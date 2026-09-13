import { useEffect, useMemo, useRef, useState } from "react";
import "./modelpicker.css";
import type { ModelInfo } from "../lib/models";
import {
  CATEGORIES,
  formatContext,
  formatPrice,
  isFree,
  isShellCompatible,
  providerOf,
  searchModels,
  shortName,
  sortByRelevance,
  type CategoryId,
} from "../lib/models";
import { cx } from "../lib/utils";

type Props = {
  open: boolean;
  models: ModelInfo[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onClose: () => void;
  onRetry: () => void;
  mobile: boolean;
};

export default function ModelPicker({
  open,
  models,
  loading,
  error,
  selectedId,
  onSelect,
  onClose,
  onRetry,
  mobile,
}: Props) {
  const [cat, setCat] = useState<CategoryId>("shell");
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const cat of CATEGORIES) c[cat.id] = models.filter(cat.test).length;
    return c;
  }, [models]);

  const filtered = useMemo(() => {
    const activeCat = CATEGORIES.find((c) => c.id === cat);
    const base = activeCat ? models.filter(activeCat.test) : models;
    const searched = searchModels(base, query);
    return [...searched].sort(sortByRelevance);
  }, [models, cat, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, ModelInfo[]>();
    for (const m of filtered) {
      const p = providerOf(m);
      if (!map.has(p)) map.set(p, []);
      map.get(p)!.push(m);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  if (!open) return null;

  return (
    <>
      <div className="sheet-overlay" onClick={onClose} />
      <div className={cx("sheet", mobile ? "bottom" : "center")} role="dialog" aria-label="Select model">
        <div className="sheet__header">
          <div className="sheet__title-row">
            <span className="sheet__title">Select model</span>
            <button className="sheet__close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
          <div className="sheet__search">
            <SearchIcon />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search model or provider"
              spellCheck={false}
              autoCapitalize="off"
              autoComplete="off"
            />
          </div>
          <div className="sheet__cats">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                className={cx("sheet__cat", cat === c.id && "sheet__cat--active")}
                onClick={() => setCat(c.id)}
              >
                {c.label}
                <span className="sheet__cat-count">{counts[c.id] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="sheet__err">
            {error}{" "}
            <button
              onClick={onRetry}
              style={{ color: "var(--text-2)", textDecoration: "underline" }}
            >
              Retry
            </button>
          </div>
        )}

        <div className="sheet__list" ref={listRef}>
          {loading && (
            <div className="sheet__loading">
              <span className="onboard__spinner" style={{ width: 14, height: 14 }} />
              Loading models…
            </div>
          )}
          {!loading && !error && filtered.length === 0 && (
            <div className="sheet__empty">
              {models.length === 0
                ? "No models returned by OpenRouter."
                : "No models match this filter."}
            </div>
          )}
          {!loading &&
            grouped.map(([provider, items]) => (
              <div key={provider}>
                <div className="sheet__group-label">{provider}</div>
                {items.map((m) => {
                  const active = m.id === selectedId;
                  const shell = isShellCompatible(m);
                  return (
                    <button
                      key={m.id}
                      className={cx("sheet__model", active && "sheet__model--active")}
                      onClick={() => {
                        onSelect(m.id);
                        onClose();
                      }}
                    >
                      <div className="sheet__model-main">
                        <div className="sheet__model-name">{shortName(m)}</div>
                        <div className="sheet__model-id">{m.id}</div>
                        <div className="sheet__model-meta">
                          <span className={cx("tag", isFree(m) && "tag--free")}>
                            {formatPrice(m)}
                          </span>
                          <span className="tag">{formatContext(m)} ctx</span>
                          {shell && <span className="tag tag--shell">shell</span>}
                        </div>
                      </div>
                      <span className="sheet__model-check">✓</span>
                    </button>
                  );
                })}
              </div>
            ))}
        </div>
      </div>
    </>
  );
}

function SearchIcon() {
  return (
    <svg className="sheet__search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}
