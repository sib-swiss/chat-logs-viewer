/**
 * IndexedDB utility for storing conversations data
 */

const DB_NAME = "ChatLogsViewerDB";
const DB_VERSION = 3; // Increment version to migrate to new structure
const CONVERSATIONS_STORE_NAME = "conversations";

interface StoredConversations {
  id: string; // "likes", "dislikes", or "langfuse"
  label: string;
  fileName: string;
  fileSize: number;
  conversations: any[];
  uploadedAt: number;
  updatedAt: number;
}

/**
 * Initialize IndexedDB
 */
const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => {
      reject(new Error("Failed to open IndexedDB"));
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onupgradeneeded = event => {
      const db = (event.target as IDBOpenDBRequest).result;
      // Remove old store if it exists
      if (db.objectStoreNames.contains("uploadedFiles")) {
        db.deleteObjectStore("uploadedFiles");
      }
      // Create or recreate conversations store with new structure
      if (db.objectStoreNames.contains(CONVERSATIONS_STORE_NAME)) {
        db.deleteObjectStore(CONVERSATIONS_STORE_NAME);
      }
      const conversationsStore = db.createObjectStore(CONVERSATIONS_STORE_NAME, {keyPath: "id"});
      conversationsStore.createIndex("label", "label", {unique: false});
      conversationsStore.createIndex("updatedAt", "updatedAt", {unique: false});
    };
  });
};

/**
 * Store conversations from a file
 */
export const storeConversations = async (fileType: "likes" | "dislikes" | "langfuse", file: File, conversations: any[]): Promise<void> => {
  const db = await initDB();
  const storedConversations: StoredConversations = {
    id: fileType,
    label: fileType,
    fileName: file.name,
    fileSize: file.size,
    conversations,
    uploadedAt: Date.now(),
    updatedAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CONVERSATIONS_STORE_NAME], "readwrite");
    const store = transaction.objectStore(CONVERSATIONS_STORE_NAME);
    const request = store.put(storedConversations);
    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      reject(new Error(`Failed to store conversations for: ${file.name}`));
    };
  });
};

/**
 * Get stored conversations
 */
export const getStoredConversations = async (fileType: "likes" | "dislikes" | "langfuse"): Promise<any[] | null> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CONVERSATIONS_STORE_NAME], "readonly");
    const store = transaction.objectStore(CONVERSATIONS_STORE_NAME);
    const request = store.get(fileType);
    request.onsuccess = () => {
      const result = request.result;
      resolve(result ? result.conversations : null);
    };
    request.onerror = () => {
      reject(new Error(`Failed to retrieve conversations for: ${fileType}`));
    };
  });
};

/**
 * Get all stored conversation sets (returns metadata about uploaded files)
 */
export const getAllStoredConversations = async (): Promise<StoredConversations[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CONVERSATIONS_STORE_NAME], "readonly");
    const store = transaction.objectStore(CONVERSATIONS_STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(new Error("Failed to retrieve all conversations"));
    };
  });
};

/**
 * Delete stored conversations
 */
export const deleteStoredConversations = async (fileType: "likes" | "dislikes" | "langfuse"): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CONVERSATIONS_STORE_NAME], "readwrite");
    const store = transaction.objectStore(CONVERSATIONS_STORE_NAME);
    const request = store.delete(fileType);
    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      reject(new Error(`Failed to delete conversations: ${fileType}`));
    };
  });
};

/**
 * Clear all stored conversations
 */
export const clearAllStoredConversations = async (): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([CONVERSATIONS_STORE_NAME], "readwrite");
    const store = transaction.objectStore(CONVERSATIONS_STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      reject(new Error("Failed to clear all conversations"));
    };
  });
};

/**
 * Create a mock File object from stored conversation data (for backward compatibility)
 */
export const createFileFromStored = (storedConversations: StoredConversations): File => {
  // Create a mock JSONL content from conversations
  const jsonlContent = storedConversations.conversations.map(conv => JSON.stringify(conv)).join('\n');
  const blob = new Blob([jsonlContent], {type: "application/json"});
  const file = new File([blob], storedConversations.fileName, {
    type: "application/json",
    lastModified: storedConversations.updatedAt,
  });
  return file;
};

/**
 * Update a specific conversation's SPARQL results
 */
export const updateConversationSparqlResults = async (
  fileType: "likes" | "dislikes" | "langfuse",
  conversationTimestamp: string,
  results: any[]
): Promise<void> => {
  // Get existing conversations
  const existingConversations = await getStoredConversations(fileType);
  if (!existingConversations) return;
  // Find and update the specific conversation
  const updatedConversations = existingConversations.map(conv => {
    if (conv.timestamp === conversationTimestamp && conv.sparql_block) {
      return {
        ...conv,
        sparql_block: {
          ...conv.sparql_block,
          results
        }
      };
    }
    return conv;
  });
  // Get the stored conversations metadata to preserve file info
  const db = await initDB();
  const storedConversations = await new Promise<StoredConversations | null>((resolve, reject) => {
    const transaction = db.transaction([CONVERSATIONS_STORE_NAME], "readonly");
    const store = transaction.objectStore(CONVERSATIONS_STORE_NAME);
    const request = store.get(fileType);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(new Error(`Failed to get stored conversations: ${fileType}`));
  });
  if (!storedConversations) return;
  // Update the stored conversations with new results
  const updatedStoredConversations: StoredConversations = {
    ...storedConversations,
    conversations: updatedConversations,
    updatedAt: Date.now(),
  };
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction([CONVERSATIONS_STORE_NAME], "readwrite");
    const store = transaction.objectStore(CONVERSATIONS_STORE_NAME);
    const request = store.put(updatedStoredConversations);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error(`Failed to update conversations: ${fileType}`));
  });
};

export { type StoredConversations };
