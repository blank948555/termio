# Termio — Documentation

Termio is a client-side web terminal interface that executes real Linux shell commands inside an isolated hosted sandbox environment powered by OpenRouter's `openrouter:shell` engine.

---

## 1. System Architecture & Component Overview

Termio is designed as a zero-framework, client-side single-page application (SPA) built with vanilla HTML5, CSS3, and ES6 JavaScript. It runs directly in any modern web browser without requiring a local backend server or API proxy.

### File & Directory Structure

```
/app/termio/
├── index.html               # Main HTML entry point (Setup, Topbar, Terminal, Modals, Settings)
├── README.md                # Project overview and high-level summary
├── DOCS.md                  # Comprehensive technical documentation
└── source/
    ├── app/
    │   └── app.js           # Core application controller, execution loop, UI state, modal handlers
    ├── css/
    │   └── styles.css       # Mobile-first dark terminal UI stylesheet
    ├── js/
    │   ├── openrouter.js    # OpenRouter API client, SSE stream parser, model catalog & tool builders
    │   └── storage.js       # IndexedDB database wrapper with in-memory sync settings cache
    └── assets/
        └── shell.svg        # Terminal shell icon asset
```

### Main Modules & Responsibilities

- **`index.html`**: Defines the application layout, multi-step wizard, terminal display container, floating prompt input, and fullscreen views (Model Picker, Session History, Settings, Network Access Details, Version & Changelog, Warning Dialog).
- **`source/app/app.js`**: Contains application state (`state`), event bindings, boot sequence, session management, terminal output rendering (`parseAnsi`, `escapeHtml`), dangerous command detection, and streaming request orchestrator.
- **`source/js/openrouter.js`**: Implements communication with `https://openrouter.ai/api/v1`, Server-Sent Events (SSE) parsing, `openrouter:shell` tool schema generation (`shellTool`), model catalog querying and filtering (`fetchModels`, `isTextChatModel`), and pricing calculations.
- **`source/js/storage.js`**: Manages local data persistence using IndexedDB (`termio` database, version 2) across three object stores: settings (`kv`), session records (`sessions`), and command history logs (`history`).

---

## 2. API Key Setup

Termio operates on a **Bring Your Own Key (BYOK)** model. To run shell commands, users must supply a valid OpenRouter API key.

### First-Run Setup Wizard

Upon launching Termio for the first time (or when no API key is configured), the application displays a fullscreen multi-step wizard (`#setup` screen):

1. **Step 0: Welcome** — Introduces Termio's capabilities, hosted shell container environment, and key security principles.
2. **Step 1: OpenRouter API Key** — Provides a secure input field (`#setup-key`) for entering an OpenRouter API key (`sk-or-v1-…`) and a direct link to the OpenRouter API keys dashboard.
3. **Step 2: Shell Warning** — Presents compliance notices explaining that shell execution occurs within remote hosted Linux containers, outlines terms of service obligations, and notes maintainer non-liability.
4. **Step 3: Network Access** — Allows users to configure initial outbound network access for the hosted shell sandbox (defaults to **OFF**).
5. **Step 4: Privacy & Data** — Outlines data flow transparency regarding prompt transmission, container execution, local storage, API key handling, and anonymized analytics.
6. **Step 5: Ready** — Confirms setup completion and unlocks the main terminal interface.

### Onboarding Validation & Persistence

- During Step 1 or final setup submission, entering a key invokes `Storage.setSetting("apiKey", keyVal)`.
- Upon successful setup, `Storage.setSetting("setupDone", true)` is written to IndexedDB.
- Subsequent app boots check `Storage._mem.setupDone` and `Storage._mem.apiKey`. If both are present, the setup wizard is bypassed and the main terminal view initializes immediately.

---

## 3. Key Management & Credential Security

Termio treats third-party API credentials as high-sensitivity material and enforces strict security controls:

### Client-Side Isolation & Zero Middleman

- **No Proxy Server**: Termio contains no middleman backend or proxy server. Requests flow directly from the browser to OpenRouter endpoints (`https://openrouter.ai/api/v1`).
- **No Remote Logging**: API keys are never transmitted to any third-party logging service, analytics provider, or maintainer endpoint.

### Storage Security

- **IndexedDB Key-Value Store**: The API key is stored locally in the browser's IndexedDB database under store `kv` with key `'apiKey'`.
- **No `localStorage` Sinks**: Termio avoids using `localStorage` for key persistence to reduce exposure to non-isolated browser storage inspectors.

### In-Flight Security & Cross-Domain Protection

- **HTTPS Transmission**: API keys are transmitted over TLS-encrypted HTTPS connections using standard Bearer token headers (`Authorization: Bearer <API_KEY>`).
- **Catalog Pagination Boundary**: When iterating through paginated model catalog links (`json.links.next`), `OpenRouter.fetchModels` parses target URLs and verifies that the hostname matches `openrouter.ai` or ends in `.openrouter.ai`. Authorization headers are omitted if a pagination link references an untrusted external domain.

