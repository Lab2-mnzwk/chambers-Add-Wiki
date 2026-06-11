"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchLinkPreviewTitleClient } from "@/lib/link-preview-client";
import type { WikiHistorySuggestion } from "@/lib/wiki-history";
import styles from "./WikiCorrectInput.module.css";

type Props = {
  value: string;
  onChange: (value: string) => void;
  tripletName: string;
  tripletWiki: string;
  indexRows: number;
};

export function WikiCorrectInput({
  value,
  onChange,
  tripletName,
  tripletWiki,
  indexRows,
}: Props) {
  const [suggestions, setSuggestions] = useState<WikiHistorySuggestion[]>([]);
  const [titles, setTitles] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchSuggestions = useCallback(
    async (query: string) => {
      if (!tripletName.trim()) {
        setSuggestions([]);
        return;
      }
      setLoading(true);
      try {
        const params = new URLSearchParams({
          name: tripletName,
          wiki: tripletWiki,
          q: query,
          indexRows: String(indexRows),
        });
        const resp = await fetch(`/api/wiki-history?${params}`);
        if (!resp.ok) return;
        const data = (await resp.json()) as {
          suggestions: WikiHistorySuggestion[];
        };
        setSuggestions(data.suggestions ?? []);
      } finally {
        setLoading(false);
      }
    },
    [tripletName, tripletWiki, indexRows]
  );

  const scheduleFetch = useCallback(
    (query: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void fetchSuggestions(query);
      }, 250);
    },
    [fetchSuggestions]
  );

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    if (!suggestions.length) {
      setTitles({});
      return;
    }

    let cancelled = false;
    void Promise.all(
      suggestions.map(async (s) => {
        const title = await fetchLinkPreviewTitleClient(s.correctWiki);
        return [s.correctWiki, title] as const;
      })
    ).then((entries) => {
      if (!cancelled) setTitles(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, [suggestions]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <textarea
        className={styles.textarea}
        value={value}
        onFocus={() => {
          setOpen(true);
          void fetchSuggestions(value);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          scheduleFetch(e.target.value);
        }}
      />
      {open && suggestions.length > 0 && (
        <ul className={styles.suggestions} role="listbox">
          {suggestions.map((s) => (
            <li key={s.correctWiki}>
              <button
                type="button"
                className={styles.item}
                role="option"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange(s.correctWiki);
                  setOpen(false);
                }}
              >
                <div className={styles.url}>
                  {titles[s.correctWiki]
                    ? `${titles[s.correctWiki]}|${s.correctWiki}`
                    : s.correctWiki}
                </div>
                <div className={styles.meta}>
                  {s.match === "exact" ? "name+wiki 一致" : "name のみ一致"} ·{" "}
                  {s.count} 件
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && tripletName && suggestions.length === 0 && (
        <div className={styles.hint}>履歴候補なし</div>
      )}
    </div>
  );
}
