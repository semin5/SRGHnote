import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true,
  executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const now = "2026-10-14T10:00:00";
const content = '{"type":"doc","content":[{"type":"paragraph"}]}';
const pageData = (id, title, locked = false) => ({ id, parent_id: 1, title, content_json: content,
  version: 1, created_by: locked ? "another" : "test", updated_by: "test", created_by_name: "테스트",
  updated_by_name: "테스트", created_at: now, updated_at: now, locked_for_others: locked });
let root = { ...pageData(1, "테스트 폴더"), parent_id: null };
let documents = [root, pageData(2, "첫 번째"), pageData(3, "두 번째"), pageData(4, "잠긴 페이지", true)];
const deleted = [];

await context.route("**/it/api/auth/me", (route) => route.fulfill({ json: {
  username: "test", displayName: "테스트", role: "SUPER_ADMIN" } }));
await context.route("**/note/api/**", (route) => {
  const { pathname } = new URL(route.request().url());
  const method = route.request().method();
  if (pathname === "/note/api/documents" && method === "GET") return route.fulfill({ json: documents });
  if (pathname === "/note/api/documents/order") return route.fulfill({ json: [1] });
  if (pathname === "/note/api/documents/preferences") return route.fulfill({ json: { pageSize: 20 } });
  if (pathname === "/note/api/documents/trash") return route.fulfill({ json: deleted });
  if (pathname === "/note/api/documents/1" && method === "GET") return route.fulfill({ json: root });
  if (pathname === "/note/api/documents/1" && method === "PUT") {
    const body = route.request().postDataJSON();
    root = { ...root, title: body.title, content_json: body.contentJson, version: root.version + 1 };
    documents = documents.map((item) => item.id === 1 ? root : item);
    return route.fulfill({ json: root });
  }
  const deletion = pathname.match(/^\/note\/api\/documents\/(\d+)$/);
  if (deletion && method === "DELETE") {
    const id = Number(deletion[1]);
    const item = documents.find((entry) => entry.id === id);
    if (!item || item.locked_for_others) return route.fulfill({ status: 403 });
    documents = documents.filter((entry) => entry.id !== id);
    deleted.push({ ...item, deleted_at: now });
    return route.fulfill({ status: 204 });
  }
  if (pathname === "/note/api/events") return route.fulfill({ contentType: "text/event-stream", body: "" });
  return route.fulfill({ status: 404, body: pathname });
});

try {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("http://127.0.0.1:5184/note/?page=1");
  await page.locator(".notion-card").first().waitFor();
  assert.equal(await page.locator(".notion-card").count(), 3);
  assert.equal(await page.getByRole("searchbox", { name: "전체 문서 검색" }).count(), 1);
  assert.equal(await page.getByRole("searchbox", { name: "페이지 통합검색" }).count(), 0);
  await page.getByRole("button", { name: "현재 페이지 삭제" }).waitFor();
  assert.deepEqual(await page.locator(".notion-delete").evaluate((button) => {
    const style = getComputedStyle(button);
    return [style.backgroundColor, style.color, style.borderTopColor];
  }), ["rgb(255, 255, 255)", "rgb(220, 38, 38)", "rgb(220, 38, 38)"]);
  assert.equal(await page.locator(".notion-card-select").first().evaluate((label) => getComputedStyle(label).borderTopWidth), "0px");
  assert.equal(await page.getByRole("checkbox", { name: "잠긴 페이지 선택" }).isDisabled(), true);
  assert.equal(await page.locator(".notion-delete").evaluate((button) => button.previousElementSibling?.textContent), "현재 페이지 모두 선택");
  assert.equal(await page.locator(".notion-selection-toggle input").count(), 0);
  await page.getByRole("button", { name: "현재 페이지 모두 선택" }).click();
  await page.getByRole("button", { name: "2개 페이지 선택 해제" }).waitFor();
  assert.equal(await page.locator(".notion-delete").evaluate((button) => button.previousElementSibling?.textContent),
    "2개페이지 선택 해제");
  assert.deepEqual(await page.locator(".notion-selection-toggle").evaluate((button) => {
    const style = getComputedStyle(button);
    return [style.borderTopColor, style.color];
  }), ["rgb(37, 99, 235)", "rgb(37, 99, 235)"]);
  await page.getByRole("button", { name: "2개 페이지 선택 해제" }).click();
  await page.getByText("2개", { exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "현재 페이지 모두 선택" }).click();
  await page.getByRole("button", { name: "선택 페이지 삭제" }).click();
  await page.getByText("2개", { exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "현재 페이지 삭제" }).waitFor();
  assert.deepEqual(deleted.map((item) => item.id).sort(), [2, 3]);
  assert.equal(await page.locator(".notion-card").count(), 1);
  assert.equal(await page.getByRole("checkbox", { name: "잠긴 페이지 선택" }).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log("bulk delete smoke passed");
} finally {
  await browser.close();
}
