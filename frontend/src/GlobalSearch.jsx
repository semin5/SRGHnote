import React, { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Search, X } from "lucide-react";
import { searchDocuments } from "./search";

export default function GlobalSearch({ value, onChange, onSubmit, onOpenDocument, index }) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);
  const matches = useMemo(() => searchDocuments(index, value).slice(0, 5), [index, value]);
  const terms = [...new Set(matches.map((item) => item.title))].slice(0, 4);

  useEffect(() => {
    const closeOutside = (event) => {
      if (!wrapperRef.current?.contains(event.target)) setOpen(false);
    };
    window.document.addEventListener("pointerdown", closeOutside);
    return () => window.document.removeEventListener("pointerdown", closeOutside);
  }, []);

  return <div ref={wrapperRef} className="notion-global-search">
    <form role="search" onSubmit={(event) => {
      event.preventDefault();
      if (!value.trim()) return;
      setOpen(false);
      onSubmit(value.trim());
    }}>
      <Search size={15} aria-hidden="true"/>
      <input type="search" aria-label="전체 문서 검색" placeholder="전체 문서 검색" value={value}
        onFocus={() => setOpen(true)} onChange={(event) => { onChange(event.target.value); setOpen(true); }}
        onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); event.currentTarget.blur(); } }}/>
      {value && <button type="button" className="notion-global-clear" aria-label="검색어 지우기"
        onClick={() => { onChange(""); setOpen(false); }}><X size={14}/></button>}
    </form>
    {open && value.trim() && <div className="notion-global-suggestions">
      {terms.length ? <>
        <small className="notion-suggestion-label">연관 검색어</small>
        {terms.map((term) => <button key={term} type="button" onClick={() => {
          onChange(term); setOpen(false); onSubmit(term);
        }}><Search size={14}/><span>{term}</span></button>)}
        <small className="notion-suggestion-label">관련 문서</small>
        {matches.map((item) => <button key={item.id} type="button" onClick={() => {
          setOpen(false); onOpenDocument(item.id);
        }}><FileText size={14}/><span><strong>{item.title}</strong><small>{item.parentPath}</small></span></button>)}
      </> : <p>일치하는 문서가 없습니다.</p>}
      <button type="button" className="notion-show-all-results" onClick={() => {
        setOpen(false); onSubmit(value.trim());
      }}><Search size={14}/> “{value.trim()}” 전체 검색 결과 보기</button>
    </div>}
  </div>;
}
