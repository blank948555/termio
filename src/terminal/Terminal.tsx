import { useCallback, useEffect, useRef, useState } from "react";
import "./terminal.css";
import type { Settings } from "../lib/storage";
import { clearAll, saveSettings } from "../lib/storage";
import type { ModelInfo } from "../lib/models";
import { isShellCompatible, shortName } from "../lib/models";
import {
  runShell,
  SYSTEM_INSTRUCTION,
  TermioError,
  type ResponsesResult,
  type TermioErrorKind,
} from "../lib/openrouter";
import { ensureSession, clearSession, type SessionMeta } from "../lib/session";
import { cx, formatCost, formatTokens } from "../lib/utils";
import ModelPicker from "../modelpicker/ModelPicker";
import SettingsPanel from "../settings/SettingsPanel";

type Props = {
  settings: Settings;
  models: ModelInfo[];
  modelsError: string | null;
  selectedModel: ModelInfo | null;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onReloadModels: () => void;
  onOpenSettings: null;
};

type BlockKind =
  | "cmd"
  | "stdout"
  | "stderr"
  | "exit"
  | "prose"
  | "reason"
  | "running"
  | "error"
  | "system";

type Block = {
  id: string;
  kind: BlockKind;
  text: string;
  exitCode?: number;
  timeout?: boolean;
  errorKind?: TermioErrorKind;
  running?: boolean;
};

type Turn = {
  userText: string;
  blocks: Block[];
};

type Usage = {
  input: number | null;
  output: number | null;
  cost: number | null;
};

const ERROR_HINTS: Partial<Record<TermioErrorKind, string>> = {
  auth: "Check your API key in Settings.",
  credits: "Add credits to your OpenRouter account to continue.",
  rate_limit: "Wait a moment, then resend your command.",
  shell_unavailable: "Shell is in beta and may be temporarily unavailable.",
  no_compatible_endpoint: "This model has no compatible endpoint right now. Try another model.",
  tool_unsupported: "This model may not support the Shell tool. Pick a model marked shell.",
  network: "Check your connection and try again.",
  session: "The shell session may have expired. Reset session in Settings.",
  server: "OpenRouter had a transient error. Try again shortly.",
};

