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
  const [menuPos, setMenuPos] = useState<{
    top: number;
    left: number;
    width: number;
  } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 候補メニューはテーブルの overflow でクリップされるため position:fixed で
  // コンテナ外に描画する。テキストエリアの実座標へ追従させる。
  const MENU_MIN_WIDTH = 280;
  const updateMenuPos = useCallback(() => {
    const el = taRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, MENU_MIN_WIDTH);
    const left = Math.min(r.left, window.innerWidth - width - 8);
    setMenuPos({ top: r.bottom + 4, left: Math.max(8, left), width });
  }, []);

  const fetchSuggestions = useCallback(
    async (query: string): Promise<WikiHistorySuggestion[]> => {
      if (!tripletName.trim()) {
        setSuggestions([]);
        return [];
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
        if (!resp.ok) return [];
        const data = (await resp.json()) as {
          suggestions: WikiHistorySuggestion[];
        };
        const list = data.suggestions ?? [];
        setSuggestions(list);
        return list;
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

  // 行表示時（三つ組が変わったら）に候補を先読みし、候補があればドロップダウンを
  // 自動で開く。フォーカスを待たず、行を開くと同時に候補を表示する（fetchSuggestions は
  // tripletName / tripletWiki / indexRows が変わると再生成される）。
  useEffect(() => {
    if (!tripletName.trim()) return;
    // 名称がある三つ組は、候補の有無にかかわらず行表示と同時に開く。
    // 候補があれば一覧を、無ければ「履歴候補なし」を欄内に表示する。
    setOpen(true);
    void fetchSuggestions(value);
    // value は依存に含めない（入力中の再取得は onChange→scheduleFetch が担当）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchSuggestions]);

  // リンクプレビュー（タイトル）の取得はドロップダウンを開いた時のみ。
  // 先読みで全行・全候補のプレビューを大量取得しないようにする。
  useEffect(() => {
    if (!open || !suggestions.length) {
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
  }, [suggestions, open]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // 開いている間はスクロール/リサイズに合わせてメニュー位置を更新する。
  useEffect(() => {
    if (!open) {
      setMenuPos(null);
      return;
    }
    updateMenuPos();
    const onMove = () => updateMenuPos();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open, suggestions, updateMenuPos]);

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <textarea
        ref={taRef}
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
      {open && menuPos && suggestions.length > 0 && (
        <ul
          className={styles.suggestions}
          role="listbox"
          style={{
            position: "fixed",
            top: menuPos.top,
            left: menuPos.left,
            width: menuPos.width,
            right: "auto",
          }}
        >
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
      {open && menuPos && !loading && tripletName && suggestions.length === 0 && (
        <div
          className={styles.hint}
          style={{
            position: "fixed",
            top: menuPos.top,
            left: menuPos.left,
          }}
        >
          履歴候補なし
        </div>
      )}
    </div>
  );
}
