# Termio

Termio is a focused browser interface for OpenRouter's hosted **Shell** capability (`openrouter:shell`). It is not an AI chatbot — the terminal is the center of the product. You type a command or a natural-language request, a current OpenRouter model translates it into real shell commands, and OpenRouter executes them server-side in an isolated Linux container. Real output only.

- BYOK — bring your own OpenRouter API key. It is stored only in this browser and sent directly to OpenRouter. It is never logged.
- Dynamic model catalog fetched live from OpenRouter. No hardcoded model list.
- Real terminal output: stdout, stderr, exit codes, timeouts. Termio never fabricates results.
- Session continuity via the OpenRouter Shell container, with an explicit reset.
- AMOLED design, genuinely excellent on phones (320–412px and up).

## Architecture

Pure client-side single-page app (Vite + React + TypeScript). No backend, no server-side secrets.

- `src/lib/openrouter.ts` — OpenRouter Responses API client (`openrouter:shell` tool), output parsing, usage, and terminal-native error classification (auth, credits, rate limit, shell unavailable, no compatible endpoint, tool unsupported, network, session, server).
- `src/lib/models.ts` — dynamic model metadata and category derivation (Free / Cheap / Fast / Premium / Shell compatible) computed from current OpenRouter catalog pricing and capability data. No hardcoded membership lists.
- `src/lib/storage.ts` — client-side settings (localStorage). The API key is stored locally and never printed or logged.
- `src/lib/session.ts` — shell container/session lifecycle (sessionStorage).
- `src/onboarding/` — continuous, animated first-run setup (what Termio is, OpenRouter, BYOK, Beta warning, key entry/verify).
- `src/modelpicker/` — custom model picker with search, dynamic categories, and per-model metadata.
- `src/terminal/` — the main terminal surface: command flow like terminal history, animated `Running…` state, usage, errors, keyboard history navigation.
- `src/settings/` — focused settings (API key, model, terminal behavior, strict terminal, appearance, reset session, Beta info, clear data).

## Develop

```bash
npm install
npm run dev      # start the dev server
npm run build    # type-check + production build
npm run preview  # preview the production build
```

Requires Node 18+.

## Notes

Shell is a **Beta** feature on OpenRouter; the API and environment behavior may change. The hosted environment is remote, temporary, and restricted — not your local computer, and not permanent storage. Model and Shell usage can cost OpenRouter credits per request.

Termio is an independent product and is not affiliated with OpenRouter.