### UI Protection & DOM Safety

- **Obfuscated Inputs**: API key input fields (`#setup-key` and `#set-key`) use `type="password"`, `autocomplete="off"`, and `spellcheck="false"`.
- **No Value Pre-population**: When opening the Settings modal, sensitive key material is **not** pre-populated into the DOM value attribute (`$setKey.value = ""`). Instead, key status is indicated via a visual badge (`#key-status-badge`) displaying either `Key Configured` or `No Key Configured`.

### Key Removal & Revocation

- **Clear API Key Option**: Users can remove their saved API key at any time in Settings by clicking "Clear API Key".
- **Confirmation Gate**: Clearing a key triggers a custom fullscreen warning modal (`#warning-screen`). Upon confirmation, `Storage.delSetting("apiKey")` deletes the key entry from IndexedDB, clears in-memory state (`state.apiKey = null`), and updates the UI status badge.

---

## 4. Configuration Options & App Settings

Termio stores key-value settings and preferences in the IndexedDB `kv` object store.

### Application Settings Key Reference

| Setting Key | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `apiKey` | String | `null` | Stored OpenRouter API key (`sk-or-v1-…`) |
| `setupDone` | Boolean | `false` | Flag indicating completion of the initial onboarding wizard |
| `model` | String | Dynamic | Currently selected model ID (e.g., `google/gemini-2.5-flash`) |
| `networkAccess` | Boolean | `false` | Toggles outbound container networking (OFF / ON with allowlist) |
| `prefs` | Object | `{ clearOnCmd: false, showHeaders: true }` | User interface rendering preferences |
| `activeSessionId` | String | `null` | Identifier of the currently active terminal session |
| `sessionId` | String | `null` | OpenRouter sticky container session ID for shell environment persistence |

### User Preferences (`prefs`)

- **Clear screen on new command (`clearOnCmd`)**: When enabled, execution clears existing terminal blocks before displaying output for the newly entered command.
- **Show command headers (`showHeaders`)**: When enabled, each terminal block prints a leading command prompt header (`$ <command>`) above the command output.

### Model Catalog & Selection Architecture

1. **Dynamic Model Fetching**: Termio queries `GET https://openrouter.ai/api/v1/models?output_modalities=all` with link header pagination (up to 40 pages, 1000 models per page).
2. **Compatibility Filtering (`isTextChatModel`)**:
   - Rejects models that produce non-text output modalities (`image`, `video`, `audio`, `voice`, `speech`, `transcript`).
   - Rejects pure embedding, moderation, or audio transcription model families.
   - Requires explicit tool-calling support (`tools` or `tool_choice` in `supported_parameters`), ensuring the model is capable of emitting `openrouter:shell` calls.
3. **Pricing Transparency**: Real per-token input (prompt) and output (completion) costs are extracted directly from catalog pricing (`promptPricePerM`, `completionPricePerM`) and rendered in USD per 1M tokens.
4. **Dynamic Categorization**: Models are assigned category tags (`free`, `cheap`, `fast`, `premium`) derived from live metadata without hardcoded lists.
5. **Default Model Selection (`selectDefaultModel`)**: Automatically selects a free tool-capable model with maximum context length, or falls back to the cheapest tool-capable model available.

---

## 5. IndexedDB Storage Architecture

Termio uses IndexedDB (`window.indexedDB`) as its primary storage mechanism via `source/js/storage.js`.

### Database Schema

- **Database Name**: `termio`
- **Database Version**: `2`

```
termio (IndexedDB)
├── kv (ObjectStore)
│   └── [key] => value
├── sessions (ObjectStore, keyPath: "id")
│   ├── Index: "updatedAt"
│   └── [session.id] => { id, title, createdAt, updatedAt, modelId, openrouterSessionId, conversation, blocks }
└── history (ObjectStore, keyPath: "id", autoIncrement: true)
    ├── Index: "ts"
    └── [id] => { ts, cmd, hadToolOutput, model }
```

### Storage Operations API (`window.Storage`)

- **Settings Operations**:
  - `getSetting(key)`: Retrieves a single setting value from `kv`.
  - `setSetting(key, value)`: Updates a setting in `kv` and synchronizes the in-memory cache (`memCache`).
  - `delSetting(key)`: Deletes a key from `kv` and removes it from `memCache`.
  - `getAllSettings()`: Hydrates `memCache` with all key-value entries from `kv`.
  - `clearSettings()`: Wipes all records in `kv`.
- **Session Operations**:
  - `saveSession(session)`: Inserts or updates a session object in `sessions` with an updated timestamp (`updatedAt`).
  - `getSession(id)`: Retrieves a specific session by ID.
  - `getAllSessions()`: Fetches all stored sessions, sorted descending by `updatedAt` / `createdAt`.
  - `deleteSession(id)`: Deletes a session record by ID.
  - `clearAllSessions()`: Wipes all records in `sessions`.
