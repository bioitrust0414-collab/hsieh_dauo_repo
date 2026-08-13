# 手動內容同步操作指南

本流程將 `hsieh_dauo_repo` 的單篇 Markdown 講稿同步至 Supabase `articles` 資料表，並固定寫入 `review` 狀態。同步不會直接公開到官網，也不會發送 LINE OA 推播。

> 第一次使用時，請先在 GitHub Repository 的 **Settings → Secrets and variables → Actions** 建立兩個 Repository secrets。這兩個密鑰只供 GitHub Actions 使用，絕對不可寫入 Markdown、程式碼或前端環境變數。

| Secret 名稱 | 填入內容 | 取得位置 |
| :--- | :--- | :--- |
| `SUPABASE_URL` | Supabase Project URL | hsieh0126 → Connect 或 Settings → API |
| `SUPABASE_SECRET_KEY` | Supabase 的 server-side secret key | hsieh0126 → Settings → API Keys；僅限伺服器端使用 |

## 操作步驟

1. 開啟 `hsieh_dauo_repo` 的 **Actions** 分頁。
2. 在左側選擇「手動同步講稿至 Supabase」。
3. 點選 **Run workflow**。
4. 選擇欲同步的文章，例如 `第01次_南山經_彙整與討論.md`。
5. 第一次請保持 **dry_run = true**，系統僅檢查 Front Matter、文章路徑與段落解析，不會寫入資料庫。
6. 檢查 Actions 執行摘要。確認文章名稱、來源路徑、章節與解析段落數正確後，再次執行同一工作流程，將 **dry_run = false**。
7. 實際同步後，文章會寫入 Supabase，狀態固定為 `review`。此時仍不會出現在公開網站，也不會通知 LINE 好友。

## 發布生命週期

```text
draft（文案庫原稿）
  → review（已同步，等待管理者審核）
  → approved（核准待發布）
  → published（網站公開）
  → archived（封存）
```

LINE 推播是獨立流程。即使文章已是 `published`，也必須在管理端建立推播草稿並確認，才會送出 Flex Message。

## 安全規則

- 同步腳本若偵測到資料庫中的同一篇文章已是 `published`，會拒絕覆寫，防止意外修改公開內容。
- 同一個 `source_article_id` 會以更新方式同步，不會產生重複文章。
- 同步時記錄 GitHub commit SHA、原始檔案路徑與來源 Repository，讓每次發布都可追溯。
- 需要修改已公開文章時，建議在文案庫新增修訂版本，先同步為新的 `review` 內容，再經審核發布。

## 本機預覽測試

如只需檢查文章格式，可在 Repository 根目錄執行：

```bash
node .github/scripts/sync-markdown-to-supabase.mjs \
  --path "第01次_南山經_彙整與討論.md" \
  --dry-run
```

本機 `--dry-run` 不需要任何 Supabase 金鑰，也不會寫入資料庫。
