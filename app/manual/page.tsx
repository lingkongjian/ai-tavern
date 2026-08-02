import type { Metadata } from "next";
import Link from "next/link";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MarkdownDocument } from "./Markdown文档";

export const metadata: Metadata = {
  title: "操作手册 · AI 酒馆",
  description: "AI 酒馆本地开发版的完整中文操作手册。",
};

export default async function ManualPage() {
  const source = await readFile(
    join(process.cwd(), "public", "使用手册", "AI酒馆操作手册.md"),
    "utf8",
  );

  return (
    <main className="manual-page">
      <nav className="manual-page-actions" aria-label="手册操作">
        <Link href="/">← 返回酒馆首页</Link>
        <a href="/使用手册/AI酒馆操作手册.md" download>
          下载 Markdown 原文
        </a>
      </nav>
      <article className="manual-document">
        <MarkdownDocument source={source} />
      </article>
    </main>
  );
}
