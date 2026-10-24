import { isMediaNode, type NodeKind, type ProjectNode, type ReferenceRole } from '../domain/project.ts';

export const kindLabels: Record<NodeKind, string> = { text: '文本', image: '图片', video: '视频', audio: '音频', scene: '3D' };

// Designed labels. The target product has no role field; this enum exists only in FlowForge.
export const roleLabels: Record<ReferenceRole, string> = { reference: '参考图', 'first-frame': '首帧', style: '风格' };

/** Filename slug used by the readonly / bundle / result exports. */
export function slugify(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
}

/**
 * Simulated results are local SVG placeholders; nothing came from a provider.
 * Slice 6.1-fix: the placeholder used to be a pale green card with an all-caps
 * English label, which clashed with the dark product surface. Colours now mirror
 * `--surface-3` / `--line` / `--text-soft`, the label is Chinese and the type
 * runs on the same system stack as the rest of the interface.
 */
export function simulatedUrl(node: ProjectNode): string | undefined {
  if (!isMediaNode(node) || node.assetSource !== 'simulated' || !node.assetPath) return undefined;
  const font = "-apple-system,BlinkMacSystemFont,'SF Pro Text','PingFang SC','Hiragino Sans GB','Helvetica Neue',Arial,sans-serif";
  const label = `${kindLabels[node.kind]} · 模拟结果`;
  const title = node.title.replace(/[<>&]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><rect width="320" height="200" fill="#121212"/><rect x="0.5" y="0.5" width="319" height="199" fill="none" stroke="#3b3b38"/><rect x="14" y="14" width="292" height="172" fill="none" stroke="#2a2a28" stroke-dasharray="4 4"/><text x="16" y="98" font-family="${font}" font-size="14" fill="#e3e5d3">${label}</text><text x="16" y="122" font-family="${font}" font-size="11" fill="#8f9186">${title}</text><text x="16" y="168" font-family="${font}" font-size="10" fill="#6b6d64">本地占位图，无模型产物</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
