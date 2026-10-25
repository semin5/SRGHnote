import React from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { AttachmentActions, FileCardBody } from "./FileBlock";

const previewUrl = /^\/note\/api\/files\/[1-9]\d*\/preview$/;

function PdfBlockView({ node, editor, getPos }) {
  const { src, name, size } = node.attrs;
  const safeSrc = previewUrl.test(src || "") ? src : null;
  return <NodeViewWrapper className="notion-pdf-block" contentEditable={false}>
    {safeSrc ? <>
      <iframe src={safeSrc} title={`${name || "PDF 문서"} 미리보기`} loading="lazy" />
      <div className="notion-file-block"><FileCardBody src={safeSrc.replace(/\/preview$/, "")}
        name={name} size={size}/><AttachmentActions editor={editor} getPos={getPos} node={node}/></div>
    </> : <p>PDF를 표시할 수 없습니다.</p>}
  </NodeViewWrapper>;
}

export const PdfBlock = Node.create({
  name: "pdfBlock",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      src: { default: "", parseHTML: (element) => element.getAttribute("data-pdf-src") || "",
        renderHTML: ({ src }) => ({ "data-pdf-src": src }) },
      name: { default: "PDF 문서", parseHTML: (element) => element.getAttribute("data-pdf-name") || "PDF 문서",
        renderHTML: ({ name }) => ({ "data-pdf-name": name }) },
      size: { default: 0, parseHTML: (element) => Number(element.getAttribute("data-pdf-size")) || 0,
        renderHTML: ({ size }) => ({ "data-pdf-size": size }) },
    };
  },
  parseHTML() { return [{ tag: 'div[data-type="pdf-block"]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-type": "pdf-block" }), HTMLAttributes["data-pdf-name"]];
  },
  addNodeView() { return ReactNodeViewRenderer(PdfBlockView); },
});
