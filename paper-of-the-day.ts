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

    const schema = {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
            "result": {
            "type": "boolean"
            }
        },
        "required": ["result"],
        "additionalProperties": false
    };
    const start = new Date().getTime();

    // Stream response for efficiency
    const response = await client.chat.completions.create({
      messages: [
        { 
          role: "system", 
          content: `You are a helpful AI assistant. Here's the json schema you need to adhere to: <schema>${JSON.stringify(schema)}</schema>` 
        },
        { 
          role: 'user', 
          content: `Does this abstract focus on efficiency or cost reduction in relation to either Machine Learning (ML) generally or Large Lanaguage Models (LLM) specifically? Answer true or false in the json:\n${text}` 
        }
      ],
      model: model,      stream: false,
      response_format: {
        type: "json_schema",
        json_schema:  {
            "name": "result",
            "schema": schema,
        strict: true,        
        }
      }
    });    

    const completionTokens = response.usage?.completion_tokens || 0;
    const end = new Date().getTime();
    const completionTime = end - start;
    // Note tokens per second is a bit meaningless here, as their are so few tokens
    // the latency of the request and time to first token are big factors
    console.log("alignedWithCentML tokens per second:" , completionTokens / (completionTime / 1000))

    // Accumulate response chunks
    const completion = response.choices[0]?.message.content || '';    
    const result = JSON.parse(completion);
    return result.result;
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

    const schema = {
        "name": "result",
        "schema": {
            "$schema": "http://json-schema.org/draft-07/schema#",
            "type": "object",
            "properties": {
                "result": {
                "type": "integer",
                "enum": [1, 2]
                }
            },
            "required": ["result"],
            "additionalProperties": false
        },
        strict: true
    }

    const messages: Array<OpenAI.ChatCompletionMessageParam> = [
        { 
            role: "system", 
            content: `You are an expert at comparing academic papers while following instructions. Here's the json schema you need to adhere to in your response: <schema>${JSON.stringify(schema)}</schema>`
        },
        { 
          role: 'user', 
          content: `Which paper focuses more on quantifiable effeciency improvments or cost reduction? We're looking specifically for techniques/strategies/algorithms that can increase the effeciency/reduce the cost of LLMs, Reasoning Models, or machine learning/neural netorks/ai broadly. Here's the papers:\nPaper 1: ${await paper1.abstract()}\n\nPaper 2: ${await paper2.abstract()}. Result should specify paper 1 or 2.`
        }
    ]

    const start = new Date().getTime(); 

    // Stream comparison request
    const response = await client.chat.completions.create({
        messages: messages,
        model: model,
        stream: false,
        response_format: {
            type: "json_schema",
            json_schema:  schema,
            
        }
    });

    const completionTokens = response.usage?.completion_tokens || 0;
    const end = new Date().getTime();
    const completionTime = end - start;
    // Note tokens per second is a bit meaningless here, as their are so few tokens
    // the latency of the request and time to first token are big factors
    console.log("mostImpactful tokens per second:" , completionTokens / (completionTime / 1000))
    
    console.log("reasoning: ", response.choices[0]?.message.reasoning_content)

    // Accumulate response chunks
    const completion = response.choices[0]?.message.content || '';    
    const result = JSON.parse(completion);

    console.log("selected paper number: ", result.result)

    if (result.result === 1) {
        return paper1;
    }
    return paper2;
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
  characters: number
): Promise<string> {
    const model = "deepseek-ai/DeepSeek-R1";
    const client = new OpenAI({
        apiKey: Deno.env.get('CENTML_API_KEY'),
        baseURL: "https://api.centml.com/openai/v1"
    });

    const schema = {
        "$schema": "http://json-schema.org/draft-07/schema#",
        "type": "object",
        "properties": {
            "result": {
            "type": "string"
            }
        },
        "required": ["result"],
        "additionalProperties": false
    }

    const start = new Date().getTime();
    // Request JSON-formatted thread
    const response = await client.chat.completions.create({
        messages: [
        { 
            role: "system", 
            content: `You are an expert at summarizing information for mass consumption as a post. Here's the JSON schema you must adhere to: <schema>${JSON.stringify(schema)}</schema>`
        },
        { 
            role: 'user', 
            content: `Create an approximately ${characters} character summary of the following paper. ${summaryPrompt} Arxid Id: ${paper.arxivId} Paper:\n${await paper.text()}`
        }
        ],
        model: model,
        stream: false, 
        response_format: {
            type: "json_schema",
            json_schema:  {
                "name": "result",
                "schema": schema,
            strict: true,        
            }
        }
    });

    const completionTokens = response.usage?.completion_tokens || 0;
    const end = new Date().getTime();
    const completionTime = end - start;
    // Note tokens per second is a bit meaningless here, as their are so few tokens
    // the latency of the request and time to first token are big factors
    console.log("summarize tokens per second:" , completionTokens / (completionTime / 1000))
    
    console.log("reasoning: ", response.choices[0]?.message.reasoning_content)

    // Accumulate response chunks
    const completion = response.choices[0]?.message.content || '';    
    const result = JSON.parse(completion);
    return result.result;

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
        let summary = await summarize(
          leadingPaper,
              `The tone should be academic. No need for section titles but it should be a few paragraphs separated with \\n. The summary should start with "@CentML_Inc presents today's paper of the day:" then a catchy hook which entices the reader to read it. Like a news paper headline. The final sentences of the summary should start with "This paper selected and summarized by #AgenticAI using the @CentML_Inc serverless platform. The agent sifted through ${arxivIds.length} papers today.". "@CentML_Inc thanks" then list the authors by name as they appear in the paper. Include them all. Include the url to the abstract and the github repository if it exists. Don't use any markdown throughout the post. Don't bold things using *. Use plain urls without markdown. The rest of sentences/paragraphs should summarize the interesting details of the paper. Include an appropriate amount of relevant Twitter hash tags at the end."`,
          3000
        );

        summary = summary.replace("**", "")
        console.log("Twitter post:", summary);
    
        // check if ENABLE_TWEET is set to true before tweeting
        if (Deno.env.get("ENABLE_TWEET") === "true") {
            await tweet(summary);
        }
    }
}

// Run daily at 4 or 5am ET 
Deno.cron("paper of the day", "1 9 * * *", async () => {
    // Execute workflow
    await workflow();
    console.log("workflow completed")
}); 


