import {Parser} from "sparqljs";

// API utilities for SPARQL execution

export interface SparqlResponse {
  success: boolean;
  result?: {
    results: {
      bindings: Array<{[key: string]: {value: string; type?: string}}>;
    };
  };
  error?: string;
}

/**
 * Execute a SPARQL query against a endpoint URL
 * @param endpoint The SPARQL endpoint URL.
 * @param query The SPARQL query string to execute.
 * @returns A JSON object containing the results or an error message.
 */
export async function executeSparqlQuery(endpoint: string, query: string): Promise<SparqlResponse> {
  try {
    const response = await fetch(`${endpoint}?query=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(60000),
      headers: {
        Accept: "application/sparql-results+json",
      },
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return {
      success: true,
      result: await response.json(),
    };
  } catch (error: any) {
    console.warn("Error executing SPARQL query:", error);
    return {
      success: false,
      error: error.toString(),
    };
  }
}

/**
 * Format SPARQL results into an HTML table.
 * @param data The response from the SPARQL query execution.
 * @returns A string containing HTML to display the results.
 */
export function formatSparqlResults(data: SparqlResponse): string {
  if (!data.success) {
    return `<span class='tag-fail'>❌ Query failed</span><br><pre>${data.error || "Unknown error"}</pre>`;
  }
  const rows = data.result?.results?.bindings || [];
  if (rows.length === 0) {
    return "<span class='tag-success'>✅ No results</span>";
  }
  const keys = Object.keys(rows[0]);
  let table = `<span class='tag-success'>✅ ${rows.length} rows</span><br><table border='1' cellpadding='4'><thead><tr>`;
  table += keys.map(k => `<th>${k}</th>`).join("");
  table += "</tr></thead><tbody>";

  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i];
    table += "<tr>" + keys.map(k => `<td>${row[k]?.value || ""}</td>`).join("") + "</tr>";
  }
  table += "</tbody></table>";
  if (rows.length > 10) {
    table += `<br>Showing 10 of ${rows.length} rows.`;
  }
  return table;
}

/** Count BGPs (Basic Graph Patterns) in a SPARQL query */
export const countBGPs = (sparqlQuery: string): number => {
  let count = 0;
  try {
    const parser = new Parser();
    const parsed: any = parser.parse(sparqlQuery);
    for (const block of parsed.where) {
      if (block.type === "bgp") {
        count += block.triples.length;
      }
    }
    return count;
  } catch (error) {
    console.warn("Failed to parse SPARQL query for BGP counting:", error);
    return 0;
  }
};
