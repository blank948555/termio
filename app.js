/* app.js — Termio app logic: setup, settings, terminal, model picker, history. */
(function () {
  "use strict";

  const { Storage, OpenRouter } = window;

  // ---- element refs ----
  const el = (id) => document.getElementById(id);
  const $setup = el("setup");
  const $app = el("app");
  const $setupForm = el("setup-form");
  const $setupKey = el("setup-key");
  const $menuBtn = el("menu-btn");
  const $modelBtn = el("model-btn");
  const $modelPillName = el("model-pill-name");
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
  const $pickerFoot = el("picker-foot");

  // settings
  const $settings = el("settings");
  const $settingsClose = el("settings-close");
  const $setKey = el("set-key");
  const $setKeyToggle = el("set-key-toggle");
  const $setModel = el("set-model");
  const $setModelName = el("set-model-name");
  const $setClear = el("set-clear");
  const $setHeaders = el("set-headers");
  const $setClearSession = el("set-clear-session");
  const $setReset = el("set-reset");

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
    conversation: [],       // Responses API input history (messages + tool calls/outputs)
    sessionId: null,        // OpenRouter sticky session id (preserves shell container)
    running: false,
    abortCtrl: null,
  };

  const CAT_LABELS = { all: "All", free: "Free", cheap: "Cheap", fast: "Fast", premium: "Premium" };

  // ---- utils ----
  function toast(msg, ms) {
    $toast.textContent = msg;
    $toast.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { $toast.hidden = true; }, ms || 2400);
  }

  function fmtPrice(m) {
    if (OpenRouter.isFree(m)) return "free";
    const p = OpenRouter.combinedPricePerM(m);
    if (p == null) return "—";
    if (p === 0) return "free";
    if (p < 0.01) return "<$0.01/M";
    if (p < 1) return "$" + p.toFixed(3) + "/M";
    if (p < 100) return "$" + p.toFixed(2) + "/M";
    return "$" + Math.round(p) + "/M";
  }

  function fmtCtx(m) {
    const c = m.context_length || (m.top_provider && m.top_provider.context_length);
    if (!c) return "";
    if (c >= 1000) return (c / 1000) + "K ctx";
    return c + " ctx";
  }

  function modelDisplayName(m) {
    return (m && (m.name || OpenRouter.shortName(m))) || "Model…";
  }

  function findModelById(id) {
    return state.models.find((m) => m.id === id) || null;
  }

  // ---- terminal rendering ----
  function scrollTerm() {
    $term.scrollTop = $term.scrollHeight;
  }

  function appendBlock(nodes) {
    const block = document.createElement("div");
    block.className = "term-block";
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
    out.className = "term-out" + (cls ? " " + cls : "");
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

  // ---- boot ----
  async function boot() {
    try {
      await Storage.getAllSettings();
    } catch (e) {
      console.error("storage init failed", e);
    }
    const setupDone = Storage._mem.setupDone === true;
    if (setupDone) {
      showApp();
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
    setTimeout(() => $setupKey.focus(), 50);
  }

  function showApp() {
    state.apiKey = Storage._mem.apiKey || null;
    state.modelId = Storage._mem.model || null;
    const prefs = Storage._mem.prefs || {};
    if (prefs && typeof prefs === "object") {
      state.prefs = Object.assign(state.prefs, prefs);
    }
    state.sessionId = Storage._mem.sessionId || null;

    $setup.hidden = true;
    $app.hidden = false;

    // reflect model pill
    renderModelPill();

    // load catalog in background (uses key if present; catalog is public)
    loadModels().then(() => {
      if (state.modelId) {
        state.model = findModelById(state.modelId);
        renderModelPill();
      } else if (state.models.length) {
        // no model selected yet → open picker so user picks one
        openPicker();
      }
    }).catch((e) => {
      console.warn("model load failed", e);
      toast("Could not load models");
    });

    renderWelcome();
    focusInput();
  }

  function renderWelcome() {
    if ($termOutput.children.length > 0) { $termWelcome.hidden = true; return; }
    $termWelcome.hidden = false;
    $termWelcome.textContent = "Termio ready. Enter a command — it runs on the OpenRouter hosted Shell.";
  }

  function focusInput() {
    // avoid stealing focus when a modal is open
    if (!$picker.hidden || !$settings.hidden) return;
    requestAnimationFrame(() => { try { $cmdInput.focus({ preventScroll: true }); } catch (e) {} });
  }

  // ---- setup ----
  $setupForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const key = $setupKey.value.trim();
    if (!key) { toast("Enter your OpenRouter API key"); return; }
    try {
      await Storage.setSetting("apiKey", key);
      await Storage.setSetting("setupDone", true);
      toast("Setup complete");
      showApp();
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
    // keep text-output, tool-capable models relevant; show all but sort smartly
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
    setTimeout(() => $pickerSearch.focus(), 60);
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
    $pickerFoot.textContent = state.models.length
      ? state.models.length + " models · live from OpenRouter"
      : "Loading models…";
  }

  function renderCats() {
    // dynamic categories derived from current metadata
    const counts = { all: state.models.length, free: 0, cheap: 0, fast: 0, premium: 0 };
    for (const m of state.models) {
      const cats = categorizeForList(m);
      for (const c of cats) if (counts[c] != null) counts[c]++;
    }
    const order = ["all", "free", "cheap", "fast", "premium"];
    $pickerCats.innerHTML = "";
    for (const key of order) {
      if (key !== "all" && counts[key] === 0) continue; // only show categories that exist
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

    // sort: selected first, then by name
    list.sort((a, b) => {
      const as = a.id === state.modelId ? -1 : 0;
      const bs = b.id === state.modelId ? -1 : 0;
      if (as !== bs) return as - bs;
      const an = (a.name || a.id || "").toLowerCase();
      const bn = (b.name || b.id || "").toLowerCase();
      return an < bn ? -1 : an > bn ? 1 : 0;
    });

    const frag = document.createDocumentFragment();
    const cap = 300;
    for (let i = 0; i < Math.min(list.length, cap); i++) {
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
      const price = fmtPrice(m);
      const priceSpan = document.createElement("span");
      priceSpan.className = "tag";
      if (OpenRouter.isFree(m)) priceSpan.classList.add("tag-free");
      else if (price !== "—" && price !== "free" && price.startsWith("$")) {
        const n = parseFloat(price.replace(/[^0-9.]/g, ""));
        if (!isNaN(n) && n >= 5) priceSpan.classList.add("tag-prem");
        else if (!isNaN(n)) priceSpan.classList.add("tag-cheap");
      }
      priceSpan.textContent = price;
      meta.appendChild(priceSpan);

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
    if (list.length > cap) {
      const more = document.createElement("div");
      more.className = "picker-item";
      more.style.color = "var(--muted)";
      more.style.fontSize = "12px";
      more.textContent = "+" + (list.length - cap) + " more — refine your search";
      frag.appendChild(more);
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
    try { await Storage.setSetting("model", m.id); } catch (e) {}
    renderModelPill();
    closePicker();
    toast("Model: " + modelDisplayName(m));
  }

  // ---- settings ----
  $menuBtn.addEventListener("click", openSettings);
  $settingsClose.addEventListener("click", closeSettings);
  $settings.addEventListener("click", (e) => { if (e.target === $settings) closeSettings(); });

  function openSettings() {
    $setKey.value = state.apiKey || "";
    $setKey.type = "password";
    $setKeyToggle.textContent = "show";
    $setClear.checked = !!state.prefs.clearOnCmd;
    $setHeaders.checked = !!state.prefs.showHeaders;
    renderModelPill();
    $settings.hidden = false;
  }
  function closeSettings() {
    $settings.hidden = true;
    focusInput();
  }

  $setKey.addEventListener("change", async () => {
    const v = $setKey.value.trim();
    state.apiKey = v || null;
    try {
      if (v) await Storage.setSetting("apiKey", v);
      else await Storage.delSetting("apiKey");
    } catch (e) {}
    toast(v ? "API key updated" : "API key cleared");
  });

  $setKeyToggle.addEventListener("click", () => {
    if ($setKey.type === "password") { $setKey.type = "text"; $setKeyToggle.textContent = "hide"; }
    else { $setKey.type = "password"; $setKeyToggle.textContent = "show"; }
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
    state.conversation = [];
    state.sessionId = null;
    try { await Storage.delSetting("sessionId"); } catch (e) {}
    try { await Storage.clearHistory(); } catch (e) {}
    $termOutput.innerHTML = "";
    renderWelcome();
    toast("Session cleared");
  });

  $setReset.addEventListener("click", async () => {
    if (!confirm("Reset all Termio data (API key, model, history)? This cannot be undone.")) return;
    try {
      await Storage.resetAll();
    } catch (e) {}
    state.apiKey = null;
    state.model = null;
    state.modelId = null;
    state.conversation = [];
    state.sessionId = null;
    state.models = [];
    $termOutput.innerHTML = "";
    closeSettings();
    closePicker();
    showSetup();
  });

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

    $termWelcome.hidden = true;

    if (state.prefs.clearOnCmd) {
      $termOutput.innerHTML = "";
    }

    const blockNodes = [];
    if (state.prefs.showHeaders) blockNodes.push(mkCmdLine(cmd));
    const running = mkRunning();
    blockNodes.push(running);
    const block = appendBlock(blockNodes);

    setRunning(true);

    // build conversation input: prior turns + this user command
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

      // Finalize: remove the running indicator
      running.remove();

      if (!gotToolOutput && !renderedText) {
        // No shell output and no rendered message text.
        if (assistantText.trim()) {
          // Some providers stream only deltas and no output_item.done message.
          appendAfter(block, mkOut(assistantText.trim()));
        } else {
          appendAfter(block, mkOut("[shell unavailable]", "unavail"));
        }
      }

      // record assistant message into conversation for continuity
      if (assistantText.trim()) {
        state.conversation.push({
          type: "message", role: "assistant", id: "msg_" + Date.now(),
          status: "completed",
          content: [{ type: "output_text", text: assistantText, annotations: [] }],
        });
      }

      // persist meaningful activity (only after a real run)
      persistHistory(cmd, gotToolOutput);
    } catch (err) {
      running.remove();
      if (err && err.name === "AbortError") {
        appendAfter(block, mkOut("[aborted]", "out-dim"));
      } else {
        const msg = err && err.message ? err.message : "request failed";
        if (err && err.status === 401) {
          appendAfter(block, mkOut("[error] " + msg + " — check your API key in Settings", "out-err"));
        } else if (err && err.status === 402) {
          appendAfter(block, mkOut("[error] " + msg + " — insufficient OpenRouter credits", "out-err"));
        } else {
          appendAfter(block, mkOut("[error] " + msg, "out-err"));
        }
      }
      // roll back the user turn we appended if nothing came back
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
  }

  function appendAfter(block, node) {
    block.appendChild(node);
    scrollTerm();
  }

  async function persistHistory(cmd, hadToolOutput) {
    try {
      await Storage.addHistory({ cmd, hadToolOutput, model: state.modelId, ts: Date.now() });
    } catch (e) {}
  }

  function rememberSession(id) {
    state.sessionId = id;
    try { Storage.setSetting("sessionId", id); } catch (e) {}
  }

  // ---- stream event handling ----
  // OpenRouter Responses API streaming event types (from docs):
  //  response.created, response.output_item.added, response.content_part.added,
  //  response.content_part.delta (delta text), response.output_item.done,
  //  response.function_call_arguments.delta/.done (tool call args),
  //  response.done (final + usage)
  // openrouter:shell calls surface as output items of type "openrouter:shell" /
  // "function_call" with the tool name; their results come back as separate items
  // produced server-side (we are NOT asked to send outputs — the server runs shell).
  function handleStreamEvent(ev, ctx) {
    if (!ev || typeof ev !== "object") return;

    // explicit done/error from our parser
    if (ev.type === "done") return;
    if (ev.type === "error") {
      const m = (ev.error && ev.error.message) || "stream error";
      appendAfter(ctx.block, mkOut("[error] " + m, "out-err"));
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
        const item = ev.item;
        if (!item) break;
        // shell call starting
        if (item.type === "function_call" || item.type === "openrouter:shell" || item.type === "shell_call") {
          // tool invoked — keep the running indicator
        }
        break;
      }
      case "response.output_item.done": {
        const item = ev.item;
        if (!item) break;
        renderItemOutput(item, ctx);
        break;
      }
      case "response.content_part.delta": {
        const d = ev.delta;
        if (typeof d === "string" && d.length) {
          streamTextIntoBlock(ctx.block, d, ctx);
        }
        break;
      }
      case "response.output_text.delta": {
        const d = ev.delta;
        if (typeof d === "string" && d.length) {
          streamTextIntoBlock(ctx.block, d, ctx);
        }
        break;
      }
      case "response.function_call_arguments.delta":
        // arguments streaming for a tool call; ignore (server executes shell)
        break;
      case "response.function_call_arguments.done":
        // full args available; not needed — server runs commands
        break;
      case "response.done": {
        const resp = ev.response;
        if (resp && resp.usage) {
          const u = resp.usage;
          const parts = [];
          if (u.input_tokens != null) parts.push("in " + u.input_tokens + " tok");
          if (u.output_tokens != null) parts.push("out " + u.output_tokens + " tok");
          if (parts.length) appendAfter(ctx.block, mkMeta(parts));
        }
        break;
      }
      default:
        break;
    }
  }

  // Streamed text deltas (assistant reasoning/text). We surface them only if no
  // tool output has arrived yet; once real shell output comes, text is dropped to
  // keep the terminal free of commentary (per the terminal behavior prompt).
  function streamTextIntoBlock(block, delta, ctx) {
    // We buffer text silently; final decision happens in runCommand.
    ctx.onText(delta);
  }

  // Render a completed output item (assistant message text or shell result).
  function renderItemOutput(item, ctx) {
    if (!item) return;

    if (item.type === "message") {
      // The terminal behavior prompt asks the model to output only raw terminal
      // results. Render the final message text exactly once here. We do not rely
      // on streamed deltas for display (deltas are only used as a fallback if no
      // completed message item is emitted).
      const content = item.content || [];
      let text = "";
      for (const c of content) {
        if (c.type === "output_text" && c.text) text += c.text;
      }
      const t = text.replace(/\s+$/, "");
      if (t) {
        appendAfter(ctx.block, mkOut(t));
        ctx.onText(text);
        if (ctx.onRenderedText) ctx.onRenderedText();
      }
      return;
    }

    if (item.type === "function_call" || item.type === "openrouter:shell" || item.type === "shell_call") {
      // The model called shell. The server executes it and returns results as
      // follow-up items in the same response. We don't render the call itself.
      return;
    }

    // shell call output: OpenRouter returns one entry per command.
    if (item.type === "shell_call_output" || item.type === "openrouter_shell_tool_result") {
      renderShellResult(item, ctx.block);
      ctx.onToolOut();
      return;
    }

    // Some providers return function_call_output with output string.
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
        if (cmd.stdout) appendAfter(block, mkOut(cmd.stdout));
        if (cmd.stderr) appendAfter(block, mkOut(cmd.stderr, "out-err"));
        if (cmd.outcome) {
          const parts = [];
          if (cmd.outcome.type === "exit") parts.push("exit " + cmd.outcome.exit_code);
          else if (cmd.outcome.type === "timeout") parts.push("timeout");
          if (parts.length) appendAfter(block, mkMeta(parts));
        }
      }
    } else if (typeof out === "string") {
      appendAfter(block, mkOut(out));
    }
  }

  function renderFunctionCallOutput(item, block) {
    let out = item.output;
    if (typeof out !== "string") {
      try { out = JSON.stringify(out); } catch (e) { out = String(out); }
    }
    // Shell tool outputs via function_call_output are JSON strings of {output:[...]}.
    let parsed = null;
    try { parsed = JSON.parse(out); } catch (e) {}
    if (parsed && Array.isArray(parsed.output)) {
      renderShellResult({ output: parsed.output }, block);
    } else if (parsed && parsed.stdout != null) {
      if (parsed.stdout) appendAfter(block, mkOut(parsed.stdout));
      if (parsed.stderr) appendAfter(block, mkOut(parsed.stderr, "out-err"));
    } else {
      appendAfter(block, mkOut(out));
    }
  }

  // Handle a non-streamed (raw) completed response object.
  function handleCompletedResponse(resp, ctx) {
    if (!resp) return;
    if (resp.error) {
      appendAfter(ctx.block, mkOut("[error] " + (resp.error.message || "failed"), "out-err"));
      return;
    }
    const items = resp.output || [];
    for (const item of items) renderItemOutput(item, ctx);
    if (resp.usage) {
      const u = resp.usage;
      const parts = [];
      if (u.input_tokens != null) parts.push("in " + u.input_tokens + " tok");
      if (u.output_tokens != null) parts.push("out " + u.output_tokens + " tok");
      if (parts.length) appendAfter(ctx.block, mkMeta(parts));
    }
  }

  // ---- global key handling ----
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$picker.hidden) { closePicker(); return; }
      if (!$settings.hidden) { closeSettings(); return; }
    }
    // Ctrl/Cmd+K opens model picker; Ctrl/Cmd+, opens settings
    if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      openPicker();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === ",") {
      e.preventDefault();
      openSettings();
    }
  });

  // keep input visible when viewport changes (mobile keyboard)
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", () => {
      if (!$app.hidden) scrollTerm();
    });
  }

  function bindEvents() {
    // resize handler keeps terminal scrolled to bottom
    window.addEventListener("resize", () => { if (!$app.hidden) scrollTerm(); });
  }

  // ---- go ----
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
