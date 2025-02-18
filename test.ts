// Import required libraries
import { DOMParser } from "jsr:@b-fuze/deno-dom"; // DOM parser for Deno (arxiv HTML parsing)
import OpenAI from 'jsr:@openai/openai'; // OpenAI client for CentML serverless API

/**
 * Interface for date-like objects to handle arXiv's date format requirements
 * Allows flexibility in accepting different date representations
 */
interface DateMatchable {
  getFullYear(): number;
  getMonth(): number;
  getDate(): number;
}

/**
 * Extracts arXiv IDs for papers published on a specific date from arXiv HTML listing
 * @param html - Raw HTML content from arXiv listing page (/list/cs.AI/recent)
 * @param targetDate - Date object or compatible interface representing target publication date
 * @returns Array of arXiv ID strings (e.g., ["2406.12345", "2406.67890"])
 */
function extractArxivIdsForDate(html: string, targetDate: DateMatchable): string[] {
  // Parse HTML document using Deno DOM parser
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) return [];

  // Convert JavaScript date to arXiv's display format (1-based month)
  const targetYear = targetDate.getFullYear();
  const targetMonth = targetDate.getMonth() + 1; // Convert from 0-indexed
  const targetDay = targetDate.getDate();

  // Find all date navigation entries in left sidebar
  const dateEntries = Array.from(doc.querySelectorAll('ul li a'));

  // Find matching date entry using arXiv's "DD Mon YYYY" format
  const matchingDateEntry = dateEntries.find(entry => {
    const dateText = entry.textContent.trim().split('(')[0].trim();
    const dateMatch = dateText.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
    if (!dateMatch) return false;

    // Extract date components from matched text
    const [, day, monthStr, year] = dateMatch;
    const month = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ].indexOf(monthStr) + 1;

    // Compare with target date components
    return (
      parseInt(year) === targetYear &&
      month === targetMonth &&
      parseInt(day) === targetDay
    );
  });

  if (!matchingDateEntry) return [];

  // Locate corresponding articles section header
  const fullDateString = matchingDateEntry.textContent.trim().split(/\s+/).slice(0, 4).join(' ');
  const dateHeader = Array.from(doc.querySelectorAll('dl#articles h3'))
    .find(h3 => h3.textContent.includes(fullDateString));
  
  if (!dateHeader) return [];

  // Collect all arXiv IDs under matching date section
  const arxivIds: string[] = [];
  let nextNode = dateHeader.nextElementSibling;
  
  // Traverse DOM siblings until next date header
  while (nextNode && !nextNode.matches('h3')) {
    if (nextNode.matches('dt')) {
      const abstractLink = nextNode.querySelector('a[href^="/abs/"]');
      const href = abstractLink?.getAttribute('href');
      
      // Extract ID from /abs/ URL path segment
      if (href) {
        const id = href.split('/').pop() || '';
        if (id) arxivIds.push(id);
      }
    }
    nextNode = nextNode.nextElementSibling;
  }

  return arxivIds;
}

/**
 * Fetches and cleans abstract text from arXiv.org
 * @param arxivId - arXiv paper identifier (e.g., "2406.12345")
 * @returns Cleaned abstract text or null if retrieval fails
 */
export async function getArxivAbstract(arxivId: string): Promise<string | null> {
  const url = `https://arxiv.org/abs/${arxivId}`;
  
  try {
    // Fetch with 5-second timeout to prevent hanging
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    
    if (!response.ok) {
      console.error(`HTTP error! Status: ${response.status}`);
      return null;
    }

    // Parse abstract from standardized blockquote element
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    if (!doc) {
      console.error("Failed to parse HTML document");
      return null;
    }

    // Clean abstract text by removing labels and normalizing whitespace
    const abstractBlock = doc.querySelector('blockquote.abstract');
    return abstractBlock?.textContent
      ?.replace(/(Abstract:|[\n\r]+|\s{2,})/g, ' ')
      .trim()
      .replace(/\s+/g, ' ') || null;

  } catch (error) {
    console.error(`Error fetching abstract: ${error}`);
    return null;
  }
}

