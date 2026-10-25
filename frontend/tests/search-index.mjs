import assert from "node:assert/strict";
import { buildSearchIndex, searchDocuments } from "../src/search.js";

const docs = [
  { id: 1, parent_id: null, title: "네트워크", content_json: '{"type":"doc","content":[]}' },
  { id: 2, parent_id: 1, title: "서버 구성", content_json: JSON.stringify({ type: "doc", content: [
    { type: "paragraph", content: [{ type: "text", text: "이중화 운영 안내" }] },
    { type: "fileBlock", attrs: { name: "설정표.xlsx" } },
  ] }) },
];
const index = buildSearchIndex(docs);
assert.equal(index.find((item) => item.id === 2).path, "네트워크 / 서버 구성");
assert.equal(searchDocuments(index, "이중화")[0].id, 2, "body text is searchable");
assert.equal(searchDocuments(index, "설정표")[0].id, 2, "attachment names are searchable");
assert.equal(searchDocuments(index, "네트워크 서버")[0].id, 2, "path and title can be combined");
assert.equal(searchDocuments(index, "찾을수없는말").length, 0);
