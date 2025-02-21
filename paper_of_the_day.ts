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
          content: `Does this abstract focus on AI efficiency/cost reduction? Answer yes/no:\n${text}` 
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

    // Stream comparison request
    const stream = await client.chat.completions.create({
      messages: [
        { 
          role: "system", 
          content: "you are helpful and follow instructions percisely" 
        },
        { 
          role: 'user', 
          content: `Which paper focuses more on AI cost reduction? We're looking specifically for techniques/strategies/algorithms that can increase the effeciency/reduce the cost of LLMs, Reasoning Models, or machine learning/neural netorks/ai broadly. It is essential that the final output answers only 1 or 2 and nothing else. This is very important. Nothing else! Here's the papers:\nPaper 1: ${await paper1.abstract()}\n\nPaper 2: ${await paper2.abstract()}`
        }
      ],
      model: model,
      stream: true
    });

    // Process response chunks
    let completion = '';
    for await (const chunk of stream) {
        completion += chunk.choices[0]?.delta?.content || '';
    }

    console.log(completion)

    // Clean and parse response
    const rawAnswer = completion.split("</think>").pop() || '';
    const answer = rawAnswer.replace(/\s+/g, ' ').trim();
    
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
          content: "you are an expert at summarizing information for mass consumption on Twittier/X (long post, not a tweet), with hashtags but one log post." 
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
    for await (const chunk of stream) {
        completion += chunk.choices[0]?.delta?.content || '';
    }

    let answer = completion.split("</think>").pop() || ''; // Remove potential prefix
    
    // 1. Trim first, *before* any whitespace manipulation
    answer = answer.trim();

    // 2. Remove code block markers, *including* the newline
    answer = answer.replace(/^```json\n|```$/g, '');
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
              `The tone should be academic. No need for section titles, just a couple of paragraphs. The summary should start with "@CentML_Inc presents today's paper of the day:" then a catchy hook which entices the reader to read it. Like a news paper headline. The final sentences of the summary should start with "This paper selected and summarized by #AgenticAI using the @CentML_Inc serverless platform". "@CentML_Inc thanks" then list the authors by name. Try to include them all. Include the url to the abstract and the github repository if it exists. Don't wrap the url in markdown, just use the plain url as this is for Twitter/X. The rest of sentences/paragraphs should summarize the interesting details of the paper."`,
          4000
        );
        console.log("Twitter post:", summary);
    
        // check if ENABLE_TWEET is set to true before tweeting
        if (Deno.env.get("ENABLE_TWEET") === "true") {
            await tweet(summary);
        }
    }
}

// Run daily at 4 or 5am ET 
Deno.cron("paper of the day", "01 9 * * *", async () => {
    // Execute workflow
    await workflow();
}); 

await workflow();