export default function Terminal({
  settings,
  models,
  modelsError,
  selectedModel,
  onSettingsChange,
  onReloadModels,
}: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [usage, setUsage] = useState<Usage>({ input: null, output: null, cost: null });
  const [session, setSession] = useState<SessionMeta>(() => ensureSession());
  const [lastModel, setLastModel] = useState<string | null>(null);
  const [newSessionNotice, setNewSessionNotice] = useState<string | null>(null);
  const [mobile, setMobile] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const historyRef = useRef<string[]>([]);
  const histIdxRef = useRef<number>(-1);
  const histDraftRef = useRef<string>("");

  const modelsLoading = models.length === 0 && !modelsError;

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const update = () => setMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  const hasModel = !!selectedModel;
  const shellOk = selectedModel ? isShellCompatible(selectedModel) : null;

  useEffect(() => {
    if (settings.modelId || models.length === 0) return;
    const first = [...models]
      .filter(isShellCompatible)
      .sort((a, b) =>
        (a.pricing?.prompt ?? "9").localeCompare(b.pricing?.prompt ?? "9")
      )[0];
    if (first) onSettingsChange({ modelId: first.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models, settings.modelId]);

  const scrollBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const el = bodyRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  useEffect(() => {
    scrollBottom();
  }, [turns, busy, scrollBottom]);

  function pushSystem(text: string) {
    setTurns((prev) => [
      ...prev,
      { userText: "", blocks: [{ id: rid(), kind: "system", text }] },
    ]);
  }

  function resetSession() {
    abortRef.current?.abort();
    clearSession();
    const fresh = ensureSession();
    setSession(fresh);
    setTurns([]);
    setUsage({ input: null, output: null, cost: null });
    setLastModel(null);
    setNewSessionNotice("New shell session started. The previous remote container was released.");
  }

  function reopenSetup() {
    setSettingsOpen(false);
    const next = saveSettings({ setupComplete: false });
    onSettingsChange(next);
  }

  function clearAllData() {
    clearAll();
    clearSession();
    onSettingsChange({ apiKey: "", modelId: "", setupComplete: false });
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    if (!settings.apiKey) {
      pushSystem("No OpenRouter API key set. Add one in Settings to continue.");
      return;
    }
    if (!selectedModel) {
      pushSystem("No model selected. Pick one from the model picker.");
      return;
    }

    historyRef.current = [...historyRef.current, text];
    histIdxRef.current = historyRef.current.length;
    histDraftRef.current = "";
    setInput("");

    const turn: Turn = { userText: text, blocks: [] };
    const runningBlock: Block = {
      id: rid(),
      kind: "running",
      text: "Running",
      running: true,
    };
    turn.blocks.push(runningBlock);
    setTurns((prev) => [...prev, turn]);
    setBusy(true);

    const controller = new AbortController();
    abortRef.current = controller;

    const inputArr = buildInput(text);

    try {
      const result = await runShell({
        apiKey: settings.apiKey,
        modelId: selectedModel.id,
        input: inputArr,
        containerId: session.containerId,
        sessionId: session.sessionId,
        reasoning: settings.prefersReasoning,
        signal: controller.signal,
      });
      const newBlocks = renderResult(result, settings);
      setTurns((prev) =>
        prev.map((t) =>
          t === turn
            ? { ...t, blocks: [...t.blocks.filter((b) => !b.running), ...newBlocks] }
            : t
        )
      );
      applyUsage(result);
      if (lastModel && lastModel !== selectedModel.id) {
        setNewSessionNotice(
          `Model changed — a new shell container is now in use for ${shortName(selectedModel)}.`
        );
      }
      setLastModel(selectedModel.id);
      setNewSessionNotice((n) => n);
    } catch (e) {
      const blocks = renderError(e);
      setTurns((prev) =>
        prev.map((t) =>
          t === turn
            ? { ...t, blocks: [...t.blocks.filter((b) => !b.running), ...blocks] }
            : t
        )
      );
    } finally {
      setBusy(false);
      abortRef.current = null;
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function onInputKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      send();
    } else if (e.key === "ArrowUp") {
      if (historyRef.current.length === 0) return;
      e.preventDefault();
      if (histIdxRef.current === historyRef.current.length) {
        histDraftRef.current = input;
      }
      histIdxRef.current = Math.max(0, histIdxRef.current - 1);
      setInput(historyRef.current[histIdxRef.current] ?? "");
    } else if (e.key === "ArrowDown") {
      if (historyRef.current.length === 0) return;
      e.preventDefault();
      histIdxRef.current = Math.min(historyRef.current.length, histIdxRef.current + 1);
      if (histIdxRef.current === historyRef.current.length) {
        setInput(histDraftRef.current);
      } else {
        setInput(historyRef.current[histIdxRef.current] ?? "");
      }
    }
  }

  function applyUsage(result: ResponsesResult) {
    const u = result.usage;
    if (!u) return;
    setUsage({
      input: u.input_tokens,
      output: u.output_tokens,
      cost: u.cost,
    });
  }

  const modelPillName = selectedModel
    ? shortName(selectedModel)
    : settings.modelId || "Select model";

  const showWelcome = turns.length === 0;

  return (
    <div className={cx("term", `font-${settings.fontSize}`)}>
      <header className="term__header">
        <div className="term__brand">
          <span className="term__brand-name">Termio</span>
          <span className="term__brand-sub">termio.lol</span>
        </div>
        <div className="term__header-right">
          <button
            className="term__model-pill"
            onClick={() => setPickerOpen(true)}
            title={selectedModel ? selectedModel.id : "Select a model"}
          >
            <span
              className={cx("term__model-pill-dot", busy && "term__model-pill-dot--busy")}
            />
            <span className="term__model-pill-name">{modelPillName}</span>
            <span className="term__model-pill-chev">▾</span>
          </button>
          <button
            className={cx("icon-btn", settingsOpen && "icon-btn--active")}
            onClick={() => setSettingsOpen((s) => !s)}
            aria-label="Settings"
          >
            <GearIcon />
          </button>
        </div>
      </header>

      <div className="term__body" ref={bodyRef} onClick={() => inputRef.current?.focus()}>
        <div className="term__inner">
          {showWelcome && (
            <div className="term__welcome">
              <span style={{ color: "var(--text-2)" }}>Termio</span> — OpenRouter hosted
              Shell.
              <br />
              Type a command or a natural-language request.
              <br />
              Try: <span style={{ color: "var(--text-2)" }}>whoami</span>,{" "}
              <span style={{ color: "var(--text-2)" }}>uname -a</span>, or{" "}
              <span style={{ color: "var(--text-2)" }}>find the 10 largest files</span>.
              <br />
              Commands run remotely in a temporary Linux container.
            </div>
          )}

          {newSessionNotice && (
            <div className="term__system">
              <strong>Session.</strong> {newSessionNotice}
            </div>
          )}

          {modelsError && (
            <div className="term__system">
              <strong>Model catalog unavailable.</strong> {modelsError}{" "}
              <button
                onClick={onReloadModels}
                style={{ color: "var(--text-2)", textDecoration: "underline" }}
              >
                Retry
              </button>
            </div>
          )}

          {hasModel && shellOk === false && (
            <div className="term__system">
              <strong>Note.</strong> This model may not support the Shell tool. Pick one
              tagged <em>shell</em> for reliable execution.
            </div>
          )}

          {turns.map((t, ti) => (
            <div key={ti}>
              {t.userText && (
                <div className="term__line">
                  <div className="term__prompt">
                    <span className="term__prompt-sign">$</span>
                    <span className="term__prompt-cmd">{t.userText}</span>
                  </div>
                </div>
              )}
              {t.blocks.map((b) => (
                <BlockView key={b.id} block={b} preserve={settings.preserveWhitespace} />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="term__footer-meta">
        <div className="term__usage">
          <span>
            in <b>{formatTokens(usage.input)}</b>
          </span>
          <span>
            out <b>{formatTokens(usage.output)}</b>
          </span>
          <span>
            cost <b>{formatCost(usage.cost)}</b>
          </span>
          {selectedModel && (
            <span style={{ color: "var(--text-4)" }}>{shortName(selectedModel)}</span>
          )}
        </div>
        {busy && (
          <button className="term__stop" onClick={stop}>
            stop
          </button>
        )}
      </div>

      <div className="term__input-row">
        <span className="term__input-sign">$</span>
        <input
          ref={inputRef}
          className="term__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onInputKey}
          placeholder={busy ? "Running…" : "type a command or request"}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          disabled={busy}
          aria-label="Terminal input"
        />
        <button className="term__send" onClick={send} disabled={busy || !input.trim()}>
          ↵
        </button>
      </div>

      <ModelPicker
        open={pickerOpen}
        models={models}
        loading={modelsLoading}
        error={modelsError}
        selectedId={settings.modelId || null}
        onSelect={(id) => onSettingsChange({ modelId: id })}
        onClose={() => setPickerOpen(false)}
        onRetry={onReloadModels}
        mobile={mobile}
      />

      {settingsOpen && (
        <SettingsSheet mobile={mobile} onClose={() => setSettingsOpen(false)}>
          <SettingsPanel
            settings={settings}
            selectedModel={selectedModel}
            onSettingsChange={onSettingsChange}
            onPickModel={() => {
              setSettingsOpen(false);
              setTimeout(() => setPickerOpen(true), 200);
            }}
            onResetSession={resetSession}
            onReopenSetup={reopenSetup}
            onClearAll={clearAllData}
          />
        </SettingsSheet>
      )}
    </div>
  );
}

function BlockView({ block, preserve }: { block: Block; preserve: boolean }) {
  switch (block.kind) {
    case "cmd":
      return (
        <div className="term__line">
          <div className="term__prompt">
            <span className="term__prompt-sign">$</span>
            <span className="term__prompt-cmd">{block.text}</span>
          </div>
        </div>
      );
    case "stdout":
      if (block.text === "") return null;
      return (
        <div className={cx("term__out", preserve && "term__out--preserve")}>{block.text}</div>
      );
    case "stderr":
      if (block.text === "") return null;
      return (
        <div className={cx("term__out term__out--stderr", preserve && "term__out--preserve")}>
          {block.text}
        </div>
      );
    case "exit": {
      if (block.timeout) {
        return <div className="term__exit term__exit--timeout">⏱ timed out</div>;
      }
      const ok = block.exitCode === 0;
      return (
        <div className={cx("term__exit", ok ? "term__exit--ok" : "term__exit--err")}>
          ↳ exit {block.exitCode}
        </div>
      );
    }
    case "reason":
      return <div className="term__reason">{block.text}</div>;
    case "prose":
      return <div className="term__prose">{block.text}</div>;
    case "running":
      return (
        <div className="term__running">
          <span>Running</span>
          <span className="term__running-dots" />
        </div>
      );
    case "error":
      return (
        <div className="term__err-line">
          <span className="term__err-label">error</span>
          {block.text}
        </div>
      );
    case "system":
      return (
        <div className="term__system">
          <strong>Note.</strong> {block.text}
        </div>
      );
    default:
      return null;
  }
}

function SettingsSheet({
  children,
  onClose,
  mobile,
}: {
  children: React.ReactNode;
  onClose: () => void;
  mobile: boolean;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className={cx("sheet", mobile ? "bottom" : "center")} role="dialog" aria-label="Settings">
        <div className="sheet__header">
          <div className="sheet__title-row">
            <span className="sheet__title">Settings</span>
            <button className="sheet__close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        </div>
        <div className="sheet__list" style={{ paddingTop: 6, paddingBottom: 24 }}>
          {children}
        </div>
      </div>
    </>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

function buildInput(text: string): unknown[] {
  return [
    { role: "system", content: SYSTEM_INSTRUCTION },
    { role: "user", content: text },
  ];
}

function renderResult(result: ResponsesResult, settings: Settings): Block[] {
  const blocks: Block[] = [];
  const { shellCalls, shellOutputs, reasoningParts, textParts } = result.output;

  for (const call of shellCalls) {
    for (const cmd of call.commands) {
      blocks.push({ id: rid(), kind: "cmd", text: cmd });
    }
  }

  for (const e of shellOutputs) {
    if (e.stdout) {
      blocks.push({ id: rid(), kind: "stdout", text: e.stdout });
    }
    if (e.stderr) {
      blocks.push({ id: rid(), kind: "stderr", text: e.stderr });
    }
    blocks.push({
      id: rid(),
      kind: "exit",
      text: "",
      exitCode: e.outcome.type === "exit" ? e.outcome.exit_code : undefined,
      timeout: e.outcome.type === "timeout",
    });
  }

  if (settings.prefersReasoning) {
    for (const r of reasoningParts) {
      blocks.push({ id: rid(), kind: "reason", text: r });
    }
  }

  const prose = textParts.join("\n").trim();
  if (prose) {
    if (settings.strictTerminal && shellOutputs.length === 0 && shellCalls.length === 0) {
      blocks.push({
        id: rid(),
        kind: "system",
        text:
          "No Shell command was executed for this request. The model returned text only — Termio did not show it as terminal output.",
      });
      blocks.push({ id: rid(), kind: "prose", text: prose });
    } else {
      blocks.push({ id: rid(), kind: "prose", text: prose });
    }
  }

  if (shellOutputs.length === 0 && shellCalls.length === 0 && !prose) {
    blocks.push({
      id: rid(),
      kind: "system",
      text: "The model did not run any shell command and returned no output.",
    });
  }

  return blocks;
}

function renderError(e: unknown): Block[] {
  let message: string;
  let kind: TermioErrorKind | undefined;
  if (e instanceof TermioError) {
    kind = e.kind;
    message = e.message;
    const hint = kind ? ERROR_HINTS[kind] : undefined;
    message = hint ? `${message} ${hint}` : message;
  } else if (e instanceof Error) {
    message = e.message || "Unexpected error.";
  } else {
    message = "Unexpected error.";
  }
  return [{ id: rid(), kind: "error", text: message, errorKind: kind }];
}

function rid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
