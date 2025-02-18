// Import required libraries
import { DOMParser } from "jsr:@b-fuze/deno-dom";  // DOM parser for Deno
import OpenAI from 'jsr:@openai/openai';

// Interface for date-like objects to allow flexibility in date handling
interface DateMatchable {
  getFullYear(): number;
  getMonth(): number;
  getDate(): number;
}

/**
 * Extracts arXiv IDs for papers published on a specific date from arXiv HTML listing
 * @param html - The HTML content of arXiv listing page
 * @param targetDate - The date to filter papers by
 * @returns Array of arXiv IDs (strings)
 */
function extractArxivIdsForDate(html: string, targetDate: DateMatchable): string[] {
  // Parse HTML document
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) return [];

  // Extract target date components (convert to arXiv's date format)
  const targetYear = targetDate.getFullYear();
  const targetMonth = targetDate.getMonth() + 1;  // Months are 0-indexed in JS
  const targetDay = targetDate.getDate();

  // Find all date entries in the navigation list
  const dateEntries = Array.from(doc.querySelectorAll('ul li a'));

  // Find matching date entry in navigation
  const matchingDateEntry = dateEntries.find(entry => {
    const dateText = entry.textContent.trim().split('(')[0].trim();
    const dateMatch = dateText.match(/(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})/);
    if (!dateMatch) return false;

    // Parse date components from matched text
    const [, day, monthStr, year] = dateMatch;
    const month = [
      'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
      'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
    ].indexOf(monthStr) + 1;

    return (
      parseInt(year) === targetYear &&
      month === targetMonth &&
      parseInt(day) === targetDay
    );
  });

  if (!matchingDateEntry) return [];

  // Find corresponding date header in articles section
  const fullDateString = matchingDateEntry.textContent.trim().split(/\s+/).slice(0, 4).join(' ');
  const dateHeader = Array.from(doc.querySelectorAll('dl#articles h3'))
    .find(h3 => h3.textContent.includes(fullDateString));
  
  if (!dateHeader) return [];

  // Collect arXiv IDs under matching date header
  const arxivIds: string[] = [];
  let nextNode = dateHeader.nextElementSibling;
  
  // Traverse sibling elements until next date header
  while (nextNode && !nextNode.matches('h3')) {
    if (nextNode.matches('dt')) {
      const abstractLink = nextNode.querySelector('a[href^="/abs/"]');
      const href = abstractLink?.getAttribute('href');
      
      if (href) {
        // Extract ID from URL path /abs/[ID]
        const id = href.split('/').pop() || '';
        if (id) arxivIds.push(id);
      }
    }
    nextNode = nextNode.nextElementSibling;
  }

  return arxivIds;
}

/**
 * Fetches and extracts abstract from arXiv.org by paper ID
 * @param arxivId The arXiv paper ID (e.g., "2502.09601")
 * @returns Cleaned abstract text or null if not found
 */
export async function getArxivAbstract(arxivId: string): Promise<string | null> {
  const url = `https://arxiv.org/abs/${arxivId}`;
  
  try {
    // Fetch paper page with timeout
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    
    if (!response.ok) {
      console.error(`HTTP error! Status: ${response.status}`);
      return null;
    }

    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    if (!doc) {
      console.error("Failed to parse HTML document");
      return null;
    }

    const abstractBlock = doc.querySelector('blockquote.abstract');
    
    // Clean up the abstract text
    return abstractBlock?.textContent
      ?.replace(/(Abstract:|[\n\r]+|\s{2,})/g, ' ') // Normalize whitespace
      .trim()
      .replace(/\s+/g, ' ') || null;

  } catch (error) {
    console.error(`Error fetching abstract: ${error}`);
    return null;
  }
}

async function extractPaperText(arxivId: string): Promise<string> {
  // Construct arXiv HTML URL
  const arxivUrl = `https://arxiv.org/html/${arxivId}v1`;
  
  // Fetch HTML from arXiv
  const response = await fetch(arxivUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch paper: ${response.status} ${response.statusText}`);
  }
  const html = await response.text();

  // Parse document
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) throw new Error("Failed to parse HTML document");

  // Find main article content
  const article = doc.querySelector('article.ltx_document');
  if (!article) throw new Error("Paper article element not found");

  // Extract and clean text
  return Array.from(article.querySelectorAll('p.ltx_p'))
    .map(p => {
      return p.textContent
        .replace(/\s+/g, ' ')     // Normalize whitespace
        .replace(/\u00a0/g, ' ')  // Replace non-breaking spaces
        .trim();
    })
    .filter(text => 
      text && 
      !text.startsWith("References") && // Exclude references header
      !text.match(/^arXiv:\d{4}\.\d{5}/) // Exclude arXiv footer
    )
    .join('\n\n');
}

async function alignedWithCentML(text: string): Promise<boolean> {
    const model = "meta-llama/Llama-3.3-70B-Instruct"

    const client = new OpenAI({
        apiKey: Deno.env.get('CENTML_API_KEY'),
        baseURL: "https://api.centml.com/openai/v1"
    });

    const stream = await client.chat.completions.create({
      messages: [
        { role: "system", content: "you are helpful" },
        { role: 'user', content: `Here is an abstract from an academic paper. Does the research described in this paper focus on increasing effeciency or reducing costs associated with a critical aspect of artificial intelligence? Please just answer yes or no. \`\`\`${text}\`\`\` ` }],
      model: model,
      stream: true
    });    

    let completion = '';
    for await (const chunk of stream) {
        completion += chunk.choices[0]?.delta?.content || '';
    }

    if (completion.toLowerCase().startsWith("yes")) {
        return true;
    }
    return false;
}


