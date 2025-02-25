import OpenAI from 'jsr:@openai/openai'; // OpenAI client for CentML serverless API
import { getArxivIdsForDate, Paper } from './lib/arxiv.ts';
import { tweet } from './lib/twitter.ts';

/**
 * Determines if paper aligns with CentML's focus on AI efficiency
 * @param text - Abstract text to evaluate
 * @returns Promise resolving to boolean decision
 */
async function alignedWithCentML(text: string): Promise<boolean> {
    const model = "meta-llama/Llama-3.3-70B-Instruct";
    const client = new OpenAI({
        apiKey: Deno.env.get('CENTML_API_KEY'),
        baseURL: "https://api.centml.com/openai/v1"
    });

    // Stream response for efficiency
    const stream = await client.chat.completions.create({
      messages: [
        { 
          role: "system", 
          content: "you are helpful" 
        },
        { 
          role: 'user', 
          content: `Does this abstract focus on efficiency or cost reduction in relation to either Machine Learning (ML) generally or Large Lanaguage Models (LLM) specifically? Answer yes/no:\n${text}` 
        }
      ],
      model: model,
      stream: true
    });    

    // Accumulate response chunks
    let completion = '';
    for await (const chunk of stream) {
        completion += chunk.choices[0]?.delta?.content || '';
    }

    // Simple yes/no detection
    return completion.toLowerCase().startsWith("yes");
}


/**
 * Compares two papers using AI evaluation
 * @param paper1 - First paper to compare
 * @param paper2 - Second paper to compare
 * @returns Promise resolving to the selected Paper
 */
async function mostImpactful(paper1: Paper, paper2: Paper): Promise<Paper> {
    const model = "deepseek-ai/DeepSeek-R1";
    const client = new OpenAI({
        apiKey: Deno.env.get('CENTML_API_KEY'),
        baseURL: "https://api.centml.com/openai/v1"
    });


    const messages: Array<OpenAI.ChatCompletionMessageParam> = [
        { 
          role: "system", 
          content: "you are an expert at comparing academic papers while following instructions" 
        },
        { 
          role: 'user', 
          content: `Which paper focuses more on quantifiable effeciency improvments or cost reduction? We're looking specifically for techniques/strategies/algorithms that can increase the effeciency/reduce the cost of LLMs, Reasoning Models, or machine learning/neural netorks/ai broadly. Here's the papers:\nPaper 1: ${await paper1.abstract()}\n\nPaper 2: ${await paper2.abstract()}. Answer only 1 or 2, nothing else.`
        }
    ]

    const start = new Date().getTime(); 

    // Stream comparison request
    const stream = await client.chat.completions.create({
      messages: messages,
      model: model,
      stream: true,
      stream_options: {"include_usage": true},            
    });

    // Process response chunks
    let completion = '';
    let reasoningContent = '';
    let lastChunk;
    for await (const chunk of stream) {
        completion += chunk.choices[0]?.delta?.content || '';
        reasoningContent += chunk.choices[0]?.delta?.reasoning_content || '';
        lastChunk = chunk;
    }

    const end = new Date().getTime();
    const completionTime = end - start;
    const completionTokens = lastChunk?.usage?.completion_tokens || 0;
    console.log("tokens per second:" , completionTokens / (completionTime / 1000))

    console.log("reasoning: ", reasoningContent)
    console.log("completion: ", completion)

    // Clean and parse response
    let answer = completion.replace(/\s+/g, ' ').trim();
    if (!answer.startsWith("1") && !answer.startsWith("2")) {

        console.log("Invalid response, asking for clarification")
        messages.push({
            role: "assistant",
            content: reasoningContent + completion
        })
        messages.push({
            role: "user",
            content: "Please answer with 1 or 2 ONLY."
        })
        
        // Stream comparison request
        const stream = await client.chat.completions.create({
        messages: messages,
        model: model,
        stream: true
        });

        // Process response chunks
        let updatedCompletion = '';
        let updatedReasoningContent = '';
        for await (const chunk of stream) {
            updatedCompletion += chunk.choices[0]?.delta?.content || '';
            updatedReasoningContent += chunk.choices[0]?.delta?.reasoning_content || '';
        }
        answer = completion.replace(/\s+/g, ' ').trim();
        console.log("updated reasoning: ", updatedReasoningContent)
        console.log("updated completion:", updatedCompletion)
    }

    // safety,sanity check, something really went off the rails in in the second attempt
    // we can't proceed with the comparison
    if (!answer.startsWith("1") && !answer.startsWith("2")) {
        throw new Error("Invalid response. Please answer with 1 or 2 ONLY.")
    }

    return answer.startsWith("1") ? paper1 : paper2;
}

