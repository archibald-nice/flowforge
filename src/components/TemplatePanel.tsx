import type { Dispatch, SetStateAction } from 'react';
import { TEMPLATES, findTemplate } from '../domain/templates.ts';

export interface TemplatePanelProps {
  setTemplatesOpen: Dispatch<SetStateAction<boolean>>;
  setPreview: Dispatch<SetStateAction<string | null>>;
  useTemplate: (templateId: string) => void;
}

/** Template drawer: fixed local templates that instantiate an empty draft —
 * no content generation, no upload. */
export function TemplatePanel({ setTemplatesOpen, setPreview, useTemplate }: TemplatePanelProps) {
  return <section className="template-panel" data-testid="template-panel">
    <header><span className="eyebrow">模板 · 仅生成草稿</span><button className="linkish" onClick={() => setTemplatesOpen(false)}>关闭</button></header>
    <ul>{TEMPLATES.map(template => <li key={template.id} data-testid={`template-${template.id}`}>
      <div><strong>{template.title}</strong><p>{template.summary}</p></div>
      <button className="linkish" onClick={() => setPreview(template.id)}>预览</button>
      <button className="linkish" aria-label={`Use ${template.title}`} onClick={() => void useTemplate(template.id)}>使用</button>
    </li>)}</ul>
  </section>;
}

export interface TemplatePreviewProps {
  preview: string;
  setPreview: Dispatch<SetStateAction<string | null>>;
}

/** Read-only look at a template's steps before instantiating it. */
export function TemplatePreview({ preview, setPreview }: TemplatePreviewProps) {
  return <div className="preview-shell" role="dialog" aria-label="Template preview" data-testid="template-preview">
    <h2>{findTemplate(preview).title}</h2><p>{findTemplate(preview).summary}</p>
    <ol>{findTemplate(preview).steps.map(step => <li key={step}>{step}</li>)}</ol>
    <p className="muted">使用模板只会生成空草稿：不生成内容，也不上传任何东西。</p>
    <button className="primary" onClick={() => setPreview(null)}>关闭预览</button>
  </div>;
}
