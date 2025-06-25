import {createSignal, createEffect, For, Show} from "solid-js";
import {createStore} from "solid-js/store";
import {marked} from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import "highlight.js/styles/default.min.css";

import xIcon from "~/assets/x.svg";
import sendIcon from "~/assets/send.svg";
import githubIcon from "~/assets/github.svg";
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
  steps: Step[];
  totalCost?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  //   filetype: "likes" | "langfuse";
}

interface Step {
  node_id: string;
  label: string;
  details: string; // Details about the step as markdown string
  substeps?: {label: string; details: string}[];
  // retrieved_docs?: RefenceDocument[];
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
  const [conversationFilters, setConversationFilters] = createStore<
    Record<
      string,
      {
        withSparql: boolean;
        withoutSparql: boolean;
        withInvalidQuery: boolean;
        minMessages: number;
      }
    >
  >({
    likes: {withSparql: true, withoutSparql: true, withInvalidQuery: false, minMessages: 1},
    dislikes: {withSparql: true, withoutSparql: true, withInvalidQuery: false, minMessages: 1},
    langfuse: {withSparql: true, withoutSparql: true, withInvalidQuery: false, minMessages: 1},
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
  const [uploadSectionExpanded, setUploadSectionExpanded] = createSignal(true);

  // To display steps
  const [dialogOpen, setDialogOpen] = createSignal("");
  const [selectedDocsTab, setSelectedDocsTab] = createSignal("");

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
    setTimeout(() => highlightAll(), 0);
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
      setActiveTab(fileType);
    }
  };

