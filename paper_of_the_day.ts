import OpenAI from 'jsr:@openai/openai'; // OpenAI client for CentML serverless API
import { getArxivIdsForDate, Paper } from './lib/arxiv.ts';
import { tweetThread } from './lib/twitter.ts';

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
          content: "you are helpful" 
        },
        { 
          role: 'user', 
          content: `Which paper focuses more on AI cost reduction? We're looking specifically for techniques/strategies/algorithms that can increase the effeciency/reduce the cost of LLMs, Reasoning Models, or machine learning/neural netorks/ai broadly. It is essential that the finaly output answers only 1 or 2 and nothing else. Here's the papers:\nPaper 1: ${await paper1.abstract()}\n\nPaper 2: ${await paper2.abstract()}`
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
async function summarizeWithTweetThread(
  paper: Paper,
  summaryPrompt: string,
  threadLength: number
): Promise<string[]> {
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
          content: "you are an expert at summarizing information for mass consumption on Twittier/X" 
        },
        { 
          role: 'user', 
          content: `Create ${threadLength}-tweet summary thread of the following paper as a JSON array of strings. Each tweet (string) should only be 280 characters at most! ${summaryPrompt} Arxid Id: ${paper.arxivId} Paper:\n${await paper.text()}`
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

    // Parse JSON with error handling
    try {
        return JSON.parse(answer);
    } catch(err) {
        console.error("JSON parse error:", err);
        console.error(answer)
        return [];
    }
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

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 6);

    // Extract IDs for target date
    const arxivIds = await getArxivIdsForDate(yesterday);

    console.log(`Found ${arxivIds.length} Arxid IDs`);

    // Processing pipeline
    let leadingPaper: Paper | null = null;
    let processed = 0;    
    for (const id of arxivIds) {
        // Rate limiting and testing safeguard
        await new Promise(r => setTimeout(r, 1000));

        // Create paper instance
        const paper = new Paper(id);

        // Alignment check
        if (!await alignedWithCentML(await paper.abstract())) {
            console.log(`Skipping ${id} - not aligned`);
            continue;
        }
        console.log(`Processing ${id} - aligned`);

        // Comparative evaluation
        leadingPaper = leadingPaper 
          ? await mostImpactful(leadingPaper, paper)
          : paper;

        console.log("Current leader:", leadingPaper.arxivId);
        if (++processed >= 2) break; 
    }

    // Generate social media content
    if (leadingPaper) {
        console.log("Selected paper:", leadingPaper.arxivId);        
        const thread = await summarizeWithTweetThread(
          leadingPaper,
          `The tone should be academic. Each tweet should be 
           numbered correctly. 
           The first tweet should end with "This paper selected and 
           summarized by #AgenticAI using @CentML serverless platform. 
           The first tweet should start with a hook which describes 
           the thread and entices the reader to read it. The last
           tweet should start with "@CentML thanks" then list the authors 
           by name. Include a link to the  abstract. The rest of the tweets 
           should summarize the interesting
           details of the paper."`,
          12
        );
        console.log("Twitter Thread:", thread);
        //tweetThread(thread)

    }
}

// Execute workflow
await workflow();