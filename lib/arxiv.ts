import { DOMParser } from "jsr:@b-fuze/deno-dom"; // DOM parser for Deno (arxiv HTML parsing)

/**
 * Interface for date-like objects to handle arXiv's date format requirements
 * Allows flexibility in accepting different date representations
 */
export interface DateMatchable {
  getFullYear(): number;
  getMonth(): number;
  getDate(): number;
}

/**
 * Represents an academic paper with metadata and content
 */
export class Paper {

    public readonly arxivId: string
    private _abstract: string = ""

    constructor(arxivId: string) {
        this.arxivId = arxivId;
    }

    async abstract(): Promise<string> {
        if (!this._abstract) {
            this._abstract = await getArxivAbstract(this.arxivId);
        }
        return this._abstract
    }

    /**
     * Retrieves full paper text
     * @returns Promise resolving to cleaned paper content
     */
    async text(): Promise<string> {
        return await extractPaperText(this.arxivId);
    }
}

/**
 * Extracts arXiv IDs for papers published on a specific date from arXiv HTML listing
 * @param html - Raw HTML content from arXiv listing page (/list/cs.AI/recent)
 * @param targetDate - Date object or compatible interface representing target publication date
 * @returns Array of arXiv ID strings (e.g., ["2406.12345", "2406.67890"])
 */
export async function getArxivIdsForDate(targetDate: DateMatchable): Promise<string[]> {
      // Fetch maximum recent papers from cs.AI category
    const res = await fetch('https://arxiv.org/list/cs.AI/recent?skip=0&show=2000');
    const html = await res.text();


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
export async function getArxivAbstract(arxivId: string): Promise<string> {
  const url = `https://arxiv.org/abs/${arxivId}`;
  
    // Fetch with 5-second timeout to prevent hanging
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    
    if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
    }

    // Parse abstract from standardized blockquote element
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    if (!doc) {
      throw new Error("Failed to parse HTML document");
    }

    // Clean abstract text by removing labels and normalizing whitespace
    const abstractBlock = doc.querySelector('blockquote.abstract');
    const result =  abstractBlock?.textContent
      ?.replace(/(Abstract:|[\n\r]+|\s{2,})/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');

    if (!result) {
      throw new Error("Abstract not found in document");
    }

    return result
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
