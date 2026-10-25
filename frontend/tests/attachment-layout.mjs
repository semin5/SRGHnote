import assert from "node:assert/strict";
import { chromium } from "playwright";

// Run with `npm run dev -- --host 127.0.0.1`; all APIs are mocked below.
const browser = await chromium.launch({ headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
let nextFileId = 1;
const now = "2026-10-14T10:00:00";
const root = { id: 1, parent_id: null, title: "테스트 폴더", content_json: '{"type":"doc","content":[{"type":"paragraph"}]}',
  version: 1, created_by: "test", updated_by: "test", created_by_name: "테스트", updated_by_name: "테스트",
  created_at: now, updated_at: now, locked_for_others: false };
let document = { ...root, id: 2, parent_id: 1, title: "PDF 배치 테스트" };
await context.route("**/it/api/auth/me", (route) => route.fulfill({ json: { username: "test", displayName: "테스트", role: "SUPER_ADMIN" } }));
await context.route("**/note/api/**", async (route) => {
  const { pathname } = new URL(route.request().url());
  const method = route.request().method();
  if (pathname === "/note/api/documents" && method === "GET")
    return route.fulfill({ json: [root, document] });
  if (pathname === "/note/api/documents/order") return route.fulfill({ json: [1] });
  if (pathname === "/note/api/documents/preferences") return route.fulfill({ json: { pageSize: 20 } });
  if (pathname === "/note/api/documents/2" && method === "GET") return route.fulfill({ json: document });
  if (pathname === "/note/api/documents/2" && method === "PUT") {
    const body = route.request().postDataJSON();
    document = { ...document, title: body.title, content_json: body.contentJson, version: document.version + 1 };
    return route.fulfill({ json: document });
  }
  if (pathname === "/note/api/documents/2/files" && method === "POST") {
    const id = nextFileId++;
    return route.fulfill({ json: { id, url: `/note/api/files/${id}`, size_bytes: 1024 } });
  }
  if (/^\/note\/api\/files\/\d+\/preview$/.test(pathname))
    return route.fulfill({ contentType: "application/pdf", body: "%PDF-1.4\n%%EOF" });
  if (pathname === "/note/api/events") return route.fulfill({ contentType: "text/event-stream", body: "" });
  return route.fulfill({ status: 404, body: pathname });
});

try {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5184/note/?page=2");
  await page.locator(".notion-editor").waitFor();
  assert.ok(await page.locator('.notion-tree-item[data-document-id="1"]').evaluate((item) =>
    item.classList.contains("selected")), "the top-level folder stays highlighted on a child page");
  const search = page.getByRole("searchbox", { name: "전체 문서 검색" });
  await search.fill("PDF");
  await page.getByText("연관 검색어").waitFor();
  await search.press("Enter");
  await page.locator(".notion-results-view").waitFor();
  assert.equal(new URL(page.url()).searchParams.get("search"), "PDF", "search results have a shareable URL");
  assert.equal(await page.locator(".notion-result-row").count(), 1, "title matches appear in global results");
  await page.locator(".notion-result-row").click();
  await page.locator(".notion-editor").waitFor();
  assert.ok(await page.locator('.notion-tree-item[data-document-id="1"]').evaluate((item) =>
    item.classList.contains("selected")), "the parent folder is highlighted after opening a search result");
  const pdf = { mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF") };
  await page.locator('input[type="file"][accept*="pdf"]').setInputFiles([
    { ...pdf, name: "first.pdf" }, { ...pdf, name: "second.pdf" },
  ]);
  await page.locator(".notion-pdf-block").nth(1).waitFor();
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["%PDF-1.4\n%%EOF"], "third.pdf", { type: "application/pdf" }));
    transfer.items.add(new File(["%PDF-1.4\n%%EOF"], "fourth.pdf", { type: "application/pdf" }));
    document.querySelector(".notion-editor").dispatchEvent(new DragEvent("drop", {
      bubbles: true, cancelable: true, dataTransfer: transfer,
    }));
  });
  await page.locator(".notion-pdf-block").nth(3).waitFor();
  await page.waitForTimeout(1600);
  const layout = await page.locator(".notion-pdf-block").evaluateAll((blocks) => blocks.map((block) => {
    const rect = block.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: rect.height };
  }));
  for (let index = 1; index < layout.length; index++)
    assert.ok(layout[index].top >= layout[index - 1].bottom, `PDF blocks overlap: ${JSON.stringify(layout)}`);
  const finalParagraphTop = await page.locator(".notion-editor p").last().evaluate((element) => element.getBoundingClientRect().top);
  assert.ok(finalParagraphTop >= layout.at(-1).bottom, "content after PDF blocks remains visible");
  const savedTypes = JSON.parse(document.content_json).content.map((block) => block.type);
  assert.equal(savedTypes.filter((type) => type === "pdfBlock").length, 4, "all PDF blocks saved");
  await page.evaluate(() => {
    const preview = document.querySelector(".notion-pdf-block iframe");
    // A PDF viewer or node view can consume a bubbling drop event.
    preview.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
    }, { once: true });
    const transfer = new DataTransfer();
    transfer.items.add(new File(["spreadsheet"], "dropped.xlsx", { type: "application/octet-stream" }));
    preview.dispatchEvent(new DragEvent("drop", {
      bubbles: true, cancelable: true, dataTransfer: transfer,
    }));
  });
  await page.waitForTimeout(1600);
  const droppedTypes = JSON.parse(document.content_json).content.map((block) => block.type);
  assert.equal(droppedTypes.filter((type) => type === "fileBlock").length, 1,
    "a file dropped on a PDF preview is attached even when the viewer consumes the event");
  await page.locator('input[type="file"]:not([accept])').setInputFiles([
    { name: "report.xlsx", mimeType: "application/octet-stream", buffer: Buffer.from("spreadsheet") },
    { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("notes") },
    { name: "archive.zip", mimeType: "application/zip", buffer: Buffer.from("PK\u0003\u0004archive") },
  ]);
  await page.locator(".notion-editor .notion-file-block").nth(7).waitFor();
  await page.waitForTimeout(1600);
  const finalTypes = JSON.parse(document.content_json).content.map((block) => block.type);
  assert.equal(finalTypes.filter((type) => type === "fileBlock").length, 4, "ZIP and ordinary files saved");
  assert.match(await page.locator(".notion-file-block").filter({ hasText: "archive.zip" }).innerText(),
    /archive\.zip[\s\S]*ZIP/);
  assert.equal(await page.locator(".notion-file-block").filter({ hasText: "archive.zip" })
    .locator("a.notion-file-download").getAttribute("download"), "archive.zip",
  "the download button preserves the ZIP filename");
  assert.deepEqual(errors, [], "browser errors");
  console.log(JSON.stringify({ pdfBlocks: layout.length, fileBlocks: 4, savedTypes: finalTypes }));
} finally {
  await browser.close();
}
