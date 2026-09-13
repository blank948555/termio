/* app.js — Termio app logic: setup, settings, terminal, model picker, multi-session history, security. */
(function () {
  "use strict";

  const { Storage, OpenRouter } = window;

  // ---- element refs ----
  const el = (id) => document.getElementById(id);
  const $setup = el("setup");
  const $app = el("app");
  const $setupForm = el("setup-form");
  const $setupKey = el("setup-key");

  // topbar
  const $menuBtn = el("menu-btn");
  const $historyBtn = el("history-btn");
  const $newSessionBtn = el("new-session-btn");
  const $modelBtn = el("model-btn");
  const $modelPillName = el("model-pill-name");

  // terminal
  const $term = el("term");
  const $termOutput = el("term-output");
  const $termWelcome = el("term-welcome");
  const $cmdForm = el("cmd-form");
  const $cmdInput = el("cmd-input");
  const $toast = el("toast");

  // picker
  const $picker = el("picker");
  const $pickerClose = el("picker-close");
  const $pickerSearch = el("picker-search");
  const $pickerCats = el("picker-cats");
  const $pickerList = el("picker-list");
  const $pickerCount = el("picker-count");

  // settings
  const $settings = el("settings");
  const $settingsClose = el("settings-close");
  const $keyStatusBadge = el("key-status-badge");
  const $setKey = el("set-key");
  const $setKeySave = el("set-key-save");
  const $setKeyClear = el("set-key-clear");
  const $setModel = el("set-model");
  const $setModelName = el("set-model-name");
  const $setClear = el("set-clear");
  const $setHeaders = el("set-headers");
  const $setClearSession = el("set-clear-session");
  const $setReset = el("set-reset");
  const $setChangelog = el("set-changelog");
  const $setVersion = el("set-version");

  // changelog
  const $changelog = el("changelog");
  const $changelogClose = el("changelog-close");
  const $changelogList = el("changelog-list");

  // session history
  const $historyModal = el("history-modal");
  const $historyClose = el("history-close");
  const $historyList = el("history-list");
  const $historyNewBtn = el("history-new-btn");

  // confirm modal
  const $confirmModal = el("confirm-modal");
  const $confirmTitle = el("confirm-title");
  const $confirmMessage = el("confirm-message");
  const $confirmCancelBtn = el("confirm-cancel-btn");
  const $confirmOkBtn = el("confirm-ok-btn");

  // ---- app state ----
  const state = {
    apiKey: null,
    modelId: null,
    model: null,           // selected model object
    prefs: { clearOnCmd: false, showHeaders: true },
    models: [],            // catalog cache
    modelsCacheAt: 0,
    activeCat: "all",
    search: "",
    activeSession: null,   // active session object
    conversation: [],      // Responses API input history
    sessionId: null,       // OpenRouter sticky session container id
    running: false,
    abortCtrl: null,
  };

  let welcomeTimer = null;

  const CAT_LABELS = { all: "All", free: "Free", cheap: "Cheap", fast: "Fast", premium: "Premium" };

  const VERSION = "v1.0";
  const CHANGELOG = [
    {
      version: "v1.0",
      items: [
        "Fullscreen true-AMOLED redesign: setup, settings, model picker, history, and changelog are now dedicated fullscreen views.",
        "Setup introduces each part one by one with smooth staged reveal animations on a true black background.",
        "Model pricing now shows real per-token input and output rates directly from the OpenRouter catalog — no invented per-prompt estimates.",
        "Model catalog fetched dynamically from OpenRouter (complete catalog, no hardcoded model list or prices).",
        "Pill-shaped, rounded components throughout; refined top header and command input for smoother, responsive mobile use.",
        "Version moved off the home screen into Settings → Version & Changelog.",
      ],
    },
  ];

  // ---- utils ----
  function toast(msg, ms) {
    $toast.textContent = msg;
    $toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { $toast.hidden = true; }, ms || 2400);
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function fmtPerM(n) {
    if (n == null) return null;
    if (n === 0) return "free";
    if (n < 0.01) return "<$0.01/M";
    if (n < 1) return "$" + n.toFixed(3) + "/M";
    if (n < 100) return "$" + n.toFixed(2) + "/M";
    return "$" + Math.round(n) + "/M";
  }

  function isPriceHigh(m) {
    const p = OpenRouter.priceOrderMetric(m);
    return p != null && p >= 5;
  }

  function fmtCtx(m) {
    const c = m.context_length || (m.top_provider && m.top_provider.context_length);
    if (!c) return "";
    if (c >= 1000) return (c / 1000) + "K ctx";
    return c + " ctx";
  }

  function fmtTime(ts) {
    if (!ts) return "";
    const diff = Date.now() - ts;
    if (diff < 60000) return "Just now";
    if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
    if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  function modelDisplayName(m) {
    return (m && (m.name || OpenRouter.shortName(m))) || "Model…";
  }

  function findModelById(id) {
    return state.models.find((m) => m.id === id) || null;
  }

  // ---- Custom Confirmation Modal ----
  function showConfirmModal({ title, message, confirmText = "Confirm", cancelText = "Cancel", danger = true }) {
    return new Promise((resolve) => {
      $confirmTitle.textContent = title || "Confirm Action";
      $confirmMessage.textContent = message || "Are you sure you want to proceed?";
      $confirmOkBtn.textContent = confirmText;
      $confirmCancelBtn.textContent = cancelText;

      if (danger) {
        $confirmOkBtn.className = "btn btn-danger";
      } else {
        $confirmOkBtn.className = "btn btn-primary";
      }

      $confirmModal.hidden = false;

      function cleanup(result) {
        $confirmModal.hidden = true;
        $confirmOkBtn.removeEventListener("click", onOk);
        $confirmCancelBtn.removeEventListener("click", onCancel);
        resolve(result);
      }

      function onOk() { cleanup(true); }
      function onCancel() { cleanup(false); }

      $confirmOkBtn.addEventListener("click", onOk);
      $confirmCancelBtn.addEventListener("click", onCancel);
    });
  }

  // ---- terminal rendering ----
  function scrollTerm() {
    $term.scrollTop = $term.scrollHeight;
  }

  function appendBlock(nodes) {
    const block = document.createElement("div");
    block.className = "term-block is-new";
    for (const n of nodes) block.appendChild(n);
    $termOutput.appendChild(block);
    scrollTerm();
    return block;
  }

  function mkCmdLine(cmd) {
    const line = document.createElement("div");
    line.className = "cmd-line";
    const sym = document.createElement("span");
    sym.className = "prompt-sym";
    sym.textContent = "$";
    const txt = document.createElement("span");
    txt.className = "cmd-text";
    txt.textContent = cmd;
    line.appendChild(sym);
    line.appendChild(txt);
    return line;
  }

  function mkOut(text, cls) {
    const out = document.createElement("div");
    out.className = "term-out is-new" + (cls ? " " + cls : "");
    out.textContent = text == null ? "" : String(text);
    return out;
  }

  function mkRunning() {
    const wrap = document.createElement("div");
    wrap.className = "running-line";
    wrap.innerHTML = '<span>Running</span><span class="dots"><span></span><span></span><span></span></span>';
    return wrap;
  }

  function mkMeta(parts) {
    const meta = document.createElement("div");
    meta.className = "term-meta";
    for (const p of parts) {
      if (p == null || p === "") continue;
      const s = document.createElement("span");
      s.textContent = p;
      meta.appendChild(s);
    }
    return meta;
  }

  function appendBlockRecord(record) {
    if (!state.activeSession) return;
    if (!state.activeSession.blocks) state.activeSession.blocks = [];
    state.activeSession.blocks.push(record);
  }

  function restoreSessionBlocks(blocks) {
    $termOutput.innerHTML = "";
    if (!Array.isArray(blocks) || blocks.length === 0) return;

    let currentBlock = null;
    for (const b of blocks) {
      if (!b) continue;
      if (b.kind === "cmd") {
        currentBlock = document.createElement("div");
        currentBlock.className = "term-block";
        currentBlock.appendChild(mkCmdLine(b.text));
        $termOutput.appendChild(currentBlock);
      } else {
        if (!currentBlock) {
          currentBlock = document.createElement("div");
          currentBlock.className = "term-block";
          $termOutput.appendChild(currentBlock);
        }
        if (b.kind === "out") {
          currentBlock.appendChild(mkOut(b.text, b.cls));
        } else if (b.kind === "meta") {
          currentBlock.appendChild(mkMeta(b.parts || []));
        }
      }
    }
    scrollTerm();
  }

  // ---- welcome animation ----
  function renderWelcome(animate = false) {
    if (welcomeTimer) { clearTimeout(welcomeTimer); welcomeTimer = null; }
    if ($termOutput.children.length > 0) {
      $termWelcome.hidden = true;
      return;
    }

    $termWelcome.hidden = false;
    $termWelcome.innerHTML = "";

    const lines = [
      "TERMIO [OpenRouter Hosted Shell]",
      "Connected to isolated Linux environment.",
      "Enter a command or ask the terminal to begin."
    ];

    if (!animate) {
      $termWelcome.innerHTML = lines.map((l, i) =>
        `<div class="${i === 0 ? 'term-welcome-line' : 'term-welcome-sub'}">${escapeHtml(l)}</div>`
      ).join("");
      return;
    }

    let lineIdx = 0;
    let charIdx = 0;
    const lineNodes = lines.map((l, i) => {
      const div = document.createElement("div");
      div.className = i === 0 ? "term-welcome-line" : "term-welcome-sub";
      $termWelcome.appendChild(div);
      return div;
    });

    function typeNext() {
      if (lineIdx >= lines.length) return;
      const targetText = lines[lineIdx];
      charIdx += 2;
      if (charIdx > targetText.length) charIdx = targetText.length;
      lineNodes[lineIdx].textContent = targetText.slice(0, charIdx);

      if (charIdx < targetText.length) {
        welcomeTimer = setTimeout(typeNext, 12);
      } else {
        lineIdx++;
        charIdx = 0;
        welcomeTimer = setTimeout(typeNext, 40);
      }
    }
    typeNext();
  }

  // ---- boot ----
  async function boot() {
    try {
      await Storage.getAllSettings();
    } catch (e) {
      console.error("storage init failed", e);
    }
    const setupDone = Storage._mem.setupDone === true;
    if (setupDone) {
      await showApp();
    } else {
      showSetup();
    }
    bindEvents();
  }

  function showSetup() {
    $setup.hidden = false;
    $app.hidden = true;
    $picker.hidden = true;
    $settings.hidden = true;
    $historyModal.hidden = true;
    $changelog.hidden = true;
    // Trigger the staged reveal animation by (re)applying the revealing class.
    $setup.classList.remove("is-revealing");
    void $setup.offsetWidth;
    $setup.classList.add("is-revealing");
  }

  async function showApp() {
    state.apiKey = Storage._mem.apiKey || null;
    state.modelId = Storage._mem.model || null;
    const prefs = Storage._mem.prefs || {};
    if (prefs && typeof prefs === "object") {
      state.prefs = Object.assign(state.prefs, prefs);
    }

    $setup.hidden = true;
    $app.hidden = false;

    renderModelPill();

    // Load active session or create a new session
    const activeSessionId = Storage._mem.activeSessionId || null;
    let loaded = null;
    if (activeSessionId) {
      try { loaded = await Storage.getSession(activeSessionId); } catch (e) {}
    }

    if (loaded) {
      setActiveSession(loaded);
    } else {
      await startNewSession({ playWelcome: true });
    }

    // load catalog in background
    loadModels().then(() => {
      if (state.modelId) {
        state.model = findModelById(state.modelId);
        renderModelPill();
      } else if (state.models.length) {
        openPicker();
      }
    }).catch((e) => {
      console.warn("model load failed", e);
      toast("Could not load models");
    });

    focusInput();
  }

  function focusInput() {
    if (!$picker.hidden || !$settings.hidden || !$historyModal.hidden || !$changelog.hidden || !$confirmModal.hidden) return;
    requestAnimationFrame(() => { try { $cmdInput.focus({ preventScroll: true }); } catch (e) {} });
  }

  // ---- session management ----
  function generateSessionId() {
    return "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
  }

  async function startNewSession({ playWelcome = true } = {}) {
    const newSess = {
      id: generateSessionId(),
      title: "New Session",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      modelId: state.modelId,
      openrouterSessionId: null,
      conversation: [],
      blocks: [],
    };

    state.activeSession = newSess;
    state.conversation = [];
    state.sessionId = null;

    $termOutput.innerHTML = "";
    renderWelcome(playWelcome);

    try {
      await Storage.saveSession(newSess);
      await Storage.setSetting("activeSessionId", newSess.id);
    } catch (e) {}

    return newSess;
  }

  function setActiveSession(sess) {
    state.activeSession = sess;
    state.conversation = sess.conversation || [];
    state.sessionId = sess.openrouterSessionId || null;
    if (sess.modelId && sess.modelId !== state.modelId) {
      state.modelId = sess.modelId;
      state.model = findModelById(sess.modelId);
      renderModelPill();
    }

    restoreSessionBlocks(sess.blocks || []);
    renderWelcome(false);
  }

  async function openSession(id) {
    try {
      const sess = await Storage.getSession(id);
      if (sess) {
        setActiveSession(sess);
        await Storage.setSetting("activeSessionId", sess.id);
        toast("Loaded session: " + sess.title);
      }
    } catch (e) {
      toast("Could not load session");
    }
  }

  // ---- setup ----
  $setupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const key = $setupKey.value.trim();
    if (!key) { toast("Enter your OpenRouter API key"); return; }
    try {
      await Storage.setSetting("apiKey", key);
      await Storage.setSetting("setupDone", true);
      $setupKey.value = "";
      toast("Setup complete");
      await showApp();
    } catch (err) {
      toast("Could not save settings");
    }
  });

  // ---- models ----
  async function loadModels(force) {
    const now = Date.now();
    if (!force && state.models.length && now - state.modelsCacheAt < 5 * 60 * 1000) {
      return state.models;
    }
    const models = await OpenRouter.fetchModels(state.apiKey || null);
    state.models = models.slice();
    state.modelsCacheAt = now;
    return state.models;
  }

  function categorizeForList(m) {
    return OpenRouter.categorize(m);
  }

  function renderModelPill() {
    const m = state.model || (state.modelId ? findModelById(state.modelId) : null);
    $modelPillName.textContent = m ? modelDisplayName(m) : (state.modelId || "Model…");
    $setModelName.textContent = m ? modelDisplayName(m) : (state.modelId || "Model…");
  }

  // ---- picker ----
  function openPicker() {
    $picker.hidden = false;
    renderPicker();
  }
  function closePicker() {
    $picker.hidden = true;
    focusInput();
  }

  $modelBtn.addEventListener("click", openPicker);
  $setModel.addEventListener("click", openPicker);
  $pickerClose.addEventListener("click", closePicker);
  $picker.addEventListener("click", (e) => { if (e.target === $picker) closePicker(); });

  $pickerSearch.addEventListener("input", () => {
    state.search = $pickerSearch.value.trim().toLowerCase();
    renderPickerList();
  });

  function renderPicker() {
    renderCats();
    renderPickerList();
    $pickerCount.textContent = state.models.length
      ? state.models.length + ""
      : "";
  }

  function renderCats() {
    const counts = { all: state.models.length, free: 0, cheap: 0, fast: 0, premium: 0 };
    for (const m of state.models) {
      const cats = categorizeForList(m);
      for (const c of cats) if (counts[c] != null) counts[c]++;
    }
    const order = ["all", "free", "cheap", "fast", "premium"];
    $pickerCats.innerHTML = "";
    for (const key of order) {
      if (key !== "all" && counts[key] === 0) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cat-btn";
      b.textContent = CAT_LABELS[key] + (key !== "all" ? " · " + counts[key] : "");
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(state.activeCat === key));
      b.addEventListener("click", () => {
        state.activeCat = key;
        renderCats();
        renderPickerList();
      });
      $pickerCats.appendChild(b);
    }
  }

  function visibleModels() {
    const q = state.search;
    return state.models.filter((m) => {
      const cats = categorizeForList(m);
      if (state.activeCat !== "all" && !cats.includes(state.activeCat)) return false;
      if (!q) return true;
      const hay = ((m.id || "") + " " + (m.name || "") + " " + (m.description || "")).toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  function renderPickerList() {
    $pickerList.innerHTML = "";
    const list = visibleModels();

    list.sort((a, b) => {
      const as = a.id === state.modelId ? -1 : 0;
      const bs = b.id === state.modelId ? -1 : 0;
      if (as !== bs) return as - bs;
      const an = (a.name || a.id || "").toLowerCase();
      const bn = (b.name || b.id || "").toLowerCase();
      return an < bn ? -1 : an > bn ? 1 : 0;
    });

    const frag = document.createDocumentFragment();
    for (let i = 0; i < list.length; i++) {
      const m = list[i];
      const item = document.createElement("button");
      item.type = "button";
      item.className = "picker-item";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(m.id === state.modelId));

      const top = document.createElement("div");
      top.className = "picker-item-top";
      const name = document.createElement("span");
      name.className = "picker-item-name";
      name.textContent = m.name || OpenRouter.shortName(m);
      const provId = document.createElement("span");
      provId.className = "picker-item-id";
      provId.textContent = m.id;
      top.appendChild(name);
      top.appendChild(provId);

      const meta = document.createElement("div");
      meta.className = "picker-item-meta";
      if (OpenRouter.isFree(m)) {
        const priceSpan = document.createElement("span");
        priceSpan.className = "tag tag-free";
        priceSpan.textContent = "free";
        meta.appendChild(priceSpan);
      } else {
        const inP = OpenRouter.promptPricePerM(m);
        const outP = OpenRouter.completionPricePerM(m);
        if (inP != null) {
          const inTag = document.createElement("span");
          inTag.className = "tag" + (isPriceHigh(m) ? " tag-prem" : "");
          inTag.textContent = "in " + (fmtPerM(inP) || "—").replace("/M", "");
          meta.appendChild(inTag);
        }
        if (outP != null) {
          const outTag = document.createElement("span");
          outTag.className = "tag" + (isPriceHigh(m) ? " tag-prem" : "");
          outTag.textContent = "out " + (fmtPerM(outP) || "—").replace("/M", "");
          meta.appendChild(outTag);
        }
      }

      const ctx = fmtCtx(m);
      if (ctx) {
        const c = document.createElement("span");
        c.className = "tag";
        c.textContent = ctx;
        meta.appendChild(c);
      }
      const cats = categorizeForList(m);
      for (const c of cats) {
        const t = document.createElement("span");
        t.className = "tag tag-" + c;
        t.textContent = CAT_LABELS[c].toLowerCase();
        meta.appendChild(t);
      }

      item.appendChild(top);
      item.appendChild(meta);
      item.addEventListener("click", () => selectModel(m));
      frag.appendChild(item);
    }
    if (list.length === 0) {
      const empty = document.createElement("div");
      empty.className = "picker-item";
      empty.style.color = "var(--muted)";
      empty.style.fontSize = "12px";
      empty.textContent = state.models.length ? "No models match." : "Loading models…";
      frag.appendChild(empty);
    }
    $pickerList.appendChild(frag);
  }

  async function selectModel(m) {
    state.model = m;
    state.modelId = m.id;
    if (state.activeSession) {
      state.activeSession.modelId = m.id;
      try { await Storage.saveSession(state.activeSession); } catch (e) {}
    }
    try { await Storage.setSetting("model", m.id); } catch (e) {}
    renderModelPill();
    closePicker();
    toast("Model: " + modelDisplayName(m));
  }

  // ---- history modal ----
  $historyBtn.addEventListener("click", openHistory);
  $newSessionBtn.addEventListener("click", async () => {
    await startNewSession({ playWelcome: true });
    toast("Started new session");
  });
  $historyClose.addEventListener("click", closeHistory);
  $historyModal.addEventListener("click", (e) => { if (e.target === $historyModal) closeHistory(); });

  $historyNewBtn.addEventListener("click", async () => {
    await startNewSession({ playWelcome: true });
    closeHistory();
    toast("Started new session");
  });

  async function openHistory() {
    $historyModal.hidden = false;
    await renderHistoryList();
  }

  function closeHistory() {
    $historyModal.hidden = true;
    focusInput();
  }

  async function renderHistoryList() {
    $historyList.innerHTML = "";
    let sessions = [];
    try { sessions = await Storage.getAllSessions(); } catch (e) {}

    // Filter out empty sessions (no commands run)
    const validSessions = sessions.filter((s) => {
      if (!s) return false;
      const cmdBlocks = (s.blocks || []).filter((b) => b && b.kind === "cmd");
      return cmdBlocks.length > 0 || (s.conversation || []).length > 0;
    });

    if (validSessions.length === 0) {
      const empty = document.createElement("div");
      empty.className = "history-item";
      empty.style.color = "var(--muted)";
      empty.style.fontSize = "13px";
      empty.textContent = "No saved session history yet.";
      $historyList.appendChild(empty);
      return;
    }

    const frag = document.createDocumentFragment();
    for (const sess of validSessions) {
      const item = document.createElement("div");
      item.className = "history-item" + (state.activeSession && state.activeSession.id === sess.id ? " active" : "");

      const info = document.createElement("div");
      info.className = "history-info";

      const title = document.createElement("div");
      title.className = "history-title";
      title.textContent = sess.title || "Session";

      const meta = document.createElement("div");
      meta.className = "history-meta";

      const time = document.createElement("span");
      time.textContent = fmtTime(sess.updatedAt || sess.createdAt);
      meta.appendChild(time);

      const cmdBlocks = (sess.blocks || []).filter((b) => b && b.kind === "cmd");
      const count = document.createElement("span");
      count.textContent = cmdBlocks.length + (cmdBlocks.length === 1 ? " command" : " commands");
      meta.appendChild(count);

      if (sess.modelId) {
        const mBadge = document.createElement("span");
        mBadge.className = "badge badge-sm";
        mBadge.textContent = OpenRouter.shortName({ id: sess.modelId });
        meta.appendChild(mBadge);
      }

      if (state.activeSession && state.activeSession.id === sess.id) {
        const activeBadge = document.createElement("span");
        activeBadge.className = "badge badge-ok badge-sm";
        activeBadge.textContent = "ACTIVE";
        meta.appendChild(activeBadge);
      }

      info.appendChild(title);
      info.appendChild(meta);

      const actions = document.createElement("div");
      actions.className = "history-actions";

      const openBtn = document.createElement("button");
      openBtn.type = "button";
      openBtn.className = "btn btn-sm btn-ghost";
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openSession(sess.id);
        closeHistory();
      });

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "btn btn-sm btn-danger";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = await showConfirmModal({
          title: "Delete Session",
          message: `Delete session "${sess.title || "Session"}"? This action cannot be undone.`,
          confirmText: "Delete",
          danger: true
        });
        if (ok) {
          await Storage.deleteSession(sess.id);
          if (state.activeSession && state.activeSession.id === sess.id) {
            await startNewSession({ playWelcome: true });
          }
          await renderHistoryList();
          toast("Session deleted");
        }
      });

      actions.appendChild(openBtn);
      actions.appendChild(delBtn);

      item.appendChild(info);
      item.appendChild(actions);

      item.addEventListener("click", () => {
        openSession(sess.id);
        closeHistory();
      });

      frag.appendChild(item);
    }
    $historyList.appendChild(frag);
  }

  // ---- settings ----
  $menuBtn.addEventListener("click", openSettings);
  $settingsClose.addEventListener("click", closeSettings);
  $settings.addEventListener("click", (e) => { if (e.target === $settings) closeSettings(); });

  function openSettings() {
    // SECURITY: NEVER populate $setKey.value with existing state.apiKey
    $setKey.value = "";
    updateKeyStatusBadge();

    $setClear.checked = !!state.prefs.clearOnCmd;
    $setHeaders.checked = !!state.prefs.showHeaders;
    if ($setVersion) $setVersion.textContent = VERSION;
    renderModelPill();
    $settings.hidden = false;
  }

  function updateKeyStatusBadge() {
    if (state.apiKey) {
      $keyStatusBadge.textContent = "Key Configured";
      $keyStatusBadge.className = "badge badge-ok";
    } else {
      $keyStatusBadge.textContent = "No Key Configured";
      $keyStatusBadge.className = "badge badge-none";
    }
  }

  function closeSettings() {
    $settings.hidden = true;
    focusInput();
  }

  $setKeySave.addEventListener("click", async () => {
    const v = $setKey.value.trim();
    if (!v) { toast("Enter an API key"); return; }
    state.apiKey = v;
    try { await Storage.setSetting("apiKey", v); } catch (e) {}
    $setKey.value = "";
    updateKeyStatusBadge();
    toast("API key saved");
  });

  $setKeyClear.addEventListener("click", async () => {
    if (!state.apiKey) { toast("No API key configured"); return; }
    const ok = await showConfirmModal({
      title: "Clear API Key",
      message: "Are you sure you want to remove your stored OpenRouter API key?",
      confirmText: "Remove Key",
      danger: true
    });
    if (ok) {
      state.apiKey = null;
      try { await Storage.delSetting("apiKey"); } catch (e) {}
      updateKeyStatusBadge();
      toast("API key removed");
    }
  });

  $setClear.addEventListener("change", async () => {
    state.prefs.clearOnCmd = $setClear.checked;
    try { await Storage.setSetting("prefs", state.prefs); } catch (e) {}
  });

  $setHeaders.addEventListener("change", async () => {
    state.prefs.showHeaders = $setHeaders.checked;
    try { await Storage.setSetting("prefs", state.prefs); } catch (e) {}
  });

  $setClearSession.addEventListener("click", async () => {
    const ok = await showConfirmModal({
      title: "Start New Session",
      message: "Clear current terminal view and start a fresh session context?",
      confirmText: "New Session",
      danger: false
    });
    if (ok) {
      await startNewSession({ playWelcome: true });
      closeSettings();
      toast("New session started");
    }
  });

  $setReset.addEventListener("click", async () => {
    const ok = await showConfirmModal({
      title: "Reset All Termio Data",
      message: "This will permanently delete all stored sessions, API keys, and settings. This cannot be undone.",
      confirmText: "Reset All Data",
      danger: true
    });
    if (ok) {
      try { await Storage.resetAll(); } catch (e) {}
      state.apiKey = null;
      state.model = null;
      state.modelId = null;
      state.conversation = [];
      state.sessionId = null;
      state.activeSession = null;
      state.models = [];
      $termOutput.innerHTML = "";
      closeSettings();
      closePicker();
      closeHistory();
      closeChangelog();
      showSetup();
      toast("All data reset");
    }
  });

  // ---- changelog ----
  $setChangelog.addEventListener("click", openChangelog);
  $changelogClose.addEventListener("click", closeChangelog);

  function openChangelog() {
    renderChangelog();
    $changelog.hidden = false;
  }
  function closeChangelog() {
    $changelog.hidden = true;
    focusInput();
  }
  function renderChangelog() {
    if (!$changelogList) return;
    $changelogList.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (const entry of CHANGELOG) {
      const e = document.createElement("div");
      e.className = "changelog-entry";
      const ver = document.createElement("div");
      ver.className = "cl-ver";
      ver.textContent = entry.version;
      const ul = document.createElement("ul");
      ul.className = "cl-items";
      for (const item of entry.items) {
        const li = document.createElement("li");
        li.textContent = item;
        ul.appendChild(li);
      }
      e.appendChild(ver);
      e.appendChild(ul);
      frag.appendChild(e);
    }
    $changelogList.appendChild(frag);
  }

  // ---- command execution ----
  $cmdForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const cmd = $cmdInput.value;
    runCommand(cmd);
    $cmdInput.value = "";
  });

  async function runCommand(raw) {
    const cmd = String(raw || "").trim();
    if (!cmd || state.running) return;

    if (!state.apiKey) {
      toast("Add your OpenRouter API key in Settings");
      openSettings();
      return;
    }
    if (!state.modelId) {
      toast("Select a model first");
      openPicker();
      return;
    }

    if (welcomeTimer) { clearTimeout(welcomeTimer); welcomeTimer = null; }
    $termWelcome.hidden = true;

    if (!state.activeSession) {
      await startNewSession({ playWelcome: false });
    }

    // Auto update session title from first command
    if (state.activeSession.title === "New Session" || !state.activeSession.title) {
      state.activeSession.title = cmd.length > 36 ? cmd.slice(0, 36) + "…" : cmd;
    }

    if (state.prefs.clearOnCmd) {
      $termOutput.innerHTML = "";
    }

    const blockNodes = [];
    if (state.prefs.showHeaders) {
      blockNodes.push(mkCmdLine(cmd));
    }
    const running = mkRunning();
    blockNodes.push(running);
    const block = appendBlock(blockNodes);

    appendBlockRecord({ kind: "cmd", text: cmd });

    setRunning(true);

    const userInput = { type: "message", role: "user", content: [{ type: "input_text", text: cmd }] };
    state.conversation.push(userInput);
    const input = state.conversation.slice();

    const abortCtrl = new AbortController();
    state.abortCtrl = abortCtrl;

    let gotToolOutput = false;
    let renderedText = false;
    let assistantText = "";

    try {
      await OpenRouter.streamResponse({
        apiKey: state.apiKey,
        model: state.modelId,
        input: input,
        sessionId: state.sessionId || undefined,
        signal: abortCtrl.signal,
        onEvent: (ev) => handleStreamEvent(ev, {
          running, block,
          onToolOut: () => { gotToolOutput = true; },
          onText: (t) => { assistantText += t; },
          onRenderedText: () => { renderedText = true; },
          onSession: (id) => { if (id) rememberSession(id); },
        }),
      });

      running.remove();

      if (!gotToolOutput && !renderedText) {
        if (assistantText.trim()) {
          const textNode = mkOut(assistantText.trim());
          appendAfter(block, textNode);
          appendBlockRecord({ kind: "out", text: assistantText.trim() });
        } else {
          const unavailNode = mkOut("[shell unavailable]", "unavail");
          appendAfter(block, unavailNode);
          appendBlockRecord({ kind: "out", text: "[shell unavailable]", cls: "unavail" });
        }
      }

      if (assistantText.trim()) {
        state.conversation.push({
          type: "message", role: "assistant", id: "msg_" + Date.now(),
          status: "completed",
          content: [{ type: "output_text", text: assistantText, annotations: [] }],
        });
      }

      // Persist active session
      state.activeSession.conversation = state.conversation;
      state.activeSession.openrouterSessionId = state.sessionId;
      state.activeSession.updatedAt = Date.now();
      try { await Storage.saveSession(state.activeSession); } catch (e) {}

      // Add to history log
      try { await Storage.addHistory({ cmd, hadToolOutput, model: state.modelId, ts: Date.now() }); } catch (e) {}

    } catch (err) {
      running.remove();
      if (err && err.name === "AbortError") {
        appendAfter(block, mkOut("[aborted]", "out-dim"));
        appendBlockRecord({ kind: "out", text: "[aborted]", cls: "out-dim" });
      } else {
        const msg = err && err.message ? err.message : "request failed";
        let errMsg = "[error] " + msg;
        if (err && err.status === 401) {
          errMsg = "[error] " + msg + " — check your API key in Settings";
        } else if (err && err.status === 402) {
          errMsg = "[error] " + msg + " — insufficient OpenRouter credits";
        }
        appendAfter(block, mkOut(errMsg, "out-err"));
        appendBlockRecord({ kind: "out", text: errMsg, cls: "out-err" });
      }

      if (!gotToolOutput && !assistantText.trim() && state.conversation[state.conversation.length - 1] === userInput) {
        state.conversation.pop();
      }
    } finally {
      setRunning(false);
      state.abortCtrl = null;
      focusInput();
    }
  }

  function setRunning(on) {
    state.running = on;
    $cmdInput.disabled = on;
    $modelBtn.disabled = on;
    $menuBtn.disabled = on;
    $historyBtn.disabled = on;
    $newSessionBtn.disabled = on;
  }

  function appendAfter(block, node) {
    block.appendChild(node);
    scrollTerm();
  }

  function rememberSession(id) {
    state.sessionId = id;
    if (state.activeSession) {
      state.activeSession.openrouterSessionId = id;
      try { Storage.saveSession(state.activeSession); } catch (e) {}
    }
    try { Storage.setSetting("sessionId", id); } catch (e) {}
  }

  // ---- stream event handling ----
  function handleStreamEvent(ev, ctx) {
    if (!ev || typeof ev !== "object") return;

    if (ev.type === "done") return;
    if (ev.type === "error") {
      const m = (ev.error && ev.error.message) || "stream error";
      appendAfter(ctx.block, mkOut("[error] " + m, "out-err"));
      appendBlockRecord({ kind: "out", text: "[error] " + m, cls: "out-err" });
      return;
    }
    if (ev.type === "raw") {
      handleCompletedResponse(ev.data, ctx);
      return;
    }

    switch (ev.type) {
      case "response.created": {
        const id = ev.response && ev.response.id;
        if (id) ctx.onSession(id);
        break;
      }
      case "response.output_item.added": {
        break;
      }
      case "response.output_item.done": {
        const item = ev.item;
        if (!item) break;
        renderItemOutput(item, ctx);
        break;
      }
      case "response.content_part.delta":
      case "response.output_text.delta": {
        const d = ev.delta;
        if (typeof d === "string" && d.length) {
          ctx.onText(d);
        }
        break;
      }
      case "response.done": {
        const resp = ev.response;
        if (resp && resp.usage) {
          const u = resp.usage;
          const parts = [];
          if (u.input_tokens != null) parts.push("in " + u.input_tokens + " tok");
          if (u.output_tokens != null) parts.push("out " + u.output_tokens + " tok");
          if (parts.length) {
            appendAfter(ctx.block, mkMeta(parts));
            appendBlockRecord({ kind: "meta", parts });
          }
        }
        break;
      }
      default:
        break;
    }
  }

  function renderItemOutput(item, ctx) {
    if (!item) return;

    if (item.type === "message") {
      const content = item.content || [];
      let text = "";
      for (const c of content) {
        if (c.type === "output_text" && c.text) text += c.text;
      }
      const t = text.replace(/\s+$/, "");
      if (t) {
        appendAfter(ctx.block, mkOut(t));
        appendBlockRecord({ kind: "out", text: t });
        ctx.onText(text);
        if (ctx.onRenderedText) ctx.onRenderedText();
      }
      return;
    }

    if (item.type === "shell_call_output" || item.type === "openrouter_shell_tool_result") {
      renderShellResult(item, ctx.block);
      ctx.onToolOut();
      return;
    }

    if (item.type === "function_call_output") {
      renderFunctionCallOutput(item, ctx.block);
      ctx.onToolOut();
      return;
    }
  }

  function renderShellResult(item, block) {
    const out = item.output || [];
    if (Array.isArray(out)) {
      for (const cmd of out) {
        if (cmd.stdout) {
          appendAfter(block, mkOut(cmd.stdout));
          appendBlockRecord({ kind: "out", text: cmd.stdout });
        }
        if (cmd.stderr) {
          appendAfter(block, mkOut(cmd.stderr, "out-err"));
          appendBlockRecord({ kind: "out", text: cmd.stderr, cls: "out-err" });
        }
        if (cmd.outcome) {
          const parts = [];
          if (cmd.outcome.type === "exit") parts.push("exit " + cmd.outcome.exit_code);
          else if (cmd.outcome.type === "timeout") parts.push("timeout");
          if (parts.length) {
            appendAfter(block, mkMeta(parts));
            appendBlockRecord({ kind: "meta", parts });
          }
        }
      }
    } else if (typeof out === "string") {
      appendAfter(block, mkOut(out));
      appendBlockRecord({ kind: "out", text: out });
    }
  }

  function renderFunctionCallOutput(item, block) {
    let out = item.output;
    if (typeof out !== "string") {
      try { out = JSON.stringify(out); } catch (e) { out = String(out); }
    }
    let parsed = null;
    try { parsed = JSON.parse(out); } catch (e) {}
    if (parsed && Array.isArray(parsed.output)) {
      renderShellResult({ output: parsed.output }, block);
    } else if (parsed && parsed.stdout != null) {
      if (parsed.stdout) {
        appendAfter(block, mkOut(parsed.stdout));
        appendBlockRecord({ kind: "out", text: parsed.stdout });
      }
      if (parsed.stderr) {
        appendAfter(block, mkOut(parsed.stderr, "out-err"));
        appendBlockRecord({ kind: "out", text: parsed.stderr, cls: "out-err" });
      }
    } else {
      appendAfter(block, mkOut(out));
      appendBlockRecord({ kind: "out", text: out });
    }
  }

  function handleCompletedResponse(resp, ctx) {
    if (!resp) return;
    if (resp.error) {
      const errText = "[error] " + (resp.error.message || "failed");
      appendAfter(ctx.block, mkOut(errText, "out-err"));
      appendBlockRecord({ kind: "out", text: errText, cls: "out-err" });
      return;
    }
    const items = resp.output || [];
    for (const item of items) renderItemOutput(item, ctx);
    if (resp.usage) {
      const u = resp.usage;
      const parts = [];
      if (u.input_tokens != null) parts.push("in " + u.input_tokens + " tok");
      if (u.output_tokens != null) parts.push("out " + u.output_tokens + " tok");
      if (parts.length) {
        appendAfter(ctx.block, mkMeta(parts));
        appendBlockRecord({ kind: "meta", parts });
      }
    }
  }

  // ---- global key handling ----
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$confirmModal.hidden) { $confirmModal.hidden = true; return; }
      if (!$changelog.hidden) { closeChangelog(); return; }
      if (!$historyModal.hidden) { closeHistory(); return; }
      if (!$picker.hidden) { closePicker(); return; }
      if (!$settings.hidden) { closeSettings(); return; }
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      openPicker();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === ",") {
      e.preventDefault();
      openSettings();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === "h" || e.key === "H")) {
      e.preventDefault();
      openHistory();
    }
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      if (!$app.hidden) scrollTerm();
    });
  }

  function bindEvents() {
    window.addEventListener("resize", () => { if (!$app.hidden) scrollTerm(); });
  }

  // ---- go ----
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
