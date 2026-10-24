import { isMediaNode, type Project, type ProjectNode } from '../domain/project.ts';
import type { StoredMedia } from './fixture-media.ts';

/**
 * Static read-only view of one project. The target only verified the
 * navigation path public work → detail → read-only preview (OBS-005 §2);
 * sharing rights, link visibility and asset ownership stay unknown (U12).
 * So this file is a local, self-contained HTML render: no edit, no run,
 * no agent entry, no script and no network request.
 */
const escape = (value: string) => value.replace(/[&<>"']/g, character => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] ?? character));

const dataUrl = async (media: StoredMedia | undefined) => {
  if (!media) return '';
  const bytes = new Uint8Array(await media.blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${media.blob.type || 'image/png'};base64,${btoa(binary)}`;
};

const CARD_W = 260;
const CARD_H = 132;

export async function renderReadonly(project: Project, media: Map<string, StoredMedia>): Promise<string> {
  const images = new Map<string, string>();
  for (const node of project.nodes) {
    if (node.kind === 'image' && node.assetPath) images.set(node.assetPath, await dataUrl(media.get(node.assetPath)));
  }

  const xs = project.nodes.map(node => node.position.x);
  const ys = project.nodes.map(node => node.position.y);
  const offsetX = Math.min(...xs);
  const offsetY = Math.min(...ys);
  const width = Math.max(...xs) - offsetX + CARD_W + 40;
  const height = Math.max(...ys) - offsetY + CARD_H + 40;
  const center = (node: ProjectNode) => ({
    x: node.position.x - offsetX + CARD_W / 2,
    y: node.position.y - offsetY + CARD_H / 2,
  });

  const edges = project.edges.map(edge => {
    const source = project.nodes.find(node => node.id === edge.source);
    const target = project.nodes.find(node => node.id === edge.target);
    if (!source || !target) return '';
    const from = center(source);
    const to = center(target);
    return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#82957b" stroke-width="1.5" stroke-dasharray="6 5" marker-end="url(#arrow)" />`;
  }).join('');

  const cards = project.nodes.map(node => {
    const left = node.position.x - offsetX;
    const top = node.position.y - offsetY;
    const label = isMediaNode(node) ? `${node.kind.toUpperCase()} DRAFT` : node.kind.toUpperCase();
    const body = node.kind === 'text'
      ? `<p>${escape(node.text)}</p>`
      : node.kind === 'scene'
        ? '<p class="empty">3D placeholder</p>'
        : node.kind === 'image'
          ? (node.assetPath && images.get(node.assetPath) ? `<img src="${images.get(node.assetPath)}" alt="${escape(node.title)}" />` : '<p class="empty">empty draft</p>')
          : `<p>${escape(node.prompt)}</p><footer><span>${node.references.length} inputs</span><span>${node.assetSource === 'simulated' ? 'simulated' : 'not run'}</span></footer>`;
    return `<article class="card ${node.kind}" style="left:${left}px;top:${top}px"><header><span>${label}</span><small>r${node.revision}</small></header><h2>${escape(node.title)}</h2>${body}</article>`;
  }).join('');

  const drafts = project.nodes.filter(node => isMediaNode(node));
  const referenceList = drafts.map(draft => `<section><h3>${escape(draft.title)}</h3>${draft.references.length
    ? `<ul>${draft.references.map(reference => {
      const source = project.nodes.find(node => node.id === reference.nodeId);
      return `<li><strong>${escape(source?.title ?? reference.nodeId)}</strong> <span>r${source?.revision ?? '?'} · ${reference.role}</span></li>`;
    }).join('')}</ul>`
    : '<p class="empty">No explicit input in the pre-submit list.</p>'}</section>`).join('');

  const latest = project.snapshots.at(-1);
  const snapshot = latest
    ? `<section><p class="muted">Latest frozen record: ${escape(latest.mode)} · ${escape(latest.createdAt)} · ${latest.inputs.length} inputs</p>
       <ul>${latest.inputs.map(input => `<li><strong>${escape(input.nodeId)}</strong> <span>r${input.revision} · ${input.role}</span></li>`).join('')}</ul></section>`
    : '<p class="empty">No input snapshot was frozen.</p>';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escape(project.name)} — read-only view</title>
<style>
:root{color-scheme:light dark}
body{margin:0;font:14px/1.6 "Avenir Next",Helvetica,sans-serif;color:#2c3a2f;background:#f6f5e9}
header.page{padding:26px 32px;border-bottom:1px solid #cfd5c4;background:linear-gradient(120deg,#f9f8ee,#e6eade)}
header.page h1{font:400 30px/1.2 Palatino,serif;margin:6px 0}
.eyebrow{font-size:9px;letter-spacing:1.7px;font-weight:600}
.badge{display:inline-block;margin-top:10px;padding:3px 9px;border:1px solid #a9b4a3;border-radius:999px;font-size:10px;letter-spacing:1px}
main{padding:26px 32px 40px;display:grid;gap:26px;max-width:1180px}
.figure{position:relative;overflow:auto;border:1px solid #d6dccb;border-radius:8px;background:radial-gradient(ellipse at 20% 20%,#f5f3e6 0,transparent 50%),linear-gradient(145deg,#eef0e5,#e3e8dc)}
.stage{position:relative;margin:20px}
.card{position:absolute;width:${CARD_W}px;background:#f9f8ee;border:1px solid #acb9a7;border-radius:8px;box-shadow:0 4px 14px #354a3110;padding-bottom:8px}
.card.draft{border-color:#c88b73;background:#faf3e9}
.card header{display:flex;justify-content:space-between;padding:9px 12px;font-size:9px;letter-spacing:1.2px;background:#edf0e4;border-bottom:1px solid #d9ded0;border-radius:8px 8px 0 0}
.card.draft header{background:#edddcd;border-color:#dac6b5}
.card h2{font:400 16px/1.3 Palatino,serif;margin:10px 12px 4px}
.card p{font-size:12px;margin:6px 12px;max-height:64px;overflow:hidden}
.card img{display:block;width:calc(100% - 24px);height:92px;object-fit:cover;margin:8px 12px;border-radius:4px}
.card footer{display:flex;justify-content:space-between;font-size:10px;border-top:1px solid #e2d0c0;padding:7px 12px;margin-top:8px}
section h3{font:400 18px/1.3 Palatino,serif;margin:0 0 6px}
section ul{margin:6px 0 0;padding-left:18px}
section li{font-size:12px}
.muted{color:#71806a;font-size:12px}
.empty{color:#87917c;font:400 15px/1.5 Palatino,serif}
footer.page{border-top:1px solid #cfd5c4;padding:14px 32px;font-size:10px;letter-spacing:.6px;color:#73806a}
@media(prefers-color-scheme:dark){body{background:#161a15;color:#e8ecdf}header.page{background:#1d231c;border-color:#33402f}.figure{background:#1b211a;border-color:#33402f}.card{background:#20271e;border-color:#3c4a37}.card header{background:#273023;border-color:#3c4a37}.card.draft{background:#2a231d;border-color:#6b5140}footer.page{border-color:#33402f}}
</style></head>
<body>
<header class="page"><span class="eyebrow">FLOWFORGE / READ-ONLY VIEW</span><h1>${escape(project.name)}</h1>
<p class="muted">${project.nodes.length} nodes · ${project.edges.length} candidates · ${project.snapshots.length} snapshots · exported ${escape(new Date().toISOString())}</p>
<span class="badge">READ-ONLY · NO EDIT · NO RUN · NO AGENT</span></header>
<main>
<section class="figure"><div class="stage" style="width:${width}px;height:${height}px">
<svg width="${width}" height="${height}" style="position:absolute;inset:0" aria-label="reference edges"><defs><marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8 z" fill="#82957b" /></marker></defs>${edges}</svg>
${cards}</div></section>
<section><h3>Explicit inputs</h3>${referenceList}</section>
<section><h3>Frozen record</h3>${snapshot}<p class="muted">Simulated results keep their simulated marker; nothing here was produced by a provider.</p></section>
</main>
<footer class="page">LOCAL FILE · SELF-CONTAINED · NO SCRIPT · NO NETWORK</footer>
</body></html>`;
}
