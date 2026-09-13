export type ModelPricing = {
  prompt?: string;
  completion?: string;
  request?: string;
};

export type ModelArchitecture = {
  modality?: string;
  input_modalities?: string[];
  output_modalities?: string[];
  tokenizer?: string;
  instruct_type?: string;
};

export type ModelInfo = {
  id: string;
  name: string;
  description?: string;
  context_length?: number;
  pricing?: ModelPricing;
  architecture?: ModelArchitecture;
  supported_parameters?: string[];
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
    is_moderated?: boolean;
  };
  created?: number;
  canonical_slug?: string;
};

function num(v: unknown): number {
  if (typeof v === "number" && isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (isFinite(n)) return n;
  }
  return NaN;
}

function tokenPricePerMillion(m: ModelInfo): number {
  const p = m.pricing;
  if (!p) return NaN;
  const prompt = num(p.prompt);
  const completion = num(p.completion);
  if (isNaN(prompt) && isNaN(completion)) return NaN;
  const blended = isNaN(completion) ? prompt : isNaN(prompt) ? completion : (prompt + completion) / 2;
  return blended * 1_000_000;
}

export function isFree(m: ModelInfo): boolean {
  const p = m.pricing;
  if (!p) return false;
  const prompt = num(p.prompt);
  const completion = num(p.completion);
  const request = num(p.request);
  const allZero =
    (!isNaN(prompt) ? prompt === 0 : true) &&
    (!isNaN(completion) ? completion === 0 : true) &&
    (!isNaN(request) ? request === 0 : true);
  return allZero;
}

export function hasToolSupport(m: ModelInfo): boolean {
  const params = m.supported_parameters ?? [];
  return params.some((p) => {
    const s = String(p).toLowerCase();
    return s === "tools" || s === "tool_choice";
  });
}

export function isShellCompatible(m: ModelInfo): boolean {
  const arch = m.architecture;
  if (!arch) return hasToolSupport(m);
  const out = arch.output_modalities ?? [];
  const okOutput =
    out.length === 0 ||
    out.some((o) => String(o).toLowerCase() === "text");
  return okOutput && hasToolSupport(m);
}

export function priceRank(m: ModelInfo): "free" | "cheap" | "standard" | "premium" {
  if (isFree(m)) return "free";
  const ppm = tokenPricePerMillion(m);
  if (isNaN(ppm)) return "standard";
  if (ppm <= 0.5) return "cheap";
  if (ppm <= 5) return "standard";
  return "premium";
}

export function isFast(m: ModelInfo): boolean {
  const id = m.id.toLowerCase();
  const name = (m.name ?? "").toLowerCase();
  return /(\bfast\b|mini|flash|nano|small|micro|lite|tiny|haiku|instant)/.test(
    `${id} ${name}`
  );
}

export function isPremium(m: ModelInfo): boolean {
  return priceRank(m) === "premium";
}

export function isCheap(m: ModelInfo): boolean {
  return priceRank(m) === "cheap" || isFree(m);
}

export type CategoryId =
  | "all"
  | "free"
  | "cheap"
  | "fast"
  | "premium"
  | "shell";

export type Category = {
  id: CategoryId;
  label: string;
  test: (m: ModelInfo) => boolean;
  dynamic: boolean;
};

export const CATEGORIES: Category[] = [
  { id: "all", label: "All", test: () => true, dynamic: false },
  { id: "shell", label: "Shell compatible", test: isShellCompatible, dynamic: true },
  { id: "free", label: "Free", test: isFree, dynamic: true },
  { id: "cheap", label: "Cheap", test: isCheap, dynamic: true },
  { id: "fast", label: "Fast", test: isFast, dynamic: true },
  { id: "premium", label: "Premium", test: isPremium, dynamic: true },
];

export function providerOf(m: ModelInfo): string {
  const i = m.id.indexOf("/");
  return i > 0 ? m.id.slice(0, i) : m.id;
}

export function shortName(m: ModelInfo): string {
  const i = m.id.indexOf("/");
  return i > 0 ? m.id.slice(i + 1) : m.id;
}

export function formatPrice(m: ModelInfo): string {
  if (isFree(m)) return "Free";
  const ppm = tokenPricePerMillion(m);
  if (isNaN(ppm)) return "—";
  if (ppm <= 0.01) return `$${ppm.toFixed(4)}/M`;
  if (ppm < 1) return `$${ppm.toFixed(3)}/M`;
  if (ppm < 10) return `$${ppm.toFixed(2)}/M`;
  return `$${ppm.toFixed(1)}/M`;
}

export function formatContext(m: ModelInfo): string {
  const ctx = m.context_length ?? m.top_provider?.context_length;
  if (!ctx) return "—";
  if (ctx >= 1000) {
    const k = Math.round(ctx / 1000);
    return `${k >= 1000 ? (k / 1000).toFixed(1).replace(/\.0$/, "") + "M" : k + "K"}`;
  }
  return String(ctx);
}

export function sortByRelevance(a: ModelInfo, b: ModelInfo): number {
  const sa = shellScore(a);
  const sb = shellScore(b);
  if (sa !== sb) return sb - sa;
  const pa = priceScore(a);
  const pb = priceScore(b);
  return pa - pb;
}

function shellScore(m: ModelInfo): number {
  let s = 0;
  if (isShellCompatible(m)) s += 2;
  if (hasToolSupport(m)) s += 1;
  if (isFree(m)) s += 0.5;
  return s;
}

function priceScore(m: ModelInfo): number {
  return tokenPricePerMillion(m);
}

export function searchModels(models: ModelInfo[], q: string): ModelInfo[] {
  const query = q.trim().toLowerCase();
  if (!query) return models;
  return models.filter((m) => {
    const hay = `${m.id} ${m.name ?? ""} ${providerOf(m)} ${m.description ?? ""}`.toLowerCase();
    return hay.includes(query);
  });
}
