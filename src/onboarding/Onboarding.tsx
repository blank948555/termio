import { useEffect, useRef, useState } from "react";
import "./onboarding.css";
import type { Settings } from "../lib/storage";
import { validateKey } from "../lib/openrouter";
import { cx } from "../lib/utils";

type Props = {
  onComplete: (next: Partial<Settings>) => void;
  settings: Settings;
};

type Step = "welcome" | "what" | "beta" | "key";

const STEPS: Step[] = ["welcome", "what", "beta", "key"];

export default function Onboarding({ onComplete, settings }: Props) {
  const [step, setStep] = useState<Step>("welcome");
  const [leaving, setLeaving] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [reveal, setReveal] = useState(false);
  const [verifyState, setVerifyState] = useState<"idle" | "busy" | "ok" | "err">("idle");
  const [verifyMsg, setVerifyMsg] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const idx = STEPS.indexOf(step);
  const progress = ((idx + 1) / STEPS.length) * 100;

  useEffect(() => {
    if (step === "key") {
      const t = setTimeout(() => inputRef.current?.focus(), 350);
      return () => clearTimeout(t);
    }
  }, [step]);

  function go(next: Step, _d: 1 | -1) {
    if (next === step) return;
    setLeaving(true);
    setTimeout(() => {
      setStep(next);
      setLeaving(false);
    }, 220);
  }

  async function verify() {
    const k = apiKey.trim();
    if (!k) {
      setVerifyState("err");
      setVerifyMsg("Enter your OpenRouter API key to continue.");
      return;
    }
    setVerifyState("busy");
    setVerifyMsg("Verifying key…");
    try {
      const ok = await validateKey(k);
      if (ok) {
        setVerifyState("ok");
        setVerifyMsg("Key verified.");
      } else {
        setVerifyState("err");
        setVerifyMsg("Key rejected by OpenRouter. Check it and try again.");
      }
    } catch {
      setVerifyState("err");
      setVerifyMsg("Could not reach OpenRouter. You can continue and verify later.");
    }
  }

  function finish() {
    const k = apiKey.trim() || settings.apiKey;
    onComplete({ apiKey: k });
  }

  return (
    <div className="onboard">
      <div className="onboard__brand">
        <span className="onboard__brand-mark">Termio</span>
        <span className="onboard__brand-dot" />
        <span className="onboard__brand-sub">termio.lol</span>
      </div>

      <div className="onboard__stage">
        <div className="onboard__progress">
          <div className="onboard__progress-bar" style={{ width: `${progress}%` }} />
        </div>

        {step === "welcome" && (
          <div className={cx("onboard__step", leaving && "leaving")}>
            <div className="onboard__eyebrow">A browser terminal</div>
            <h1 className="onboard__title">
              Termio<span className="accent">.</span>
            </h1>
            <div className="onboard__lede">
              <p>
                A clean interface for OpenRouter's hosted Shell. Type into a real
                terminal — commands run remotely in a sandboxed Linux
                environment.
              </p>
            </div>
            <div className="onboard__actions">
              <button
                className="onboard__btn onboard__btn--primary"
                onClick={() => go("what", 1)}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === "what" && (
          <div className={cx("onboard__step", leaving && "leaving")}>
            <div className="onboard__eyebrow">How it works</div>
            <h1 className="onboard__title">
              Your key<span className="accent">,</span> their shell
              <span className="accent">.</span>
            </h1>
            <div className="onboard__lede">
              <p>Termio is built on OpenRouter and its hosted Shell capability.</p>
            </div>
            <div className="onboard__facts">
              <div className="onboard__fact">
                <span className="onboard__fact-marker">01</span>
                <span className="onboard__fact-text">
                  You bring your <strong>own OpenRouter API key</strong>. Nothing
                  is stored on Termio's servers.
                </span>
              </div>
              <div className="onboard__fact">
                <span className="onboard__fact-marker">02</span>
                <span className="onboard__fact-text">
                  Commands execute on a <strong>remote, limited Linux
                  environment</strong> — not your local computer.
                </span>
              </div>
              <div className="onboard__fact">
                <span className="onboard__fact-marker">03</span>
                <span className="onboard__fact-text">
                  The environment may be <strong>temporary or
                  restricted</strong>. Don't treat it like permanent storage.
                </span>
              </div>
              <div className="onboard__fact">
                <span className="onboard__fact-marker">04</span>
                <span className="onboard__fact-text">
                  Model and Shell usage can <strong>cost OpenRouter
                  credits</strong> per request.
                </span>
              </div>
            </div>
            <div className="onboard__actions">
              <button
                className="onboard__btn onboard__btn--ghost"
                onClick={() => go("welcome", -1)}
              >
                Back
              </button>
              <button
                className="onboard__btn onboard__btn--primary"
                onClick={() => go("beta", 1)}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === "beta" && (
          <div className={cx("onboard__step", leaving && "leaving")}>
            <div className="onboard__eyebrow">Before you start</div>
            <h1 className="onboard__title">
              Shell is in <span className="accent">Beta</span>
            </h1>
            <div className="onboard__lede">
              <p>A few things to know before your first command.</p>
            </div>
            <div className="onboard__beta">
              <div className="onboard__beta-head">
                <span className="onboard__beta-badge">Beta</span>
                <span className="onboard__beta-title">Hosted Shell</span>
              </div>
              <div className="onboard__beta-text">
                <p>
                  Shell is currently a beta feature on OpenRouter. The API and
                  environment behavior may change.
                </p>
                <p>
                  Commands run in an isolated container that may sleep after
                  idle time. Sandbox execution may add a small charge to each
                  request on top of model token cost.
                </p>
                <p>
                  Termio always shows real output from the Shell tool — it does
                  not fabricate results.
                </p>
              </div>
            </div>
            <div className="onboard__actions">
              <button
                className="onboard__btn onboard__btn--ghost"
                onClick={() => go("what", -1)}
              >
                Back
              </button>
              <button
                className="onboard__btn onboard__btn--primary"
                onClick={() => go("key", 1)}
              >
                Continue
              </button>
            </div>
          </div>
        )}

        {step === "key" && (
          <div className={cx("onboard__step", leaving && "leaving")}>
            <div className="onboard__eyebrow">Connect</div>
            <h1 className="onboard__title">
              OpenRouter <span className="accent">API key</span>
            </h1>
            <div className="onboard__lede">
              <p>
                Your key is stored locally in this browser only and sent
                directly to OpenRouter.
              </p>
            </div>

            <div className="onboard__field">
              <label className="onboard__label" htmlFor="or-key">
                API key
              </label>
              <div className="onboard__input-wrap">
                <input
                  id="or-key"
                  ref={inputRef}
                  className="onboard__input"
                  type={reveal ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setVerifyState("idle");
                    setVerifyMsg("");
                  }}
                  placeholder="sk-or-v1-…"
                  autoComplete="off"
                  spellCheck={false}
                  autoCapitalize="off"
                />
                <button
                  type="button"
                  className="onboard__input-toggle"
                  onClick={() => setReveal((r) => !r)}
                  tabIndex={-1}
                >
                  {reveal ? "hide" : "show"}
                </button>
              </div>
              <div className="onboard__key-hint">
                Get one at{" "}
                <a href="https://openrouter.ai/keys" target="_blank" rel="noreferrer">
                  openrouter.ai/keys
                </a>
                . Stored only on this device.
              </div>
              <div
                className={cx(
                  "onboard__verify",
                  verifyState === "ok" && "onboard__verify--ok",
                  verifyState === "err" && "onboard__verify--err",
                  verifyState === "busy" && "onboard__verify--busy"
                )}
              >
                {verifyState === "busy" && <span className="onboard__spinner" />}
                {verifyState !== "idle" && verifyMsg}
              </div>
            </div>

            <div className="onboard__actions">
              <button
                className="onboard__btn onboard__btn--ghost"
                onClick={() => go("beta", -1)}
              >
                Back
              </button>
              <button
                className="onboard__btn"
                onClick={verify}
                disabled={verifyState === "busy" || !apiKey.trim()}
              >
                Verify
              </button>
              <button
                className="onboard__btn onboard__btn--primary"
                onClick={finish}
                disabled={!apiKey.trim() && !settings.apiKey}
              >
                Start
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
