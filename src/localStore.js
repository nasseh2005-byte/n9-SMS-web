const DATABASE_NAME = "n9-sms-local";
const DATABASE_VERSION = 1;
const STORE_NAME = "archives";
const CURRENT_ARCHIVE_KEY = "current";

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("التخزين المحلي غير متاح في هذا المتصفح."));
      return;
    }
    const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("تعذر فتح التخزين المحلي."));
  });
}

function runTransaction(mode, action) {
  return openDatabase().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    let request;
    try {
      request = action(store);
    } catch (error) {
      database.close();
      reject(error);
      return;
    }
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("تعذر إكمال التخزين المحلي."));
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => database.close();
    transaction.onabort = () => database.close();
  }));
}

export function saveCurrentArchive(messages, sourceName) {
  return runTransaction("readwrite", (store) => store.put({
    sourceName,
    messages,
    savedAt: Date.now(),
    version: 1,
  }, CURRENT_ARCHIVE_KEY));
}

export function loadCurrentArchive() {
  return runTransaction("readonly", (store) => store.get(CURRENT_ARCHIVE_KEY));
}

export function clearCurrentArchive() {
  return runTransaction("readwrite", (store) => store.delete(CURRENT_ARCHIVE_KEY));
}

function workspaceArchiveKey(workspaceId) {
  return `workspace:${workspaceId}`;
}

export function saveWorkspaceArchive(workspaceId, messages, sourceName) {
  return runTransaction("readwrite", (store) => store.put({
    workspaceId,
    sourceName,
    messages,
    savedAt: Date.now(),
    version: 1,
  }, workspaceArchiveKey(workspaceId)));
}

export function loadWorkspaceArchive(workspaceId) {
  return runTransaction("readonly", (store) => store.get(workspaceArchiveKey(workspaceId)));
}

export function clearWorkspaceArchive(workspaceId) {
  return runTransaction("readwrite", (store) => store.delete(workspaceArchiveKey(workspaceId)));
}
