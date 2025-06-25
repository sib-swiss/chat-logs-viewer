/**
 * IndexedDB utility for storing uploaded files which can be quite large (~100MB)
 */

const DB_NAME = "ChatLogsViewerDB";
const DB_VERSION = 1;
const STORE_NAME = "uploadedFiles";

interface StoredFile {
  id: string; // "likes", "dislikes", or "langfuse"
  name: string;
  size: number;
  type: string;
  lastModified: number;
  content: string; // File content as text
  uploadedAt: number;
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
      // Create object store if it doesn't exist
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, {keyPath: "id"});
        store.createIndex("uploadedAt", "uploadedAt", {unique: false});
      }
    };
  });
};

/**
 * Store a file in IndexedDB
 */
export const storeFile = async (fileType: "likes" | "dislikes" | "langfuse", file: File): Promise<void> => {
  const db = await initDB();
  const content = await file.text();
  const storedFile: StoredFile = {
    id: fileType,
    name: file.name,
    size: file.size,
    type: file.type,
    lastModified: file.lastModified,
    content,
    uploadedAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(storedFile);
    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      reject(new Error(`Failed to store file: ${file.name}`));
    };
  });
};

/**
 * Retrieve a stored file from IndexedDB
 */
export const getStoredFile = async (fileType: "likes" | "dislikes" | "langfuse"): Promise<StoredFile | null> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(fileType);
    request.onsuccess = () => {
      resolve(request.result || null);
    };
    request.onerror = () => {
      reject(new Error(`Failed to retrieve file: ${fileType}`));
    };
  });
};

/**
 * Get all stored files
 */
export const getAllStoredFiles = async (): Promise<StoredFile[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(new Error("Failed to retrieve all files"));
    };
  });
};

/**
 * Delete a stored file
 */
export const deleteStoredFile = async (fileType: "likes" | "dislikes" | "langfuse"): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(fileType);
    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      reject(new Error(`Failed to delete file: ${fileType}`));
    };
  });
};

/**
 * Clear all stored files
 */
export const clearAllStoredFiles = async (): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();
    request.onsuccess = () => {
      resolve();
    };
    request.onerror = () => {
      reject(new Error("Failed to clear all files"));
    };
  });
};

/**
 * Create a File object from stored file data
 */
export const createFileFromStored = (storedFile: StoredFile): File => {
  const blob = new Blob([storedFile.content], {type: storedFile.type || "application/json"});
  const file = new File([blob], storedFile.name, {
    type: storedFile.type || "application/json",
    lastModified: storedFile.lastModified,
  });
  return file;
};
