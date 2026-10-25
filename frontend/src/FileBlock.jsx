import React from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { ArrowDown, ArrowUp, Download, FileText, Trash2 } from "lucide-react";

const fileUrl = /^\/note\/api\/files\/[1-9]\d*$/;

function fileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "첨부파일";
  if (bytes < 1024) return `${bytes} B`;
  const unit = bytes < 1024 * 1024 ? "KB" : "MB";
  const value = bytes / (unit === "KB" ? 1024 : 1024 * 1024);
  return `${value.toLocaleString("ko-KR", { maximumFractionDigits: 1 })} ${unit}`;
}

export function FileCardBody({ src, name, size }) {
  const safeSrc = fileUrl.test(src || "") ? src : null;
  const label = name || "첨부파일";
  const extension = label.includes(".") ? label.split(".").pop().toUpperCase().slice(0, 8) : "FILE";
  return <>
    <span className="notion-file-icon" aria-hidden="true"><FileText size={20}/></span>
    <span className="notion-file-details"><strong title={label}>{label}</strong>
      <small>{extension} · {fileSize(Number(size))}</small></span>
    {safeSrc ? <a className="notion-file-download" href={safeSrc} download={label} aria-label={`${label} 다운로드`} title="다운로드">
      <Download size={18}/></a> : <small>파일을 열 수 없습니다</small>}
  </>;
}

export function AttachmentActions({ editor, getPos, node }) {
  if (!editor?.isEditable) return null;
  const pos = getPos();
  if (typeof pos !== "number") return null;
  const $pos = editor.state.doc.resolve(pos);
  const index = $pos.index();
  const parent = $pos.parent;
  const move = (direction) => {
    const currentPos = getPos();
    if (typeof currentPos !== "number" || !editor.isEditable) return;
    const resolved = editor.state.doc.resolve(currentPos);
    const currentIndex = resolved.index();
    const siblingIndex = currentIndex + direction;
    if (siblingIndex < 0 || siblingIndex >= resolved.parent.childCount) return;
    const attachment = resolved.parent.child(currentIndex);
    const sibling = resolved.parent.child(siblingIndex);
    const siblingContent = sibling.isTextblock ? [...sibling.content.content] : [];
    const breakIndexes = siblingContent.flatMap((child, childIndex) => child.type.name === "hardBreak" ? [childIndex] : []);
    let transaction;
    let nextPos;
    if (breakIndexes.length) {
      const breakIndex = direction < 0 ? breakIndexes.at(-1) : breakIndexes[0];
      const first = sibling.type.create(sibling.attrs, siblingContent.slice(0, breakIndex));
      const second = sibling.type.create(sibling.attrs, siblingContent.slice(breakIndex + 1));
      const from = direction < 0 ? currentPos - sibling.nodeSize : currentPos;
      const to = direction < 0 ? currentPos + attachment.nodeSize : currentPos + attachment.nodeSize + sibling.nodeSize;
      nextPos = from + first.nodeSize;
      transaction = editor.state.tr.replaceWith(from, to, [first, attachment, second]);
    } else {
      nextPos = direction < 0 ? currentPos - sibling.nodeSize : currentPos + sibling.nodeSize;
      transaction = editor.state.tr.delete(currentPos, currentPos + attachment.nodeSize).insert(nextPos, attachment);
    }
    editor.view.dispatch(transaction.setSelection(NodeSelection.create(transaction.doc, nextPos)).scrollIntoView());
    editor.view.focus();
  };
  return <span className="notion-attachment-actions" aria-label="첨부파일 관리">
    <button type="button" disabled={index === 0} aria-label="첨부파일 한 줄 위로 이동" title="위로 이동"
      onMouseDown={(event) => event.preventDefault()} onClick={() => move(-1)}><ArrowUp size={16}/></button>
    <button type="button" disabled={index >= parent.childCount - 1} aria-label="첨부파일 한 줄 아래로 이동" title="아래로 이동"
      onMouseDown={(event) => event.preventDefault()} onClick={() => move(1)}><ArrowDown size={16}/></button>
    <button type="button" className="notion-attachment-remove" aria-label="첨부파일 삭제" title="첨부파일 삭제"
      onMouseDown={(event) => event.preventDefault()} onClick={() => {
        const currentPos = getPos();
        if (typeof currentPos === "number" && editor.isEditable) editor.chain().focus().deleteRange({ from: currentPos, to: currentPos + node.nodeSize }).run();
      }}><Trash2 size={16}/></button>
  </span>;
}

function FileBlockView({ node, editor, getPos }) {
  return <NodeViewWrapper className="notion-file-block" contentEditable={false}>
    <FileCardBody {...node.attrs}/>
    <AttachmentActions editor={editor} getPos={getPos} node={node}/>
  </NodeViewWrapper>;
}

export const FileBlock = Node.create({
  name: "fileBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: "", parseHTML: (element) => element.getAttribute("data-file-src") || "",
        renderHTML: ({ src }) => ({ "data-file-src": src }) },
      name: { default: "첨부파일", parseHTML: (element) => element.getAttribute("data-file-name") || "첨부파일",
        renderHTML: ({ name }) => ({ "data-file-name": name }) },
      size: { default: 0, parseHTML: (element) => Number(element.getAttribute("data-file-size")) || 0,
        renderHTML: ({ size }) => ({ "data-file-size": size }) },
    };
  },
  parseHTML() { return [{ tag: 'div[data-type="file-block"]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "file-block" }), HTMLAttributes["data-file-name"]];
  },
  addNodeView() { return ReactNodeViewRenderer(FileBlockView); },
});