/**
 * Generates Twitter thread from paper content
 * @param paper - Paper to summarize
 * @param summaryPrompt - Instructions for tone/style
 * @param threadLength - Number of tweets in thread
 * @returns Promise resolving to array of tweet strings
 */
async function summarize(
  paper: Paper,
  summaryPrompt: string,
  words: number
): Promise<string> {
    const model = "deepseek-ai/DeepSeek-R1";
    const client = new OpenAI({
        apiKey: Deno.env.get('CENTML_API_KEY'),
        baseURL: "https://api.centml.com/openai/v1"
    });

    // Request JSON-formatted thread
    const stream = await client.chat.completions.create({
      messages: [
        { 
          role: "system", 
          content: "you are an expert at summarizing information for mass consumption on Twittier/X (long post, not a tweet), with hashtags but one log post. You follow instructions to the letter." 
        },
        { 
          role: 'user', 
          content: `Create a approximately ${words} word summary of the following paper. ${summaryPrompt} Arxid Id: ${paper.arxivId} Paper:\n${await paper.text()}`
        }
      ],
      model: model,
      stream: true
    });

    // Collect response
    let completion = '';
    let reasoningContent = '';
    for await (const chunk of stream) {
        completion += chunk.choices[0]?.delta?.content || '';
        reasoningContent += chunk.choices[0]?.delta?.reasoning_content || '';
    }
    
    console.log("summarize reasoning: ", reasoningContent)    
    console.log("summarize completion: ", completion)
    // 1. Trim first, *before* any whitespace manipulation
    // 2. Remove code block markers, *including* the newline
    const answer = completion.trim().replace(/^```json\n|```$/g, '');
    return answer
}

/**
 * Main workflow orchestrating entire process
 * 1. Fetch recent papers
 * 2. Filter by date
 * 3. Evaluate candidates
 * 4. Generate social media content
 */
async function workflow() {    
    console.log("Starting workflow...");

    // Extract IDs for target date
    const today = new Date();
    const arxivIds = await getArxivIdsForDate(today);

    console.log(`Found ${arxivIds.length} Arxid IDs`);

    // Processing pipeline
    let leadingPaper: Paper | null = null;
    let processed = 0; 
    const total = arxivIds.length;   
    for (const id of arxivIds) {
        processed++;
        // Rate limiting and testing safeguard
        await new Promise(r => setTimeout(r, 1000));

        // Create paper instance
        const paper = new Paper(id);

        // Alignment check
        if (!await alignedWithCentML(await paper.abstract())) {
            console.log(`${processed}/${total} - Skipping ${id} - not aligned`);
            continue;
        }
        console.log(`${processed}/${total} - Processing ${id} - aligned`);

        // Comparative evaluation
        leadingPaper = leadingPaper 
          ? await mostImpactful(leadingPaper, paper)
          : paper;

        console.log("Current leader:", leadingPaper.arxivId);
    }

    // Generate social media content
    if (leadingPaper) {
        console.log("Selected paper:", leadingPaper.arxivId);        
        const summary = await summarize(
          leadingPaper,
              `The tone should be academic. No need for section titles, just a couple of paragraphs. The summary should start with "@CentML_Inc presents today's paper of the day:" then a catchy hook which entices the reader to read it. Like a news paper headline. The final sentences of the summary should start with "This paper selected and summarized by #AgenticAI using the @CentML_Inc serverless platform". "@CentML_Inc thanks" then list the authors by name as they appear in the paper. Include them all. Include the url to the abstract and the github repository if it exists. Don't use any markdown throughout the post. Don't bold things using *. Use plain urls as this is for Twitter/X. The rest of sentences/paragraphs should summarize the interesting details of the paper. Include an appropriate amount of relevant Twitter hash tags."`,
          3000
        );
        console.log("Twitter post:", summary);
    
        // check if ENABLE_TWEET is set to true before tweeting
        if (Deno.env.get("ENABLE_TWEET") === "true") {
            await tweet(summary);
        }
    }
}

// Run daily at 4 or 5am ET 
//Deno.cron("paper of the day", "01 9 * * *", async () => {
Deno.cron("paper of the day", "40 13 * * *", async () => {
    // Execute workflow
    await workflow();
}); 


