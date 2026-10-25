function contentText(raw) {
  try {
    const parts = [];
    const visit = (node) => {
      if (!node || typeof node !== "object") return;
      if (typeof node.text === "string") parts.push(node.text);
      if (["image", "fileBlock", "pdfBlock"].includes(node.type)) {
        const label = node.attrs?.name || node.attrs?.alt;
        if (typeof label === "string") parts.push(label);
      }
      if (Array.isArray(node.content)) node.content.forEach(visit);
    };
    visit(JSON.parse(raw || "{}"));
    return parts.join(" ").replace(/\s+/g, " ").trim();
  } catch { return ""; }
}

const lower = (value) => String(value || "").normalize("NFKC").toLocaleLowerCase("ko");

export function buildSearchIndex(documents) {
  const byId = new Map(documents.map((item) => [Number(item.id), item]));
  return documents.map((item) => {
    const names = [];
    let current = item;
    const seen = new Set();
    while (current && !seen.has(Number(current.id))) {
      seen.add(Number(current.id));
      names.unshift(current.title || "제목 없음");
      current = current.parent_id ? byId.get(Number(current.parent_id)) : null;
    }
    const body = contentText(item.content_json);
    const path = names.join(" / ");
    return { id: item.id, title: item.title || "제목 없음", path,
      parentPath: names.slice(0, -1).join(" / ") || "최상위", body,
      updatedAt: item.updated_at || "", titleKey: lower(item.title), pathKey: lower(path), bodyKey: lower(body) };
  });
}

export function searchDocuments(index, query) {
  const terms = lower(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  return index.flatMap((item) => {
    if (!terms.every((term) => item.titleKey.includes(term) || item.pathKey.includes(term) ||
      item.bodyKey.includes(term))) return [];
    const score = terms.reduce((sum, term) => sum + (item.titleKey.startsWith(term) ? 5 :
      item.titleKey.includes(term) ? 4 : item.pathKey.includes(term) ? 2 : 0) +
      (item.bodyKey.includes(term) ? 1 : 0), 0);
    const at = item.bodyKey.indexOf(terms[0]);
    const start = at < 0 ? 0 : Math.max(0, at - 55);
    const snippet = item.body ? `${start ? "…" : ""}${item.body.slice(start, start + 150)}${item.body.length > start + 150 ? "…" : ""}` : "";
    return [{ ...item, score, snippet }];
  }).sort((a, b) => b.score - a.score || b.updatedAt.localeCompare(a.updatedAt) || Number(b.id) - Number(a.id));
}
