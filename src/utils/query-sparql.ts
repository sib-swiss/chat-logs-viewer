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

export async function executeSparqlQuery(endpoint: string, query: string): Promise<SparqlResponse> {
  try {
    const response = await fetch(`${endpoint}?query=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(10000),
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
    table += `<br>...Showing 10 of ${rows.length} rows.`;
  }
  return table;
}