/**
 * Extracts full paper text from arXiv HTML version
 * @param arxivId - arXiv paper identifier
 * @returns Cleaned concatenated text of paper paragraphs
 * @throws Error if paper structure is unexpected
 */
async function extractPaperText(arxivId: string): Promise<string> {
  const arxivUrl = `https://arxiv.org/html/${arxivId}v1`;
  const response = await fetch(arxivUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch paper: ${response.status} ${response.statusText}`);
  }

  // Parse document structure
  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) throw new Error("Failed to parse HTML document");

  // Extract main article content
  const article = doc.querySelector('article.ltx_document');
  if (!article) throw new Error("Paper article element not found");

  // Process paragraphs and filter unwanted sections
  return Array.from(article.querySelectorAll('p.ltx_p'))
    .map(p => {
      return p.textContent
        .replace(/\s+/g, ' ')     // Collapse whitespace
        .replace(/\u00a0/g, ' ')  // Replace non-breaking spaces
        .trim();
    })
    .filter(text => 
      text && 
      !text.startsWith("References") && // Exclude bibliography
      !text.match(/^arXiv:\d{4}\.\d{5}/) // Remove arXiv footer
    )
    .join('\n\n'); // Join paragraphs with double newlines
}

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
 * Represents an academic paper with metadata and content
 */
class Paper {
  constructor(
    public readonly arxivId: string,
    public readonly abstract: string
  ) {}

  /**
   * Retrieves full paper text
   * @returns Promise resolving to cleaned paper content
   */
  async text(): Promise<string> {
    return await extractPaperText(this.arxivId);
  }
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
          content: `Which paper focuses more on AI cost reduction? Answer 1 or 2:\nPaper 1: ${paper1.abstract}\n\nPaper 2: ${paper2.abstract}`
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
          content: "you are helpful" 
        },
        { 
          role: 'user', 
          content: `Create ${threadLength}-tweet thread as JSON array. ${summaryPrompt}:\n${await paper.text()}`
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

    // Clean JSON response
    let answer = completion
      .split("</think>").pop() || ''          // Remove potential prefix
      .replace(/^```json|```$/g, '')     // Remove code block markers
      .replace(/\s+/g, ' ').trim();

    // Parse JSON with error handling
    try {
        return JSON.parse(answer);
    } catch(err) {
        console.error("JSON parse error:", err);
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
    // Fetch maximum recent papers from cs.AI category
    const res = await fetch('https://arxiv.org/list/cs.AI/recent?skip=0&show=2000');
    const html = await res.text();

    // Calculate target date (currently set to 4 days ago for testing)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 4);

    // Extract IDs for target date
    const arxivIds = extractArxivIdsForDate(html, yesterday);

    // Processing pipeline
    let leadingPaper: Paper | null = null;
    let processedCount = 0;
    
    for (const id of arxivIds) {
        // Fetch and validate abstract
        const abstract = await getArxivAbstract(id);
        if (!abstract) {
            console.error(`Skipping ${id} - abstract unavailable`);
            continue;
        }

        // Create paper instance
        const paper = new Paper(id, abstract);

        // Alignment check
        if (!await alignedWithCentML(abstract)) {
            console.log(`Skipping ${id} - not aligned`);
            continue;
        }
        console.log(`Processing ${id} - aligned`);

        // Comparative evaluation
        leadingPaper = leadingPaper 
          ? await mostImpactful(leadingPaper, paper)
          : paper;

        console.log("Current leader:", leadingPaper.arxivId);

        // Rate limiting and testing safeguard
        await new Promise(r => setTimeout(r, 1000));
        if (++processedCount > 2) break; // Temporary limit for development
    }

    // Generate social media content
    if (leadingPaper) {
        console.log("Selected paper:", leadingPaper.arxivId);
        const summary = await summarizeWithTweetThread(
          leadingPaper,
          `Serious tone. First tweet must include @CentML and #AgenticAI`,
          10
        );
        console.log("Twitter Thread:", summary);
    }
}

// Execute workflow
await workflow();