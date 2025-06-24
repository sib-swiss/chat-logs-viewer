import {createSignal, createEffect, For, Show} from "solid-js";
import {createStore} from "solid-js/store";
import {marked} from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import "highlight.js/styles/default.min.css";

import {executeSparqlQuery, formatSparqlResults} from "~/utils/query-sparql";
import {hljsDefineSparql, hljsDefineTurtle} from "~/utils/highlight-sparql";

interface SparqlBlock {
  endpoint: string;
  query: string;
}

interface Message {
  content: string;
  role: "user" | "assistant";
}

interface Conversation {
  timestamp: string;
  label: string;
  messages: Message[];
  sparql_block?: SparqlBlock;
  //   filetype: "likes" | "langfuse";
}

interface Summary {
  likes: number;
  likes_sparql: number;
  dislikes: number;
  dislikes_sparql: number;
  langfuse: number;
  langfuse_sparql: number;
  sparql_total: number;
}

// Initialize markdown and code highlight
marked.use({
  gfm: true, // Includes autolinker
});
hljs.registerLanguage("ttl", hljsDefineTurtle);
hljs.registerLanguage("sparql", hljsDefineSparql);
hljs.registerLanguage("python", python);
hljs.registerLanguage("r", r);

export default function Index() {
  const [activeTab, setActiveTab] = createSignal<string>("likes");
  const [conversations, setConversations] = createSignal<Conversation[]>([]);
  const [summary, setSummary] = createSignal<Summary>({
    likes: 0,
    likes_sparql: 0,
    dislikes: 0,
    dislikes_sparql: 0,
    langfuse: 0,
    langfuse_sparql: 0,
    sparql_total: 0,
  });
  const [sparqlOnlyFilters, setSparqlOnlyFilters] = createStore<Record<string, boolean>>({
    likes: false,
    dislikes: false,
    langfuse: false,
  });
  const [searchQuery, setSearchQuery] = createSignal<string>("");
  const [uploadedFiles, setUploadedFiles] = createStore<{
    likes: File | null;
    dislikes: File | null;
    langfuse: File | null;
  }>({
    likes: null,
    dislikes: null,
    langfuse: null,
  });
  // const [progress, setProgress] = createStore<Record<string, { executed: number; total: number; percent: number }>>({});
  const [uploadSectionExpanded, setUploadSectionExpanded] = createSignal(true);

  /** Set active tab to first available tab when files are uploaded */
  createEffect(() => {
    const availableTabs = getAvailableTabs();
    if (availableTabs.length > 0 && !availableTabs.some(tab => tab.key === activeTab())) {
      setActiveTab(availableTabs[0].key);
    }
  });

  /** Trigger code highlighting when tab changes */
  createEffect(() => {
    activeTab(); // Track the activeTab signal
    // Use a small delay to ensure DOM is updated before highlighting
    setTimeout(() => hljs.highlightAll(), 0);
  });

  /** Auto-collapse upload section when all 3 files are uploaded */
  createEffect(() => {
    const allFilesUploaded = uploadedFiles.likes && uploadedFiles.dislikes && uploadedFiles.langfuse;
    if (allFilesUploaded) {
      setUploadSectionExpanded(false);
    }
  });

  const handleFileUpload = (event: Event, fileType: "likes" | "dislikes" | "langfuse") => {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files[0]) {
      const file = target.files[0];
      setUploadedFiles(fileType, file);
      processJsonlFile(file, fileType);
    }
  };

  const processJsonlFile = async (file: File, fileType: "likes" | "dislikes" | "langfuse") => {
    const text = await file.text();
    const lines = text.trim().split("\n");
    const newConversations: Conversation[] = [];
    // let sparqlCount = 0;
    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        console.log("Processing line:", fileType, data);
        if (fileType === "langfuse") {
          // Handle langfuse format
          if (data.output && data.output.messages && Array.isArray(data.output.messages)) {
            const messages: Message[] = [];
            // Convert array format ["role", "content"] to Message objects
            for (const msg of data.output.messages) {
              // const {role, type} = messageArray;
              messages.push({
                content: msg.content || "",
                role: msg.type || msg.role || "assistant",
              });
            }
            const conversation: Conversation = {
              timestamp: data.timestamp || new Date().toISOString(),
              label: "langfuse",
              messages: messages,
              sparql_block: data.output.structured_output
                ? {
                    endpoint: data.output.structured_output["sparql_endpoint_url"] || "",
                    query: data.output.structured_output["sparql_query"] || "",
                  }
                : undefined,
            };
            // if (conversation.sparql_block) sparqlCount += 1;
            newConversations.push(conversation);
          }
        } else {
          // Handle likes/dislikes files
          // console.log("Processing likes/dislikes data:", data);
          const conversation: Conversation = {
            timestamp: data.timestamp || new Date().toISOString(),
            label: fileType,
            messages: data.messages || [],
          };
          newConversations.push(conversation);
        }
      } catch (e) {
        console.error("Error parsing line:", line, e);
      }
    }

    // Update conversations by removing old ones of this type and adding new ones
    const otherConversations = conversations().filter(c => {
      if (fileType === "langfuse") return c.label !== "langfuse";
      return c.label !== fileType;
    });
    setConversations([...otherConversations, ...newConversations]);
    updateSummary();
    hljs.highlightAll();
  };

  const updateSummary = () => {
    const allConversations = conversations();
    let totalLikes = 0,
      totalDislikes = 0,
      totalComplete = 0;
    let likesSparql = 0,
      dislikesSparql = 0,
      completeSparql = 0,
      totalSparql = 0;

    allConversations.forEach(convo => {
      let hasSparql = false;
      if (convo.sparql_block) {
        totalSparql++;
        hasSparql = true;
      }
      if (convo.label === "likes") {
        totalLikes++;
        if (hasSparql) likesSparql++;
      } else if (convo.label === "dislikes") {
        totalDislikes++;
        if (hasSparql) dislikesSparql++;
      } else if (convo.label === "langfuse") {
        totalComplete++;
        if (hasSparql) completeSparql++;
      }
    });
    setSummary({
      likes: totalLikes,
      likes_sparql: likesSparql,
      dislikes: totalDislikes,
      dislikes_sparql: dislikesSparql,
      langfuse: totalComplete,
      langfuse_sparql: completeSparql,
      sparql_total: totalSparql,
    });
  };

  const runSparql = async (endpoint: string, query: string, resultElement: HTMLElement) => {
    resultElement.innerHTML = "⏳ Running query...";
    try {
      const data = await executeSparqlQuery(endpoint, query);
      resultElement.innerHTML = formatSparqlResults(data);
    } catch (error) {
      resultElement.innerHTML = `<span class='tag-fail'>❌ Error</span><br><pre>${error}</pre>`;
    }
  };

  // const executeAllSparql = async (tabId: string) => {
  //   const sparqlBoxes = document.querySelectorAll(`#${tabId} .sparql-box`);
  //   if (!sparqlBoxes.length) return;
  //   const total = sparqlBoxes.length;
  //   setProgress(tabId, { executed: 0, total, percent: 0 });
  //   let executed = 0;
  //   for (const box of Array.from(sparqlBoxes)) {
  //     const endpoint = box.getAttribute('data-endpoint') || '';
  //     const query = box.querySelector('pre')?.textContent || '';
  //     const resultBox = box.querySelector('.sparql-result') as HTMLElement;
  //     if (resultBox) {
  //       await runSparql(endpoint, query, resultBox);
  //     }
  //     executed++;
  //     setProgress(tabId, { executed, total, percent: Math.round((executed / total) * 100) });
  //   }
  // };

  const getAvailableTabs = () => {
    const tabs: Array<{key: string; label: string; icon: string}> = [];
    if (uploadedFiles.langfuse) tabs.push({key: "langfuse", label: "Langfuse", icon: "🔌"});
    if (uploadedFiles.likes) tabs.push({key: "likes", label: "Likes", icon: "👍"});
    if (uploadedFiles.dislikes) tabs.push({key: "dislikes", label: "Dislikes", icon: "👎"});
    return tabs;
  };

  const filteredConversations = () => {
    return conversations().filter(convo => {
      if (convo.label !== activeTab()) return false;
      const onlyWithSparql = sparqlOnlyFilters[activeTab()];
      if (onlyWithSparql && !convo.sparql_block) return false;

      // Filter by search query
      const search = searchQuery().toLowerCase().trim();
      if (search) {
        const hasSearchInMessages = convo.messages.some(message => message.content.toLowerCase().includes(search));
        const hasSearchInSparql = convo.sparql_block && convo.sparql_block.query.toLowerCase().includes(search);
        if (!hasSearchInMessages && !hasSearchInSparql) return false;
      }
      return true;
    });
  };

  return (
    <div class="qa-viewer">
      <h2 style={{"text-align": "center"}}>Chat Logs Viewer</h2>

      {/* File Upload */}
      <div class="upload-section">
        <h3
          class="upload-header"
          onClick={() => setUploadSectionExpanded(!uploadSectionExpanded())}
          style={{cursor: "pointer", "user-select": "none"}}
        >
          📁 Upload JSONL logs files {uploadSectionExpanded() ? "🔻" : "🔺"}
        </h3>
        <Show when={uploadSectionExpanded()}>
          <div class="upload-buttons">
            <div class="upload-group">
              <label for="langfuse-upload" class="upload-label">
                🔌 Upload Langfuse logs
              </label>
              <input
                id="langfuse-upload"
                type="file"
                accept=".jsonl"
                onChange={e => handleFileUpload(e, "langfuse")}
                class="file-input"
              />
              <Show when={uploadedFiles.langfuse}>
                <span class="file-status">✅ {uploadedFiles.langfuse?.name}</span>
              </Show>
            </div>

            <div class="upload-group">
              <label for="likes-upload" class="upload-label">
                👍 Upload Likes logs
              </label>
              <input
                id="likes-upload"
                type="file"
                accept=".jsonl"
                onChange={e => handleFileUpload(e, "likes")}
                class="file-input"
              />
              <Show when={uploadedFiles.likes}>
                <span class="file-status">✅ {uploadedFiles.likes?.name}</span>
              </Show>
            </div>

            <div class="upload-group">
              <label for="dislikes-upload" class="upload-label">
                👎 Upload Dislikes logs
              </label>
              <input
                id="dislikes-upload"
                type="file"
                accept=".jsonl"
                onChange={e => handleFileUpload(e, "dislikes")}
                class="file-input"
              />
              <Show when={uploadedFiles.dislikes}>
                <span class="file-status">✅ {uploadedFiles.dislikes?.name}</span>
              </Show>
            </div>
          </div>
        </Show>
      </div>

      <Show when={conversations().length > 0}>
        {/* Summary */}
        <div class="summary">
          <h4>📊 Uploaded logs summary</h4>
          <table class="summary-table">
            <thead>
              <tr>
                <th>🔌 Langfuse</th>
                <th>🔌 Langfuse SPARQL</th>
                <th>👍 Likes</th>
                <th>👍 Likes SPARQL</th>
                <th>👎 Dislikes</th>
                <th>👎 Dislikes SPARQL</th>
                <th>🧠 Total SPARQL</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{summary().langfuse}</td>
                <td>{summary().langfuse_sparql}</td>
                <td>{summary().likes}</td>
                <td>{summary().likes_sparql}</td>
                <td>{summary().dislikes}</td>
                <td>{summary().dislikes_sparql}</td>
                <td>{summary().sparql_total}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Tabs */}
        <div class="tabs">
          <For each={getAvailableTabs()}>
            {tab => (
              <button
                class={`tab-button ${activeTab() === tab.key ? "active" : ""}`}
                onClick={() => setActiveTab(tab.key)}
              >
                {tab.icon} {tab.label}
              </button>
            )}
          </For>
        </div>

        {/* Tab Content */}
        <For each={getAvailableTabs()}>
          {tab => (
            <div id={tab.key} class={`tab-content ${activeTab() === tab.key ? "active" : ""}`}>
              <div class="filters">
                <div class="filter">
                  <label>
                    <input
                      type="checkbox"
                      checked={sparqlOnlyFilters[tab.key]}
                      onChange={e => setSparqlOnlyFilters(tab.key, e.target.checked)}
                    />
                    Show only conversations with SPARQL
                  </label>
                </div>
                <div class="filter">
                  <label>
                    🔍
                    <input
                      type="text"
                      placeholder="Search in messages"
                      value={searchQuery()}
                      onInput={e => setSearchQuery(e.target.value)}
                      class="search-input"
                    />
                  </label>
                </div>
              </div>

              {/* <button onClick={() => executeAllSparql(tab.key)}>
                Execute All SPARQL Queries
              </button>
              <Show when={progress[tab.key]}>
                <div class="execute-all-report">
                  <div class="progress-bar">
                    <div
                      class="progress-bar-inner"
                      style={`width: ${progress[tab.key]?.percent || 0}%`}
                    ></div>
                  </div>
                  <div class="progress-label">
                    Executed {progress[tab.key]?.executed || 0}/{progress[tab.key]?.total || 0}
                  </div>
                </div>
              </Show> */}

              <Show when={activeTab() === tab.key}>
                <For each={filteredConversations()}>
                  {convo => (
                    <div class="box">
                      <h4 style={{"margin-bottom": ".5em"}}>🗓️ Conversation at {convo.timestamp}</h4>
                      <For each={convo.messages} fallback={<div>No messages found</div>}>
                        {(message, index) => {
                          const isLastMessage = index() === convo.messages.length - 1;
                          const isOddMessage = convo.messages.length % 2 === 1 && isLastMessage;
                          return (
                            <div class={`round ${isOddMessage ? "incomplete-round" : ""}`}>
                              <div
                                class={`message ${["user", "human"].includes(message.role) ? "user-icon" : "assistant-icon"}`}
                              >
                                <strong style={{"margin-left": ".2em"}}>{message.role}</strong>
                                <br />
                                {/* eslint-disable-next-line solid/no-innerhtml */}
                                <article innerHTML={DOMPurify.sanitize(marked.parse(message.content) as string)} />
                              </div>
                            </div>
                          );
                        }}
                      </For>
                      {convo.sparql_block && (
                        <div class="sparql-box" data-endpoint={convo.sparql_block.endpoint}>
                          <div class="sparql-meta">
                            <strong>Endpoint:</strong>{" "}
                            <a href={convo.sparql_block.endpoint} target="_blank" rel="noopener noreferrer">
                              {convo.sparql_block.endpoint}
                            </a>
                          </div>
                          <pre>
                            <code class="language-sparql hljs">{convo.sparql_block.query}</code>
                          </pre>
                          <button
                            onClick={e => {
                              const box = e.target.closest(".sparql-box");
                              const resultBox = box?.querySelector(".sparql-result") as HTMLElement;
                              if (resultBox && convo.sparql_block) {
                                runSparql(convo.sparql_block.endpoint, convo.sparql_block.query, resultBox);
                              }
                            }}
                          >
                            Execute
                          </button>
                          <div class="sparql-result" />
                        </div>
                      )}
                    </div>
                  )}
                </For>
              </Show>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}
