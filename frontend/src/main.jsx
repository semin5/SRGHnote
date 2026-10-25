import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { ChevronDown, ChevronRight, FileText, Folder, GripVertical, Menu, Pencil, Plus, Search, Trash2, RotateCcw, X } from "lucide-react";
import { api, loadItIdentity } from "./api";
import EditorPane from "./EditorPane";
import GlobalSearch from "./GlobalSearch";
import { buildSearchIndex, searchDocuments } from "./search";
import "./style.css";
import "./notion.css";

function routeUrl(pageId, showTrash = false, searchTerm = "") {
  if (showTrash) return `${window.location.pathname}?view=trash`;
  if (searchTerm) return `${window.location.pathname}?search=${encodeURIComponent(searchTerm)}`;
  return pageId ? `${window.location.pathname}?page=${pageId}` : window.location.pathname;
}

function updateRoute(pageId, showTrash = false, replace = false, searchTerm = "") {
  const url = routeUrl(pageId, showTrash, searchTerm);
  if (`${window.location.pathname}${window.location.search}` !== url)
    window.history[replace ? "replaceState" : "pushState"](null, "", url);
}

function routeFromLocation(documents) {
  const params = new URLSearchParams(window.location.search);
  if (params.get("view") === "trash") return { pageId: null, showTrash: true, searchTerm: "" };
  const searchTerm = params.get("search")?.trim();
  if (searchTerm) return { pageId: null, showTrash: false, searchTerm };
  const id = Number(params.get("page"));
  return { pageId: documents.find((item) => Number(item.id) === id)?.id ?? null,
    showTrash: false, searchTerm: "" };
}

function TreeItem({ item, all, depth, selectedId, collapsed, toggle, select, addChild, rename, remove,
  canEdit, canDelete, canAddChild, dragStart, dragOver, drop, dragEnd, draggingId, dropTargetId }) {
  const children = all.filter((entry) => Number(entry.parent_id) === Number(item.id));
  const isClosed = collapsed.has(item.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  function cancelEdit() { setEditing(false); setDraft(item.title); setError(""); }
  useEffect(() => {
    if (!editing) return;
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      cancelEdit();
    };
    window.document.addEventListener("keydown", onKeyDown);
    return () => window.document.removeEventListener("keydown", onKeyDown);
  }, [editing, item.title]);
  async function saveTitle(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const result = await rename(item.id, draft);
    setBusy(false);
    if (result) setEditing(false);
    else setError("제목을 수정하지 못했습니다. 다시 시도해 주세요.");
  }
  return <>
    <div data-document-id={item.id} className={"notion-tree-item " + (Number(selectedId) === Number(item.id) ? "selected " : "")
      + (depth === 0 && item.parent_id == null && dragStart ? "is-root " : "")
      + (Number(draggingId) === Number(item.id) ? "is-dragging " : "")
      + (Number(dropTargetId) === Number(item.id) ? "is-drop-target" : "")}
      draggable={depth === 0 && item.parent_id == null && !editing && Boolean(dragStart)}
      onDragStart={depth === 0 && item.parent_id == null ? (event) => dragStart?.(event, item.id) : undefined}
      onDragOver={depth === 0 && item.parent_id == null ? (event) => dragOver?.(event, item.id) : undefined}
      onDrop={depth === 0 && item.parent_id == null ? (event) => drop?.(event, item.id) : undefined}
      onDragEnd={dragEnd}
      style={{ paddingLeft: 10 + depth * 16 }}>
      {depth === 0 && item.parent_id == null && dragStart && <GripVertical className="notion-root-grip" size={14} aria-label="드래그하여 순서 변경"/>}
      {children.length > 0 && <button className="notion-tree-expand" aria-label={isClosed ? "펼치기" : "접기"}
        onClick={() => toggle(item.id)}>{isClosed ? <ChevronRight size={14}/> : <ChevronDown size={14}/>}</button>}
      {editing ? <form className="notion-tree-rename" onSubmit={saveTitle}>
        <input autoFocus aria-label="페이지 이름" value={draft} maxLength={200} disabled={busy}
          onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Escape") { event.stopPropagation(); cancelEdit(); }
          }}/>
        <button type="submit" aria-label="수정 저장" disabled={busy}>저장</button>
        <button type="button" aria-label="수정 취소" onClick={cancelEdit}>취소</button>
      </form> : <>
        <button className="notion-tree-title" onClick={() => select(item.id)}>
          {item.parent_id == null ? <Folder size={15}/> : <FileText size={15}/>}
          <span>{item.title}</span></button>
        {canAddChild(item) && <button className="notion-tree-add" title="하위 페이지 추가" aria-label={`${item.title} 아래 페이지 추가`}
          onClick={() => addChild(item.id)}><Plus size={14}/></button>}
        {canEdit(item) && <button className="notion-tree-action" title="페이지 수정" aria-label={`${item.title} 수정`}
          onClick={() => { setDraft(item.title); setEditing(true); }}><Pencil size={14}/></button>}
        {canDelete(item) && <button className="notion-tree-action notion-tree-remove" title="페이지 삭제" aria-label={`${item.title} 삭제`}
          onClick={() => remove(item.id, item.title)}><Trash2 size={14}/></button>}
      </>}
    </div>
    {error && <small className="notion-tree-error" role="alert">{error}</small>}
    {!isClosed && children.map((child) => <TreeItem key={child.id} item={child} all={all} depth={depth + 1}
      selectedId={selectedId} collapsed={collapsed} toggle={toggle} select={select} addChild={addChild}
      rename={rename} remove={remove} canEdit={canEdit} canDelete={canDelete} canAddChild={canAddChild} />)}
  </>;
}

