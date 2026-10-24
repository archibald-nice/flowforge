import { SCHEMA_VERSION, DEFAULT_CREDITS, type Project, type ProjectNode } from './project.ts';

export type Template = Readonly<{ id: string; title: string; summary: string; steps: readonly string[] }>;

const brief = (id: string, title: string, text: string, x: number, y: number): ProjectNode =>
  ({ id, title, kind: 'text', revision: 1, position: { x, y }, text });
const media = (id: string, title: string, kind: 'image' | 'video' | 'audio', assetPath: string | undefined, x: number, y: number): ProjectNode =>
  ({ id, title, kind, revision: 1, position: { x, y }, assetPath, prompt: '', references: [] });

/** Twelve designed templates; they instantiate local drafts, never provider calls. */
export const TEMPLATES: readonly Template[] = Object.freeze([
  { id: 'product-still', title: '产品静物', summary: '简报 + 产品图 → 一张主视觉', steps: ['写产品简报', '放一张原图', '生成主视觉'] },
  { id: 'bottle-launch', title: '瓶装新品', summary: '三个角度 + 统一光线', steps: ['写简报', '选风格', '出三张'] },
  { id: 'social-carousel', title: '社媒多图', summary: '同一提示词出多张竖版素材', steps: ['定主题', '批量出图', '挑图'] },
  { id: 'brand-mood', title: '品牌情绪板', summary: '颜色、材质、光线的参考集合', steps: ['写方向', '放参考', '生成'] },
  { id: 'story-line', title: '分镜草稿', summary: '按镜头顺序串起描述', steps: ['写分镜', '逐镜生成', '时间线合并'] },
  { id: 'video-teaser', title: '短视频预告', summary: '5 秒单镜头 + 海报', steps: ['写镜头', '生成视频', '导出海报'] },
  { id: 'music-bed', title: '配乐曲目', summary: '为成片配一段模拟音轨', steps: ['写情绪', '生成音频', '对齐时长'] },
  { id: 'podcast-intro', title: '播客片头', summary: '语音 + 音效的组合草稿', steps: ['写开场白', '配音轨', '混音'] },
  { id: 'scene-blockout', title: '场景白模', summary: '3D 片场的占位节点', steps: ['写场景', '建白模', '定机位'] },
  { id: 'style-transfer', title: '风格迁移', summary: '把参考风格贴到主图', steps: ['放原图', '放风格图', '生成'] },
  { id: 'packaging', title: '包装提案', summary: '正面、侧面与场景图', steps: ['写卖点', '出三视图', '合成'] },
  { id: 'campaign-kit', title: '活动物料', summary: '主视觉 + 两张延展', steps: ['写活动', '出主视觉', '延展尺寸'] },
]);

export function findTemplate(id: string): Template {
  const template = TEMPLATES.find(item => item.id === id);
  if (!template) throw new Error('Unknown template.');
  return template;
}

export function instantiateTemplate(id: string, projectId = `project-${crypto.randomUUID()}`): Project {
  const template = findTemplate(id);
  const nodes: ProjectNode[] = [
    brief('tpl-brief', '01 / 简报', `${template.title}：${template.summary}`, 80, 120),
    media('tpl-draft', '02 / 主图', 'image', undefined, 430, 300),
    media('tpl-video', '03 / 镜头', 'video', undefined, 780, 300),
  ];
  return {
    id: projectId, schemaVersion: SCHEMA_VERSION, name: `${template.title}（模板）`, revision: 0,
    viewport: { x: 60, y: 80, zoom: 0.9 }, credits: DEFAULT_CREDITS,
    nodes, edges: [], snapshots: [], updatedAt: new Date().toISOString(),
  };
}
