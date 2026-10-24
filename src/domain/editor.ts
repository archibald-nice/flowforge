/**
 * Image editor state. A variation is either a `simulated:` path (mock, no
 * provider) or a real local asset path produced by the Ark provider (slice
 * 2.3-real); both end up in the same list and are saved back the same way.
 */
export type EditorState = Readonly<{ nodeId: string; prompt: string; variants: readonly string[]; selected: number }>;

export function openEditor(nodeId: string, prompt = ''): EditorState {
  return { nodeId, prompt, variants: [], selected: 0 };
}

export function setPrompt(state: EditorState, prompt: string): EditorState {
  return { ...state, prompt };
}

/** Each simulated variation gets a deterministic, clearly-marked path. */
export function generateVariant(state: EditorState, index = state.variants.length + 1): EditorState {
  if (!state.prompt.trim()) throw new Error('先生成提示词，再做模拟变体。');
  const path = `simulated:editor/${state.nodeId}/${index}`;
  const variants = [...state.variants, path];
  return { ...state, variants, selected: variants.length - 1 };
}

export function selectVariant(state: EditorState, index: number): EditorState {
  if (index < 0 || index >= state.variants.length) throw new Error('请选择一个已存在的变体。');
  return { ...state, selected: index };
}

export function currentVariant(state: EditorState): string | null {
  return state.variants[state.selected] ?? null;
}

export function canSave(state: EditorState): boolean {
  return currentVariant(state) !== null;
}

/** Saving a variant as a copy never overwrites the source node. */
export function copyPlan(state: EditorState): { nodeId: string; variant: string } {
  const variant = currentVariant(state);
  if (!variant) throw new Error('先产生一个变体，再另存副本。');
  return { nodeId: state.nodeId, variant };
}

/** Slice 2.3-real: a real variant is an existing local `asset:` path. */
export function addVariant(state: EditorState, path: string): EditorState {
  if (!path.trim()) throw new Error('变体需要一个本地素材路径。');
  if (state.variants.includes(path)) throw new Error('这个变体已经在列表里。');
  const variants = [...state.variants, path];
  return { ...state, variants, selected: variants.length - 1 };
}

export function isSimulatedPath(path: string): boolean { return path.startsWith('simulated:'); }
