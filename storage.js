/* storage.js — IndexedDB persistence for Termio.
 * No localStorage as the main store. A tiny in-memory cache mirrors the
 * key/value settings object so reads stay synchronous for the UI.
 */
(function (global) {
  "use strict";

  const DB_NAME = "termio";
  const DB_VERSION = 1;
  const STORE_KV = "kv";        // settings: setupDone, apiKey, model, prefs
  const STORE_HISTORY = "history"; // terminal session history (chronological)

  let dbPromise = null;
  const memCache = {}; // settings mirror

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_KV)) {
          db.createObjectStore(STORE_KV); // key/value
        }
        if (!db.objectStoreNames.contains(STORE_HISTORY)) {
          const hs = db.createObjectStore(STORE_HISTORY, { keyPath: "id", autoIncrement: true });
          hs.createIndex("ts", "ts", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(db, store, mode) {
    return db.transaction(store, mode).objectStore(store);
  }

  function reqToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // ---- settings (key/value) ----
  async function getSetting(key) {
    const db = await openDB();
    const val = await reqToPromise(tx(db, STORE_KV, "readonly").get(key));
    return val === undefined ? null : val;
  }

  async function setSetting(key, value) {
    memCache[key] = value;
    const db = await openDB();
    await reqToPromise(tx(db, STORE_KV, "readwrite").put(value, key));
    return value;
  }

  async function delSetting(key) {
    delete memCache[key];
    const db = await openDB();
    await reqToPromise(tx(db, STORE_KV, "readwrite").delete(key));
  }

  async function getAllSettings() {
    const db = await openDB();
    const keys = await reqToPromise(tx(db, STORE_KV, "readonly").getAllKeys());
    const vals = await reqToPromise(tx(db, STORE_KV, "readonly").getAll());
    const out = {};
    for (let i = 0; i < keys.length; i++) out[keys[i]] = vals[i];
    Object.assign(memCache, out);
    return out;
  }

  async function clearSettings() {
    const db = await openDB();
    await reqToPromise(tx(db, STORE_KV, "readwrite").clear());
    for (const k in memCache) delete memCache[k];
  }

  // ---- history ----
  async function addHistory(entry) {
    const db = await openDB();
    const record = Object.assign({ ts: Date.now() }, entry);
    const id = await reqToPromise(tx(db, STORE_HISTORY, "readwrite").add(record));
    return id;
  }

  async function getHistory(limit) {
    const db = await openDB();
    const all = await reqToPromise(tx(db, STORE_HISTORY, "readonly").getAll());
    all.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    return typeof limit === "number" ? all.slice(-limit) : all;
  }

  async function clearHistory() {
    const db = await openDB();
    await reqToPromise(tx(db, STORE_HISTORY, "readwrite").clear());
  }

  // ---- wholesale reset ----
  async function resetAll() {
    const db = await openDB();
    await reqToPromise(tx(db, STORE_KV, "readwrite").clear());
    await reqToPromise(tx(db, STORE_HISTORY, "readwrite").clear());
    for (const k in memCache) delete memCache[k];
  }

  global.Storage = {
    getSetting,
    setSetting,
    delSetting,
    getAllSettings,
    clearSettings,
    addHistory,
    getHistory,
    clearHistory,
    resetAll,
    _mem: memCache,
  };
})(window);