- **Command History Operations**:
  - `addHistory(entry)`: Appends a command execution log entry to `history`.
  - `getHistory(limit)`: Retrieves command history records sorted chronologically.
  - `clearHistory()`: Wipes all records in `history`.
- **Wholesale Reset**:
  - `resetAll()`: Clears `kv`, `sessions`, `history`, and `memCache` in a single operation.

### Synchronous Memory Cache (`memCache`)

To ensure smooth synchronous UI rendering without asynchronous storage latency during user interactions, `source/js/storage.js` maintains an in-memory settings object (`Storage._mem`). Upon app initialization, `boot()` executes `Storage.getAllSettings()`, populating `memCache` before rendering UI components.

---

## 6. Security Model & Execution Safety

Termio incorporates defense-in-depth mechanisms to protect user safety and account integrity.

### Sandbox Isolation

All shell commands run within an isolated Linux container hosted remotely by OpenRouter (`engine: "openrouter"`, `environment: { type: "container_auto" }`). Commands have no access to the user's host operating system, local filesystem, or local browser storage.

### Network Access Control & Domain Allowlists

Outbound internet access from within the hosted shell container is controlled via the `networkEnabled` flag passed to `OpenRouter.shellTool(networkEnabled)`:

- **Disabled (Default / OFF)**:
  ```json
  "environment": {
    "type": "container_auto",
    "network_policy": { "type": "disabled" }
  }
  ```
  The container has zero outbound internet access.
- **Enabled (ON)**:
  ```json
  "environment": {
    "type": "container_auto",
    "network_policy": {
      "type": "allowlist",
      "allowed_domains": [
        "api.github.com",
        "*.pythonhosted.org",
        "pypi.org"
      ]
    }
  }
  ```
  Network access is limited strictly to the approved domain allowlist.

### Dangerous Command Interception

Before executing user input, `runCommand()` evaluates command text against a dangerous command detection regex (`isDangerousCommand`):

```javascript
const pattern = /\b(rm\s+-[rRf]+|sudo|mkfs|dd\s+if=|chmod\s+(-R\s+)?777|shutdown|reboot|:\{\s*:\|:&\s*\}|drop\s+database)\b/i;
```

If a command matches known destructive patterns (e.g., recursive deletion `rm -rf`, privileged operations `sudo`, disk formatting `mkfs`, fork bombs, database destruction):
1. Execution is paused.
2. A fullscreen modal warning (`#warning-screen`) is displayed.
3. The command is sent to OpenRouter **only** if the user explicitly confirms by clicking "Execute Command". If cancelled, execution is aborted locally.

### Promise-Backed Modal System

Termio avoids browser-native blocking dialogs (`window.confirm`, `window.alert`, `window.prompt`), which can freeze UI event loops or be suppressed by browsers. All confirmation workflows (deleting sessions, clearing API keys, dangerous command warnings, factory resetting data) utilize `showFullscreenWarning()`, an asynchronous promise-backed overlay component.

### Single-Command Strict Terminal Rules

To prevent autonomous agent drift or unintended multi-step loops, Termio injects strict system instructions (`TERMINAL_INSTRUCTIONS`) into every OpenRouter Responses API payload:
- Forces verbatim single-command execution.
- Caps request execution to a single tool call (`maxToolCalls: 1`).
- Prohibits autonomous retry loops, commentary, or fake stdout/stderr generation.
- Treats non-zero exit codes as final execution results and stops immediately.

### Output Sanitization & XSS Prevention

- Raw command output is processed via custom ANSI escape parser `parseAnsi()`, mapping text styles and colors to safe DOM nodes.
- Text content is escaped via `escapeHtml()` before insertion into DOM templates, preventing HTML or script injection attacks from unescaped command output or session titles.

### Execution Cancellation

When a command is running, the topbar controls are disabled and a "Stop" button appears in the input bar. Clicking Stop triggers `AbortController.abort()`, immediately terminating the HTTP fetch connection and halting output streaming.

---

## 7. Data Reset & Recovery Protocols

Termio provides users with full control over their local data footprint.

### Start New Session
- Accessible via topbar or Settings ("Start New Session").
- Creates a fresh session record with a unique ID (`sess_<timestamp>_<random>`), clears active terminal output nodes, and re-initializes terminal context while retaining global settings and API keys.

### Reset All Termio Data
- Accessible via Settings → "Reset All Termio Data".
- Prompts for explicit user confirmation via `#warning-screen`.
- Upon confirmation:
  1. Executes `Storage.resetAll()`, wiping all IndexedDB stores (`kv`, `sessions`, `history`).
  2. Clears in-memory state, model caches, and session pointers.
  3. Returns the application to Step 0 of the initial setup wizard.