class Paper {
    arxivId: string;
    abstract: string;
    constructor(arxivId: string, abstract: string) {
        this.arxivId = arxivId;
        this.abstract = abstract;
    }

    async text(): Promise<string> {
        return await extractPaperText(this.arxivId)
    }
}

// Compare two papers to determine which is more impactful
async function mostImpactful(paper1: Paper, paper2: Paper): Promise<Paper> {
    const model = "deepseek-ai/DeepSeek-R1"

    const client = new OpenAI({
        apiKey: Deno.env.get('CENTML_API_KEY'),
        baseURL: "https://api.centml.com/openai/v1"
    });

    const stream = await client.chat.completions.create({
      messages: [
        { role: "system", content: "you are helpful" },
        { role: 'user', content: `Which of these two papers seems to be more directly related to optimization, algorithms, or techniques which might lower the cost of artificial intelligence/reasoning by increasing effciency of some aspect of the system? Please just return 1 or 2 as your answer. \`\`\`Paper 1: ${paper1.abstract}\n\nPaper 2: ${paper2.abstract}\`\`\` ` }],
      model: model,
      stream: true
    });    

    let completion = '';
    for await (const chunk of stream) {
        completion += chunk.choices[0]?.delta?.content || '';
    }

    // get rid of the thinking 
    const rawAnswer = completion.split("</think>").pop() || '';
    const answer = rawAnswer.replace(/\s+/g, ' ').trim();
    if (answer.startsWith("1")) {
        return paper1;
    }
    return paper2;

}

async function summarizeWithTweetThread(paper: Paper, summaryPrompt: string, threadLength: number): Promise<string[]> {
   const model = "deepseek-ai/DeepSeek-R1"

    const client = new OpenAI({
        apiKey: Deno.env.get('CENTML_API_KEY'),
        baseURL: "https://api.centml.com/openai/v1"
    });

    const stream = await client.chat.completions.create({
      messages: [
        { role: "system", content: "you are helpful" },
        { role: 'user', content: `Please summarize this academic paper by creating a ${threadLength} tweet/post thread for twitter/x. The output format should be a json array of tweet text only, it must be parsible so nothing else. ${summaryPrompt}. Please:\`\`\`${await paper.text()}\`\`\` ` }],
      model: model,
      stream: true
    });    

    let completion = '';
    for await (const chunk of stream) {
        completion += chunk.choices[0]?.delta?.content || '';
    }

    // get rid of the thinking 
    const rawAnswer = completion.split("</think>").pop() || '';
    console.log("rawAnswer:", rawAnswer);

    let answer = rawAnswer.replace(/\s+/g, ' ').trim();

    // the remaining answer should be wrapped in json markdown code block, remove that
    answer = answer.replace(/^```json/g, '');
    answer = answer.replace(/```$/g, '');

    console.log("answer:", answer);

    let result = []
    try {
        result = JSON.parse(answer);
    } catch(err) {
        console.error("Error parsing JSON: ", err);
    }
    return result;
}

// workflow is the main function that orchestrates the entire process
async function workflow() {    

    const res = await fetch('https://arxiv.org/list/cs.AI/recent?skip=0&show=2000');
    const html = await res.text();

    // Calculate yesterday's date (target date for papers)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 4);

    // Extract arXiv IDs from yesterday's papers
    const axrivids = extractArxivIdsForDate(html, yesterday);

    // Process each paper with rate limiting
    let leadingPaper: Paper | null = null;
    let count = 0;
    for (const id of axrivids) {

        const abstract = await getArxivAbstract(id);
        if (!abstract) {
            console.error(`Failed to fetch abstract for ${id}`);
            continue;
        }

        const paper = new Paper(id, abstract);

        if (!await alignedWithCentML(abstract)) {
            console.log(`The paper ${paper.arxivId} *is not* aligned with CentML`);
            continue
        }
        console.log(`The paper ${paper.arxivId} *is* aligned with CentML`);

        if (leadingPaper) {
            leadingPaper = await mostImpactful(leadingPaper, paper);
            console.log("Most impactful paper so far: ", leadingPaper?.arxivId);
        } else {
            leadingPaper = paper;
        }

        await new Promise(r => setTimeout(r, 1000));
        count++;

        if (count > 2) {
            break;
        }
    }

    console.log("Most impactful paper:\n ", leadingPaper!.arxivId);
    console.log(leadingPaper?.abstract)

    const summary = await summarizeWithTweetThread(leadingPaper!, 
        `The tone of the summary posts should be serious and factual.
         The first tweet in the thread should explain why the rest is worth reading
         and mention that this is today's paper of the day presented by
         @CentML built using #AgenticAI`, 10);
    console.log(summary);
}

await workflow()