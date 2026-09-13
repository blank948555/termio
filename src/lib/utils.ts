export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function uid(prefix = ""): string {
  const r =
    (crypto as Crypto & { randomUUID?: () => string }).randomUUID?.() ??
    Math.random().toString(36).slice(2);
  return `${prefix}${r}`;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function formatCost(cost: number | null | undefined): string {
  if (cost == null || !isFinite(cost)) return "—";
  if (cost === 0) return "$0.00";
  if (cost < 0.01) return `$${cost.toFixed(5)}`;
  if (cost < 1) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

export function formatTokens(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return "—";
  if (n >= 1000) {
    const k = n / 1000;
    return k >= 1000 ? `${(k / 1000).toFixed(1)}M` : `${k.toFixed(k < 10 ? 1 : 0)}K`;
  }
  return String(n);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
