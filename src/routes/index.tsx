import {createSignal, createEffect, For, Show, onMount} from "solid-js";
import {createStore} from "solid-js/store";
import {marked} from "marked";
import DOMPurify from "dompurify";
import hljs from "highlight.js/lib/core";
// import python from "highlight.js/lib/languages/python";
// import r from "highlight.js/lib/languages/r";
import "highlight.js/styles/default.min.css";

import githubIcon from "~/assets/github.svg";
import FileUpload from "~/components/FileUpload";
import SummaryTable from "~/components/SummaryTable";
import Dialog from "~/components/Dialog";
import {countBGPs} from "~/utils/query-sparql";
import {hljsDefineSparql, hljsDefineTurtle} from "~/utils/highlight-sparql";
import {
  storeConversations,
  getFilteredConversations,
  getSummary,
  getAllFileMeta,
  createFileFromMeta,
  clearAllStoredConversations,
  type Conversation,
  type Summary,
  type PaginatedResult,
} from "~/utils/storage";

// Initialize markdown and code highlight
marked.use({
  gfm: true,
});
hljs.registerLanguage("ttl", hljsDefineTurtle);
hljs.registerLanguage("sparql", hljsDefineSparql);
// hljs.registerLanguage("python", python);
// hljs.registerLanguage("r", r);

const PAGE_SIZE = 20;

