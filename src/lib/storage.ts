export type Settings = {
  apiKey: string;
  modelId: string;
  setupComplete: boolean;
  prefersReasoning: boolean;
  preserveWhitespace: boolean;
  fontSize: "sm" | "md" | "lg";
  strictTerminal: boolean;
};

const KEY = "termio:v1";

export const DEFAULT_SETTINGS: Settings = {
  apiKey: "",
  modelId: "",
  setupComplete: false,
  prefersReasoning: true,
  preserveWhitespace: true,
  fontSize: "md",
  strictTerminal: true,
};

function read(): Partial<Settings> {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Partial<Settings>;
  } catch {
    return {};
  }
}

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...read() };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...loadSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore quota / private mode failures silently; never surface the key
  }
  return next;
}

export function clearAll(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
