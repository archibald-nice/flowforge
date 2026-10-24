import { isMediaNode, type MediaNode, type Project, type ProjectNode, type Reference } from './project.ts';

/**
 * Next-step advice for the selected node. Everything here is designed: the
 * target only exposes suggestion UI, never a verified planning step (U8).
 * Advice never runs, never calls a provider and never creates a snapshot.
 */
export type AdviceAction = 'reference' | 'focus-run' | 'fill-prompt';
export type Advice = Readonly<{ id: string; title: string; action: AdviceAction }>;

const draftsFedBy = (project: Project, nodeId: string): MediaNode[] => project.edges
  .filter(edge => edge.source === nodeId)
  .map(edge => project.nodes.find(node => node.id === edge.target))
  .filter((node): node is MediaNode => !!node && isMediaNode(node));

export function adviceFor(project: Project, nodeId: string): readonly Advice[] {
  const node = project.nodes.find(candidate => candidate.id === nodeId);
  if (!node) return [];
  if (!isMediaNode(node)) {
    const drafts = draftsFedBy(project, nodeId);
    if (!drafts.length) return [{ id: 'link-first', title: '先把它连到一个生成草稿，再作为上下文引用。', action: 'focus-run' }];
    const pending = drafts.find(draft => !draft.references.some((reference: Reference) => reference.nodeId === nodeId));
    return pending
      ? [{ id: 'reference-upstream', title: '把它引用到下游草稿的提交前清单。', action: 'reference' }]
      : [{ id: 'already-referenced', title: '它已被下游草稿引用；可以直接填写 prompt 并提交。', action: 'focus-run' }];
  }
  const advice: Advice[] = [];
  const draft = node;
  if (!draft.references.length) advice.push({ id: 'reference-first', title: '先从画布上引用一个上游节点；连线本身不是输入。', action: 'focus-run' });
  if (!draft.prompt.trim()) advice.push({ id: 'fill-prompt', title: '写一句 prompt 再提交；提交前清单只含显式引用。', action: 'fill-prompt' });
  if (draft.references.length && draft.prompt.trim()) advice.push({ id: 'run-ready', title: '可以提交一次模拟运行；成本恒 0，不调用 provider。', action: 'focus-run' });
  return advice;
}
