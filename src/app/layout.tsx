import type { Metadata } from "next";
import { ThemeInit } from "@/components/ThemeInit";
import "./globals.css";

export const metadata: Metadata = {
  title: "PJ140 Wiki付与",
  description: "PJ140 Wiki付与 行作業ビュー",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body>
        <ThemeInit />
        {children}
      </body>
    </html>
  );
}
