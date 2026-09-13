import { useState } from "react";
import "./settings.css";
import type { Settings } from "../lib/storage";
import type { ModelInfo } from "../lib/models";
import { shortName } from "../lib/models";
import { cx } from "../lib/utils";

type Props = {
  settings: Settings;
  selectedModel: ModelInfo | null;
  onSettingsChange: (patch: Partial<Settings>) => void;
  onPickModel: () => void;
  onResetSession: () => void;
  onReopenSetup: () => void;
  onClearAll: () => void;
};

export default function SettingsPanel({
  settings,
  selectedModel,
  onSettingsChange,
  onPickModel,
  onResetSession,
  onReopenSetup,
  onClearAll,
}: Props) {
  const [keyDraft, setKeyDraft] = useState(settings.apiKey);
  const [reveal, setReveal] = useState(false);

  return (
    <div>
      <div className="settings__section">
        <div className="settings__section-title">OpenRouter</div>
        <div className="settings__field-block">
          <div className="settings__row-label" style={{ marginBottom: 8 }}>
            API key
          </div>
          <div className="settings__key-wrap">
            <input
              className="settings__key-input"
              type={reveal ? "text" : "password"}
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              onBlur={() => keyDraft.trim() && onSettingsChange({ apiKey: keyDraft.trim() })}
              placeholder="sk-or-v1-…"
              autoComplete="off"
              spellCheck={false}
              autoCapitalize="off"
            />
            <button
              type="button"
              className="settings__key-toggle"
              onClick={() => setReveal((r) => !r)}
              tabIndex={-1}
            >
              {reveal ? "hide" : "show"}
            </button>
          </div>
          <div className="settings__row-hint">
            Stored only in this browser. Sent directly to OpenRouter.
          </div>
        </div>
        <div style={{ marginTop: 16 }}>
          <div className="settings__row-label" style={{ marginBottom: 8 }}>
            Model
          </div>
          <button className="settings__model-pick" onClick={onPickModel}>
            <span
              className="settings__model-pick-name"
            >
              {selectedModel ? (
                selectedModel.id
              ) : (
                <span className="settings__model-pick-empty">
                  Select a model
                </span>
              )}
            </span>
            <span className="settings__model-pick-chev">›</span>
          </button>
          {selectedModel && (
            <div className="settings__row-hint" style={{ marginTop: 6 }}>
              {shortName(selectedModel)}
            </div>
          )}
        </div>
      </div>

      <div className="settings__section">
        <div className="settings__section-title">Terminal</div>
        <div className="settings__row">
          <div>
            <div className="settings__row-label">Strict terminal</div>
            <div className="settings__row-hint">
              Force real Shell output; block simulated results.
            </div>
          </div>
          <button
            className={cx("toggle", settings.strictTerminal && "toggle--on")}
            onClick={() =>
              onSettingsChange({ strictTerminal: !settings.strictTerminal })
            }
            aria-label="Strict terminal"
          >
            <span className="toggle__knob" />
          </button>
        </div>
        <div className="settings__row">
          <div>
            <div className="settings__row-label">Preserve whitespace</div>
            <div className="settings__row-hint">
              Keep exact line breaks and spacing in output.
            </div>
          </div>
          <button
            className={cx("toggle", settings.preserveWhitespace && "toggle--on")}
            onClick={() =>
              onSettingsChange({
                preserveWhitespace: !settings.preserveWhitespace,
              })
            }
            aria-label="Preserve whitespace"
          >
            <span className="toggle__knob" />
          </button>
        </div>
        <div className="settings__row">
          <div>
            <div className="settings__row-label">Reasoning</div>
            <div className="settings__row-hint">
              Allow the model to reason before acting.
            </div>
          </div>
          <button
            className={cx("toggle", settings.prefersReasoning && "toggle--on")}
            onClick={() =>
              onSettingsChange({
                prefersReasoning: !settings.prefersReasoning,
              })
            }
            aria-label="Reasoning"
          >
            <span className="toggle__knob" />
          </button>
        </div>
        <div className="settings__row">
          <div className="settings__row-label">Font size</div>
          <div className="seg">
            {(["sm", "md", "lg"] as const).map((s) => (
              <button
                key={s}
                className={cx(
                  "seg__btn",
                  settings.fontSize === s && "seg__btn--active"
                )}
                onClick={() => onSettingsChange({ fontSize: s })}
              >
                {s === "sm" ? "S" : s === "md" ? "M" : "L"}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="settings__section">
        <div className="settings__section-title">Session</div>
        <div className="settings__row">
          <div>
            <div className="settings__row-label">New shell session</div>
            <div className="settings__row-hint">
              Starts a fresh remote container. Current session ends.
            </div>
          </div>
          <button className="settings__btn" onClick={onResetSession}>
            Reset session
          </button>
        </div>
      </div>

      <div className="settings__section">
        <div className="settings__section-title">About</div>
        <div className="settings__info">
          <p>
            Termio runs commands through OpenRouter's hosted{" "}
            <code>openrouter:shell</code> tool. The environment is a remote,
            temporary Linux container — not your machine.
          </p>
          <p>
            Commands and their output are real. Termio does not fabricate
            results.
          </p>
        </div>
        <div className="settings__beta-line">
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.12em",
              color: "var(--amber)",
              padding: "3px 8px",
              border: "1px solid #3a2e0e",
              borderRadius: "999px",
              background: "#1a1408",
            }}
          >
            BETA
          </span>
          <span style={{ fontSize: 12, color: "var(--text-2)" }}>
            Shell is a beta feature. Behavior may change.
          </span>
        </div>
        <div className="settings__save-row">
          <button className="settings__btn" onClick={onReopenSetup}>
            Setup guide
          </button>
          <button
            className="settings__btn settings__btn--danger"
            onClick={onClearAll}
          >
            Clear all data
          </button>
        </div>
      </div>
    </div>
  );
}
