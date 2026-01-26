import {createSignal, createEffect, For, Show} from "solid-js";
import {createStore} from "solid-js/store";
import {marked} from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
import python from "highlight.js/lib/languages/python";
import r from "highlight.js/lib/languages/r";
import "highlight.js/styles/default.min.css";

// import sendIcon from "~/assets/send.svg";
import githubIcon from "~/assets/github.svg";
import FileUpload from "~/components/FileUpload";
import SummaryTable, {Summary} from "~/components/SummaryTable";
import Dialog from "~/components/Dialog";
import {countBGPs} from "~/utils/query-sparql";
import {hljsDefineSparql, hljsDefineTurtle} from "~/utils/highlight-sparql";
import {storeConversations, getAllStoredConversations, createFileFromStored, clearAllStoredConversations} from "~/utils/storage";

interface SparqlBlock {
  endpoint: string;
  query: string;
  results?: any[], // Query bindings
  bgp_count?: number; // Count of BGPs in the query
}

interface Message {
  content: string;
  role: "user" | "assistant";
  query_results?: {
    question?: string;
    sparql_query?: string;
    sparql_endpoint?: string;
    results?: any[];
    error?: string | null;
  };
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

// Initialize markdown and code highlight
marked.use({
  gfm: true, // Includes autolinker
});
hljs.registerLanguage("ttl", hljsDefineTurtle);
hljs.registerLanguage("sparql", hljsDefineSparql);
hljs.registerLanguage("python", python);
hljs.registerLanguage("r", r);

export default function Index() {
  // Signals
  const [activeTab, setActiveTab] = createSignal<string>("langfuse");
  const [conversations, setConversations] = createSignal<Conversation[]>([]);
  const [summary, setSummary] = createSignal<Summary>({
    likes: 0,
    likes_sparql: 0,
    dislikes: 0,
    dislikes_sparql: 0,
    langfuse: 0,
    langfuse_sparql: 0,
    sparql_total: 0,
    conversation_total: 0,
  });
  const [uploadSectionExpanded, setUploadSectionExpanded] = createSignal(true);
  const [isLoadingFromStorage, setIsLoadingFromStorage] = createSignal(true);
  // To display substeps
  const [selectedDocsTab, setSelectedDocsTab] = createSignal("");
  const [searchQuery, setSearchQuery] = createSignal<string>("");

  // Stores
  // Filters and uploaded files
  const [conversationFilters, setConversationFilters] = createStore<
    Record<
      string,
      {
        withSparql: boolean;
        withoutSparql: boolean;
        withInvalidQuery: boolean;
        minMessages: number;
        minBgps: number;
      }
    >
  >({
    likes: {withSparql: true, withoutSparql: true, withInvalidQuery: false, minMessages: 1, minBgps: 0},
    dislikes: {withSparql: true, withoutSparql: true, withInvalidQuery: false, minMessages: 1, minBgps: 0},
    langfuse: {withSparql: true, withoutSparql: true, withInvalidQuery: false, minMessages: 1, minBgps: 0},
  });
  const [uploadedFiles, setUploadedFiles] = createStore<{
    likes: File | null;
    dislikes: File | null;
    langfuse: File | null;
  }>({
    likes: null,
    dislikes: null,
    langfuse: null,
  });
  // Progress tracking SPARQL queries execution
  // const [progress, setProgress] = createStore<Record<string, { executed: number; total: number; percent: number }>>({});

  /** Initialize component */
  createEffect(() => {
    loadStoredFiles();
    // Restore last active tab from localStorage
    const savedActiveTab = localStorage.getItem("chat-logs-viewer-active-tab");
    if (savedActiveTab) setActiveTab(savedActiveTab);
  });

  /** Trigger code highlighting when tab changes */
  createEffect(() => {
    activeTab(); // Track the activeTab signal
    highlightAll();
  });

  /** Auto-collapse upload section when all 3 files are uploaded */
  createEffect(() => {
    const allFilesUploaded = uploadedFiles.likes && uploadedFiles.dislikes && uploadedFiles.langfuse;
    if (allFilesUploaded) {
      setUploadSectionExpanded(false);
    }
  });

  /** Trigger code highlighting when filters change */
  createEffect(() => {
    // Track filter changes and search query
    conversationFilters;
    searchQuery();
    // Delay highlighting to ensure DOM updates are complete
    setTimeout(() => highlightAll(), 0);
  });

  /** Load stored conversations from IndexedDB on component initialization */
  const loadStoredFiles = async () => {
    try {
      const storedConversations = await getAllStoredConversations();
      for (const stored of storedConversations) {
        const file = createFileFromStored(stored);
        setUploadedFiles(stored.id as "likes" | "dislikes" | "langfuse", file);
        // Process the conversations directly from storage
        await processConversations(stored.conversations, stored.id as "likes" | "dislikes" | "langfuse");
      }
    } catch (error) {
      console.warn("Failed to load stored conversations:", error);
    } finally {
      setIsLoadingFromStorage(false);
    }
  };

  const handleFileUpload = async (event: Event, fileType: "likes" | "dislikes" | "langfuse") => {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files[0]) {
      const file = target.files[0];
      setUploadedFiles(fileType, file);
      await processJsonlFile(file, fileType);
      setActiveTab(fileType);
    }
  };