export default function Index() {
  // Signals
  const [activeTab, setActiveTab] = createSignal<string>("langfuse");
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
  const [isLoading, setIsLoading] = createSignal(true);
  const [selectedDocsTab, setSelectedDocsTab] = createSignal("");
  const [searchQuery, setSearchQuery] = createSignal<string>("");

  // Pagination state
  const [currentPage, setCurrentPage] = createSignal(1);
  const [paginatedResult, setPaginatedResult] = createSignal<PaginatedResult>({
    conversations: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    totalPages: 0,
  });

  // Stores for filters
  const [conversationFilters, setConversationFilters] = createStore<
    Record<
      string,
      {
        withSparql: boolean;
        withoutSparql: boolean;
        withInvalidQuery: boolean;
        minMessages: number;
        minBgps: number;
        withMultipleResults: boolean;
        withZeroResults: boolean;
        withErrors: boolean;
      }
    >
  >({
    likes: {
      withSparql: true,
      withoutSparql: false,
      withInvalidQuery: false,
      minMessages: 1,
      minBgps: 0,
      withMultipleResults: false,
      withZeroResults: false,
      withErrors: false,
    },
    dislikes: {
      withSparql: true,
      withoutSparql: false,
      withInvalidQuery: false,
      minMessages: 1,
      minBgps: 0,
      withMultipleResults: false,
      withZeroResults: false,
      withErrors: false,
    },
    langfuse: {
      withSparql: true,
      withoutSparql: false,
      withInvalidQuery: false,
      minMessages: 1,
      minBgps: 0,
      withMultipleResults: false,
      withZeroResults: false,
      withErrors: false,
    },
  });

  // Track uploaded files for display (mock File objects)
  const [uploadedFiles, setUploadedFiles] = createStore<{
    likes: File | null;
    dislikes: File | null;
    langfuse: File | null;
  }>({
    likes: null,
    dislikes: null,
    langfuse: null,
  });

  // Track expanded/collapsed state of conversations
  const [expandedConversations, setExpandedConversations] = createStore<Record<number, boolean>>({});

  // Debounce timer for search
  let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Load conversations from IndexedDB with current filters and pagination */
  const loadConversations = async () => {
    const tab = activeTab();
    const filters = conversationFilters[tab];

    try {
      const result = await getFilteredConversations(
        {
          label: tab,
          withSparql: filters.withSparql,
          withoutSparql: filters.withoutSparql,
          withInvalidQuery: filters.withInvalidQuery,
          minMessages: filters.minMessages,
          minBgps: filters.minBgps,
          searchQuery: searchQuery(),
          withMultipleResults: filters.withMultipleResults,
          withZeroResults: filters.withZeroResults,
          withErrors: filters.withErrors,
        },
        currentPage(),
        PAGE_SIZE,
      );
      setPaginatedResult(result);
      // Highlight code after DOM updates
      setTimeout(() => highlightAll(), 0);
    } catch (error) {
      console.error("Failed to load conversations:", error);
    }
  };

  /** Refresh summary stats from IndexedDB */
  const refreshSummary = async () => {
    try {
      const newSummary = await getSummary();
      setSummary(newSummary);
    } catch (error) {
      console.error("Failed to refresh summary:", error);
    }
  };

  /** Load file metadata and reconstruct uploaded files state */
  const loadFileMeta = async () => {
    try {
      const meta = await getAllFileMeta();

      // Reconstruct uploadedFiles for UI display
      for (const m of meta) {
        const file = createFileFromMeta(m);
        setUploadedFiles(m.id as "likes" | "dislikes" | "langfuse", file);
      }

      // Auto-collapse upload section if all files uploaded
      if (meta.length >= 3) {
        setUploadSectionExpanded(false);
      }
    } catch (error) {
      console.error("Failed to load file metadata:", error);
    }
  };

  /** Initialize on mount */
  onMount(async () => {
    setIsLoading(true);

    // Restore last active tab
    const savedActiveTab = localStorage.getItem("chat-logs-viewer-active-tab");
    if (savedActiveTab) setActiveTab(savedActiveTab);

    await loadFileMeta();
    await refreshSummary();
    await loadConversations();

    setIsLoading(false);
  });

  /** Reload conversations when tab, filters, or page changes */
  createEffect(() => {
    // Track these signals
    activeTab();
    currentPage();
    conversationFilters;
    // Don't load during initial mount
    if (!isLoading()) loadConversations();
  });

  /** Debounced search - reload when search query changes */
  createEffect(() => {
    // Track search query changes
    searchQuery();

    if (searchDebounceTimer) {
      clearTimeout(searchDebounceTimer);
    }
    searchDebounceTimer = setTimeout(() => {
      if (!isLoading()) {
        // Reset to page 1 when search changes
        setCurrentPage(1);
        loadConversations();
      }
    }, 300);
  });

  /** Handle file upload */
  const handleFileUpload = async (event: Event, fileType: "likes" | "dislikes" | "langfuse") => {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files[0]) {
      const file = target.files[0];
      setUploadedFiles(fileType, file);
      setIsLoading(true);

      try {
        const parsedConversations = await parseJsonlFile(file, fileType);
        await storeConversations(fileType, file, parsedConversations);
        await loadFileMeta();
        await refreshSummary();
        setActiveTab(fileType);
        setCurrentPage(1);
        await loadConversations();
      } catch (error) {
        console.error("Failed to process file:", error);
      } finally {
        setIsLoading(false);
      }
    }
  };

  /** Parse JSONL file content */
  const parseJsonlFile = async (
    file: File,
    fileType: "likes" | "dislikes" | "langfuse",
  ): Promise<
    Omit<
      Conversation,
      | "id"
      | "hasSparql"
      | "hasInvalidQuery"
      | "messageCount"
      | "bgpCount"
      | "searchText"
      | "hasMultipleResults"
      | "hasZeroResults"
      | "hasErrors"
    >[]
  > => {
    const text = await file.text();
    const lines = text.trim().split("\n");
    const conversations: Omit<
      Conversation,
      "id" | "hasSparql" | "hasInvalidQuery" | "messageCount" | "bgpCount" | "searchText"
    >[] = [];

    // Clear markdown memoization cache
    renderMarkdownMemo.clear();

    for (const line of lines) {
      try {
        const data = JSON.parse(line);

        if (fileType === "langfuse") {
          if (data.output?.messages && Array.isArray(data.output.messages)) {
            const messages = data.output.messages.map((msg: any) => ({
              content: msg.content || "",
              role: msg.type || msg.role || "ai",
              query_results: msg.query_results,
            }));

            conversations.push({
              timestamp: data.timestamp || new Date().toISOString(),
              label: "langfuse",
              messages,
              steps: data.output.steps || [],
              totalCost: data.totalCost || 0,
              promptTokens: data.usage?.promptTokens || 0,
              completionTokens: data.usage?.completionTokens || 0,
              totalTokens: data.usage?.totalTokens || 0,
              sparql_block: data.output.structured_output
                ? {
                    endpoint: data.output.structured_output["sparql_endpoint_url"] || "",
                    query: data.output.structured_output["sparql_query"] || "",
                    bgp_count: data.output.structured_output["sparql_query"]
                      ? countBGPs(data.output.structured_output["sparql_query"])
                      : 0,
                  }
                : undefined,
              hasMultipleResults: false,
              hasZeroResults: false,
              hasErrors: false,
            });
          }
        } else {
          // Handle likes/dislikes files
          let conversationSteps: any[] = [];
          if (data.messages && Array.isArray(data.messages)) {
            for (const message of data.messages) {
              if (message.steps?.length > 0) {
                conversationSteps = message.steps;
                break;
              }
            }
          }

          conversations.push({
            timestamp: data.timestamp || new Date().toISOString(),
            label: fileType,
            messages: data.messages || [],
            steps: conversationSteps,
            totalCost: data.totalCost || 0,
            sparql_block: data.sparql_block
              ? {
                  endpoint: data.sparql_block.endpoint || "",
                  query: data.sparql_block.query || "",
                  bgp_count: data.sparql_block.query ? countBGPs(data.sparql_block.query) : 0,
                }
              : undefined,
            hasMultipleResults: false,
            hasZeroResults: false,
            hasErrors: false,
          });
        }
      } catch (e) {
        console.error("Error parsing line:", line, e);
      }
    }

    return conversations;
  };

  /** Clear all stored data */
  const clearStoredData = async () => {
    try {
      await clearAllStoredConversations();
      setUploadedFiles("likes", null);
      setUploadedFiles("dislikes", null);
      setUploadedFiles("langfuse", null);
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
      setPaginatedResult({
        conversations: [],
        total: 0,
        page: 1,
        pageSize: PAGE_SIZE,
        totalPages: 0,
      });
      localStorage.removeItem("chat-logs-viewer-active-tab");
    } catch (error) {
      console.warn("Failed to clear stored data:", error);
    }
  };

  const getAvailableTabs = () => {
    const tabs: Array<{key: string; label: string; icon: string}> = [];
    if (uploadedFiles.langfuse) tabs.push({key: "langfuse", label: "Langfuse", icon: "🔌"});
    if (uploadedFiles.likes) tabs.push({key: "likes", label: "Likes", icon: "👍"});
    if (uploadedFiles.dislikes) tabs.push({key: "dislikes", label: "Dislikes", icon: "👎"});
    return tabs;
  };

  // Memoization cache for parsed markdown
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

  /** Handle page change */
  const goToPage = (page: number) => {
    const result = paginatedResult();
    if (page >= 1 && page <= result.totalPages) {
      setCurrentPage(page);
    }
  };

  /** Handle filter change - reset to page 1 */
  const handleFilterChange = (tab: string, key: string, value: any) => {
    setConversationFilters(tab, key as any, value);
    setCurrentPage(1);
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

          <Show when={uploadedFiles.likes || uploadedFiles.dislikes || uploadedFiles.langfuse}>
            <div style={{"text-align": "center", "margin-top": "1rem"}}>
              <button
                class="btn-clear-data"
                style={{
                  "background-color": "#ffb3b3",
                  color: "#990000",
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
      <Show when={isLoading()}>
        <div style={{"text-align": "center", padding: "1rem"}}>
          <p>⏳ Loading...</p>
        </div>
      </Show>

      <Show when={summary().conversation_total > 0}>
        <SummaryTable summary={summary()} />

        {/* Tabs */}
        <div>
          <For each={getAvailableTabs()}>
            {tab => (
              <button
                class={`tab-button ${activeTab() === tab.key ? "active" : ""}`}
                onClick={() => {
                  setActiveTab(tab.key);
                  setCurrentPage(1);
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
                      onChange={e => handleFilterChange(tab.key, "withSparql", e.target.checked)}
                    />
                    With SPARQL
                  </label>
                </div>
                <div class="filter" title="Show only conversations with queries that returned more than 1 result">
                  <label>
                    <input
                      type="checkbox"
                      checked={conversationFilters[tab.key].withMultipleResults}
                      onChange={e => handleFilterChange(tab.key, "withMultipleResults", e.target.checked)}
                    />
                    &gt;1 results
                  </label>
                </div>
                <div class="filter" title="Show only conversations with queries that returned 0 results">
                  <label>
                    <input
                      type="checkbox"
                      checked={conversationFilters[tab.key].withZeroResults}
                      onChange={e => handleFilterChange(tab.key, "withZeroResults", e.target.checked)}
                    />
                    0 results
                  </label>
                </div>
                <div class="filter" title="Show only conversations with queries that have errors">
                  <label>
                    <input
                      type="checkbox"
                      checked={conversationFilters[tab.key].withErrors}
                      onChange={e => handleFilterChange(tab.key, "withErrors", e.target.checked)}
                    />
                    With errors
                  </label>
                </div>
                <div class="filter" title="Show conversations without extracted SPARQL query">
                  <label>
                    <input
                      type="checkbox"
                      checked={conversationFilters[tab.key].withoutSparql}
                      onChange={e => handleFilterChange(tab.key, "withoutSparql", e.target.checked)}
                    />
                    Without SPARQL
                  </label>
                </div>
                <div class="filter" title="Show only conversations with steps that have fixed query">
                  <label>
                    <input
                      type="checkbox"
                      checked={conversationFilters[tab.key].withInvalidQuery}
                      onChange={e => handleFilterChange(tab.key, "withInvalidQuery", e.target.checked)}
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
                      onInput={e => handleFilterChange(tab.key, "minMessages", parseInt(e.target.value) || 1)}
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
                      onInput={e => handleFilterChange(tab.key, "minBgps", parseInt(e.target.value) || 0)}
                      style={{width: "60px"}}
                    />
                  </label>
                </div>
              </div>

              {/* Pagination controls and info */}
              <Show when={activeTab() === tab.key}>
                <div
                  class="pagination-info"
                  style={{
                    display: "flex",
                    "justify-content": "space-between",
                    "align-items": "center",
                    padding: "0.5rem 0",
                    "margin-bottom": "0.5rem",
                    "border-bottom": "1px solid #eee",
                  }}
                >
                  <span style={{color: "#666"}}>
                    Showing {paginatedResult().conversations.length} of {paginatedResult().total} conversations
                    {paginatedResult().totalPages > 1 &&
                      ` (Page ${paginatedResult().page} of ${paginatedResult().totalPages})`}
                  </span>

                  <Show when={paginatedResult().totalPages > 1}>
                    <div class="pagination-controls" style={{display: "flex", gap: "0.5rem", "align-items": "center"}}>
                      <button
                        onClick={() => goToPage(1)}
                        disabled={currentPage() === 1}
                        style={{padding: "0.25rem 0.5rem", cursor: currentPage() === 1 ? "not-allowed" : "pointer"}}
                      >
                        ⏮️
                      </button>
                      <button
                        onClick={() => goToPage(currentPage() - 1)}
                        disabled={currentPage() === 1}
                        style={{padding: "0.25rem 0.5rem", cursor: currentPage() === 1 ? "not-allowed" : "pointer"}}
                      >
                        ◀️
                      </button>
                      <span style={{padding: "0 0.5rem"}}>
                        Page{" "}
                        <input
                          type="number"
                          min="1"
                          max={paginatedResult().totalPages}
                          value={currentPage()}
                          onInput={e => {
                            const val = parseInt(e.target.value);
                            if (val >= 1 && val <= paginatedResult().totalPages) {
                              goToPage(val);
                            }
                          }}
                          style={{width: "50px", "text-align": "center"}}
                        />{" "}
                        of {paginatedResult().totalPages}
                      </span>
                      <button
                        onClick={() => goToPage(currentPage() + 1)}
                        disabled={currentPage() === paginatedResult().totalPages}
                        style={{
                          padding: "0.25rem 0.5rem",
                          cursor: currentPage() === paginatedResult().totalPages ? "not-allowed" : "pointer",
                        }}
                      >
                        ▶️
                      </button>
                      <button
                        onClick={() => goToPage(paginatedResult().totalPages)}
                        disabled={currentPage() === paginatedResult().totalPages}
                        style={{
                          padding: "0.25rem 0.5rem",
                          cursor: currentPage() === paginatedResult().totalPages ? "not-allowed" : "pointer",
                        }}
                      >
                        ⏭️
                      </button>
                    </div>
                  </Show>
                </div>

                <For each={paginatedResult().conversations}>
                  {convo => (
                    <div class="box">
                      <h4
                        onClick={() => setExpandedConversations(convo.id!, prev => !(prev ?? true))}
                        style={{cursor: "pointer", "user-select": "none"}}
                      >
                        {(expandedConversations[convo.id!] ?? true) ? "🔽" : "▶️"} Conversation {convo.timestamp}
                      </h4>

                      <Show when={expandedConversations[convo.id!] ?? true}>
                        {/* Display messages */}
                        <For each={convo.messages} fallback={<div>No messages found</div>}>
                          {msg => (
                            <div class={["user", "human"].includes(msg.role) ? "user-round" : ""}>
                              <div class="message">
                                {((msg.content || "").length || 0) > 7000 ? (
                                  <Dialog
                                    trigger={
                                      <button
                                        title="Show full message"
                                        style={{
                                          padding: ".4rem .6rem",
                                          "border-radius": "6px",
                                          border: "none",
                                          cursor: "pointer",
                                        }}
                                      >
                                        Show context message
                                      </button>
                                    }
                                    onOpen={() => setTimeout(() => highlightAll(), 0)}
                                  >
                                    {/* eslint-disable-next-line solid/no-innerhtml */}
                                    <article innerHTML={renderMarkdown(msg.content)} />
                                  </Dialog>
                                ) : (
                                  // eslint-disable-next-line solid/no-innerhtml
                                  <article innerHTML={renderMarkdown(msg.content)} />
                                )}

                                {/* Display SPARQL query results if present */}
                                <Show when={msg.query_results}>
                                  {qr => (
                                    <div
                                      style={{
                                        "margin-top": ".5rem",
                                        "font-size": "0.9rem",
                                        display: "flex",
                                        "align-items": "center",
                                        gap: ".5rem",
                                      }}
                                    >
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
                                                <p>{qr().question}</p>
                                                <p>{qr().sparql_endpoint}</p>
                                                <pre>
                                                  <code class="language-sparql">{qr().sparql_query}</code>
                                                </pre>
                                                <pre>
                                                  <code class="language-json">
                                                    {JSON.stringify(qr().results ?? [], null, 2)}
                                                  </code>
                                                </pre>
                                              </Dialog>
                                            )}
                                          </div>
                                        </>
                                      ) : (
                                        <div
                                          class="query-card"
                                          style={{
                                            "background-color": "#ffe6e6",
                                            color: "#990000",
                                            padding: ".5rem",
                                            "border-radius": "6px",
                                          }}
                                        >
                                          {qr().error ? `Error: ${qr().error}` : "Query results: 0"}
                                        </div>
                                      )}
                                      {/* External SPARQL editor link */}
                                      <a
                                        href={`https://sib-swiss.github.io/sparql-editor/?query=${encodeURIComponent(qr().sparql_query || "")}&endpoint=${encodeURIComponent(qr().sparql_endpoint || "")}`}
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
                          <div class="steps-box">
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
                                      setTimeout(() => highlightAll(), 0);
                                    }}
                                  >
                                    <div>
                                      <div
                                        style={{
                                          display: "flex",
                                          gap: ".5em",
                                          "margin-bottom": "1rem",
                                          "flex-wrap": "wrap",
                                          "align-items": "stretch",
                                        }}
                                      >
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
                                      setTimeout(() => highlightAll(), 0);
                                    }}
                                  >
                                    <article
                                      // eslint-disable-next-line solid/no-innerhtml
                                      innerHTML={renderMarkdown(step.details)}
                                    />
                                  </Dialog>
                                ) : (
                                  <p title={`Node: ${step.node_id}`}>{step.label}</p>
                                )
                              }
                            </For>
                          </div>
                        </Show>
                      </Show>
                    </div>
                  )}
                </For>

                {/* Bottom pagination for convenience */}
                <Show when={paginatedResult().totalPages > 1}>
                  <div
                    class="pagination-controls"
                    style={{
                      display: "flex",
                      "justify-content": "center",
                      gap: "0.5rem",
                      "align-items": "center",
                      padding: "1rem 0",
                      "margin-top": "1rem",
                      "border-top": "1px solid #eee",
                    }}
                  >
                    <button
                      onClick={() => goToPage(1)}
                      disabled={currentPage() === 1}
                      style={{padding: "0.25rem 0.5rem", cursor: currentPage() === 1 ? "not-allowed" : "pointer"}}
                    >
                      ⏮️ First
                    </button>
                    <button
                      onClick={() => goToPage(currentPage() - 1)}
                      disabled={currentPage() === 1}
                      style={{padding: "0.25rem 0.5rem", cursor: currentPage() === 1 ? "not-allowed" : "pointer"}}
                    >
                      ◀️ Previous
                    </button>
                    <span style={{padding: "0 1rem"}}>
                      Page {currentPage()} of {paginatedResult().totalPages}
                    </span>
                    <button
                      onClick={() => goToPage(currentPage() + 1)}
                      disabled={currentPage() === paginatedResult().totalPages}
                      style={{
                        padding: "0.25rem 0.5rem",
                        cursor: currentPage() === paginatedResult().totalPages ? "not-allowed" : "pointer",
                      }}
                    >
                      Next ▶️
                    </button>
                    <button
                      onClick={() => goToPage(paginatedResult().totalPages)}
                      disabled={currentPage() === paginatedResult().totalPages}
                      style={{
                        padding: "0.25rem 0.5rem",
                        cursor: currentPage() === paginatedResult().totalPages ? "not-allowed" : "pointer",
                      }}
                    >
                      Last ⏭️
                    </button>
                  </div>
                </Show>
              </Show>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}
