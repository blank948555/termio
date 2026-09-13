import type { ModelInfo } from "./models";

const BASE = "https://openrouter.ai/api/v1";

export type Outcome =
  | { type: "exit"; exit_code: number }
  | { type: "timeout" };

export type ShellResultEntry = {
  stdout: string;
  stderr: string;
  outcome: Outcome;
};

export type ReasoningItem = {
  type: "reasoning";
  text: string;
  id: string;
};

export type ParsedOutput = {
  textParts: string[];
  reasoningParts: string[];
  shellCalls: { id: string; commands: string[] }[];
  shellOutputs: ShellResultEntry[];
  rawOutput: unknown[];
};

export type ResponsesUsage = {
  input_tokens: number | null;
  output_tokens: number | null;
  total_tokens: number | null;
  cost: number | null;
};

export type ResponsesResult = {
  output: ParsedOutput;
  usage: ResponsesUsage | null;
  model: string | null;
  id: string | null;
  rawOutput: unknown[];
};

export type TermioErrorKind =
  | "auth"
  | "credits"
  | "rate_limit"
  | "shell_unavailable"
  | "no_compatible_endpoint"
  | "tool_unsupported"
  | "network"
  | "session"
  | "server"
  | "request"
  | "unknown";

export class TermioError extends Error {
  kind: TermioErrorKind;
  status: number;
  raw: unknown;
  constructor(kind: TermioErrorKind, message: string, status = 0, raw?: unknown) {
    super(message);
    this.name = "TermioError";
    this.kind = kind;
    this.status = status;
    this.raw = raw;
  }
}

function authHeaders(apiKey: string): HeadersInit {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "https://termio.lol",
    "X-Title": "Termio",
  };
}

export async function listModels(apiKey: string): Promise<ModelInfo[]> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/models`, { headers: authHeaders(apiKey) });
  } catch {
    throw new TermioError("network", "Network error while fetching models.", 0);
  }
  if (!res.ok) {
    throw classifyHttp(res.status, "Failed to fetch model catalog.", await safeText(res));
  }
  const data = await res.json();
  const list = data?.data;
  if (!Array.isArray(list)) return [];
  return list as ModelInfo[];
}

export type RunOptions = {
  apiKey: string;
  modelId: string;
  input: unknown[];
  containerId: string;
  sessionId: string;
  reasoning: boolean;
  signal?: AbortSignal;
};

export async function runShell(opts: RunOptions): Promise<ResponsesResult> {
  const body: Record<string, unknown> = {
    model: opts.modelId,
    input: opts.input,
    tools: [
      {
        type: "openrouter:shell",
        parameters: {
          engine: "openrouter",
          environment: {
            type: "container_reference",
            container_id: opts.containerId,
          },
        },
      },
    ],
    tool_choice: "auto",
    session_id: opts.sessionId,
  };
  if (opts.reasoning) {
    body.reasoning = { effort: "medium" };
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}/responses`, {
      method: "POST",
      headers: authHeaders(opts.apiKey),
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new TermioError("unknown", "Request cancelled.", 0);
    }
    throw new TermioError("network", "Network error while contacting OpenRouter.", 0);
  }

  if (!res.ok) {
    throw classifyHttp(res.status, "OpenRouter request failed.", await safeText(res));
  }

  const data = await res.json();
  if (data?.error) {
    throw classifyError(data.error, res.status);
  }
  const outputArr = Array.isArray(data?.output) ? data.output : [];
  const parsed = parseOutput(outputArr);
  return {
    output: parsed,
    usage: normalizeUsage(data?.usage),
    model: data?.model ?? null,
    id: data?.id ?? null,
    rawOutput: outputArr,
  };
}

