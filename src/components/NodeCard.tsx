import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { isMediaNode, isSimulatedPath, type ProjectNode } from '../domain/project.ts';
import { kindLabels } from '../lib/format.ts';

export type CardNode = Node<{ item: ProjectNode; mediaUrl?: string; toolbar?: HoverToolbarActions }, 'card'>;

/** Slice 6.5 — actions the floating hover toolbar may offer. All of them reuse
 * the inspector's existing functions; the toolbar adds no logic of its own. */
export interface HoverToolbarActions {
  onEdit: (nodeId: string) => void;
  onCopy: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onReplace: (nodeId: string, file: File) => void;
  onDownload: (nodeId: string) => void;
}

/** Slice 6.5 — small inline icons for the hover toolbar. Drawn by hand in the
 * same stroke style as the rail; no icon dependency. */
const ToolbarIcon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
);
const ICONS = {
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  copy: 'M9 9V5.5A1.5 1.5 0 0 1 10.5 4H18a2 2 0 0 1 2 2v7.5a1.5 1.5 0 0 1-1.5 1.5H15M4 10.5A1.5 1.5 0 0 1 5.5 9H13a2 2 0 0 1 2 2v7.5a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 18.5v-8z',
  trash: 'M5 7h14M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6',
  swap: 'M4 8h13l-3-3M20 16H7l3 3',
  download: 'M12 4v10M8 11l4 4 4-4M5 19h14',
} as const;

export const Card = memo(function Card({ data, selected }: NodeProps<CardNode>) {
  const node = data.item;
  const generative = isMediaNode(node);
  // 6.5-fix: a locally replaced MP4 must play in place; simulated placeholders
  // stay an <img> because they are SVG data URLs.
  const playable = node.kind === 'video' && isMediaNode(node) && Boolean(node.assetPath) && !isSimulatedPath(node.assetPath ?? '');
  const toolbar = data.toolbar;
  // 6.5: replace is only meaningful for image/video nodes (the asset path is
  // what gets swapped); text gets edit/copy/delete, per the slice brief.
  const replaceable = node.kind === 'image' || node.kind === 'video';
  const actions = toolbar && (
    <div className="hover-toolbar" data-testid="hover-toolbar" onMouseDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      {replaceable && <label className="toolbar-swap" title="替换素材">
        <input type="file" hidden aria-label={`替换素材 ${node.title}`} accept="image/png,image/jpeg,image/webp,video/mp4"
          onChange={event => { const file = event.target.files?.[0]; if (file) toolbar.onReplace(node.id, file); event.target.value = ''; }} />
        <ToolbarIcon d={ICONS.swap} />
      </label>}
      {replaceable && <button onClick={() => toolbar!.onDownload(node.id)} aria-label={`下载 ${node.title}`} title="下载"><ToolbarIcon d={ICONS.download} /></button>}
      {node.kind === 'text' && <button onClick={() => toolbar!.onEdit(node.id)} aria-label={`编辑 ${node.title}`} title="编辑"><ToolbarIcon d={ICONS.edit} /></button>}
      {node.kind === 'text' && <button onClick={() => toolbar!.onCopy(node.id)} aria-label={`复制节点 ${node.title}`} title="复制"><ToolbarIcon d={ICONS.copy} /></button>}
      <button className="danger" onClick={() => toolbar!.onDelete(node.id)} aria-label={`删除节点 ${node.title}`} title="删除"><ToolbarIcon d={ICONS.trash} /></button>
    </div>
  );
  return <article className={`node-card ${node.kind} ${selected ? 'is-selected' : ''}`} data-testid={`card-${node.id}`}>
    {actions}
    {generative && <Handle type="target" position={Position.Left} aria-label="Input handle" />}
    <header className="node-drag"><span>{kindLabels[node.kind]}{generative ? ' · 草稿' : ''}</span><small>v{node.revision}</small></header>
    <h3 className="node-drag">{node.title}</h3>
    {node.kind === 'text' && <p>{node.text}</p>}
    {node.kind === 'scene' && <p className="muted">3D · 占位</p>}
    {node.kind === 'image' && (data.mediaUrl ? <img src={data.mediaUrl} alt="节点图片" draggable={false} /> : <p className="muted" data-testid="empty-asset">空图片草稿</p>)}
    {node.kind === 'video' && (data.mediaUrl
      ? (playable
        ? <video className="node-video" data-testid="node-video" src={data.mediaUrl} controls preload="metadata" playsInline />
        : <img src={data.mediaUrl} alt="视频封面" draggable={false} />)
      : <p className="muted" data-testid="empty-asset">空视频草稿</p>)}
    {node.kind === 'audio' && <p className="muted" data-testid="empty-asset">{data.mediaUrl ? '模拟音频' : '空音频草稿'}</p>}
    {generative && <><p>{node.prompt}</p><footer>{node.references.length} 项输入 <span>{node.assetSource === 'simulated' ? '已模拟' : '未运行'}</span></footer></>}
    {node.kind !== 'scene' && <Handle type="source" position={Position.Right} aria-label="Reference handle" />}
  </article>;
});

export const nodeTypes = { card: Card };
