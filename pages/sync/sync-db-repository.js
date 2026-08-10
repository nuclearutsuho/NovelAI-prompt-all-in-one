const DEFAULT_DB_NAME = 'WildcardSyncDB';
const DEFAULT_DB_VERSION = 3;
const DEFAULT_HANDLE_STORE = 'handles';
const DEFAULT_SNAPSHOT_STORE = 'snapshots';
const DEFAULT_DIR_HANDLE_KEY = 'wildcardDirHandle';

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 请求失败'));
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB 事务失败'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB 事务已中止'));
  });
}

export default function createSyncDbRepository(options = {}) {
  const indexedDBRef = options.indexedDBRef || globalThis.indexedDB;
  const dbName = options.dbName || DEFAULT_DB_NAME;
  const dbVersion = options.dbVersion || DEFAULT_DB_VERSION;
  const handleStore = options.handleStore || DEFAULT_HANDLE_STORE;
  const snapshotStore = options.snapshotStore || DEFAULT_SNAPSHOT_STORE;
  const dirHandleKey = options.dirHandleKey || DEFAULT_DIR_HANDLE_KEY;
  let databasePromise = null;

  if (!indexedDBRef?.open) {
    throw new TypeError('[Sync DB] 当前环境不支持 IndexedDB');
  }

  function open() {
    if (databasePromise) return databasePromise;
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDBRef.open(dbName, dbVersion);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(handleStore)) {
          database.createObjectStore(handleStore);
        }
        if (!database.objectStoreNames.contains(snapshotStore)) {
          database.createObjectStore(snapshotStore, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => {
          database.close();
          databasePromise = null;
        };
        database.onclose = () => {
          databasePromise = null;
        };
        resolve(database);
      };
      request.onerror = () => {
        databasePromise = null;
        reject(request.error || new Error('无法打开同步数据库'));
      };
      request.onblocked = () => {
        console.warn('[Sync DB] 数据库升级被其他页面阻塞');
      };
    });
    return databasePromise;
  }

  async function saveDirHandle(handle) {
    const database = await open();
    const transaction = database.transaction(handleStore, 'readwrite');
    transaction.objectStore(handleStore).put(handle, dirHandleKey);
    await transactionToPromise(transaction);
  }

  async function getDirHandle() {
    const database = await open();
    const transaction = database.transaction(handleStore, 'readonly');
    const resultPromise = requestToPromise(transaction.objectStore(handleStore).get(dirHandleKey));
    const [result] = await Promise.all([resultPromise, transactionToPromise(transaction)]);
    return result || null;
  }

  async function removeDirHandle() {
    const database = await open();
    const transaction = database.transaction(handleStore, 'readwrite');
    transaction.objectStore(handleStore).delete(dirHandleKey);
    await transactionToPromise(transaction);
  }

  async function saveSnapshot(snapshot) {
    const database = await open();
    const transaction = database.transaction(snapshotStore, 'readwrite');
    transaction.objectStore(snapshotStore).put(snapshot);
    await transactionToPromise(transaction);
  }

  async function listSnapshots() {
    const database = await open();
    const transaction = database.transaction(snapshotStore, 'readonly');
    const resultPromise = requestToPromise(transaction.objectStore(snapshotStore).getAll());
    const [snapshots] = await Promise.all([resultPromise, transactionToPromise(transaction)]);
    return (snapshots || []).sort((left, right) => Number(right?.timestamp || 0) - Number(left?.timestamp || 0));
  }

  async function getSnapshot(id) {
    const database = await open();
    const transaction = database.transaction(snapshotStore, 'readonly');
    const resultPromise = requestToPromise(transaction.objectStore(snapshotStore).get(id));
    const [result] = await Promise.all([resultPromise, transactionToPromise(transaction)]);
    return result || null;
  }

  async function deleteSnapshot(id) {
    const database = await open();
    const transaction = database.transaction(snapshotStore, 'readwrite');
    transaction.objectStore(snapshotStore).delete(id);
    await transactionToPromise(transaction);
  }

  return Object.freeze({
    open,
    saveDirHandle,
    getDirHandle,
    removeDirHandle,
    saveSnapshot,
    listSnapshots,
    getSnapshot,
    deleteSnapshot
  });
}

export {
  DEFAULT_DB_NAME,
  DEFAULT_DB_VERSION,
  DEFAULT_HANDLE_STORE,
  DEFAULT_SNAPSHOT_STORE,
  DEFAULT_DIR_HANDLE_KEY
};
