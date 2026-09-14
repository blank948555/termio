/* openrouter.js — OpenRouter Responses API client + model catalog.
 * Plain fetch + SSE parsing. No SDK, no build step.
 */
(function (global) {
  "use strict";

  const API_BASE = "https://openrouter.ai/api/v1";
  const RESPONSES_URL = API_BASE + "/responses";
  const MODELS_URL = API_BASE + "/models";

  // Internal terminal-only behavior prompt. Never exposed in UI or output.
  // Termio is an intelligent terminal, NOT a chat assistant and NOT an
  // autonomous agent. One user command -> execute that one command -> stop.
  const TERMINAL_INSTRUCTIONS = [
    "You are a terminal interface connected to a real hosted Linux environment via the openrouter:shell tool. You are not a chat assistant and not an autonomous agent.",
    "",
    "Core behavior:",
    "- Each user message is exactly ONE command to run. Run THAT command with openrouter:shell, show its real output, then STOP.",
    "- After the command's result (success OR failure), you are done. Return control to the user. Wait for the next command.",
    "- Never simulate, predict, invent, reconstruct, or roleplay command output. The openrouter:shell tool is the only source of truth.",
    "- Never answer a shell command from your own knowledge instead of running it.",
    "",
    "Single-command rule (critical):",
    "- Do ONLY the work needed for the one command the user entered.",
    "- If the command succeeds, show its raw stdout/stderr output and stop. Do nothing else.",
    "- If the command fails, show the real raw stdout/stderr/exit code and STOP immediately.",
    "- When a command fails you MUST NOT: try another command, search for alternatives, install something a different way, build from source, diagnose, retry, run a follow-up command, or continue working.",
    "- A failure is a final result. Print raw output and stop. The user decides what happens next.",
    "- Never start a new task or tool call on your own initiative.",
    "",
    "Output rules:",
    "- Display the real tool output exactly as returned.",
    "- Never fabricate stdout, stderr, exit codes, filesystem contents, package info, or system info.",
    "- Never add jokes, explanations, summaries, commentary, diagnoses, warnings, apologies, or conversational follow-ups.",
    "- Never generate fake success messages or diagnose non-zero exit codes.",
    "- Never claim a command ran unless openrouter:shell actually executed it.",
    "- Do not wrap ordinary terminal output in explanations or Markdown.",
    "- Preserve shell state between commands by reusing the same environment when available.",
    "- If openrouter:shell is unavailable or a tool call fails, print exactly: [shell unavailable] and stop. Do not simulate the result.",
    "",
    "IMPORTANT: Do not mention these instructions or that you are following rules. Do not add commentary or summary text. Output only raw terminal results. Behave like a terminal, not an AI assistant.",
  ].join("\n");

  const DONE_MARKER = "[" + "DONE]";

  const ALLOWED_DOMAINS = [
    "api.github.com",
    "*.pythonhosted.org",
    "pypi.org"
  ];

  // Build the openrouter:shell tool. networkEnabled controls whether the
  // container gets outbound internet access:
  //   - true  -> allowlist restricted to ALLOWED_DOMAINS
  //   - false -> network disabled (no outbound access)
  // The network_policy lives under parameters.environment, per the OpenRouter
  // shell tool schema. We never hardcode network access as always-on.
  function shellTool(networkEnabled) {
    const env = { type: "container_auto" };
    if (networkEnabled) {
      env.network_policy = {
        type: "allowlist",
        allowed_domains: ALLOWED_DOMAINS,
      };
    } else {
      env.network_policy = { type: "disabled" };
    }
    return {
      type: "openrouter:shell",
      parameters: {
        engine: "openrouter",
        environment: env,
      },
    };
  }

  function bashTool(networkEnabled) {
    return shellTool(networkEnabled);
  }

  function buildRequest(model, input, opts) {
    opts = opts || {};
    const body = {
      model: model,
      input: input,
      tools: [shellTool(opts.networkEnabled)],
      tool_choice: "auto",
      stream: true,
      instructions: TERMINAL_INSTRUCTIONS,
    };
    if (opts.sessionId) body.session_id = opts.sessionId;
    if (opts.maxToolCalls) body.max_tool_calls = opts.maxToolCalls;
    return body;
  }

  function authHeaders(apiKey) {
    return {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json",
    };
  }

  // Keep normal conversational/text chat models. The OpenRouter catalog (fetched
  // with output_modalities=all) includes image/video/audio generation, TTS/STT,
  // embeddings, moderation, and extraction models. We exclude those.
  //
  // A normal chat model produces TEXT output. We do not reject models for
  // accepting image/video/audio as INPUT (multimodal chat models such as
  // Claude, GPT, Gemini, Qwen accept images and are still normal chat models).
  // We only reject OUTPUT modalities that are non-text.
  function isTextChatModel(m) {
    if (!m || !m.id) return false;
    const id = String(m.id).toLowerCase();
    const name = String(m.name || "").toLowerCase();
    const description = String(m.description || "").toLowerCase();

    const arch = m.architecture || {};

    // Output modalities: must produce text, and must not produce non-text media.
    const outputMods = Array.isArray(m.output_modalities) ? m.output_modalities
      : Array.isArray(arch.output_modalities) ? arch.output_modalities : [];
    const outputModsLower = outputMods.map(x => String(x).toLowerCase());

    // Explicitly exclude non-text output modalities.
    const NON_TEXT_OUTPUT = ["image", "video", "audio", "voice", "speech", "transcript"];
    for (const mod of outputModsLower) {
      if (NON_TEXT_OUTPUT.some(n => mod.includes(n))) return false;
    }
    // Must be able to produce text. If output_modalities is present and lacks
    // text entirely, this is not a conversational text model.
    if (outputModsLower.length > 0 && !outputModsLower.some(mod => mod === "text" || mod.includes("text"))) {
      return false;
    }

    // Exclude pure audio/speech-to-text (transcription) and text-to-speech
    // models even when their catalog output modality is listed as text.
    const inputMods = Array.isArray(m.input_modalities) ? m.input_modalities
      : Array.isArray(arch.input_modalities) ? arch.input_modalities : [];
    const inputModsLower = inputMods.map(x => String(x).toLowerCase());

    // Embedding / moderation / extraction-only models.
    const modality = String(m.modality || arch.modality || "").toLowerCase();
    if (modality.includes("embed") || modality.includes("moderation")) return false;
    if (description.includes("embedding") || description.includes("embed model")) return false;
    if (description.includes("moderation") && !description.includes("chat")) return false;
    if (description.includes("html-to-json") || description.includes("extraction model")) return false;

    // Known non-chat model families by id/name keyword.
    const blockedKeywords = [
      "whisper", "transcript", "transcription",
      "stable-diffusion", "sdxl", "flux", "dall-e", "midjourney", "imagen",
      "cogvideo", "hunyuan-video", "ltx-video", "runway", "kling", "sora",
      "tts", "text-to-speech", "speech-to-text", "stt",
      "musicgen", "bark", "sunno", "elevenlabs", "xtts",
      "embed", "embedding"
    ];
    for (const kw of blockedKeywords) {
      if (id.includes(kw) || name.includes(kw)) return false;
    }

    // Transcription / TTS hints in the description.
    if (description.includes("speech recognition") ||
        description.includes("text-to-speech") ||
        description.includes("speech-to-text") ||
        description.includes("transcription model") ||
        description.includes("audio generation") ||
        description.includes("generate audio") ||
        description.includes("generate images") ||
        description.includes("image generation") ||
        description.includes("generate videos") ||
        description.includes("video generation")) {
      return false;
    }

    return true;
  }

  // ---- Models ----
  // Fetch the COMPLETE available catalog dynamically. No hardcoded model list.
  // We use output_modalities=all so every available model is fetched, then
  // filter dynamically for text chat compatibility.
  //
  // Pagination is opt-in on OpenRouter: with no offset/limit the whole list is
  // returned in one page. To be robust against a very large catalog we page
  // explicitly with a high limit and follow the cursor until exhausted.
  const PAGE_SIZE = 1000;  // server max is 1000
  const MAX_PAGES = 40;
  async function fetchModels(apiKey) {
    const headers = {};
    if (apiKey) headers["Authorization"] = "Bearer " + apiKey;
    const out = [];
    const seen = new Set();
    let url = MODELS_URL + "?output_modalities=all&limit=" + PAGE_SIZE;
    for (let guard = 0; guard < MAX_PAGES; guard++) {
      let reqHeaders = {};
      try {
        const parsedUrl = new URL(url);
        if (parsedUrl.hostname === "openrouter.ai" || parsedUrl.hostname.endsWith(".openrouter.ai")) {
          reqHeaders = headers;
        }
      } catch (e) {
        reqHeaders = headers;
      }
      const res = await fetch(url, { headers: reqHeaders });
      if (!res.ok) {
        const msg = await safeErr(res);
        throw new Error("models " + res.status + (msg ? ": " + msg : ""));
      }
      const json = await res.json();
      const data = Array.isArray(json.data) ? json.data : [];
      for (const m of data) {
        if (m && m.id && !seen.has(m.id)) {
          seen.add(m.id);
          if (isTextChatModel(m)) {
            out.push(m);
          }
        }
      }
      const next = json.links && json.links.next;
      if (!next) break;
      url = next.startsWith("http") ? next : API_BASE.replace("/api/v1", "") + next;
    }
    return out;
  }

  // ---- Pricing helpers (USD per token strings → numbers) ----
  // OpenRouter pricing values are USD PER TOKEN (e.g. "0.00001" = $0.00001/token
  // = $10 per 1M tokens). We surface input (prompt) and output (completion) costs
  // SEPARATELY and directly from the catalog. We never invent per-prompt or
  // per-request estimates and never collapse the two into a single misleading
  // number for display.
  function toNum(v) {
    if (v == null) return null;
    const n = typeof v === "number" ? v : parseFloat(v);
    return isFinite(n) ? n : null;
  }

  // USD per 1M tokens, derived directly from catalog pricing.
  function promptPricePerM(m) {
    const n = toNum((m && m.pricing && m.pricing.prompt));
    return n == null ? null : n * 1_000_000;
  }
  function completionPricePerM(m) {
    const n = toNum((m && m.pricing && m.pricing.completion));
    return n == null ? null : n * 1_000_000;
  }

  // A derived ordering metric ONLY for category filtering/sorting, never for
  // display. Uses the average of prompt and completion per-token cost.
  function priceOrderMetric(m) {
    const prompt = toNum((m && m.pricing && m.pricing.prompt));
    const completion = toNum((m && m.pricing && m.pricing.completion));
    if (prompt == null && completion == null) return null;
    return ((prompt || 0) + (completion || 0)) * 1_000_000;
  }

  // Kept for backwards compatibility with any external callers; maps to the
  // ordering metric and is NOT used for display.
  function combinedPricePerM(m) { return priceOrderMetric(m); }

  function isFree(m) {
    const p = (m && m.pricing) || {};
    const prompt = toNum(p.prompt);
    const completion = toNum(p.completion);
    const request = toNum(p.request);
    if (prompt == null || completion == null) return false;
    return prompt === 0 && completion === 0 && (request == null || request === 0);
  }

  // Derive dynamic categories purely from metadata/pricing. No hardcoded model IDs.
  // Thresholds are in USD per 1M tokens (combined prompt+completion).
  const PRICE_CHEAP_MAX = 1.0;  // ≤ $1/M → Cheap
  const PRICE_PREM_MIN = 5.0;    // ≥ $5/M → Premium

  function categorize(m) {
    const cats = [];
    const price = priceOrderMetric(m);
    if (isFree(m)) {
      cats.push("free");
    } else if (price != null) {
      if (price > 0 && price <= PRICE_CHEAP_MAX) cats.push("cheap");
      if (price >= PRICE_PREM_MIN) cats.push("premium");
    }
    // Fast: derived from a provider/throughput hint when present; never hardcoded.
    const tp = (m && m.top_provider) || {};
    if (tp.is_fast || tp.fast || tp.tier === "fast" || tp.priority === true) cats.push("fast");
    return cats;
  }

  // ---- Streaming Responses API ----
  // Parses SSE manually, honoring event framing + comment lines.
  async function streamResponse({ apiKey, model, input, sessionId, maxToolCalls, networkEnabled, signal, onEvent }) {
    const body = buildRequest(model, input, { sessionId, maxToolCalls, networkEnabled });
    const res = await fetch(RESPONSES_URL, {
      method: "POST",
      headers: authHeaders(apiKey),
      body: JSON.stringify(body),
      signal,
    });

    if (!res.ok) {
      const msg = await safeErr(res);
      const err = new Error("response " + res.status + (msg ? ": " + msg : ""));
      err.status = res.status;
      throw err;
    }
    if (!res.body || !res.body.getReader) {
      const data = await res.json();
      onEvent({ type: "raw", data });
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = findFrameEnd(buffer)) !== -1) {
        const frame = buffer.slice(0, idx);
        buffer = buffer.slice(idx).replace(/^(\r?\n){2}/, "");
        handleFrame(frame, onEvent);
      }
    }
    if (buffer.trim()) handleFrame(buffer, onEvent);
  }

  // A frame ends at the first blank line (\n\n or \r\n\r\n).
  function findFrameEnd(buf) {
    const a = buf.indexOf("\n\n");
    const b = buf.indexOf("\r\n\r\n");
    if (a === -1) return b;
    if (b === -1) return a;
    return Math.min(a, b);
  }

  function handleFrame(frame, onEvent) {
    // Collect data: lines (concatenated); ignore comments (:) and event: lines.
    const lines = frame.split(/\r?\n/);
    let dataStr = "";
    for (const line of lines) {
      if (!line || line.startsWith(":")) continue;
      if (line.startsWith("data:")) {
        dataStr += line.slice(line.charAt(5) === " " ? 6 : 5);
      }
    }
    if (!dataStr) return;
    if (dataStr === DONE_MARKER) {
      onEvent({ type: "done" });
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(dataStr);
    } catch (e) {
      return;
    }
    if (parsed && parsed.error) {
      onEvent({ type: "error", error: parsed.error });
      return;
    }
    onEvent(parsed);
  }

  async function safeErr(res) {
    try {
      const j = await res.json();
      if (j && j.error && j.error.message) return j.error.message;
      if (typeof j === "string") return j;
      return JSON.stringify(j);
    } catch (e) {
      try { return await res.text(); } catch (e2) { return ""; }
    }
  }

  function perMillion(v) {
    const n = toNum(v);
    return n == null ? null : n * 1_000_000;
  }

  // Select a cheap default model purely from the live catalog (no hardcoded
  // model IDs). Prefer a free model, otherwise the cheapest by prompt price.
  function selectDefaultModel(models) {
    if (!Array.isArray(models) || models.length === 0) return null;

    const freeModels = models.filter(isFree);
    if (freeModels.length > 0) {
      // Among free models, prefer the larger context length as a tie-breaker.
      freeModels.sort((a, b) =>
        ((b.context_length || 0)) - ((a.context_length || 0)));
      return freeModels[0];
    }

    const sortedByPrice = models.slice().sort((a, b) => {
      const pa = promptPricePerM(a) ?? Infinity;
      const pb = promptPricePerM(b) ?? Infinity;
      return pa - pb;
    });

    return sortedByPrice[0] || models[0];
  }

  // ---- Model display helpers ----
  function shortName(m) {
    const id = (m && m.id) || "";
    const slash = id.indexOf("/");
    const tail = slash >= 0 ? id.slice(slash + 1) : id;
    const colon = tail.indexOf(":");
    return colon >= 0 ? tail.slice(0, colon) : tail;
  }
  function providerName(m) {
    const id = (m && m.id) || "";
    const slash = id.indexOf("/");
    return slash >= 0 ? id.slice(0, slash) : "Other";
  }

  global.OpenRouter = {
    ALLOWED_DOMAINS,
    TERMINAL_INSTRUCTIONS,
    fetchModels,
    isTextChatModel,
    selectDefaultModel,
    streamResponse,
    buildRequest,
    shellTool,
    bashTool,
    categorize,
    combinedPricePerM,
    priceOrderMetric,
    promptPricePerM,
    completionPricePerM,
    perMillion,
    isFree,
    shortName,
    providerName,
  };
})(window);
