import React, { useEffect, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { Check, FileText, GripVertical, Pencil, Trash2, X } from "lucide-react";
import { api } from "./api";

function PageBlockView({ node, extension, updateAttributes, deleteNode }) {
  const id = Number(node.attrs.pageId);
  const page = extension.options.getPage(id);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(page?.title || node.attrs.title || "제목 없음");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function cancelEdit() { setEditing(false); setTitle(page?.title || node.attrs.title || "제목 없음"); setError(""); }
  useEffect(() => {
    if (!editing) return;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelEdit();
    };
    window.document.addEventListener("keydown", onKeyDown);
    return () => window.document.removeEventListener("keydown", onKeyDown);
  }, [editing, page?.title, node.attrs.title]);

  async function saveTitle() {
    const next = title.trim() || "제목 없음";
    setBusy(true);
    setError("");
    try {
      const detail = await api(`/documents/${id}`);
      const saved = await api(`/documents/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next, contentJson: detail.content_json, version: detail.version }) });
      updateAttributes({ title: saved.title });
      await extension.options.onPageChanged();
      setEditing(false);
    } catch (reason) {
      setError(reason.status === 409 ? "다른 사용자가 수정했습니다. 다시 시도해 주세요." : "제목을 수정하지 못했습니다.");
    } finally { setBusy(false); }
  }

  async function removePage() {
    if (!window.confirm("이 페이지와 하위 페이지를 휴지통으로 이동하시겠습니까?")) return;
    setBusy(true);
    setError("");
    try {
      await api(`/documents/${id}`, { method: "DELETE" });
      deleteNode();
      await extension.options.onPageDeleted();
    } catch { setError("휴지통으로 이동하지 못했습니다."); setBusy(false); }
  }

  return <NodeViewWrapper className="notion-page-block" data-page-id={id} contentEditable={false}>
    <span className="notion-page-drag" data-drag-handle title="드래그하여 위치 이동" aria-label="페이지 위치 이동">
      <GripVertical size={17}/>
    </span>
    {editing ? <form className="notion-page-rename" onSubmit={(event) => { event.preventDefault(); saveTitle(); }}>
      <FileText size={18}/><input autoFocus aria-label="페이지 이름" value={title} maxLength={200}
        onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Escape") { event.stopPropagation(); cancelEdit(); }
        }} disabled={busy}/>
      <button type="submit" aria-label="수정 저장" title="수정 저장" disabled={busy}><Check size={16}/></button>
      <button type="button" aria-label="수정 취소" title="수정 취소" onClick={cancelEdit}><X size={16}/></button>
    </form> : <>
      <button type="button" className="notion-page-open" onClick={() => extension.options.onOpenPage(id)}>
        <FileText size={18}/><span>{node.attrs.title || page?.title || "제목 없음"}</span>
      </button>
      {extension.options.canEdit() && <div className="notion-page-actions">
        <button type="button" aria-label="페이지 수정" title="페이지 수정" onClick={() => { setTitle(page?.title || node.attrs.title || "제목 없음"); setEditing(true); }}><Pencil size={15}/></button>
        <button type="button" aria-label="페이지 삭제" title="휴지통으로 이동" onClick={removePage} disabled={busy}><Trash2 size={15}/></button>
      </div>}
    </>}
    {error && <small className="notion-page-error" role="alert">{error}</small>}
  </NodeViewWrapper>;
}

export const PageBlock = Node.create({
  name: "pageBlock",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addOptions() { return { getPage: () => null, canEdit: () => true, onOpenPage: () => {}, onPageChanged: () => {}, onPageDeleted: () => {} }; },
  addAttributes() {
    return {
      pageId: { default: null, parseHTML: (element) => Number(element.getAttribute("data-page-id")),
        renderHTML: ({ pageId }) => ({ "data-page-id": pageId }) },
      title: { default: "제목 없음", parseHTML: (element) => element.getAttribute("data-page-title") || "제목 없음",
        renderHTML: ({ title }) => ({ "data-page-title": title }) },
    };
  },
  parseHTML() { return [{ tag: 'div[data-type="page-block"]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "page-block" }), HTMLAttributes["data-page-title"] || "제목 없음"];
  },
  addNodeView() { return ReactNodeViewRenderer(PageBlockView); },
});