  const processJsonlFile = async (file: File, fileType: "likes" | "dislikes" | "langfuse") => {
    const text = await file.text();
    const parsedConversations = await parseJsonlContent(text, fileType);
    // Store conversations in IndexedDB
    try {
      await storeConversations(fileType, file, parsedConversations);
    } catch (error) {
      console.warn(`Failed to store conversations for ${file.name}:`, error);
    }
    await processConversations(parsedConversations, fileType);
  };

  const processConversations = async (newConversations: Conversation[], fileType: "likes" | "dislikes" | "langfuse") => {
    // Update conversations by removing old ones of this type and adding new ones
    const otherConversations = conversations().filter(c => {
      if (fileType === "langfuse") return c.label !== "langfuse";
      return c.label !== fileType;
    });
    // Ensure BGP count is calculated for conversations with SPARQL queries
    newConversations.forEach(convo => {
      if (convo.sparql_block && convo.sparql_block.query && convo.sparql_block.bgp_count === undefined) {
        convo.sparql_block.bgp_count = countBGPs(convo.sparql_block.query);
      }
    });
    setConversations([...otherConversations, ...newConversations]);
    updateSummary();
    highlightAll();
  };

  const parseJsonlContent = async (text: string, fileType: "likes" | "dislikes" | "langfuse"): Promise<Conversation[]> => {
    const lines = text.trim().split("\n");
    const newConversations: Conversation[] = [];
    // Clear markdown memoization cache when processing new files
    renderMarkdownMemo.clear();

    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        // console.log("Processing line:", fileType, data);
        if (fileType === "langfuse") {
          // Handle langfuse format
          if (data.output && data.output.messages && Array.isArray(data.output.messages)) {
            const messages: Message[] = [];
            for (const msg of data.output.messages) {
              messages.push({
                content: msg.content || "",
                role: msg.type || msg.role || "ai",
                query_results: msg.query_results
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
              // Count BGPs in SPARQL query if available
              sparql_block: data.output.structured_output
                ? {
                    endpoint: data.output.structured_output["sparql_endpoint_url"] || "",
                    query: data.output.structured_output["sparql_query"] || "",
                    bgp_count: data.output.structured_output["sparql_query"]
                      ? countBGPs(data.output.structured_output["sparql_query"])
                      : 0,
                  }
                : undefined,
            };
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
            totalCost: data.totalCost || 0,
            sparql_block: data.sparql_block
              ? {
                  endpoint: data.sparql_block.endpoint || "",
                  query: data.sparql_block.query || "",
                  bgp_count: data.sparql_block.query
                    ? countBGPs(data.sparql_block.query)
                    : 0,
                }
              : undefined,
          };
          newConversations.push(conversation);
        }
      } catch (e) {
        console.error("Error parsing line:", line, e);
      }
    }

    return newConversations;
  };

