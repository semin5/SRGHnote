import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.TEST_BASE || "http://sarangmc.kr";
const user = process.env.TEST_USER;
const password = process.env.TEST_PASS;
if (!user || !password) throw new Error("TEST_USER and TEST_PASS are required");

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
let documentId;
let childId;
let grandchildId;
let secondGrandchildId;
let attachmentId;
try {
  const login = await context.request.post(`${base}/it/api/auth/login`, {
    data: { username: user, password },
  });
  assert.equal(login.status(), 200, "IT login");
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${base}/notion/`, { waitUntil: "networkidle" });
  await page.locator('.notion-sidebar-heading button[title="새 페이지"]').waitFor();
  assert.equal(await page.locator(".notion-hero").count(), 0, "top header removed");
  await page.evaluate(() => {
    window.__notionEvents = [];
    window.__notionConnected = false;
    const stream = new EventSource("/notion/api/events");
    stream.addEventListener("connected", () => { window.__notionConnected = true; });
    stream.addEventListener("change", (event) => window.__notionEvents.push(JSON.parse(event.data)));
    window.__notionStream = stream;
  });
  await page.waitForFunction(() => window.__notionConnected);
  const previousPage = new URL(page.url()).searchParams.get("page");
  await page.locator('.notion-sidebar-heading button[title="새 페이지"]').click();
  await page.waitForFunction((previous) => new URLSearchParams(location.search).get("page") !== previous,
    previousPage);
  await page.locator(".notion-title-input").waitFor();
  documentId = Number(new URL(page.url()).searchParams.get("page"));
  assert.ok(documentId > 0, "new page ID");
  await page.waitForFunction((id) => window.__notionEvents.some((event) => Number(event.document_id) === id), documentId);
  await page.locator(".notion-title-input").fill("Codex 화면 검증 (임시)");
  await page.locator(".notion-tree-item.selected .notion-tree-title").getByText("Codex 화면 검증 (임시)").waitFor();
  await page.locator(".notion-document-path").getByText("Codex 화면 검증 (임시)").waitFor();
  const rootRow = page.locator(`.notion-tree-item[data-document-id="${documentId}"]`);
  await rootRow.getByRole("button", { name: "Codex 화면 검증 (임시) 수정" }).click();
  await rootRow.getByRole("textbox", { name: "페이지 이름" }).fill("Codex 목록 수정 검증");
  await rootRow.getByRole("button", { name: "수정 저장" }).click();
  await page.locator(".notion-title-input").waitFor();
  await page.waitForFunction(() => document.querySelector(".notion-title-input")?.value === "Codex 목록 수정 검증");
  await rootRow.getByRole("button", { name: "Codex 목록 수정 검증 수정" }).click();
  await rootRow.getByRole("textbox", { name: "페이지 이름" }).fill("Codex 화면 검증 (임시)");
  await rootRow.getByRole("button", { name: "수정 저장" }).click();
  await page.waitForFunction(() => document.querySelector(".notion-title-input")?.value === "Codex 화면 검증 (임시)");
  await rootRow.locator(".notion-tree-title").click({ button: "right" });
  assert.equal(await page.locator(".notion-context-menu").count(), 0, "no page options on right click");
  await rootRow.getByRole("button", { name: "Codex 화면 검증 (임시) 수정" }).click();
  await rootRow.getByRole("textbox", { name: "페이지 이름" }).fill("취소할 이름");
  await page.keyboard.press("Escape");
  await rootRow.getByRole("textbox", { name: "페이지 이름" }).waitFor({ state: "hidden" });
  assert.equal(await page.locator(".notion-title-input").inputValue(), "Codex 화면 검증 (임시)");
  assert.equal(await page.locator(".notion-attachments").count(), 0, "attachment bar hidden");
  await page.locator(".notion-editor").click();
  await page.keyboard.type("문서 자동 저장 확인");
  await page.getByText("저장됨", { exact: true }).waitFor({ timeout: 15000 });
  await page.evaluate(() => {
    window.__editorContextPrevented = null;
    document.addEventListener("contextmenu", (event) => { window.__editorContextPrevented = event.defaultPrevented; }, { once: true });
  });
  await page.locator(".notion-editor p").first().click({ button: "right" });
  assert.equal(await page.evaluate(() => window.__editorContextPrevented), true,
    "browser context menu is suppressed in the editor");
  await page.locator(".notion-context-toolbar").waitFor();
  await page.mouse.move(1400, 850);
  await page.locator(".notion-context-toolbar").waitFor({ state: "hidden" });
  await page.keyboard.press("Enter");
  assert.ok((await page.locator(".notion-editor").textContent()).includes("문서 자동 저장 확인"));
  await page.getByRole("button", { name: "블록 추가" }).click();
  await page.getByRole("button", { name: "표 삽입" }).waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".notion-block-menu").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "블록 추가" }).click();
  await page.getByRole("button", { name: "표 삽입" }).click();
  await page.locator(".notion-editor table").waitFor();
  await page.getByText("저장됨", { exact: true }).waitFor({ timeout: 15000 });
  await page.locator(".notion-editor p").first().click();
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.locator(".notion-bubble-toolbar:visible").waitFor();
  await page.getByRole("button", { name: "링크", exact: true }).first().click();
  await page.getByLabel("연결 주소").fill("https://example.com");
  await page.locator(".notion-link-dialog").getByRole("button", { name: "확인" }).click();
  await page.locator('.notion-editor a[href="https://example.com"]').waitFor();

  const detail = await context.request.get(`${base}/notion/api/documents/${documentId}`);
  assert.equal(detail.status(), 200);
  const saved = await detail.json();
  assert.equal(saved.title, "Codex 화면 검증 (임시)");
  assert.ok(saved.content_json.includes("문서 자동 저장 확인"));
  assert.ok(saved.content_json.includes('"type":"table"'));

  await page.locator('input[type="file"]').setInputFiles("../README.md");
  await page.locator(".notion-editor a").getByText("README.md", { exact: true }).waitFor();
  const filesResponse = await context.request.get(`${base}/notion/api/documents/${documentId}/files`);
  assert.equal(filesResponse.status(), 200);
  const files = await filesResponse.json();
  assert.equal(files.length, 1);
  attachmentId = files[0].id;
  const download = await context.request.get(`${base}/notion/api/files/${files[0].id}`);
  assert.equal(download.status(), 200, "authenticated attachment download");
  assert.ok((await download.body()).length > 100, "attachment bytes");
  await page.screenshot({ path: "tests/notion-smoke.png", fullPage: true });
  await page.locator('input[type="file"]').setInputFiles("tests/notion-smoke.png");
  await page.locator(".notion-editor img").waitFor({ timeout: 15000 });
  await page.waitForFunction(() => [...document.querySelectorAll(".notion-editor img")]
    .some((image) => image.complete && image.naturalWidth > 0));

  await page.getByRole("button", { name: "Codex 화면 검증 (임시) 아래 페이지 추가" }).click();
  await page.waitForFunction((parent) => {
    const id = Number(new URLSearchParams(location.search).get("page"));
    return id > 0 && id !== parent;
  }, documentId);
  await page.locator(".notion-document-path").getByRole("button", { name: "Codex 화면 검증 (임시)" }).waitFor();
  await page.locator(".notion-editor").click();
  childId = await page.evaluate(() => Number(new URLSearchParams(location.search).get("page")));
  await page.getByRole("button", { name: "블록 추가" }).click();
  await page.getByRole("button", { name: "하위 페이지" }).click();
  await page.locator(".notion-page-block").waitFor();
  assert.equal(Number(new URL(page.url()).searchParams.get("page")), childId, "inline child remains on parent");
  grandchildId = Number(await page.locator(".notion-page-block").getAttribute("data-page-id"));
  assert.ok(grandchildId > 0);
  await page.locator(".notion-editor p").last().click();
  await page.getByRole("button", { name: "블록 추가" }).click();
  await page.getByRole("button", { name: "하위 페이지" }).click();
  await page.locator(".notion-page-block").nth(1).waitFor();
  secondGrandchildId = Number(await page.locator(".notion-page-block").nth(1).getAttribute("data-page-id"));
  assert.ok(secondGrandchildId > 0 && secondGrandchildId !== grandchildId);
  await page.locator(".notion-page-block").nth(1).locator(".notion-page-drag").dragTo(
    page.locator(".notion-page-block").first(), { targetPosition: { x: 100, y: 2 } });
  await page.getByText("저장됨", { exact: true }).waitFor({ timeout: 15000 });
  const childDetail = await (await context.request.get(`${base}/notion/api/documents/${childId}`)).json();
  const childBlocks = JSON.parse(childDetail.content_json).content.filter((block) => block.type === "pageBlock");
  assert.deepEqual(childBlocks.map((block) => Number(block.attrs.pageId)), [secondGrandchildId, grandchildId],
    "child pages can be drag-reordered inside the document");
  const sidebarChild = page.locator(`.notion-tree-item[data-document-id="${secondGrandchildId}"]`);
  await sidebarChild.getByRole("button", { name: "제목 없음 수정" }).click();
  await sidebarChild.getByRole("textbox", { name: "페이지 이름" }).fill("목록에서 수정한 하위 페이지");
  await sidebarChild.getByRole("button", { name: "수정 저장" }).click();
  const editedBlock = page.locator(`.notion-page-block[data-page-id="${secondGrandchildId}"]`);
  await editedBlock.getByRole("button", { name: "목록에서 수정한 하위 페이지" }).waitFor();
  await editedBlock.locator(".notion-page-open").click({ button: "right" });
  assert.equal(await page.locator(".notion-context-menu").count(), 0, "no child page options on right click");
  await editedBlock.getByRole("button", { name: "페이지 수정" }).click();
  await editedBlock.getByRole("textbox", { name: "페이지 이름" }).fill("취소할 하위 페이지 이름");
  await page.keyboard.press("Escape");
  await editedBlock.getByRole("textbox", { name: "페이지 이름" }).waitFor({ state: "hidden" });
  await editedBlock.getByRole("button", { name: "페이지 수정" }).click();
  await editedBlock.getByRole("textbox", { name: "페이지 이름" }).fill("수정한 하위 페이지");
  await editedBlock.getByRole("button", { name: "수정 저장" }).click();
  await editedBlock.getByRole("button", { name: "수정한 하위 페이지" }).waitFor();
  assert.equal((await (await context.request.get(`${base}/notion/api/documents/${secondGrandchildId}`)).json()).title,
    "수정한 하위 페이지");
  page.once("dialog", (dialog) => dialog.accept());
  await editedBlock.getByRole("button", { name: "페이지 삭제" }).click();
  await editedBlock.waitFor({ state: "detached" });
  await page.waitForFunction(async (id) => (await fetch(`/notion/api/documents/${id}`)).status === 404,
    secondGrandchildId);
  await page.locator(`.notion-page-block[data-page-id="${grandchildId}"] .notion-page-open`).click();
  await page.waitForFunction((id) => Number(new URLSearchParams(location.search).get("page")) === id, grandchildId);
  await page.locator(".notion-editor").click();
  await page.keyboard.type("/코드");
  await page.getByRole("button", { name: "코드 블록" }).waitFor();
  await page.keyboard.press("Enter");
  await page.locator(".notion-editor pre").waitFor();
  await page.locator(".notion-document-path").getByRole("button", { name: "Codex 화면 검증 (임시)" }).click();
  await page.waitForFunction((id) => Number(new URLSearchParams(location.search).get("page")) === id, documentId);
  await page.waitForFunction(() => document.querySelector(".notion-title-input")?.value === "Codex 화면 검증 (임시)");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator(`.notion-tree-item[data-document-id="${documentId}"]`)
    .getByRole("button", { name: "Codex 화면 검증 (임시) 삭제" }).click();
  await page.waitForFunction(async (id) => (await (await fetch("/notion/api/documents/trash")).json())
    .some((item) => Number(item.id) === id), documentId);
  await page.waitForFunction(async (id) => (await fetch(`/notion/api/files/${id}`)).status === 404, attachmentId);
  await page.locator(`.notion-tree-item[data-document-id="${documentId}"]`).waitFor({ state: "detached" });
  await page.locator(".notion-trash-link").click();
  await page.locator(".notion-trash-link.selected").waitFor();
  assert.equal(await page.getByText("삭제한 페이지와 하위 페이지를 복원하거나 영구 삭제할 수 있습니다.").count(), 0);
  await page.locator(".notion-tree-item.selected .notion-tree-title").click();
  await page.locator(".notion-trash-view").waitFor({ state: "hidden" });
  await page.locator(".notion-trash-link").click();
  await page.locator(`.notion-trash-row[data-document-id="${documentId}"]`)
    .getByRole("button", { name: "복원" }).click();
  await page.waitForFunction((id) => Number(new URLSearchParams(location.search).get("page")) === id, documentId);
  assert.equal((await (await context.request.get(`${base}/notion/api/documents`)).json())
    .filter((item) => Number(item.id) === documentId).length, 1);
  assert.equal((await context.request.get(`${base}/notion/api/documents/${grandchildId}`)).status(), 200,
    "nested page restored");
  assert.equal((await context.request.get(`${base}/notion/api/files/${attachmentId}`)).status(), 200,
    "attachment restored");

  await page.screenshot({ path: "tests/notion-smoke.png", fullPage: true });
  assert.deepEqual(errors, [], "browser runtime errors");
  console.log(JSON.stringify({ documentId, editor: "ok", attachment: "ok", runtimeErrors: 0 }));
} finally {
  if (documentId) {
    await context.request.delete(`${base}/notion/api/documents/${documentId}`).catch(() => {});
    const deletion = await context.request.delete(`${base}/notion/api/documents/${documentId}/permanent`).catch(() => null);
    console.log(`cleanup-status=${deletion?.status()}`);
    if (deletion?.status() === 200) {
      assert.equal((await context.request.get(`${base}/notion/api/documents/${documentId}`)).status(), 404);
      if (childId) assert.equal((await context.request.get(`${base}/notion/api/documents/${childId}`)).status(), 404);
      if (grandchildId) assert.equal((await context.request.get(`${base}/notion/api/documents/${grandchildId}`)).status(), 404);
      if (secondGrandchildId) assert.equal((await context.request.get(`${base}/notion/api/documents/${secondGrandchildId}`)).status(), 404);
      if (attachmentId) assert.equal((await context.request.get(`${base}/notion/api/files/${attachmentId}`)).status(), 404);
    }
  }
  await context.request.delete(`${base}/notion/api/session`).catch(() => {});
  await browser.close();
}
