import assert from "node:assert/strict";
import { chromium } from "playwright";

// Run with `npm run dev -- --host 127.0.0.1`; the API is mocked below.
const browser = await chromium.launch({ headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const now = "2026-10-19T10:00:00";
const root = { id: 1, parent_id: null, title: "테스트 폴더",
  content_json: '{"type":"doc","content":[{"type":"paragraph"}]}', version: 1,
  created_by: "test", updated_by: "test", created_by_name: "테스트", updated_by_name: "테스트",
  created_at: now, updated_at: now, locked_for_others: false };
let document = { ...root, id: 2, parent_id: 1, title: "첨부 이동 테스트" };
const paragraph = (...content) => ({ type: "paragraph", content });
const text = (value) => ({ type: "text", text: value });
const hardBreak = { type: "hardBreak" };
const file = { type: "fileBlock", attrs: { src: "/note/api/files/1", name: "test.txt", size: 100 } };
const pdf = { type: "pdfBlock", attrs: { src: "/note/api/files/2/preview", name: "test.pdf", size: 100 } };
const content = () => JSON.parse(document.content_json).content;
const labels = () => content().map((block) => block.type === "fileBlock" ? "file"
  : block.type === "pdfBlock" ? "pdf" : block.content?.map((part) => part.text || "").join(""));

await context.route("**/it/api/auth/me", (route) => route.fulfill({ json: {
  username: "test", displayName: "테스트", role: "SUPER_ADMIN",
} }));
await context.route("**/note/api/**", (route) => {
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
  if (pathname === "/note/api/events")
    return route.fulfill({ contentType: "text/event-stream", body: "" });
  return route.fulfill({ status: 404, body: pathname });
});

async function checkMove(initial, selector, direction, expected) {
  document = { ...document, content_json: JSON.stringify({ type: "doc", content: initial }), version: document.version + 1 };
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto("http://127.0.0.1:5184/note/?page=2");
    await page.locator(selector).locator(`button[aria-label="첨부파일 한 줄 ${direction}로 이동"]`).click();
    await page.waitForFunction(() => document.querySelector(".notion-editor") !== null);
    await page.waitForTimeout(1000);
    assert.deepEqual(labels().filter(Boolean), expected);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
}

try {
  await checkMove([paragraph(text("첫째"), hardBreak, text("둘째")), file],
    ".notion-file-block", "위", ["첫째", "file", "둘째"]);
  await checkMove([file, paragraph(text("첫째"), hardBreak, text("둘째"))],
    ".notion-file-block", "아래", ["첫째", "file", "둘째"]);
  await checkMove([paragraph(text("첫째")), paragraph(text("둘째")), file],
    ".notion-file-block", "위", ["첫째", "file", "둘째"]);
  await checkMove([paragraph(text("첫째"), hardBreak, text("둘째")), pdf],
    ".notion-pdf-block", "위", ["첫째", "pdf", "둘째"]);
  console.log("Attachment move keeps adjacent text lines in order");
} finally { await browser.close(); }