  const processJsonlFile = async (file: File, fileType: "likes" | "dislikes" | "langfuse") => {
    const text = await file.text();
    const lines = text.trim().split("\n");
    const newConversations: Conversation[] = [];
    // Clear markdown memoization cache when processing new files
    renderMarkdownMemo.clear();
    // let sparqlCount = 0;
    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        console.log("Processing line:", fileType, data);
        if (fileType === "langfuse") {
          // Handle langfuse format
          if (data.output && data.output.messages && Array.isArray(data.output.messages)) {
            const messages: Message[] = [];
            for (const msg of data.output.messages) {
              messages.push({
                content: msg.content || "",
                role: msg.type || msg.role || "assistant",
              });
            }
            const conversation: Conversation = {
              timestamp: data.timestamp || new Date().toISOString(),
              label: "langfuse",
              messages: messages,
              steps: data.output.steps,
              totalCost: data.totalCost || 0,
              promptTokens: data.usage?.promptTokens || 0,
              completionTokens: data.usage?.completionTokens || 0,
              totalTokens: data.usage?.totalTokens || 0,
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
          let conversationSteps: Step[] = [];
          // Find the first message with steps that has length > 0
          if (data.messages && Array.isArray(data.messages)) {
            for (const message of data.messages) {
              if (message.steps && Array.isArray(message.steps) && message.steps.length > 0) {
                conversationSteps = message.steps;
                break;
              }
            }
          }
          const conversation: Conversation = {
            timestamp: data.timestamp || new Date().toISOString(),
            label: fileType,
            messages: data.messages || [],
            steps: conversationSteps,
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
    highlightAll();
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
    resultElement.innerHTML = "⏳ Running query (60s timeout)...";
    try {
      const data = await executeSparqlQuery(endpoint, query);
      resultElement.innerHTML = formatSparqlResults(data);
    } catch (error) {
      resultElement.innerHTML = `<span class='tag-fail'>❌ Error</span><br><pre>${error}</pre>`;
    }
  };

  const getAvailableTabs = () => {
    const tabs: Array<{key: string; label: string; icon: string}> = [];
    if (uploadedFiles.langfuse) tabs.push({key: "langfuse", label: "Langfuse", icon: "🔌"});
    if (uploadedFiles.likes) tabs.push({key: "likes", label: "Likes", icon: "👍"});
    if (uploadedFiles.dislikes) tabs.push({key: "dislikes", label: "Dislikes", icon: "👎"});
    return tabs;
  };

  /** Filter conversation based on user selection */
  const filteredConversations = () => {
    return conversations().filter(convo => {
      if (convo.label !== activeTab()) return false;
      const filters = conversationFilters[activeTab()];
      const hasSparql = !!convo.sparql_block;
      // Check if the conversation has any steps with invalid query or fixing it
      const hasInvalidQueryStep = convo.steps.some(step =>
        step.label.toLowerCase().includes("generated query invalid"),
      );
      // Apply filters
      if (hasSparql && !filters.withSparql) return false;
      if (!hasSparql && !filters.withoutSparql) return false;
      if (!hasInvalidQueryStep && filters.withInvalidQuery) return false;
      if (convo.messages.length < filters.minMessages) return false;
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

  const openDialog = (dialogId: string) => {
    setDialogOpen(dialogId);
    (document.getElementById(dialogId) as HTMLDialogElement).showModal();
    history.pushState({dialogOpen: true}, "");
    document.body.style.overflow = "hidden";
    // Use debounced highlighting to avoid excessive highlighting calls
    highlightElement(dialogId);
  };

  const closeDialog = () => {
    document.body.style.overflow = "";
    const dialogEl = document.getElementById(dialogOpen()) as HTMLDialogElement;
    if (dialogEl) dialogEl.close();
    setDialogOpen("");
    // history.back();
  };

  // Memoization cache for parsed markdown to avoid recomputing
  const renderMarkdownMemo = new Map<string, string>();

  /** Render markdown to HTML */
  const renderMarkdown = (content: string): string => {
    if (renderMarkdownMemo.has(content)) {
      return renderMarkdownMemo.get(content)!;
    }
    const parsed = DOMPurify.sanitize(marked.parse(content) as string, {
      ADD_TAGS: ["think"],
    });
    renderMarkdownMemo.set(content, parsed);
    return parsed;
  };

  let highlightTimeout: number | undefined;

  /** Debounced highlighting to avoid excessive calls */
  const highlightElement = (dialogId: string) => {
    if (highlightTimeout) clearTimeout(highlightTimeout);
    highlightTimeout = setTimeout(() => {
      const dialog = document.getElementById(dialogId);
      if (dialog) {
        dialog.querySelectorAll("pre code:not(.hljs)").forEach(block => {
          hljs.highlightElement(block as HTMLElement);
        });
      }
    }, 10) as unknown as number;
  };

  const highlightAll = () => {
    document.querySelectorAll("pre code:not(.hljs)").forEach(block => {
      hljs.highlightElement(block as HTMLElement);
    });
  };

  return (
    <div class="qa-viewer">
      <h2 style={{"text-align": "center"}}>Chat Logs Viewer</h2>
      <a
        href="https://github.com/sib-swiss/chat-logs-viewer"
        target="_blank"
        rel="noopener noreferrer"
        title="View on GitHub"
        style={{
          position: "absolute",
          top: "1.5rem",
          right: "1.5rem",
        }}
        onMouseEnter={e => (e.target.style.opacity = "0.7")}
        onMouseLeave={e => (e.target.style.opacity = "1")}
      >
        <img src={githubIcon} alt="GitHub" />
      </a>

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
                <span style={{display: "flex", "align-items": "center"}}>Show:</span>
                <div class="filter" title="Show conversations with extracted SPARQL query">
                  <label>
                    <input
                      type="checkbox"
                      checked={conversationFilters[tab.key].withSparql}
                      onChange={e => setConversationFilters(tab.key, "withSparql", e.target.checked)}
                    />
                    With SPARQL
                  </label>
                </div>
                <div class="filter" title="Show conversations without extracted SPARQL query">
                  <label>
                    <input
                      type="checkbox"
                      checked={conversationFilters[tab.key].withoutSparql}
                      onChange={e => setConversationFilters(tab.key, "withoutSparql", e.target.checked)}
                    />
                    Without SPARQL
                  </label>
                </div>
                <div class="filter" title="Show only conversations with steps that have fixed query">
                  <label>
                    <input
                      type="checkbox"
                      checked={conversationFilters[tab.key].withInvalidQuery}
                      onChange={e => setConversationFilters(tab.key, "withInvalidQuery", e.target.checked)}
                    />
                    With fixed query
                  </label>
                </div>
                <div class="filter" title="Minimum number of messages in the conversation">
                  <label>
                    Min messages:
                    <input
                      type="number"
                      min="1"
                      value={conversationFilters[tab.key].minMessages}
                      onInput={e => setConversationFilters(tab.key, "minMessages", parseInt(e.target.value) || 1)}
                      style={{width: "60px"}}
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

                      {/* Display messages */}
                      <For each={convo.messages} fallback={<div>No messages found</div>}>
                        {(message, index) => (
                          <div
                            class={`round ${convo.messages.length % 2 === 1 && index() === convo.messages.length - 1 ? "incomplete-round" : ""}`}
                          >
                            <div
                              class={`message ${["user", "human"].includes(message.role) ? "user-icon" : "assistant-icon"}`}
                            >
                              <span style={{"margin-left": ".2em"}}>{message.role}</span>
                              <br />
                              {/* eslint-disable-next-line solid/no-innerhtml */}
                              <article innerHTML={renderMarkdown(message.content)} />
                            </div>
                          </div>
                        )}
                      </For>

                      {/* Display steps */}
                      <Show when={convo.steps.length > 0 || convo.totalCost > 0}>
                        <div class="steps-box">
                          <button
                            style={{"background-color": "#f3f3f3", border: "none", cursor: "help"}}
                            title={`Total cost: ${convo.totalCost * 100}¢
Tokens usage:
- prompt: ${convo.promptTokens}
- completion: ${convo.completionTokens}
- total: ${convo.totalTokens}`}
                          >
                            💶
                          </button>
                          <For each={convo.steps}>
                            {(step, iStep) =>
                              step.substeps && step.substeps.length > 0 ? (
                                <>
                                  {/* Dialog to show more details about a step with substeps (e.g. retrieved documents) */}
                                  <button
                                    class="btn-step"
                                    title="Click to see the details of the step"
                                    onClick={() => {
                                      setSelectedDocsTab(step.substeps?.[0]?.label || "");
                                      openDialog(`step-dialog-${convo.timestamp}-${iStep()}`);
                                    }}
                                  >
                                    {step.label}
                                  </button>
                                  <dialog
                                    id={`step-dialog-${convo.timestamp}-${iStep()}`}
                                    onClose={() => closeDialog()}
                                  >
                                    <button
                                      id={`close-dialog-${convo.timestamp}-${iStep()}`}
                                      class="btn-close"
                                      title="Close documents details"
                                      onClick={() => closeDialog()}
                                    >
                                      <img src={xIcon} alt="Close the dialog" class="iconBtn" />
                                    </button>
                                    <article>
                                      <div style={{display: "flex", gap: ".5em"}}>
                                        <For each={step.substeps.map(substep => substep.label)}>
                                          {label => (
                                            <button
                                              style={{
                                                filter: selectedDocsTab() === label ? "brightness(60%)" : "none",
                                              }}
                                              onClick={() => {
                                                setSelectedDocsTab(label);
                                                // Use debounced highlighting for better performance
                                                highlightElement(`step-dialog-${convo.timestamp}-${iStep()}`);
                                              }}
                                              title={`Show ${label}`}
                                            >
                                              {label}
                                            </button>
                                          )}
                                        </For>
                                      </div>
                                      <For each={step.substeps.filter(substep => substep.label === selectedDocsTab())}>
                                        {substep => {
                                          // Only render the substep content if it matches the selected tab
                                          return (
                                            <article
                                              // class="prose max-w-full"
                                              // eslint-disable-next-line solid/no-innerhtml
                                              innerHTML={renderMarkdown(substep.details)}
                                            />
                                          );
                                        }}
                                      </For>
                                    </article>
                                  </dialog>
                                </>
                              ) : step.details ? (
                                <>
                                  {/* Dialog to show more details about a step in markdown */}
                                  <button
                                    class="btn-step"
                                    title={`Click to see the documents used to generate the response\n\nNode: ${step.node_id}`}
                                    onClick={() => {
                                      openDialog(`step-dialog-${convo.timestamp}-${iStep()}`);
                                    }}
                                  >
                                    {step.label}
                                  </button>
                                  <dialog
                                    id={`step-dialog-${convo.timestamp}-${iStep()}`}
                                    onClose={() => closeDialog()}
                                  >
                                    <button
                                      id={`close-dialog-${convo.timestamp}-${iStep()}`}
                                      class="btn-close"
                                      title="Close step details"
                                      onClick={() => closeDialog()}
                                    >
                                      <img src={xIcon} alt="Close the dialog" class="iconBtn" />
                                    </button>
                                    <article
                                      // class="prose max-w-full p-6"
                                      // eslint-disable-next-line solid/no-innerhtml
                                      innerHTML={renderMarkdown(step.details)}
                                    />
                                  </dialog>
                                </>
                              ) : (
                                // Display basic step without details
                                <p title={`Node: ${step.node_id}`}>{step.label}</p>
                              )
                            }
                          </For>
                        </div>

                        {/* Display extracted SPARQL */}
                        {convo.sparql_block && (
                          <div class="sparql-box" data-endpoint={convo.sparql_block.endpoint}>
                            <div class="sparql-meta">
                              <span>Endpoint:</span>{" "}
                              <a href={convo.sparql_block.endpoint} target="_blank" rel="noopener noreferrer">
                                {convo.sparql_block.endpoint}
                              </a>
                            </div>
                            <pre>
                              <code class="language-sparql">{convo.sparql_block.query}</code>
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
                              <img src={sendIcon} style={{color: "white"}} alt="Execute the query" class="iconBtn" />{" "}
                              Execute
                            </button>
                            <div class="sparql-result" />
                          </div>
                        )}
                      </Show>
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

// const [progress, setProgress] = createStore<Record<string, { executed: number; total: number; percent: number }>>({});
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
