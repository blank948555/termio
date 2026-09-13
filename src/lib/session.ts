import { uid } from "./utils";

const SESSION_KEY = "termio:session:v1";

export type SessionMeta = {
  containerId: string;
  sessionId: string;
  createdAt: number;
};

export function loadSession(): SessionMeta | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SessionMeta;
  } catch {
    return null;
  }
}

export function ensureSession(): SessionMeta {
  const existing = loadSession();
  if (existing) return existing;
  const meta: SessionMeta = {
    containerId: `termio-${uid()}`,
    sessionId: `sess-${uid()}`,
    createdAt: Date.now(),
  };
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(meta));
  } catch {
    // ignore
  }
  return meta;
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}
