import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { EditorContent, useEditor } from "@tiptap/react";
import { FloatingMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { TextStyleKit } from "@tiptap/extension-text-style";
import { TextAlign } from "@tiptap/extension-text-align";
import { Image } from "@tiptap/extension-image";
import { TaskList, TaskItem } from "@tiptap/extension-list";
import { AlignCenter, AlignLeft, AlignRight, Bold, CheckSquare, Code2, FileText, Heading1, Heading2,
  Heading3, Italic, Link2, List, ListOrdered, Minus, Quote, Redo2,
  Strikethrough, Table2, Underline, Undo2, Upload, Plus } from "lucide-react";
import { api } from "./api";
import { PageBlock } from "./PageBlock";
import { PdfBlock } from "./PdfBlock";
import { FileBlock } from "./FileBlock";
import { normalizeAttachmentContent } from "./attachmentContent";

const parseContent = normalizeAttachmentContent;
const imageType = (file) => ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(file.type);
const MAX_ATTACHMENT_BYTES = 50_000_000;

const EditorPane = forwardRef(function EditorPane({ document, actor, canEdit, canDelete, canAddChild, remoteSignal, path, children,
  pageSize, viewMode, onViewChange, canDeleteChild,
  onHome, onOpenPage, onCreateChild, onChildCreated, onPageChanged, onPageDeleted,
  onTitleChange, onSaved, onDeleted, globalSearch }, ref) {
  const [title, setTitle] = useState(document.title);
  const [status, setStatus] = useState("자동저장됨");
  const [firstBlockType, setFirstBlockType] = useState(() => parseContent(document.content_json).content?.[0]?.type || "paragraph");
  const gapComposingRef = useRef(false);
  const gapTransferRef = useRef(false);
  const [childPage, setChildPage] = useState(1);
  const [autoPageSize, setAutoPageSize] = useState(12);
  const listWrapRef = useRef(null);
  const [selectedChildIds, setSelectedChildIds] = useState(() => new Set());
  const [deletingChildren, setDeletingChildren] = useState(false);
  const [metadata, setMetadata] = useState(document);
  const [conflict, setConflict] = useState(false);
  const [blockMenuOpen, setBlockMenuOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const menuIndexRef = useRef(0);
  const slashRef = useRef(null);
  const dismissedSlashRef = useRef(false);
  const menuItemsRef = useRef([]);
  const chooseBlockRef = useRef(null);
  const titleRef = useRef(document.title);
  const versionRef = useRef(Number(document.version));
  const dirtyRef = useRef(false);
  const savingRef = useRef(null);
  const timerRef = useRef(null);
  const conflictRef = useRef(false);
  const suppressRef = useRef(false);
  const fileInputRef = useRef(null);
  const pdfInputRef = useRef(null);
  const uploadRef = useRef(null);
  const editorSurfaceRef = useRef(null);
  const linkRef = useRef(null);
  const creatingInlineRef = useRef(false);
  const pagesRef = useRef(children);
  const canEditRef = useRef(canEdit);
  canEditRef.current = canEdit;
  pagesRef.current = children;
  const childrenKey = children.map((page) => `${Number(page.id)}:${page.title}`).join("\u0000");
  const openPageRef = useRef(onOpenPage);
  openPageRef.current = onOpenPage;
  const pageChangedRef = useRef(onPageChanged);
  pageChangedRef.current = onPageChanged;
  const pageDeletedRef = useRef(onPageDeleted);
  pageDeletedRef.current = onPageDeleted;
  const [linkDialog, setLinkDialog] = useState(null);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState("");
  const [contextToolbar, setContextToolbar] = useState(null);
  const contextToolbarRef = useRef(null);

  useEffect(() => {
    if (!contextToolbar) return;
    const closeOnOutside = (event) => {
      if (!contextToolbarRef.current?.contains(event.target)) setContextToolbar(null);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setContextToolbar(null);
    };
    const closeWhenFar = (event) => {
      const rect = contextToolbarRef.current?.getBoundingClientRect();
      if (!rect) return;
      const hoverTolerance = 64;
      if (event.clientX < rect.left - hoverTolerance || event.clientX > rect.right + hoverTolerance ||
          event.clientY < rect.top - hoverTolerance || event.clientY > rect.bottom + hoverTolerance) setContextToolbar(null);
    };
    window.document.addEventListener("pointerdown", closeOnOutside);
    window.document.addEventListener("keydown", closeOnEscape);
    window.document.addEventListener("pointermove", closeWhenFar);
    return () => {
      window.document.removeEventListener("pointerdown", closeOnOutside);
      window.document.removeEventListener("keydown", closeOnEscape);
      window.document.removeEventListener("pointermove", closeWhenFar);
    };
  }, [contextToolbar]);

  useEffect(() => {
    const showFileDropTarget = (event) => {
      if (Array.from(event.dataTransfer?.types || []).includes("Files"))
        editorSurfaceRef.current?.classList.add("is-file-dragging");
    };
    const hideFileDropTarget = () => editorSurfaceRef.current?.classList.remove("is-file-dragging");
    const hideWhenLeavingWindow = (event) => {
      if (event.clientX <= 0 || event.clientY <= 0 ||
          event.clientX >= window.innerWidth || event.clientY >= window.innerHeight) hideFileDropTarget();
    };
    window.addEventListener("dragenter", showFileDropTarget, true);
    window.addEventListener("dragover", showFileDropTarget, true);
    window.addEventListener("dragleave", hideWhenLeavingWindow, true);
    window.addEventListener("drop", hideFileDropTarget, true);
    window.addEventListener("dragend", hideFileDropTarget, true);
    return () => {
      window.removeEventListener("dragenter", showFileDropTarget, true);
      window.removeEventListener("dragover", showFileDropTarget, true);
      window.removeEventListener("dragleave", hideWhenLeavingWindow, true);
      window.removeEventListener("drop", hideFileDropTarget, true);
      window.removeEventListener("dragend", hideFileDropTarget, true);
    };
  }, []);

  const editor = useEditor({
    editable: canEdit,
    extensions: [StarterKit, TableKit, TextStyleKit, TextAlign.configure({ types: ["heading", "paragraph"] }),
      Image.configure({ resize: { enabled: true } }), TaskList, TaskItem.configure({ nested: true }),
      PdfBlock,
      FileBlock,
  PageBlock.configure({ getPage: (id) => pagesRef.current.find((page) => Number(page.id) === id), canEdit: () => canEditRef.current,
        onOpenPage: (id) => openPageRef.current(id),
        onPageChanged: () => pageChangedRef.current(),
        onPageDeleted: () => pageDeletedRef.current() })],
    content: parseContent(document.content_json),
    editorProps: {
      attributes: { class: "notion-editor" },
      handlePaste: (_view, event) => {
        const files = [...(event.clipboardData?.files || [])];
        if (!files.length) return false;
        uploadRef.current?.(files);
        return true;
      },
      handleKeyDown: (_view, event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          linkRef.current?.();
          return true;
        }
        if (slashRef.current === null) return false;
        if (event.key === "Escape") {
          dismissedSlashRef.current = true;
          slashRef.current = null;
          setSlashQuery(null);
          return true;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setMenuIndex((current) => event.key === "ArrowDown"
            ? (current + 1) % Math.max(1, menuItemsRef.current.length)
            : (current - 1 + Math.max(1, menuItemsRef.current.length)) % Math.max(1, menuItemsRef.current.length));
          return true;
        }
        if (event.key === "Enter" && menuItemsRef.current.length) {
          event.preventDefault();
          chooseBlockRef.current?.(menuItemsRef.current[menuIndexRef.current]?.[2]);
          return true;
        }
        return false;
      },
    },
    onSelectionUpdate: ({ editor: current }) => updateSlashMenu(current),
    onUpdate: ({ editor: current, transaction }) => {
      setFirstBlockType(current.state.doc.firstChild?.type.name || "paragraph");
      updateSlashMenu(current);
      if (suppressRef.current || !canEditRef.current || !transaction?.docChanged) return;
      dirtyRef.current = true;
      setStatus("저장 대기");
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => saveRef.current?.(), 800);
    },
  });
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const saveRef = useRef(null);
  useEffect(() => { editor?.setEditable(canEdit, false); }, [editor, canEdit]);

  function updateSlashMenu(current) {
    const { $from, empty } = current.state.selection;
    const value = empty && current.isActive("paragraph") && $from.parent.isTextblock
      ? $from.parent.textContent : "";
    const next = value.startsWith("/") && value.length <= 32 ? value.slice(1) : null;
    if (next === null) dismissedSlashRef.current = false;
    if (dismissedSlashRef.current) return;
    if (slashRef.current !== next) setMenuIndex(0);
    slashRef.current = next;
    setSlashQuery(next);
  }

  async function saveNow() {
    clearTimeout(timerRef.current);
    if (conflictRef.current) return false;
    if (savingRef.current) {
      await savingRef.current;
      return dirtyRef.current ? saveNow() : !conflictRef.current;
    }
    if (!dirtyRef.current || !editorRef.current) return true;
    dirtyRef.current = false;
    setStatus("저장 중…");
    const payload = { title: titleRef.current, contentJson: JSON.stringify(editorRef.current.getJSON()),
      version: versionRef.current };
    const promise = api(`/documents/${document.id}`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    }).then((saved) => {
      versionRef.current = Number(saved.version);
      setMetadata(saved);
      onSaved(dirtyRef.current ? { ...saved, title: titleRef.current || "제목 없음" } : saved);
      setStatus(dirtyRef.current ? "저장 대기" : "자동저장됨");
      return true;
    }).catch((error) => {
      dirtyRef.current = true;
      if (error.status === 409) { conflictRef.current = true; setConflict(true); setStatus("충돌 · 저장 중지"); }
      else setStatus("저장 실패 · 다시 시도");
      return false;
    }).finally(() => { savingRef.current = null; });
    savingRef.current = promise;
    const ok = await promise;
    if (ok && dirtyRef.current) return saveNow();
    return ok;
  }
  saveRef.current = saveNow;
  useImperativeHandle(ref, () => ({
    flush: saveNow,
    hasUnsaved: () => dirtyRef.current || conflictRef.current,
    renameTitle: async (value) => { changeTitle(value); return saveNow(); },
    syncChildTitle: (id, value) => {
      const current = editorRef.current;
      if (!current) return;
      const transaction = current.state.tr;
      current.state.doc.descendants((node, pos) => {
        if (node.type.name === "pageBlock" && Number(node.attrs.pageId) === Number(id))
          transaction.setNodeMarkup(pos, undefined, { ...node.attrs, title: value });
      });
      if (transaction.docChanged) current.view.dispatch(transaction);
    },
  }));

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    if (!blockMenuOpen) return;
    const closeBlockMenu = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setBlockMenuOpen(false);
    };
    window.document.addEventListener("keydown", closeBlockMenu);
    return () => window.document.removeEventListener("keydown", closeBlockMenu);
  }, [blockMenuOpen]);

  useEffect(() => {
    if (!editor || conflictRef.current || creatingInlineRef.current) return;
    if (document.parent_id == null) return;
    const currentPages = pagesRef.current;
    const active = new Set(currentPages.map((page) => Number(page.id)));
    const placed = new Set();
    const stale = [];
    const renamed = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name !== "pageBlock") return;
      const id = Number(node.attrs.pageId);
      if (active.has(id)) {
        placed.add(id);
        const page = currentPages.find((entry) => Number(entry.id) === id);
        if (page.title !== node.attrs.title) renamed.push({ pos, attrs: { ...node.attrs, title: page.title } });
      }
      else stale.push({ pos, size: node.nodeSize });
    });
    if (stale.length || renamed.length) editor.commands.command(({ tr, dispatch }) => {
      for (const { pos, attrs } of renamed) tr.setNodeMarkup(pos, undefined, attrs);
      for (const { pos, size } of stale.reverse()) tr.delete(pos, pos + size);
      dispatch(tr);
      return true;
    });
    const missing = currentPages.filter((page) => !placed.has(Number(page.id)));
    if (missing.length) editor.commands.insertContentAt(editor.state.doc.content.size,
      missing.map((page) => ({ type: "pageBlock", attrs: { pageId: page.id, title: page.title } })));
  }, [editor, childrenKey, document.parent_id]);

  useEffect(() => {
    if (!remoteSignal || !editor || remoteSignal.actor === actor) return;
    if (remoteSignal.kind === "file") return;
    if (dirtyRef.current || savingRef.current) {
      conflictRef.current = true;
      setConflict(true);
      setStatus("다른 사용자가 수정함 · 현재 내용 보존");
      return;
    }
    api(`/documents/${document.id}`).then((fresh) => {
      if (Number(fresh.version) < versionRef.current) return;
      suppressRef.current = true;
      editor.commands.setContent(parseContent(fresh.content_json));
      suppressRef.current = false;
      versionRef.current = Number(fresh.version);
      titleRef.current = fresh.title;
      setTitle(fresh.title);
      setStatus("다른 사용자의 변경 반영됨");
      setMetadata(fresh);
      onSaved(fresh);
    }).catch(() => setStatus("다른 사용자의 변경을 불러오지 못함"));
  }, [remoteSignal, editor, document.id, actor, onSaved]);

  async function uploadFiles(selected, embedPdf = false, autoEmbedPdf = false, insertAt = null) {
    if (!canEditRef.current) return;
    const blocks = [];
    for (const file of selected) {
      try {
        if (!file.size || file.size > MAX_ATTACHMENT_BYTES) {
          setStatus(`${file.name}: 파일은 50MB 이하만 가능합니다`);
          continue;
        }
        const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
        const previewPdf = embedPdf || (autoEmbedPdf && isPdf);
        if (previewPdf && (!isPdf || await file.slice(0, 5).text() !== "%PDF-")) {
          setStatus("PDF 파일만 삽입할 수 있습니다");
          continue;
        }
        setStatus("파일 업로드 중…");
        const form = new FormData();
        form.append("file", file);
        const uploaded = await api(`/documents/${document.id}/files`, { method: "POST", body: form });
        if (previewPdf) blocks.push({ type: "pdfBlock",
          attrs: { src: `${uploaded.url}/preview`, name: file.name, size: uploaded.size_bytes } });
        else if (imageType(file)) blocks.push({ type: "image", attrs: { src: uploaded.url, alt: file.name } });
        else blocks.push({ type: "fileBlock",
          attrs: { src: uploaded.url, name: file.name, size: uploaded.size_bytes } });
      } catch (error) {
        setStatus(error.status === 413 ? "파일은 50MB 이하만 가능합니다" : `${file.name} 업로드 실패`);
      }
    }
    if (blocks.length && canEditRef.current && editorRef.current) {
      const current = editorRef.current;
      const position = Math.max(0, Math.min(insertAt ?? current.state.selection.to, current.state.doc.content.size));
      current.chain().focus().insertContentAt(position, blocks).run();
      setStatus("업로드 완료 · 저장 대기");
    }
  }
  uploadRef.current = uploadFiles;

  function fileDropPosition(event) {
    const view = editorRef.current?.view;
    if (!view) return null;
    const target = event.target instanceof Element ? event.target : null;
    const block = target?.closest(".notion-pdf-block") || target?.closest(".notion-file-block");
    if (block && view.dom.contains(block)) {
      const position = view.posAtDOM(block, 0);
      const node = view.state.doc.nodeAt(position);
      if (node?.isBlock) return position + node.nodeSize;
    }
    return view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.to;
  }

  function changeTitle(value) {
    if (!canEdit) return;
    setTitle(value);
    titleRef.current = value;
    onTitleChange(document.id, value || "제목 없음");
    dirtyRef.current = true;
    setStatus("저장 대기");
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => saveRef.current?.(), 350);
  }

  function insertParagraphBelowTitle(text = "") {
    if (!canEdit || document.parent_id == null || !editor) return;
    if (editor.state.doc.firstChild?.type.name === "paragraph" && !editor.state.doc.firstChild.content.size) {
      const chain = editor.chain().focus().setTextSelection(1);
      return text ? chain.insertContent(text).run() : chain.run();
    }
    const paragraph = { type: "paragraph", ...(text ? { content: [{ type: "text", text }] } : {}) };
    return editor.chain().focus().insertContentAt(0, paragraph).setTextSelection(1 + text.length).run();
  }

  function transferGapText(text) {
    if (!text || gapTransferRef.current) return;
    gapTransferRef.current = true;
    if (!insertParagraphBelowTitle(text)) gapTransferRef.current = false;
  }

  async function createPageBlock() {
    if (!editor) return;
    creatingInlineRef.current = true;
    const created = await onCreateChild();
    creatingInlineRef.current = false;
    if (!created) return;
    if (document.parent_id == null) {
      await onChildCreated();
      onOpenPage(created.id);
      return;
    }
    editor.chain().focus().insertContent({ type: "pageBlock", attrs: { pageId: created.id, title: created.title } }).run();
    onChildCreated();
  }

  async function createChildCard() {
    if (!canAddChild) return;
    if (!(await saveNow())) return;
    const created = await onCreateChild();
    if (!created) return;
    await onChildCreated();
    onOpenPage(created.id);
  }

  const orderedChildren = children.slice().sort((a, b) =>
    (b.created_at || "").localeCompare(a.created_at || "") || Number(b.id) - Number(a.id));
  const effectivePageSize = viewMode === "AUTO" ? autoPageSize : pageSize;
  const pageCount = Math.max(1, Math.ceil(orderedChildren.length / effectivePageSize));
  const currentPage = Math.min(childPage, pageCount);
  const visibleChildren = orderedChildren.slice((currentPage - 1) * effectivePageSize, currentPage * effectivePageSize);
  const selectableChildren = visibleChildren.filter(canDeleteChild);

  useLayoutEffect(() => {
    if (viewMode !== "AUTO" || document.parent_id != null) return;
    const update = () => {
      const list = listWrapRef.current?.querySelector(".notion-page-list");
      if (!list) return;
      const headerHeight = list.tHead?.getBoundingClientRect().height || 39;
      const rowHeight = list.tBodies[0]?.rows[0]?.getBoundingClientRect().height || 40;
      const appPadding = parseFloat(getComputedStyle(window.document.querySelector(".notion-app")).paddingBottom) || 0;
      const paperPadding = parseFloat(getComputedStyle(list.closest(".notion-paper")).paddingBottom) || 0;
      const paginationSpace = 52;
      const available = window.innerHeight - list.getBoundingClientRect().top - headerHeight
        - appPadding - paperPadding - paginationSpace - 3;
      const count = Math.max(1, Math.floor(available / rowHeight));
      setAutoPageSize((current) => current === count ? current : count);
    };
    update();
    window.addEventListener("resize", update);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    const titleRow = window.document.querySelector(".notion-root-title-row");
    if (titleRow) observer?.observe(titleRow);
    return () => { window.removeEventListener("resize", update); observer?.disconnect(); };
  }, [viewMode, document.parent_id, childrenKey]);

  useEffect(() => {
    const valid = new Set(children.map((page) => Number(page.id)));
    setSelectedChildIds((current) => {
      const next = new Set([...current].filter((id) => valid.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [childrenKey]);

  function toggleChildSelection(id) {
    setSelectedChildIds((current) => {
      const next = new Set(current);
      if (next.has(Number(id))) next.delete(Number(id)); else next.add(Number(id));
      return next;
    });
  }

  async function deleteSelectedChildren() {
    const pages = children.filter((page) => selectedChildIds.has(Number(page.id)) && canDeleteChild(page));
    if (!pages.length || deletingChildren) return;
    if (!window.confirm(`선택한 ${pages.length}개 페이지와 각 하위 페이지를 휴지통으로 이동하시겠습니까?`)) return;
    if (dirtyRef.current && !(await saveNow())) return;
    setDeletingChildren(true);
    const failed = [];
    for (const page of pages) {
      try { await api(`/documents/${page.id}`, { method: "DELETE" }); }
      catch { failed.push(Number(page.id)); }
    }
    if (failed.length !== pages.length) {
      try { await onPageDeleted(); }
      catch { setStatus("삭제는 완료됐지만 목록을 새로고침하지 못했습니다"); }
    }
    setSelectedChildIds(new Set(failed));
    setDeletingChildren(false);
    if (failed.length) setStatus(`${failed.length}개 페이지를 휴지통으로 이동하지 못했습니다`);
  }

  function openLinkDialog() {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const selectedText = editor.state.doc.textBetween(from, to, " ");
    setLinkDialog({ from, to });
    setLinkText(selectedText);
    setLinkUrl(editor.getAttributes("link").href || "");
    setLinkError("");
  }
  linkRef.current = openLinkDialog;

  function insertLink(event) {
    event.preventDefault();
    if (!editor || !linkDialog) return;
    const label = linkText.trim();
    const href = linkUrl.trim();
    if (!label) { setLinkError("표시할 글자를 입력해 주세요."); return; }
    const valid = /^https?:\/\/[^\s]+$/i.test(href) || /^mailto:[^\s@]+@[^\s@]+$/i.test(href)
      || /^\/(?!\/)[^\s]*$/.test(href);
    if (!valid) { setLinkError("http(s) 주소, 메일 주소 또는 /로 시작하는 내부 경로를 입력해 주세요."); return; }
    editor.chain().focus().setTextSelection(linkDialog).insertContent({ type: "text", text: label,
      marks: [{ type: "link", attrs: { href, target: href.startsWith("/") ? "_self" : "_blank" } }] }).run();
    setLinkDialog(null);
  }

  async function deletePage() {
    if (!canDelete) return;
    if (!window.confirm("이 페이지와 하위 페이지를 휴지통으로 이동하시겠습니까?")) return;
    if (dirtyRef.current && !(await saveNow())) return;
    try { await api(`/documents/${document.id}`, { method: "DELETE" }); onDeleted(document.id); }
    catch { setStatus("휴지통으로 이동하지 못했습니다"); }
  }

  async function toggleLock() {
    if (metadata.created_by !== actor) return;
    try {
      const saved = await api(`/documents/${document.id}/lock`, { method: "PUT",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locked: !metadata.locked_for_others }) });
      setMetadata(saved);
      onSaved(saved);
    } catch { setStatus("수정 잠금을 변경하지 못했습니다"); }
  }

  const command = (label, icon, action, active = false) => <button type="button" title={label} aria-label={label}
    className={active ? "is-active" : ""} onClick={action}>{icon}</button>;
  const blockItems = editor ? [
    ["제목 1", <Heading1 size={17}/>, () => editor.chain().focus().toggleHeading({ level: 1 }).run()],
    ["제목 2", <Heading2 size={17}/>, () => editor.chain().focus().toggleHeading({ level: 2 }).run()],
    ["제목 3", <Heading3 size={17}/>, () => editor.chain().focus().toggleHeading({ level: 3 }).run()],
    ["일반 텍스트", <FileText size={17}/>, () => editor.chain().focus().setParagraph().run()],
    ["글머리", <List size={17}/>, () => editor.chain().focus().toggleBulletList().run()],
    ["번호", <ListOrdered size={17}/>, () => editor.chain().focus().toggleOrderedList().run()],
    ["체크리스트", <CheckSquare size={17}/>, () => editor.chain().focus().toggleTaskList().run()],
    ["인용", <Quote size={17}/>, () => editor.chain().focus().toggleBlockquote().run()],
    ["코드 블록", <Code2 size={17}/>, () => editor.chain().focus().toggleCodeBlock().run()],
    ["구분선", <Minus size={17}/>, () => editor.chain().focus().setHorizontalRule().run()],
    ["표 삽입", <Table2 size={17}/>, () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()],
    ["PDF첨부", <FileText size={17}/>, () => pdfInputRef.current?.click()],
    ["파일 첨부", <Upload size={17}/>, () => fileInputRef.current?.click()],
    ["하위 페이지", <FileText size={17}/>, createPageBlock],
    ["링크", <Link2 size={17}/>, openLinkDialog],
  ] : [];
  const visibleBlockItems = slashQuery === null ? blockItems : blockItems.filter(([label]) =>
    label.toLocaleLowerCase("ko").includes(slashQuery.toLocaleLowerCase("ko")));
  menuItemsRef.current = visibleBlockItems;
  menuIndexRef.current = menuIndex;
  function chooseBlock(action) {
    if (!action || !editor) return;
    if (slashRef.current !== null) {
      const { $from } = editor.state.selection;
      editor.chain().focus().deleteRange({ from: $from.start(), to: $from.start() + $from.parent.textContent.length }).run();
    }
    slashRef.current = null;
    setSlashQuery(null);
    setBlockMenuOpen(false);
    action();
  }
  chooseBlockRef.current = chooseBlock;

  const toolbar = <div className="notion-toolbar notion-bubble-toolbar" aria-label="글 서식">
    {command("제목 1", <Heading1 size={17}/>, () => editor?.chain().focus().toggleHeading({ level: 1 }).run(), editor?.isActive("heading", { level: 1 }))}
    {command("제목 2", <Heading2 size={17}/>, () => editor?.chain().focus().toggleHeading({ level: 2 }).run(), editor?.isActive("heading", { level: 2 }))}
    {command("제목 3", <Heading3 size={17}/>, () => editor?.chain().focus().toggleHeading({ level: 3 }).run(), editor?.isActive("heading", { level: 3 }))}
    <span className="tool-separator" />
    {command("굵게", <Bold size={16}/>, () => editor?.chain().focus().toggleBold().run(), editor?.isActive("bold"))}
    {command("기울임", <Italic size={16}/>, () => editor?.chain().focus().toggleItalic().run(), editor?.isActive("italic"))}
    {command("밑줄", <Underline size={16}/>, () => editor?.chain().focus().toggleUnderline().run(), editor?.isActive("underline"))}
    {command("취소선", <Strikethrough size={16}/>, () => editor?.chain().focus().toggleStrike().run(), editor?.isActive("strike"))}
    {command("코드", <Code2 size={16}/>, () => editor?.chain().focus().toggleCode().run(), editor?.isActive("code"))}
    <span className="tool-separator" />
    {command("왼쪽 정렬", <AlignLeft size={17}/>, () => editor?.chain().focus().setTextAlign("left").run())}
    {command("가운데 정렬", <AlignCenter size={17}/>, () => editor?.chain().focus().setTextAlign("center").run())}
    {command("오른쪽 정렬", <AlignRight size={17}/>, () => editor?.chain().focus().setTextAlign("right").run())}
    <span className="tool-separator" />
    <select aria-label="글꼴" defaultValue="" onChange={(event) => editor?.chain().focus().setFontFamily(event.target.value).run()}>
      <option value="" disabled>글꼴</option><option value="Malgun Gothic, sans-serif">맑은 고딕</option>
      <option value="Noto Sans KR, sans-serif">Noto Sans KR</option><option value="Arial, sans-serif">Arial</option>
      <option value="serif">명조</option><option value="monospace">고정폭</option>
    </select>
    <select aria-label="글자 크기" defaultValue="" onChange={(event) => editor?.chain().focus().setFontSize(event.target.value).run()}>
      <option value="" disabled>크기</option>{[12,14,16,18,20,24,28,32,40].map((size) =>
        <option key={size} value={`${size}px`}>{size}</option>)}</select>
    <label className="tool-color" title="글자 색">색<input type="color" defaultValue="#1e293b"
      onChange={(event) => editor?.chain().focus().setColor(event.target.value).run()} /></label>
    <label className="tool-color" title="형광펜">배경<input type="color" defaultValue="#fff59d"
      onChange={(event) => editor?.chain().focus().setBackgroundColor(event.target.value).run()} /></label>
    <span className="tool-separator" />
    {editor?.isActive("table") && <>
      <button type="button" onClick={() => editor.chain().focus().addRowAfter().run()}>행+</button>
      <button type="button" onClick={() => editor.chain().focus().addColumnAfter().run()}>열+</button>
      <button type="button" onClick={() => editor.chain().focus().deleteRow().run()}>행−</button>
      <button type="button" onClick={() => editor.chain().focus().deleteColumn().run()}>열−</button>
      <button type="button" onClick={() => editor.chain().focus().deleteTable().run()}>표 삭제</button>
    </>}
    {command("링크", <Link2 size={17}/>, openLinkDialog)}
    {command("실행 취소", <Undo2 size={17}/>, () => editor?.chain().focus().undo().run())}
    {command("다시 실행", <Redo2 size={17}/>, () => editor?.chain().focus().redo().run())}
  </div>;

  const showTitleMediaGap = document.parent_id != null && canEdit && ["image", "pdfBlock", "fileBlock"].includes(firstBlockType);

  return <section className={"notion-workspace" + (document.parent_id == null ? " notion-root-page" : "")
    + (document.parent_id == null && viewMode === "AUTO" ? " notion-root-page--auto" : "")}>
    <div className="notion-document-header">
      <nav className="notion-document-path" aria-label="문서 경로"><button type="button" onClick={onHome}>기술 문서</button>
        {path.map((item) => <React.Fragment key={item.id}><span>/</span><button type="button"
          onClick={() => onOpenPage(item.id)}>{item.title}</button></React.Fragment>)}
        <span>/</span><strong>{title || "제목 없음"}</strong></nav>
      {globalSearch}
      <span className={`notion-save-state${status === "자동저장됨" ? " is-saved" : ""}`}>{status}</span>
      <span className="notion-author-info">최초 입력 {metadata.created_by_name || metadata.created_by} · 최종 수정 {metadata.updated_by_name || metadata.updated_by} {metadata.updated_at?.replace("T", " ")}</span>
      {document.parent_id != null && metadata.created_by === actor && <button type="button" className="notion-lock-button" onClick={toggleLock}>
        {metadata.locked_for_others ? "수정 불가 해제" : "수정 불가"}</button>}
      {document.parent_id == null && (selectableChildren.length > 0 || selectedChildIds.size > 0) &&
        <button type="button" className={`notion-selection-toggle${selectedChildIds.size > 0 ? " is-active" : ""}`}
          disabled={deletingChildren}
          onClick={() => setSelectedChildIds((current) => current.size > 0
            ? new Set() : new Set(selectableChildren.map((page) => Number(page.id))))}>
          {selectedChildIds.size > 0 && <span className="notion-selection-count">{selectedChildIds.size}개</span>}
          {selectedChildIds.size > 0 ? "페이지 선택 해제" : "현재 페이지 모두 선택"}</button>}
      {(canDelete || selectedChildIds.size > 0) && <button type="button" className="notion-delete"
        onClick={selectedChildIds.size > 0 ? deleteSelectedChildren : deletePage} disabled={deletingChildren}>
        {deletingChildren ? "삭제 중…" : selectedChildIds.size > 0 ? "선택 페이지 삭제" : "현재 페이지 삭제"}</button>}
    </div>
    {conflict && <div className="notion-warning">다른 사용자의 수정과 충돌했습니다. 현재 내용은 브라우저에 유지됩니다. 필요한 내용을 복사한 뒤 페이지를 새로 열어 주세요.</div>}
    <div className={`notion-paper${showTitleMediaGap ? " has-title-media-gap" : ""}`}>
      <div className={document.parent_id == null ? "notion-root-title-row" : ""}>
        <input className="notion-title-input" value={title} readOnly={!canEdit} onChange={(event) => changeTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !canEdit || document.parent_id == null || !editor) return;
            event.preventDefault();
            insertParagraphBelowTitle();
          }}
          placeholder="제목 없음" aria-label="문서 제목" maxLength={200} />
        {document.parent_id == null && <div className="notion-root-tools">
          <select aria-label="보기 선택" value={`${viewMode}:${pageSize}`} onChange={(event) => {
            setChildPage(1); onViewChange(event.target.value);
          }}>
            <optgroup label="목록 보기">
              <option value="AUTO:20">목록 기본 보기</option>
              <option value="LIST:20">목록 · 20개 보기</option>
              <option value="LIST:50">목록 · 50개 보기</option>
              <option value="LIST:100">목록 · 100개 보기</option>
            </optgroup>
            <optgroup label="카드 보기">
              <option value="CARD:20">카드 · 20개 보기</option>
              <option value="CARD:50">카드 · 50개 보기</option>
              <option value="CARD:100">카드 · 100개 보기</option>
            </optgroup>
          </select>
          {canAddChild && <button type="button" onClick={createChildCard}><Plus size={16}/> 페이지 추가</button>}
        </div>}
      </div>
      {showTitleMediaGap && <input type="text" className="notion-title-media-gap"
        aria-label="제목 아래 내용 입력" title="여기에 입력하거나 Enter를 눌러 줄 추가"
        onFocus={() => { gapTransferRef.current = false; }}
        onCompositionStart={() => { gapComposingRef.current = true; }}
        onCompositionEnd={(event) => {
          gapComposingRef.current = false;
          transferGapText(event.currentTarget.value);
        }}
        onChange={(event) => {
          if (!gapComposingRef.current && !event.nativeEvent.isComposing)
            transferGapText(event.currentTarget.value);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          if (event.currentTarget.value) transferGapText(event.currentTarget.value);
          else insertParagraphBelowTitle();
        }}/>}
      {canEdit && editor && contextToolbar && createPortal(<div ref={contextToolbarRef} className="notion-context-toolbar"
        style={{ left: contextToolbar.x, top: contextToolbar.y }}>
        {toolbar}
      </div>, window.document.body)}
      {canEdit && editor && <FloatingMenu editor={editor} options={{ placement: "left-start" }}
        shouldShow={({ editor: current, state }) => current.isFocused && state.selection.empty &&
          current.isActive("paragraph") && (current.state.doc.resolve(state.selection.from).parent.textContent === "" ||
            current.state.doc.resolve(state.selection.from).parent.textContent.startsWith("/"))}>
        <div className="notion-block-control">
          <button type="button" className="notion-block-plus" aria-label="블록 추가" title="블록 추가"
            onMouseDown={(event) => event.preventDefault()} onClick={() => setBlockMenuOpen((open) => !open)}><Plus size={17}/></button>
          {(blockMenuOpen || slashQuery !== null) && <div className="notion-block-menu" aria-label="블록 유형">
            {visibleBlockItems.map(([label, icon, action], index) => <button key={label} type="button" aria-label={label}
              className={index === menuIndex && slashQuery !== null ? "is-selected" : ""}
              onMouseDown={(event) => event.preventDefault()} onClick={() => chooseBlock(action)}>
              {icon}<span>{label}</span></button>)}
            {slashQuery !== null && visibleBlockItems.length === 0 && <small>일치하는 블록이 없습니다.</small>}
          </div>}
        </div>
      </FloatingMenu>}
      <input ref={fileInputRef} type="file" multiple hidden onChange={(event) => {
        uploadFiles([...event.target.files]); event.target.value = "";
      }} />
      <input ref={pdfInputRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(event) => {
        uploadFiles([...event.target.files], true); event.target.value = "";
      }} />
      {document.parent_id != null && <div ref={editorSurfaceRef} className="notion-editor-surface" onMouseDown={(event) => {
        if (canEdit && (event.target === editorSurfaceRef.current || event.target === editor?.view.dom))
          editor.chain().focus("end").run();
      }} onDragOverCapture={(event) => {
        if (!Array.from(event.dataTransfer?.types || []).includes("Files")) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = canEdit ? "copy" : "none";
      }} onDropCapture={(event) => {
        const files = [...(event.dataTransfer?.files || [])];
        if (!files.length) return;
        event.preventDefault();
        event.stopPropagation();
        editorSurfaceRef.current?.classList.remove("is-file-dragging");
        if (canEdit) uploadFiles(files, false, true, fileDropPosition(event));
      }} onContextMenu={(event) => {
        if (!canEdit || event.target.closest("input, textarea")) return;
        event.preventDefault();
        if (event.target.closest(".notion-page-block")) return;
        setContextToolbar({ x: Math.max(8, Math.min(event.clientX - 20, window.innerWidth - 770)),
          y: Math.max(8, Math.min(event.clientY - 20, window.innerHeight - 54)) });
      }}><EditorContent editor={editor} /></div>}
      {document.parent_id == null && <section className="notion-subpages" aria-label="하위 페이지">
        {visibleChildren.length ? viewMode !== "CARD" ? <div className="notion-page-list-wrap" ref={listWrapRef}>
          <table className="notion-page-list">
            <colgroup><col className="notion-list-number-col"/><col/>
              <col className="notion-list-editor-col"/><col className="notion-list-date-col"/><col className="notion-list-select-col"/></colgroup>
            <thead><tr><th scope="col">번호</th><th scope="col">제목</th>
              <th scope="col">최종 수정자</th><th scope="col">최종 수정일</th><th scope="col">선택</th></tr></thead>
            <tbody>{visibleChildren.map((page, index) => <tr key={page.id} className={selectedChildIds.has(Number(page.id)) ? "is-selected" : ""}>
              <td>{orderedChildren.length - ((currentPage - 1) * effectivePageSize + index)}</td>
              <td className="notion-list-open-cell"><button type="button" className="notion-list-title" title={page.title} onClick={() => onOpenPage(page.id)}>
                <FileText size={15}/><span>{page.title}</span></button></td>
              <td>{page.updated_by_name || page.updated_by || "—"}</td>
              <td>{page.updated_at?.slice(0, 16).replace("T", " ") || "—"}</td>
              <td><input type="checkbox" aria-label={`${page.title} 선택`} checked={selectedChildIds.has(Number(page.id))}
                disabled={!canDeleteChild(page) || deletingChildren} onChange={() => toggleChildSelection(page.id)}/></td>
            </tr>)}</tbody>
          </table>
        </div> : <div className={`notion-card-grid notion-card-grid--${pageSize}`}>{visibleChildren.map((page) => <article key={page.id} className={`notion-card${selectedChildIds.has(Number(page.id)) ? " is-selected" : ""}`}>
          <label className="notion-card-select" title={canDeleteChild(page) ? "삭제할 페이지 선택" : "수정 잠금으로 선택할 수 없습니다"}>
            <input type="checkbox" aria-label={`${page.title} 선택`} checked={selectedChildIds.has(Number(page.id))}
              disabled={!canDeleteChild(page) || deletingChildren} onChange={() => toggleChildSelection(page.id)}/>
          </label>
          <button type="button" onClick={() => onOpenPage(page.id)}>
            <span className="notion-card-title"><FileText size={17}/><strong title={page.title}>{page.title}</strong></span>
            <small title={`최종 수정 ${page.updated_by_name || page.updated_by || "—"} · ${page.updated_at?.replace("T", " ") || "—"}`}>
              {pageSize === 100
                ? `${page.updated_by_name || page.updated_by || "—"} · ${page.updated_at?.slice(5, 16).replace("T", " ") || "—"}`
                : `최종 수정 ${page.updated_by_name || page.updated_by || "—"} · ${page.updated_at?.replace("T", " ") || "—"}`}
            </small>
          </button>
        </article>)}</div> : <p className="notion-subpages-empty">아직 페이지가 없습니다.</p>}
        {pageCount > 1 && <nav className="notion-pagination" aria-label="페이지 목록 넘기기">
          <button type="button" disabled={currentPage === 1} onClick={() => setChildPage(currentPage - 1)}>이전</button>
          <span>{currentPage} / {pageCount}</span>
          <button type="button" disabled={currentPage === pageCount} onClick={() => setChildPage(currentPage + 1)}>다음</button>
        </nav>}
      </section>}
    </div>
    {linkDialog && <div className="notion-link-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) setLinkDialog(null);
    }}>
      <form className="notion-link-dialog" onSubmit={insertLink} onKeyDown={(event) => {
        if (event.key === "Escape") setLinkDialog(null);
      }}>
        <h3>링크 추가</h3>
        <label>표시할 글자<input autoFocus value={linkText} onChange={(event) => setLinkText(event.target.value)} /></label>
        <label>연결 주소<input value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)}
          placeholder="https://example.com 또는 /note/?page=1" /></label>
        {linkError && <p role="alert">{linkError}</p>}
        <div><button type="button" onClick={() => setLinkDialog(null)}>취소</button><button type="submit">확인</button></div>
      </form>
    </div>}
  </section>;
});

export default EditorPane;
