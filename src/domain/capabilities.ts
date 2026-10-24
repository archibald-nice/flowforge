/**
 * Slice 3.4 — capability entry (display only, zero network).
 *
 * Everything here is a frozen front-end constant. Nothing is installed, nothing
 * is fetched, nothing is persisted: the panel exists to show what *would* be
 * addable, and every entry says so. Generic names only — no third-party brand
 * assets (brief §5).
 */
export type CapabilityKind = 'skill' | 'connector';

export type Capability = Readonly<{
  id: string;
  kind: CapabilityKind;
  name: string;
  /** One line in the list. */
  summary: string;
  /** Longer text revealed when the row is opened. */
  detail: string;
}>;

export const CAPABILITY_SECTIONS: readonly { kind: CapabilityKind; title: string; note: string }[] = [
  { kind: 'skill', title: 'Skills', note: '预先写好的多步流程，需要你批准后才会被引用。' },
  { kind: 'connector', title: 'Connectors', note: '外部数据源，接入涉及账号与密钥，本构建没有实现。' },
];

export const CAPABILITIES: readonly Capability[] = Object.freeze([
  Object.freeze({
    id: 'skill-storyboard', kind: 'skill' as const, name: '分镜拆解',
    summary: '把一段文案拆成逐镜头的提示词草稿。',
    detail: '占位条目（placeholder）。真实实现需要：读取文本节点 → 拆镜头 → 为每个镜头建草稿节点。本构建只展示入口，不安装、不运行、不写存储。',
  }),
  Object.freeze({
    id: 'skill-palette', kind: 'skill' as const, name: '配色统一',
    summary: '把一组图片的主色对齐到同一套色板。',
    detail: '占位条目（placeholder）。真实实现需要图像分析能力，本构建没有接入任何模型，展示的目的只是说明入口形态。',
  }),
  Object.freeze({
    id: 'skill-qa', kind: 'skill' as const, name: '发布前检查',
    summary: '逐条核对素材尺寸、引用与提示词是否齐全。',
    detail: '占位条目（placeholder）。这一项不需要外部服务，未来可以直接用本地规则实现；现在只是列表项。',
  }),
  Object.freeze({
    id: 'skill-caption', kind: 'skill' as const, name: '字幕生成',
    summary: '为视频草稿生成时间轴对应的字幕草稿。',
    detail: '占位条目（placeholder）。依赖语音识别，本构建未接入；点击这里不会触发任何请求。',
  }),
  Object.freeze({
    id: 'connector-assets', kind: 'connector' as const, name: '对象存储',
    summary: '把本地素材同步到自有存储桶。',
    detail: '占位条目（placeholder）。真实接入需要 endpoint、桶名与密钥，本构建不保存任何凭证，也不会发起网络请求。',
  }),
  Object.freeze({
    id: 'connector-dam', kind: 'connector' as const, name: '素材库服务',
    summary: '从团队素材库拉取可商用图片。',
    detail: '占位条目（placeholder）。个人与团队素材库分层属另一套权限模型，本构建只有本地素材库。',
  }),
  Object.freeze({
    id: 'connector-analytics', kind: 'connector' as const, name: '投放数据',
    summary: '回读投放表现，按数据重排素材优先级。',
    detail: '占位条目（placeholder）。需要 OAuth 授权与账号绑定，本构建既不授权也不存储任何第三方 token。',
  }),
  Object.freeze({
    id: 'connector-calendar', kind: 'connector' as const, name: '排期日历',
    summary: '把草稿的交稿日期写进团队日历。',
    detail: '占位条目（placeholder）。属协作能力，超出当前单用户范围；列在这里只为说明入口位置。',
  }),
]);

export function capabilitiesOf(kind: CapabilityKind): readonly Capability[] {
  return CAPABILITIES.filter(item => item.kind === kind);
}
