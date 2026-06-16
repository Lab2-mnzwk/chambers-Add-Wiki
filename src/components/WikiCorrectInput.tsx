"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchLinkPreviewTitleClient } from "@/lib/link-preview-client";
import { isHttpUrl } from "@/lib/columns";
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

  // 行表示時（三つ組が変わったら）に候補を先読みする（fetchSuggestions は
  // tripletName / tripletWiki / indexRows が変わると再生成される）。
  useEffect(() => {
    // 行表示・三つ組変更時は候補を先読みするが、ドロップダウンは開かない。
    // 件数は欄内の「候補N件」バッジで示し、クリック/フォーカスで展開する（乱立防止）。
    setOpen(false);
    if (!tripletName.trim()) {
      setSuggestions([]);
      return;
    }
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
        // URL でない候補（「-」＝該当なし）はプレビュー取得しない。
        const title = isHttpUrl(s.correctWiki)
          ? await fetchLinkPreviewTitleClient(s.correctWiki)
          : "";
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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("keydown", onKey);
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
        <div
          className={styles.menu}
          style={{
            position: "fixed",
            top: menuPos.top,
            left: menuPos.left,
            width: menuPos.width,
          }}
        >
          <button
            type="button"
            className={styles.menuHeader}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setOpen(false)}
            title="閉じる（候補件数表示に戻す）"
          >
            候補 {suggestions.length} 件 ▴
          </button>
          <ul className={styles.suggestions} role="listbox">
            {suggestions.map((s) => (
              <li key={s.correctWiki || "__blank_correct__"}>
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
                    {s.correctWiki === ""
                      ? "Wiki値正しい"
                      : s.correctWiki === "-"
                      ? "「-」（Wiki該当なし）"
                      : titles[s.correctWiki]
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
        </div>
      )}
      {tripletName.trim() && !loading && !open && (
        suggestions.length > 0 ? (
          <button
            type="button"
            className={styles.badge}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setOpen(true);
              updateMenuPos();
            }}
          >
            候補 {suggestions.length} 件 ▾
          </button>
        ) : (
          <span className={styles.badgeEmpty}>履歴候補なし</span>
        )
      )}
    </div>
  );
}
