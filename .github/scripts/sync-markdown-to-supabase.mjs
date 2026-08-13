#!/usr/bin/env node
/**
 * 將一篇含 Front Matter 的 Markdown 講稿同步至 Supabase articles。
 *
 * 安全規則：
 * - 預設透過 --dry-run 僅驗證與預覽，不寫入資料庫。
 * - 每次實際同步都強制寫入 publication_status = review。
 * - 已 published 的文章不可由本腳本覆寫，避免覆蓋正式公開內容。
 * - 不發送 LINE OA 推播；推播狀態一律為 not_requested。
 */

import { readFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import process from 'node:process';

const REQUIRED_FIELDS = [
  'id', 'collection', 'collection_name', 'chapter', 'chapter_name',
  'episode', 'sort_order', 'slug', 'content_type', 'status', 'visibility',
  'title', 'subtitle', 'summary', 'tags', 'line_push', 'line_push_copy',
  'source_version',
];

const CHAPTER_KEY_MAP = {
  nanshan: 'nan',
  xishan: 'xi',
  beishan: 'bei',
  dongshan: 'dong',
  zhongshan: 'zhong',
  haiwai: 'haiwai',
  hainei: 'hainei',
  'hainei-final': 'hainei',
  dahuang: 'dahuang',
};

function getArgument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function fail(message) {
  console.error(`同步失敗：${message}`);
  process.exit(1);
}

function parseScalar(raw) {
  const value = raw.trim();
  if (value === 'null') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  if (value.startsWith('"') || value.startsWith('[') || value.startsWith('{')) {
    return JSON.parse(value);
  }
  return value;
}

function parseMarkdown(source, filename) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
  if (!match) fail(`${filename} 缺少合法 Front Matter。`);

  const fields = {};
  for (const line of match[1].split('\n')) {
    if (!line.trim()) continue;
    const separator = line.indexOf(':');
    if (separator === -1) fail(`${filename} 的 Front Matter 有無法辨識的欄位。`);
    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1);
    fields[key] = parseScalar(rawValue);
  }

  const missing = REQUIRED_FIELDS.filter((field) => !(field in fields));
  if (missing.length) fail(`${filename} 缺少必要欄位：${missing.join(', ')}。`);
  if (fields.collection !== 'shanhaijing') fail('目前 P1 僅允許同步 collection: shanhaijing。');
  if (!Array.isArray(fields.tags)) fail('tags 必須為陣列。');
  if (!CHAPTER_KEY_MAP[fields.chapter]) fail(`找不到 chapter ${fields.chapter} 的 Supabase chapter_key 對應。`);

  return { fields, body: match[2] };
}

function markdownToSections(body) {
  const lines = body.split('\n');
  const sections = [];
  let current = { heading: '講演正文', body: [] };

  const pushCurrent = () => {
    const paragraphs = current.body
      .join('\n')
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (paragraphs.length) sections.push({ heading: current.heading, body: paragraphs });
  };

  for (const line of lines) {
    if (/^#\s+/.test(line)) continue; // H1 已由 title 管理。
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      pushCurrent();
      current = { heading: heading[1].trim(), body: [] };
      continue;
    }
    current.body.push(line);
  }
  pushCurrent();
  return sections;
}

async function callSupabase(path, options = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) fail('缺少 SUPABASE_URL 或 SUPABASE_SECRET_KEY GitHub Secret。');

  const response = await fetch(`${url}${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    fail(`Supabase API 回應 ${response.status}：${text.slice(0, 500)}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function main() {
  const contentPath = getArgument('--path');
  const dryRun = process.argv.includes('--dry-run');
  if (!contentPath) fail('請指定 --path <Markdown 檔案路徑>。');
  if (!contentPath.endsWith('.md')) fail('僅允許同步 .md 檔案。');

  const repositoryRoot = resolve(process.cwd());
  const absolutePath = resolve(repositoryRoot, contentPath);
  const safeRelativePath = relative(repositoryRoot, absolutePath);
  if (safeRelativePath.startsWith(`..${sep}`) || safeRelativePath === '..') {
    fail('文章路徑必須位於 Repository 內。');
  }

  const source = await readFile(absolutePath, 'utf8');
  const { fields, body } = parseMarkdown(source, safeRelativePath);
  const sections = markdownToSections(body);
  const sourceCommit = process.env.GITHUB_SHA ?? 'local-dry-run';

  const payload = {
    source_article_id: fields.id,
    source_repo: process.env.GITHUB_REPOSITORY ?? 'bioitrust0414-collab/hsieh_dauo_repo',
    source_path: safeRelativePath,
    source_commit: sourceCommit,
    source_version: fields.source_version,
    slug: fields.slug,
    collection: fields.collection,
    chapter_key: CHAPTER_KEY_MAP[fields.chapter],
    episode: fields.episode,
    title_zh: fields.title,
    title_en: null,
    subtitle_zh: fields.subtitle,
    subtitle_en: null,
    summary_zh: fields.summary,
    content_markdown: body,
    content_type: fields.content_type,
    visibility: fields.visibility,
    publication_status: 'review',
    is_published: false,
    published_at: null,
    tags: fields.tags,
    sort_order: fields.sort_order,
    sections,
    note_zh: null,
    note_en: null,
    line_push_status: 'not_requested',
    line_push_copy: fields.line_push_copy,
    cover_image: fields.cover_image,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  console.log(`文章：${payload.title_zh}`);
  console.log(`來源：${payload.source_path} @ ${payload.source_commit}`);
  console.log(`目標：articles / publication_status = review`);
  console.log(`章節：${fields.chapter_name} (${payload.chapter_key})，解析段落數：${sections.length}`);

  if (dryRun) {
    console.log('DRY RUN：驗證完成，未寫入 Supabase，未公開網站，未發送 LINE OA 推播。');
    return;
  }

  const existing = await callSupabase(
    `/rest/v1/articles?select=id,publication_status&source_article_id=eq.${encodeURIComponent(payload.source_article_id)}&limit=1`,
    { method: 'GET' },
  );

  if (existing?.[0]?.publication_status === 'published') {
    fail('目標文章已是 published；請先於管理端建立新修訂流程，避免自動覆寫公開內容。');
  }

  const result = await callSupabase('/rest/v1/articles?on_conflict=source_article_id', {
    method: 'POST',
    headers: {
      Prefer: 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify(payload),
  });

  const article = result?.[0];
  if (!article?.id) fail('Supabase 未回傳文章 ID。');
  console.log(`同步完成：文章 UUID ${article.id}，狀態 ${article.publication_status}。`);
  console.log('安全確認：未公開網站，未發送 LINE OA 推播。');
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