  /** Clear all stored data */
  const clearStoredData = async () => {
    try {
      await clearAllStoredConversations();
      // Reset the state
      setUploadedFiles("likes", null);
      setUploadedFiles("dislikes", null);
      setUploadedFiles("langfuse", null);
      setConversations([]);
      setSummary({
        likes: 0,
        likes_sparql: 0,
        dislikes: 0,
        dislikes_sparql: 0,
        langfuse: 0,
        langfuse_sparql: 0,
        sparql_total: 0,
        conversation_total: 0,
      });
      // Clear saved active tab
      localStorage.removeItem("chat-logs-viewer-active-tab");
    } catch (error) {
      console.warn("Failed to clear stored data:", error);
    }
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
      conversation_total: allConversations.length,
    });
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
      // Filter by minimum BGPs - if minBgps > 0, exclude conversations without SPARQL
      if (filters.minBgps > 0 && !hasSparql) return false;
      if (hasSparql && convo.sparql_block?.bgp_count !== undefined) {
        if (convo.sparql_block.bgp_count < filters.minBgps) return false;
      }
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
        onMouseEnter={e => ((e.target as HTMLElement).style.opacity = "0.7")}
        onMouseLeave={e => ((e.target as HTMLElement).style.opacity = "1")}
      >
        <img src={githubIcon} alt="GitHub" />
      </a>

      {/* File Upload */}
      <div class="upload-section">
        <h4
          class="upload-header"
          onClick={() => setUploadSectionExpanded(!uploadSectionExpanded())}
          style={{cursor: "pointer", "user-select": "none"}}
        >
          📁 Upload JSONL logs files {uploadSectionExpanded() ? "🔻" : "🔺"}
        </h4>
        <Show when={uploadSectionExpanded()}>
          <div class="upload-buttons">
            <FileUpload
              id="langfuse-upload"
              label="Upload Langfuse logs"
              icon="🔌"
              uploadedFile={uploadedFiles.langfuse}
              onFileUpload={e => handleFileUpload(e, "langfuse")}
            />
            <FileUpload
              id="likes-upload"
              label="Upload Likes logs"
              icon="👍"
              uploadedFile={uploadedFiles.likes}
              onFileUpload={e => handleFileUpload(e, "likes")}
            />
            <FileUpload
              id="dislikes-upload"
              label="Upload Dislikes logs"
              icon="👎"
              uploadedFile={uploadedFiles.dislikes}
              onFileUpload={e => handleFileUpload(e, "dislikes")}
            />
          </div>

          {/* Clear stored data button */}
          <Show when={uploadedFiles.likes || uploadedFiles.dislikes || uploadedFiles.langfuse}>
            <div style={{"text-align": "center", "margin-top": "1rem"}}>
              <button
                class="btn-clear-data"
                style={{
                  "background-color": "#ffb3b3",
                  color: "#990000", // Darker red text
                  border: "none",
                  padding: "0.5rem 1rem",
                  "border-radius": "4px",
                  cursor: "pointer",
                }}
                onClick={clearStoredData}
                title="Clear all uploaded files from local storage"
              >
                🗑️ Clear logs stored locally
              </button>
            </div>
          </Show>
        </Show>
      </div>

      {/* Loading indicator */}
      <Show when={isLoadingFromStorage()}>
        <div style={{"text-align": "center", padding: "1rem"}}>
          <p>⏳ Loading previously uploaded files...</p>
        </div>
      </Show>

      <Show when={conversations().length > 0}>
        <SummaryTable summary={summary()} />

        {/* Tabs */}
        <div>
          <For each={getAvailableTabs()}>
            {tab => (
              <button
                class={`tab-button ${activeTab() === tab.key ? "active" : ""}`}
                onClick={() => {
                  setActiveTab(tab.key);
                  localStorage.setItem("chat-logs-viewer-active-tab", tab.key);
                }}
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
                <div style={{display: "flex", "align-items": "center"}}>
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
                <div class="filter" title="Minimum number of BGPs in the SPARQL query">
                  <label>
                    Min BGPs:
                    <input
                      type="number"
                      min="0"
                      value={conversationFilters[tab.key].minBgps}
                      onInput={e => setConversationFilters(tab.key, "minBgps", parseInt(e.target.value) || 0)}
                      style={{width: "60px"}}
                    />
                  </label>
                </div>
              </div>

              {/* <button onClick={() => executeAllSparql(tab.key)}>
                Execute All SPARQL Queries
              </button> */}
              {/* Progress bar */}
              {/* <Show when={progress[tab.key]}>
                <div class="execute-all-report">
                  <div class="progress-bar">
                    <div class="progress-bar-inner" style={{width: `${progress[tab.key]?.percent || 0}%`}} />
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
                      <h4>🗓️ Conversation {convo.timestamp}</h4>

                      {/* Display messages */}
                      <For each={convo.messages} fallback={<div>No messages found</div>}>
                        {(msg) => (
                          <div class={["user", "human"].includes(msg.role) ? "user-round" : ""}>
                            <div class="message">
                              {/* eslint-disable-next-line solid/no-innerhtml */}
                              <article innerHTML={renderMarkdown(msg.content)} />

                              {/* Display SPARQL query results if present */}
                              <Show when={msg.query_results}>
                                {(qr) => (
                                  <div style={{"margin-top": ".5rem", "font-size": "0.9rem", display: "flex", "align-items": "center", gap: ".5rem"}}>
                                    {(qr().results?.length || 0) > 0 ? (
                                      <>
                                        <div
                                          class="query-card"
                                          style={{
                                            "background-color": "#e6ffed",
                                            color: "#027a3a",
                                            padding: ".5rem",
                                            "border-radius": "6px",
                                          }}
                                        >
                                          Query results: {qr().results?.length || 0}
                                        </div>

                                        <div style={{display: "flex", gap: ".4rem", "align-items": "center"}}>
                                          {/* Show dialog button (📊) when multiple results */}
                                          {(qr().results?.length || 0) > 0 && (
                                            <Dialog
                                              trigger={
                                                <button
                                                  title="See results"
                                                  style={{
                                                    padding: ".4rem .5rem",
                                                    "border-radius": "6px",
                                                    border: "none",
                                                    cursor: "pointer",
                                                    "background-color": "#ffffff",
                                                  }}
                                                >
                                                  📊
                                                </button>
                                              }
                                              onOpen={() => setTimeout(() => highlightAll(), 0)}
                                            >
                                              <pre>
                                                <code class="language-json">{JSON.stringify(qr().results ?? [], null, 2)}</code>
                                              </pre>
                                            </Dialog>
                                          )}
                                        </div>
                                      </>
                                    ) : (
                                      <div
                                        class="query-card"
                                        style={{
                                          // "background-color": "#fff5e6",
                                          // color: "#b35f00",
                                          "background-color": "#ffe6e6",
                                          color: "#990000",
                                          padding: ".5rem",
                                          "border-radius": "6px",
                                        }}
                                      >
                                        {qr().error ? `Error: ${qr().error}` : "Query results: 0"}
                                      </div>
                                    )}
                                    {/* External SPARQL editor link (always present) */}
                                    <a
                                      href={`https://sib-swiss.github.io/sparql-editor/?query=${encodeURIComponent(qr().sparql_query || "")} &endpoint=${encodeURIComponent(qr().sparql_endpoint || "")}`.replace(" ", "")}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title="Open in SPARQL editor"
                                    >
                                      <button
                                        style={{
                                          padding: ".25rem .4rem",
                                          "border-radius": "6px",
                                          border: "none",
                                          cursor: "pointer",
                                          "background-color": "#f3f3f3",
                                        }}
                                      >
                                        🔍
                                      </button>
                                    </a>
                                  </div>
                                )}
                              </Show>
                            </div>
                          </div>
                        )}
                      </For>

                      {/* Display steps details and token usage */}
                      <Show when={convo.steps.length > 0 || convo.totalCost}>
                        <div class="steps-box" >
                          {convo.totalCost && (
                            <button
                              style={{"background-color": "#f3f3f3", border: "none", cursor: "help"}}
                              title={`Total cost: ${convo.totalCost * 100}¢

Tokens usage:
📝 prompt: ${convo.promptTokens}
🤖 completion: ${convo.completionTokens}
📊 total: ${convo.totalTokens}`}
                            >
                              💶
                            </button>
                          )}
                          <For each={convo.steps}>
                            {step =>
                              step.substeps && step.substeps.length > 0 ? (
                                <Dialog
                                  trigger={
                                    <button class="btn-step" title="Click to see the details of the step">
                                      {step.label}
                                    </button>
                                  }
                                  onOpen={() => {
                                    setSelectedDocsTab(step.substeps?.[0]?.label || "");
                                    // Highlight after dialog opens
                                    setTimeout(() => highlightAll(), 0);
                                  }}
                                >
                                  <div>
                                    <div style={{display: "flex", gap: ".5em", "margin-bottom": "1rem", "flex-wrap": "wrap", "align-items": "stretch"}}>
                                      <For each={step.substeps!.map(substep => substep.label)}>
                                        {label => (
                                          <button
                                            style={{
                                              filter: selectedDocsTab() === label ? "brightness(60%)" : "none",
                                            }}
                                            onClick={() => {
                                              setSelectedDocsTab(label);
                                              setTimeout(() => highlightAll(), 0);
                                            }}
                                            title={`Show ${label}`}
                                          >
                                            {label}
                                          </button>
                                        )}
                                      </For>
                                    </div>
                                    <For each={step.substeps!.filter(substep => substep.label === selectedDocsTab())}>
                                      {substep => (
                                        <article
                                          // eslint-disable-next-line solid/no-innerhtml
                                          innerHTML={renderMarkdown(substep.details)}
                                        />
                                      )}
                                    </For>
                                  </div>
                                </Dialog>
                              ) : step.details ? (
                                <Dialog
                                  trigger={
                                    <button class="btn-step" title="Click to see the details of the step">
                                      {step.label}
                                    </button>
                                  }
                                  onOpen={() => {
                                    // Highlight after dialog opens
                                    setTimeout(() => highlightAll(), 0);
                                  }}
                                >
                                  <article
                                    // eslint-disable-next-line solid/no-innerhtml
                                    innerHTML={renderMarkdown(step.details)}
                                  />
                                </Dialog>
                              ) : (
                                // Display basic step without details
                                <p title={`Node: ${step.node_id}`}>{step.label}</p>
                              )
                            }
                          </For>
                        </div>

                        {/* Display extracted SPARQL */}
                        {/* {convo.sparql_block && (
                          <div class="sparql-box" data-endpoint={convo.sparql_block.endpoint}>
                            <div class="sparql-meta">
                              <span>Endpoint:</span>{" "}
                              <a href={convo.sparql_block.endpoint} target="_blank" rel="noopener noreferrer">
                                {convo.sparql_block.endpoint}
                              </a>
                              {convo.sparql_block.bgp_count !== undefined && convo.sparql_block.bgp_count > 0 && (
                                <span style={{
                                  "margin-left": "1rem",
                                  "background-color": "#f0f8ff",
                                  color: "#4a5568",
                                  padding: "0.2rem 0.4rem",
                                  "border-radius": "3px",
                                  "font-size": "0.8rem",
                                  border: "1px solid #cbd5e0"
                                }}>
                                  {convo.sparql_block.bgp_count} BGP{convo.sparql_block.bgp_count !== 1 ? 's' : ''}
                                </span>
                              )}
                              {convo.sparql_block.results && (
                                <span style={{
                                  "margin-left": "1rem",
                                  "background-color": "#e6f3ff",
                                  color: "#0066cc",
                                  padding: "0.2rem 0.4rem",
                                  "border-radius": "3px",
                                  "font-size": "0.8rem"
                                }}>
                                  📋 Results cached ({convo.sparql_block.results.length} rows)
                                </span>
                              )}
                            </div>
                            <pre>
                              <code class="language-sparql">{convo.sparql_block.query}</code>
                            </pre>
                            <button
                              onClick={e => {
                                const box = e.target.closest(".sparql-box");
                                const resultBox = box?.querySelector(".sparql-result") as HTMLElement;
                                if (resultBox && convo.sparql_block) {
                                  runSparql(convo.sparql_block.endpoint, convo.sparql_block.query, resultBox, convo);
                                }
                              }}
                            >
                              <img src={sendIcon} style={{color: "white"}} alt="Execute the query" class="iconBtn" />{" "}
                              Execute
                            </button>
                            <div class="sparql-result">
                              <Show when={convo.sparql_block.results}>
                                {/* eslint-disable-next-line solid/no-innerhtml *
                                <div innerHTML={renderCachedSparqlResults(convo.sparql_block.results!)} />
                              </Show>
                            </div>
                          </div>
                        )} */}
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

  // NOTE: The SPARQL execution code has been commented out for now. Done in a script beforehand
  // import {countBGPs, executeSparqlQuery, formatSparqlResults, SparqlResponse} from "~/utils/query-sparql";
  // import {storeConversations, getAllStoredConversations, createFileFromStored, clearAllStoredConversations, updateConversationSparqlResults} from "~/utils/storage";
  // const runSparql = async (endpoint: string, query: string, resultElement: HTMLElement, conversation?: Conversation, forceRefresh: boolean = false) => {
  //   // Check if we already have cached results and not forcing refresh
  //   if (conversation?.sparql_block?.results && !forceRefresh) {
  //     const cachedResponse: SparqlResponse = {
  //       success: true,
  //       result: {
  //         results: {
  //           bindings: conversation.sparql_block.results
  //         }
  //       }
  //     };
  //     resultElement.innerHTML = `<span style="background-color: #e6f3ff; color: #0066cc; padding: 0.2rem 0.4rem; border-radius: 3px; font-size: 0.8rem;">📋 Using cached results</span><br>` + formatSparqlResults(cachedResponse);
  //     return;
  //   }

  //   resultElement.innerHTML = "⏳ Running query (60s timeout)...";
  //   try {
  //     const data = await executeSparqlQuery(endpoint, query);
  //     resultElement.innerHTML = formatSparqlResults(data);

  //     // Store results if we have a conversation context and results exist
  //     if (conversation && data.success && data.result?.results?.bindings && data.result.results.bindings.length > 0) {
  //       // Update the conversation object
  //       if (conversation.sparql_block) {
  //         conversation.sparql_block.results = data.result.results.bindings;
  //       }

  //       // Persist to IndexedDB
  //       await updateConversationSparqlResults(
  //         conversation.label as "likes" | "dislikes" | "langfuse",
  //         conversation.timestamp,
  //         data.result.results.bindings
  //       );
  //     }
  //   } catch (error) {
  //     resultElement.innerHTML = `<span class='tag-fail'>❌ Error</span><br><pre>${error}</pre>`;
  //   }
  // };

  // const executeAllSparql = async (tabId: string) => {
  //   // Get conversations with valid SPARQL queries (both endpoint and query present) for the active tab
  //   const conversationsWithSparql = filteredConversations().filter(convo =>
  //     convo.sparql_block &&
  //     convo.sparql_block.endpoint &&
  //     convo.sparql_block.query &&
  //     convo.sparql_block.endpoint.trim() !== '' &&
  //     convo.sparql_block.query.trim() !== ''
  //   );
  //   if (!conversationsWithSparql.length) return;

  //   const total = conversationsWithSparql.length;
  //   setProgress(tabId, { executed: 0, total, percent: 0 });

  //   let completedCount = 0;

  //   // Create promises for all SPARQL executions
  //   const executionPromises = conversationsWithSparql.map(async (convo, index) => {
  //     if (!convo.sparql_block) return;
  //     const { endpoint, query } = convo.sparql_block;

  //     // Find the corresponding result element in the DOM
  //     const sparqlBoxes = document.querySelectorAll(`#${tabId} .sparql-box`);
  //     const resultBox = sparqlBoxes[index]?.querySelector('.sparql-result') as HTMLElement;

  //     if (resultBox) {
  //       // Force refresh when executing all queries
  //       await runSparql(endpoint, query, resultBox, convo, true);
  //     }

  //     // Update progress after each query completes
  //     completedCount++;
  //     setProgress(tabId, {
  //       executed: completedCount,
  //       total,
  //       percent: Math.round((completedCount / total) * 100)
  //     });
  //   });

  //   // Execute all queries in parallel
  //   await Promise.all(executionPromises);

  //   // Trigger re-render to update cached results display
  //   setConversations([...conversations()]);
  // };

  // /** Render cached SPARQL results */
  // const renderCachedSparqlResults = (results: any[]): string => {
  //   const cachedResponse: SparqlResponse = {
  //     success: true,
  //     result: {
  //       results: {
  //         bindings: results
  //       }
  //     }
  //   };
  //   return `<span style="background-color: #e6f3ff; color: #0066cc; padding: 0.2rem 0.4rem; border-radius: 3px; font-size: 0.8rem;">📋 Displaying cached results</span><br>` + formatSparqlResults(cachedResponse);
  // };
}