function App() {
  const [auth, setAuth] = useState(null);
  const [docs, setDocs] = useState([]);
  const [rootOrder, setRootOrder] = useState([]);
  const draggedId = useRef(null);
  const reorderingRef = useRef(false);
  const [draggingId, setDraggingId] = useState(null);
  const [dropTargetId, setDropTargetId] = useState(null);
  const [rootDialogOpen, setRootDialogOpen] = useState(false);
  const [rootDraft, setRootDraft] = useState("");
  const [rootCreating, setRootCreating] = useState(false);
  const [trash, setTrash] = useState([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [document, setDocument] = useState(null);
  const [query, setQuery] = useState("");
  const [searchDraft, setSearchDraft] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [viewMode, setViewMode] = useState("AUTO");
  const [collapsed, setCollapsed] = useState(new Set());
  const [remoteSignal, setRemoteSignal] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loadingDoc, setLoadingDoc] = useState(false);
  const [message, setMessage] = useState("");
  const editorRef = useRef(null);
  const selectedRef = useRef(null);
  const historyNavigationRef = useRef(0);
  selectedRef.current = selectedId;
  const searchIndex = useMemo(() => buildSearchIndex(docs), [docs]);

  useEffect(() => {
    let live = true;
    const connect = async () => {
      try {
        const user = await loadItIdentity();
        if (live) setAuth((current) => current?.username === user.username && current?.role === user.role ? current : user);
      } catch (error) {
        if (error.status === 401) window.top.location.assign("/it/");
        // Keep the open workspace visible during a transient network failure.
      }
    };
    connect();
    const timer = setInterval(connect, 5 * 60 * 1000);
    const onVisible = () => { if (window.document.visibilityState === "visible") connect(); };
    window.document.addEventListener("visibilitychange", onVisible);
    return () => { live = false; clearInterval(timer); window.document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  const reloadDocs = useCallback(async () => {
    const list = await api("/documents");
    setDocs(list);
    return list;
  }, []);
  const reloadTrash = useCallback(async () => {
    const list = await api("/documents/trash");
    setTrash(list);
    return list;
  }, []);

  useEffect(() => {
    if (!auth) return;
    Promise.all([reloadDocs(), api("/documents/order")]).then(([list, order]) => {
      setRootOrder(order);
      const route = routeFromLocation(list);
      setSelectedId(route.pageId);
      setTrashOpen(route.showTrash);
      setSearchTerm(route.searchTerm);
      setSearchDraft(route.searchTerm);
      if (route.showTrash) reloadTrash().catch(() => {});
      if (!route.showTrash) updateRoute(route.pageId, false, true, route.searchTerm);
    }).catch(() => setMessage("문서 목록을 불러오지 못했습니다."));
  }, [auth, reloadDocs, reloadTrash]);

  useEffect(() => {
    if (!auth) return;
    api("/documents/preferences").then((settings) => {
      if ([20, 50, 100].includes(settings.pageSize)) setPageSize(settings.pageSize);
      setViewMode(["AUTO", "LIST", "CARD"].includes(settings.viewMode) ? settings.viewMode : "AUTO");
    }).catch(() => {});
  }, [auth]);

  async function changeView(value) {
    const [mode, size] = value.split(":");
    const nextSize = Number(size);
    if (!["AUTO", "LIST", "CARD"].includes(mode) || ![20, 50, 100].includes(nextSize)
        || (mode === "AUTO" && nextSize !== 20)) return;
    const previousSize = pageSize;
    const previousMode = viewMode;
    setPageSize(nextSize);
    setViewMode(mode);
    try {
      await api("/documents/preferences", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageSize: nextSize, viewMode: mode }) });
    } catch {
      setPageSize(previousSize);
      setViewMode(previousMode);
      setMessage("보기 설정을 저장하지 못했습니다.");
    }
  }

  useEffect(() => {
    if (!auth || !selectedId) {
      setDocument(null);
      setLoadingDoc(false);
      return;
    }
    let live = true;
    setLoadingDoc(true);
    api(`/documents/${selectedId}`).then((item) => { if (live) { setDocument(item); setMessage(""); } })
      .catch(() => { if (live) { setDocument(null); setMessage("문서를 불러오지 못했습니다."); } })
      .finally(() => { if (live) setLoadingDoc(false); });
    return () => { live = false; };
  }, [auth, selectedId]);

  useEffect(() => {
    if (!auth) return;
    const onPopState = async () => {
      const navigation = ++historyNavigationRef.current;
      const route = routeFromLocation(docs);
      if (editorRef.current && !(await editorRef.current.flush())) {
        if (navigation !== historyNavigationRef.current) return;
        setMessage("현재 문서를 저장하지 못해 이동을 취소했습니다. 내용을 확인해 주세요.");
        updateRoute(selectedRef.current, trashOpen, true, searchTerm);
        return;
      }
      if (navigation !== historyNavigationRef.current) return;
      if (Number(route.pageId) !== Number(selectedRef.current)) setDocument(null);
      setSelectedId(route.pageId);
      setTrashOpen(route.showTrash);
      setSearchTerm(route.searchTerm);
      setSearchDraft(route.searchTerm);
      setSidebarOpen(false);
      if (route.showTrash) reloadTrash().catch(() => {});
      else updateRoute(route.pageId, false, true, route.searchTerm);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [auth, docs, trashOpen, searchTerm, reloadTrash]);

  async function submitSearch(value) {
    const term = value.trim();
    if (!term) return;
    if (editorRef.current && !(await editorRef.current.flush())) {
      setMessage("현재 문서를 저장하지 못했습니다. 검색 전에 내용을 확인해 주세요.");
      return;
    }
    setSearchDraft(term);
    setSearchTerm(term);
    setSelectedId(null);
    setDocument(null);
    setTrashOpen(false);
    setSidebarOpen(false);
    updateRoute(null, false, false, term);
  }

  useEffect(() => {
    if (!auth) return;
    const events = new EventSource("/note/api/events");
    events.addEventListener("change", (event) => {
      const change = JSON.parse(event.data);
      reloadDocs().then((list) => {
        if (change.change_type === "deleted" && Number(change.document_id) === Number(selectedRef.current)
          && !list.some((item) => Number(item.id) === Number(change.document_id))) {
          setSelectedId(null);
          updateRoute(null, false, true);
        }
      }).catch(() => {});
      if (["deleted", "restored", "purged"].includes(change.change_type)) reloadTrash().catch(() => {});
      if (Number(change.document_id) === Number(selectedRef.current)) {
        if (change.change_type === "file")
          setRemoteSignal({ actor: change.changed_by, eventId: change.id, kind: "file" });
        if (["updated", "locked"].includes(change.change_type) && change.changed_by !== auth.username)
          setRemoteSignal({ actor: change.changed_by, eventId: change.id });
      }
    });
    return () => events.close();
  }, [auth, reloadDocs, reloadTrash]);

  async function select(id) {
    if (Number(selectedId) === Number(id)) {
      setTrashOpen(false);
      setSearchTerm("");
      setSearchDraft("");
      setSidebarOpen(false);
      updateRoute(id);
      return;
    }
    if (editorRef.current && !(await editorRef.current.flush())) {
      setMessage("현재 문서를 저장하지 못했습니다. 다른 페이지로 이동하기 전 내용을 확인해 주세요.");
      return;
    }
    setDocument(null);
    setSelectedId(id);
    setTrashOpen(false);
    setSearchTerm("");
    setSearchDraft("");
    setSidebarOpen(false);
    updateRoute(id);
  }

  async function create(parentId = null, title = "제목 없음") {
    if (editorRef.current && !(await editorRef.current.flush())) {
      setMessage("현재 문서를 먼저 저장해 주세요.");
      return null;
    }
    try {
      const created = await api("/documents", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, parentId }) });
      await reloadDocs();
      if (parentId) setCollapsed((current) => { const next = new Set(current); next.delete(parentId); return next; });
      setDocument(null);
      setSelectedId(created.id);
      setTrashOpen(false);
      setSearchTerm("");
      setSearchDraft("");
      setSidebarOpen(false);
      updateRoute(created.id);
      return created;
    } catch { setMessage("페이지를 만들지 못했습니다."); return null; }
  }

  async function createRoot(event) {
    event.preventDefault();
    const title = rootDraft.trim();
    if (!title || rootCreating) return;
    setRootCreating(true);
    const created = await create(null, title);
    setRootCreating(false);
    if (created) { setRootDialogOpen(false); setRootDraft(""); }
  }

  async function createInlineChild(parentId) {
    try {
      const created = await api("/documents", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "제목 없음", parentId }) });
      setCollapsed((current) => { const next = new Set(current); next.delete(parentId); return next; });
      return created;
    } catch {
      setMessage("하위 페이지를 만들지 못했습니다.");
      return null;
    }
  }

  async function renamePage(id, value) {
    const title = value.trim() || "제목 없음";
    try {
      if (Number(selectedId) === Number(id) && editorRef.current) {
        if (!(await editorRef.current.renameTitle(title))) return false;
      } else {
        const current = await api(`/documents/${id}`);
        await api(`/documents/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title, contentJson: current.content_json, version: current.version }) });
        editorRef.current?.syncChildTitle(id, title);
      }
      await reloadDocs();
      return true;
    } catch {
      await reloadDocs().catch(() => {});
      return false;
    }
  }

  async function removePage(id, title) {
    if (!window.confirm(`‘${title}’ 페이지와 하위 페이지를 휴지통으로 이동하시겠습니까?`)) return;
    if (editorRef.current && !(await editorRef.current.flush())) {
      setMessage("현재 문서를 먼저 저장해 주세요.");
      return;
    }
    try {
      await api(`/documents/${id}`, { method: "DELETE" });
      let current = docs.find((entry) => Number(entry.id) === Number(selectedRef.current));
      const visited = new Set();
      while (current && !visited.has(Number(current.id))) {
        if (Number(current.id) === Number(id)) { setDocument(null); break; }
        visited.add(Number(current.id));
        current = docs.find((entry) => Number(entry.id) === Number(current.parent_id));
      }
      const list = await reloadDocs();
      await reloadTrash();
      if (!list.some((item) => Number(item.id) === Number(selectedRef.current))) {
        setDocument(null);
        setSelectedId(null);
        updateRoute(null, false, true);
      }
    } catch { setMessage("페이지를 휴지통으로 이동하지 못했습니다."); }
  }

  const onSaved = useCallback((saved) => {
    setDocs((current) => current.map((item) => Number(item.id) === Number(saved.id)
      ? { ...item, title: saved.title, version: saved.version, updated_at: saved.updated_at,
        updated_by: saved.updated_by, updated_by_name: saved.updated_by_name, locked_for_others: saved.locked_for_others } : item));
  }, []);
  const onTitleChange = useCallback((id, title) => {
    setDocs((current) => current.map((item) => Number(item.id) === Number(id) ? { ...item, title } : item));
  }, []);
  const onDeleted = useCallback(async (id) => {
    const list = await reloadDocs();
    await reloadTrash();
    if (Number(selectedRef.current) === Number(id)) {
      setDocument(null);
      setSelectedId(null);
      updateRoute(null, false, true);
    }
  }, [reloadDocs, reloadTrash]);

  async function openTrash() {
    if (editorRef.current && !(await editorRef.current.flush())) {
      setMessage("현재 문서를 먼저 저장해 주세요.");
      return;
    }
    try { await reloadTrash(); setTrashOpen(true); setSearchTerm(""); setSearchDraft("");
      setSidebarOpen(false); updateRoute(null, true); }
    catch { setMessage("휴지통을 불러오지 못했습니다."); }
  }

  async function restorePage(id) {
    try {
      await api(`/documents/${id}/restore`, { method: "POST" });
      await Promise.all([reloadDocs(), reloadTrash()]);
      setTrashOpen(false);
      setSearchTerm("");
      setSearchDraft("");
      setDocument(null);
      setSelectedId(id);
      updateRoute(id);
    } catch (error) { setMessage(error.status === 409 ? "상위 페이지를 먼저 복원해 주세요." : "페이지를 복원하지 못했습니다."); }
  }

  async function permanentlyDelete(id, title) {
    if (!window.confirm(`‘${title}’ 페이지와 하위 페이지, 첨부파일을 영구 삭제하시겠습니까? 되돌릴 수 없습니다.`)) return;
    try { await api(`/documents/${id}/permanent`, { method: "DELETE" }); await reloadTrash(); }
    catch { setMessage("영구 삭제하지 못했습니다."); }
  }

  function toggle(id) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function home() {
    if (editorRef.current && !(await editorRef.current.flush())) return;
    setSelectedId(null);
    setDocument(null);
    setTrashOpen(false);
    setSearchTerm("");
    setSearchDraft("");
    setSidebarOpen(false);
    updateRoute(null);
  }

  function closeTrash() {
    setTrashOpen(false);
    updateRoute(selectedId);
  }

  async function moveRoot(targetId) {
    const source = Number(draggedId.current);
    if (!source || source === Number(targetId) || reorderingRef.current) return;
    const ids = roots.map((item) => Number(item.id));
    if (!ids.includes(source) || !ids.includes(Number(targetId))) return;
    ids.splice(ids.indexOf(source), 1);
    ids.splice(ids.indexOf(Number(targetId)), 0, source);
    const previous = rootOrder;
    setRootOrder(ids);
    reorderingRef.current = true;
    try { await api("/documents/order", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }); }
    catch { setRootOrder(previous); setMessage("개인별 순서를 저장하지 못했습니다."); }
    finally { reorderingRef.current = false; }
  }

  function beginRootDrag(event, id) {
    if (reorderingRef.current) { event.preventDefault(); return; }
    draggedId.current = Number(id);
    setDraggingId(Number(id));
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(id));
  }

  function hoverRoot(event, id) {
    if (draggedId.current == null) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetId(Number(id));
  }

  function endRootDrag() {
    draggedId.current = null;
    setDraggingId(null);
    setDropTargetId(null);
  }

  function dropRoot(event, id) {
    event.preventDefault();
    void moveRoot(id);
    endRootDrag();
  }

  const isAdmin = ["ADMIN", "SUPER_ADMIN"].includes(auth?.role);
  const canEdit = (item) => item.parent_id == null ? isAdmin
    : !item.locked_for_others || item.created_by === auth?.username;
  const canDelete = (item) => item.parent_id == null ? auth?.role === "SUPER_ADMIN" : canEdit(item);
  const canRestore = (item) => item.parent_id == null
    ? isAdmin
    : canDelete(item);
  const canAddChild = (item) => item.parent_id == null
    || !item.locked_for_others || item.created_by === auth?.username;

  if (!auth) return <main className="notion-connecting" role="status">기술 문서에 연결 중입니다…</main>;

  const roots = docs.filter((item) => item.parent_id == null || !docs.some((parent) =>
    Number(parent.id) === Number(item.parent_id))).sort((a, b) => {
      const ai = rootOrder.indexOf(Number(a.id));
      const bi = rootOrder.indexOf(Number(b.id));
      return (ai < 0 ? rootOrder.length + Number(a.id) : ai) - (bi < 0 ? rootOrder.length + Number(b.id) : bi);
    });
  const results = query.trim() ? roots.filter((item) => item.title.toLocaleLowerCase("ko")
    .includes(query.trim().toLocaleLowerCase("ko"))) : null;
  const childCounts = new Map();
  docs.forEach((item) => {
    if (item.parent_id != null) childCounts.set(Number(item.parent_id), (childCounts.get(Number(item.parent_id)) || 0) + 1);
  });
  const docById = new Map(docs.map((item) => [Number(item.id), item]));
  let activeRootId = null;
  let currentPage = docById.get(Number(selectedId)) ||
    (Number(document?.id) === Number(selectedId) ? document : null);
  const visitedPages = new Set();
  while (currentPage && !visitedPages.has(Number(currentPage.id))) {
    visitedPages.add(Number(currentPage.id));
    activeRootId = currentPage.id;
    currentPage = currentPage.parent_id ? docById.get(Number(currentPage.parent_id)) : null;
  }
  const path = [];
  let ancestor = document?.parent_id ? docById.get(Number(document.parent_id)) : null;
  const seen = new Set();
  while (ancestor && !seen.has(Number(ancestor.id))) {
    seen.add(Number(ancestor.id));
    path.unshift({ id: ancestor.id, title: ancestor.title });
    ancestor = ancestor.parent_id ? docById.get(Number(ancestor.parent_id)) : null;
  }
  const trashRoots = trash.filter((item) => item.parent_id == null || !trash.some((parent) =>
    Number(parent.id) === Number(item.parent_id)));
  const globalSearch = <GlobalSearch value={searchDraft} onChange={setSearchDraft}
    onSubmit={submitSearch} onOpenDocument={select} index={searchIndex}/>;
  const fullResults = searchDocuments(searchIndex, searchTerm);

  return <main className="notion-app">
    <button className="notion-menu-toggle" onClick={() => setSidebarOpen((open) => !open)}
      aria-label="메뉴"><Menu size={20}/></button>
    <div className="notion-layout">
      <aside className={"notion-sidebar " + (sidebarOpen ? "open" : "")}>
        <div className="notion-sidebar-heading"><button className="notion-home-link" onClick={home}><strong>SRGH IT</strong></button>
          {isAdmin && <button title="최상위 폴더 추가" onClick={() => setRootDialogOpen(true)}><Plus size={18}/></button>}</div>
        <label className="notion-search"><Search size={16}/><input value={query} onChange={(event) => setQuery(event.target.value)}
          placeholder="문서 검색"/><button onClick={() => setQuery("")} aria-label="검색 지우기">{query && <X size={14}/>}</button></label>
        <div className="notion-tree">
          {results ? results.map((item) => <TreeItem key={item.id} item={item} all={[]} depth={0}
            selectedId={trashOpen ? null : activeRootId} collapsed={collapsed} toggle={toggle} select={select} addChild={create}
            rename={renamePage} remove={removePage} canEdit={canEdit} canDelete={canDelete} canAddChild={canAddChild}/>) : roots.map((item) => <TreeItem key={item.id} item={item} all={[]} depth={0}
              selectedId={trashOpen ? null : activeRootId} collapsed={collapsed} toggle={toggle} select={select} addChild={create}
              rename={renamePage} remove={removePage} canEdit={canEdit} canDelete={canDelete} canAddChild={canAddChild}
              dragStart={beginRootDrag} dragOver={hoverRoot} drop={dropRoot} dragEnd={endRootDrag}
              draggingId={draggingId} dropTargetId={dropTargetId}/>)}
          {!docs.length && <p className="notion-sidebar-empty">아직 작성한 페이지가 없습니다.</p>}
        </div>
        <button className={"notion-trash-link " + (trashOpen ? "selected" : "")} onClick={openTrash}><Trash2 size={16}/> 휴지통{trash.length > 0 && <span>{trash.length}</span>}</button>
      </aside>
      <div className="notion-content">
        {message && <div className="notion-notice">{message}<button onClick={() => setMessage("")}><X size={15}/></button></div>}
        {trashOpen ? <section className="notion-trash-view">
          <div className="notion-document-header notion-trash-header"><nav className="notion-document-path"><button type="button" onClick={home}>기술 문서</button><span>/</span><strong>휴지통</strong></nav>{globalSearch}<button onClick={closeTrash}>문서로 돌아가기</button></div>
          <div className="notion-trash-list">
          {trashRoots.length === 0 ? <div className="notion-trash-empty">휴지통이 비어 있습니다.</div> :
            trashRoots.map((item) => <div key={item.id} data-document-id={item.id} className="notion-trash-row">
              <FileText size={17}/><span>{item.title}</span><small>{item.deleted_at?.replace("T", " ")}</small>
              {canRestore(item) && <button onClick={() => restorePage(item.id)}><RotateCcw size={15}/> 복원</button>}
              {canDelete(item) && <button className="notion-trash-permanent" onClick={() => permanentlyDelete(item.id, item.title)}><Trash2 size={15}/> 영구삭제</button>}
            </div>)}
          </div>
        </section> : searchTerm ? <section className="notion-results-view">
          <div className="notion-document-header"><nav className="notion-document-path"><button type="button" onClick={home}>기술 문서</button><span>/</span><strong>검색 결과</strong></nav>{globalSearch}</div>
          <div className="notion-results-body">
            <h1>“{searchTerm}” 검색 결과</h1><p className="notion-results-count">제목·본문·첨부파일명에서 {fullResults.length}개 문서를 찾았습니다.</p>
            {fullResults.length ? <div className="notion-results-list">{fullResults.map((item) => <button key={item.id}
              type="button" className="notion-result-row" onClick={() => select(item.id)}>
              <span className="notion-result-title"><FileText size={17}/><strong>{item.title}</strong></span>
              <small>{item.path}</small>{item.snippet && <p>{item.snippet}</p>}
            </button>)}</div> : <div className="notion-results-empty">일치하는 문서가 없습니다. 다른 검색어로 다시 검색해 주세요.</div>}
          </div>
        </section> : loadingDoc ? <div className="notion-empty">문서를 불러오는 중입니다…</div> :
          document ? <EditorPane key={document.id} ref={editorRef} document={document} actor={auth.username}
            canEdit={canEdit(docs.find((item) => Number(item.id) === Number(document.id)) || document)}
            canDelete={canDelete(docs.find((item) => Number(item.id) === Number(document.id)) || document)}
            canAddChild={canAddChild(docs.find((item) => Number(item.id) === Number(document.id)) || document)}
            canDeleteChild={canDelete}
            path={path} children={docs.filter((item) => Number(item.parent_id) === Number(document.id))}
            pageSize={pageSize} viewMode={viewMode} onViewChange={changeView}
            onHome={home} onOpenPage={select} onCreateChild={() => createInlineChild(document.id)} onChildCreated={reloadDocs}
            onPageChanged={reloadDocs} onPageDeleted={() => Promise.all([reloadDocs(), reloadTrash()])}
            onTitleChange={onTitleChange}
            remoteSignal={remoteSignal} onSaved={onSaved} onDeleted={onDeleted} globalSearch={globalSearch}/> :
          <><div className="notion-document-header"><nav className="notion-document-path"><strong>기술 문서</strong></nav>{globalSearch}</div><section className="notion-home">
            <header><div><h1>기술 문서</h1></div>
              {isAdmin && <button onClick={() => setRootDialogOpen(true)}><Plus size={16}/> 최상위 추가</button>}</header>
            {roots.length ? <div className="notion-folder-list" role="list">{roots.map((item) => <div key={item.id} role="listitem"
              className={"notion-folder-row" + (draggingId === Number(item.id) ? " is-dragging" : "")
                + (dropTargetId === Number(item.id) ? " is-drop-target" : "")}
              onDragOver={(event) => hoverRoot(event, item.id)} onDrop={(event) => dropRoot(event, item.id)}>
              <button type="button" className="notion-folder-open" onClick={() => select(item.id)}>
                <span className="notion-folder-icon"><Folder size={21}/></span>
                <span className="notion-folder-label"><strong>{item.title}</strong><small>{childCounts.get(Number(item.id)) || 0}개 페이지</small></span>
                <ChevronRight className="notion-folder-arrow" size={18}/>
              </button>
              <button type="button" className="notion-folder-grip" draggable
                onDragStart={(event) => beginRootDrag(event, item.id)} onDragEnd={endRootDrag}
                aria-label={`${item.title} 순서 변경`} title="드래그하여 순서 변경"><GripVertical size={16}/></button>
            </div>)}</div> : <div className="notion-empty"><div className="notion-empty-icon"><FileText size={29}/></div>
              <h2>아직 글이 없습니다</h2>{isAdmin && <button onClick={() => setRootDialogOpen(true)}><Plus size={16}/> 최상위 추가</button>}</div>}
          </section></>}
      </div>
    </div>
    {rootDialogOpen && isAdmin && <div className="notion-root-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !rootCreating) setRootDialogOpen(false);
    }}><form className="notion-root-dialog" onSubmit={createRoot} onKeyDown={(event) => {
      if (event.key === "Escape" && !rootCreating) { event.preventDefault(); setRootDialogOpen(false); }
    }}>
      <h2>최상위 폴더 추가</h2><label>폴더 이름<input autoFocus value={rootDraft} maxLength={200}
        onChange={(event) => setRootDraft(event.target.value)} disabled={rootCreating}/></label>
      <p>최상위 폴더의 생성·수정·삭제는 관리자만 할 수 있습니다.</p>
      <div><button type="button" onClick={() => setRootDialogOpen(false)} disabled={rootCreating}>취소</button>
        <button type="submit" disabled={!rootDraft.trim() || rootCreating}>{rootCreating ? "추가 중…" : "추가"}</button></div>
    </form></div>}
  </main>;
}

createRoot(document.getElementById("root")).render(<App/>);