export async function validateKey(apiKey: string): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/models`, { headers: authHeaders(apiKey) });
  } catch {
    throw new TermioError("network", "Network error while verifying key.", 0);
  }
  if (res.status === 401 || res.status === 403) return false;
  if (!res.ok) throw classifyHttp(res.status, "Could not verify key.", await safeText(res));
  return true;
}

function normalizeUsage(u: unknown): ResponsesUsage | null {
  if (!u || typeof u !== "object") return null;
  const o = u as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === "number" ? v : null;
  return {
    input_tokens: num(o.input_tokens),
    output_tokens: num(o.output_tokens),
    total_tokens: num(o.total_tokens),
    cost: num(o.cost),
  };
}

function parseOutput(arr: unknown[]): ParsedOutput {
  const textParts: string[] = [];
  const reasoningParts: string[] = [];
  const shellCalls: { id: string; commands: string[] }[] = [];
  const shellOutputs: ShellResultEntry[] = [];

  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const it = item as Record<string, unknown>;
    const type = it.type as string | undefined;

    if (type === "message") {
      const content = it.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          const ct = c as Record<string, unknown>;
          if (ct?.type === "output_text" && typeof ct.text === "string") {
            textParts.push(ct.text);
          } else if (ct?.type === "text" && typeof ct.text === "string") {
            textParts.push(ct.text);
          }
        }
      }
    } else if (type === "reasoning") {
      const summary = it.summary;
      if (Array.isArray(summary)) {
        for (const s of summary) {
          const st = s as Record<string, unknown>;
          if (typeof st?.text === "string" && st.text.trim()) {
            reasoningParts.push(st.text);
          }
        }
      }
      const content = it.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          const ct = c as Record<string, unknown>;
          if (typeof ct?.text === "string" && ct.text.trim()) {
            reasoningParts.push(ct.text);
          }
        }
      }
    } else if (
      type === "openrouter:shell" ||
      type === "shell_call" ||
      type === "function_call"
    ) {
      const action = (it.action ?? it.arguments ?? it.parameters) as
        | Record<string, unknown>
        | string
        | undefined;
      let commands: string[] = [];
      if (action && typeof action === "object") {
        const c = (action as Record<string, unknown>).commands;
        if (Array.isArray(c)) {
          commands = c.filter((x): x is string => typeof x === "string");
        }
      } else if (typeof action === "string") {
        try {
          const parsed = JSON.parse(action);
          if (Array.isArray(parsed?.commands)) {
            commands = (parsed.commands as unknown[]).filter(
              (x): x is string => typeof x === "string"
            );
          }
        } catch {
          // ignore
        }
      }
      if (commands.length) {
        shellCalls.push({ id: String(it.id ?? ""), commands });
      }
    } else if (
      type === "shell_call_output" ||
      type === "openrouter_shell_tool_result" ||
      type === "function_call_output"
    ) {
      const out = it.output ?? it.results;
      if (Array.isArray(out)) {
        for (const e of out) {
          const en = e as Record<string, unknown>;
          if (!en || typeof en !== "object") continue;
          shellOutputs.push({
            stdout: typeof en.stdout === "string" ? en.stdout : "",
            stderr: typeof en.stderr === "string" ? en.stderr : "",
            outcome: normalizeOutcome(en.outcome),
          });
        }
      } else if (out && typeof out === "object") {
        const en = out as Record<string, unknown>;
        if (Array.isArray(en.output)) {
          for (const e of en.output) {
            const en2 = e as Record<string, unknown>;
            if (!en2 || typeof en2 !== "object") continue;
            shellOutputs.push({
              stdout: typeof en2.stdout === "string" ? en2.stdout : "",
              stderr: typeof en2.stderr === "string" ? en2.stderr : "",
              outcome: normalizeOutcome(en2.outcome),
            });
          }
        }
      }
    }
  }

  return {
    textParts,
    reasoningParts,
    shellCalls,
    shellOutputs,
    rawOutput: arr,
  };
}

function normalizeOutcome(o: unknown): Outcome {
  if (!o || typeof o !== "object") return { type: "exit", exit_code: 0 };
  const oc = o as Record<string, unknown>;
  if (oc.type === "timeout") return { type: "timeout" };
  if (typeof oc.exit_code === "number") return { type: "exit", exit_code: oc.exit_code };
  return { type: "exit", exit_code: 0 };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

function classifyError(err: unknown, status: number): TermioError {
  const e = err as Record<string, unknown>;
  const code = String(e?.code ?? e?.error_type ?? "").toLowerCase();
  const message = String(e?.message ?? "OpenRouter returned an error.");
  const lower = message.toLowerCase();

  if (code.includes("auth") || status === 401 || status === 403) {
    return new TermioError("auth", "OpenRouter authentication failed. Check your API key.", status, err);
  }
  if (code.includes("payment") || code.includes("credit") || status === 402) {
    return new TermioError("credits", "Insufficient OpenRouter credits for this request.", status, err);
  }
  if (code.includes("rate_limit") || status === 429) {
    return new TermioError("rate_limit", "OpenRouter rate limit reached. Wait a moment and retry.", status, err);
  }
  if (lower.includes("shell") || lower.includes("tool") || lower.includes("server tool")) {
    return new TermioError("shell_unavailable", "OpenRouter Shell is unavailable right now.", status, err);
  }
  if (lower.includes("no endpoints") || lower.includes("no compatible") || lower.includes("endpoint")) {
    return new TermioError("no_compatible_endpoint", "No compatible endpoint is available for this model.", status, err);
  }
  if (lower.includes("tool") && lower.includes("support")) {
    return new TermioError("tool_unsupported", "This model does not support the required Shell tool behavior.", status, err);
  }
  if (code.includes("server") || status >= 500) {
    return new TermioError("server", "OpenRouter had a server error. Try again shortly.", status, err);
  }
  return new TermioError("request", message || "OpenRouter rejected the request.", status, err);
}

function classifyHttp(status: number, fallback: string, raw: string): TermioError {
  if (status === 401 || status === 403) {
    return new TermioError("auth", "OpenRouter authentication failed. Check your API key.", status);
  }
  if (status === 402) {
    return new TermioError("credits", "Insufficient OpenRouter credits for this request.", status);
  }
  if (status === 429) {
    return new TermioError("rate_limit", "OpenRouter rate limit reached. Wait a moment and retry.", status);
  }
  if (status === 404) {
    return new TermioError("no_compatible_endpoint", "No compatible endpoint found for this model.", status);
  }
  if (status >= 500) {
    return new TermioError("server", "OpenRouter had a server error. Try again shortly.", status);
  }
  let hint = fallback;
  try {
    const j = JSON.parse(raw);
    if (j?.error?.message) hint = String(j.error.message);
  } catch {
    if (raw) hint = fallback;
  }
  return new TermioError("request", hint, status);
}

export const SYSTEM_INSTRUCTION = `You are Termio, a hosted Linux shell interface. You operate through the openrouter:shell tool. Every command the user wants must be executed with the shell tool — never simulate, guess, or fabricate command output from your own knowledge. Only report output that the shell tool actually returns.

Rules:
- Translate natural-language requests into real shell commands and run them with the shell tool.
- Run commands one batch at a time, read the real stdout/stderr/exit code, then continue.
- Keep prose minimal and separate from command output. Do not narrate fake terminal sessions.
- If a command fails, show the real stderr and exit code; do not invent a successful result.
- The environment is a remote, temporary, sandboxed Linux container — not the user's machine.
- Do not claim persistence that the environment does not provide.`;
