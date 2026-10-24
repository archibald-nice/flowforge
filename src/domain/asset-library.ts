import type { AssetCategory, StoredAsset } from '../persistence/project-store.ts';

/** Designed categories mirror the target library's folders, not its storage. */
export const ASSET_CATEGORIES: readonly AssetCategory[] = ['character', 'scene', 'prop', 'style', 'sound', 'other'];
export const CATEGORY_LABELS: Record<AssetCategory, string> = {
  character: '角色', scene: '场景', prop: '道具', style: '风格', sound: '音效', other: '其他',
};
export type LibraryFilter = Readonly<{ tab: 'all' | 'favorites'; category: AssetCategory | 'all'; query: string }>;
export const DEFAULT_FILTER: LibraryFilter = { tab: 'all', category: 'all', query: '' };

export function filterAssets(assets: readonly StoredAsset[], filter: LibraryFilter): StoredAsset[] {
  const needle = filter.query.trim().toLowerCase();
  return assets.filter(asset =>
    (filter.tab === 'all' || asset.favorite === true)
    && (filter.category === 'all' || (asset.category ?? 'other') === filter.category)
    && (needle === '' || asset.name.toLowerCase().includes(needle)));
}

export function categoryOf(asset: StoredAsset): AssetCategory {
  return asset.category ?? 'other';
}
