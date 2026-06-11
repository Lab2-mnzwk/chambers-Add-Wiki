import Script from "next/script";

/** 初回描画前にテーマを適用（チラつき防止） */
export function ThemeInit() {
  const code = `
(function () {
  var key = "wikiWorkTheme";
  var mode = localStorage.getItem(key) || "system";
  var resolved = mode;
  if (mode === "system") {
    resolved = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  document.documentElement.setAttribute("data-theme", resolved);
  document.documentElement.setAttribute("data-theme-mode", mode);
})();
`;
  return (
    <Script
      id="theme-init"
      strategy="beforeInteractive"
      dangerouslySetInnerHTML={{ __html: code }}
    />
  );
}
