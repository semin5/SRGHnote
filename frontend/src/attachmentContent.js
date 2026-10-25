const attachmentUrl = /^\/note\/api\/files\/[1-9]\d*$/;

// Older documents stored uploaded files as links. Render those as file blocks too.
export function normalizeAttachmentContent(raw) {
  let content;
  try { content = JSON.parse(raw); } catch { return { type: "doc", content: [{ type: "paragraph" }] }; }
  if (content?.type !== "doc" || !Array.isArray(content.content)) return { type: "doc", content: [{ type: "paragraph" }] };

  const blocks = content.content.flatMap((block) => {
    if (block.type !== "paragraph" || !Array.isArray(block.content)) return [block];
    const result = [];
    let inline = [];
    const flush = () => {
      if (inline.length) result.push({ ...block, content: inline });
      inline = [];
    };
    for (const part of block.content) {
      const href = part.marks?.find((mark) => mark.type === "link")?.attrs?.href;
      if (part.type !== "text" || !attachmentUrl.test(href || "")) {
        inline.push(part);
        continue;
      }
      flush();
      result.push({ type: "fileBlock", attrs: { src: href, name: part.text || "첨부파일", size: 0 } });
    }
    flush();
    return result.length ? result : [block];
  });
  if (blocks.length && !["paragraph", "heading", "blockquote", "codeBlock", "bulletList", "orderedList", "taskList", "table"].includes(blocks.at(-1).type))
    blocks.push({ type: "paragraph" });
  return { ...content, content: blocks };
}
