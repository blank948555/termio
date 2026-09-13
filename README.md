# Termio

A dedicated browser terminal powered by OpenRouter hosted Shell (`openrouter:shell`).

Termio is **not** a chat app. It is a terminal: you enter a command, it runs on a
real hosted Linux sandbox provided by OpenRouter, and the actual stdout/stderr is
rendered as terminal output.

## Stack

Plain HTML, CSS, and JavaScript. No frameworks, no build tooling.

- `index.html` — setup, terminal, model picker, settings
- `styles.css` — AMOLED terminal theme (mobile-first)
- `storage.js` — IndexedDB persistence (no localStorage)
- `openrouter.js` — OpenRouter Responses API streaming client + model catalog
- `app.js` — app logic

## How it works

1. First run shows a fullscreen, true-black AMOLED setup experience that
   introduces each step one by one; you provide your own OpenRouter API key.
2. Models load dynamically from `GET /api/v1/models?output_modalities=all` and
   follow server pagination, so the complete available catalog is fetched with
   no hardcoded model names, prices, or categories. Newly added models appear
   without code changes.
3. Pricing is shown directly from the OpenRouter catalog as real per-token
   input (prompt) and output (completion) rates. There are no hardcoded or
   invented per-prompt / per-request estimates.
4. Categories (`Free`, `Cheap`, `Fast`, `Premium`) are derived from current
   OpenRouter model metadata/pricing, not hardcoded membership.
5. Setup, Settings, Model Picker, Session History, and Version & Changelog are
   dedicated fullscreen views (no cramped popups). The version number lives in
   Settings → Version & Changelog, not on the home screen.
4. Commands run via the Responses API with `tools: [{ type: "openrouter:shell",
   parameters: { engine: "openrouter" } }]`, always using the selected model.
5. Real shell output is rendered exactly; if Shell is unavailable it prints
   `[shell unavailable]` and never fabricates results.

Open the `index.html` in any modern browser, or serve the folder statically.
