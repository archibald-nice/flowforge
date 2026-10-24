import type { Dispatch, SetStateAction } from 'react';
import { ASSET_CATEGORIES, CATEGORY_LABELS, categoryOf, filterAssets, type LibraryFilter } from '../domain/asset-library.ts';
import { isVideoAsset } from '../domain/assets.ts';
import type { AssetCategory, StoredAsset } from '../persistence/project-store.ts';

export interface LibraryPanelProps {
  assets: StoredAsset[];
  assetUrls: Record<string, string>;
  filter: LibraryFilter;
  setFilter: Dispatch<SetStateAction<LibraryFilter>>;
  setLibraryOpen: Dispatch<SetStateAction<boolean>>;
  useAsset: (asset: StoredAsset) => void;
  setAssetMeta: (asset: StoredAsset, patch: { category?: AssetCategory; favorite?: boolean }) => Promise<void>;
}

/** Local asset library drawer: tabs, search, category chips, per-asset rows.
 * Everything stays in this browser; nothing uploads. */
export function LibraryPanel({ assets, assetUrls, filter, setFilter, setLibraryOpen, useAsset, setAssetMeta }: LibraryPanelProps) {
  return <section className="library-panel" data-testid="library-panel">
    <header><span className="eyebrow">素材库</span><button className="linkish" onClick={() => setLibraryOpen(false)} aria-label="Close library">关闭</button></header>
    <div className="library-tabs" role="tablist">
      <button role="tab" aria-selected={filter.tab === 'all'} onClick={() => setFilter({ ...filter, tab: 'all' })}>全部</button>
      <button role="tab" aria-selected={filter.tab === 'favorites'} onClick={() => setFilter({ ...filter, tab: 'favorites' })}>收藏</button>
    </div>
    <input aria-label="搜索素材" placeholder="搜索素材" value={filter.query} onChange={event => setFilter({ ...filter, query: event.target.value })} />
    <div className="library-categories">{['all', ...ASSET_CATEGORIES].map(category => <button key={category} aria-pressed={filter.category === category} onClick={() => setFilter({ ...filter, category: category as AssetCategory | 'all' })}>{category === 'all' ? '分类：全部' : CATEGORY_LABELS[category as AssetCategory]}</button>)}</div>
    {filterAssets(assets, filter).length ? <ul className="library-rows">{filterAssets(assets, filter).map(asset => <li key={asset.path} data-testid={`library-${asset.name}`}>
      {isVideoAsset(asset.type) ? <video src={assetUrls[asset.path]} width={40} height={40} muted playsInline preload="metadata" /> : <img src={assetUrls[asset.path]} alt="" width={40} height={40} />}
      <span>{asset.name}<small>{CATEGORY_LABELS[categoryOf(asset)]}</small></span>
      <button className="linkish" aria-label={`Use library ${asset.name}`} onClick={() => useAsset(asset)}>使用</button>
      <button className="linkish" aria-label={`Favorite ${asset.name}`} aria-pressed={asset.favorite === true} onClick={() => void setAssetMeta(asset, { favorite: !asset.favorite })}>{asset.favorite ? '★' : '☆'}</button>
      <select aria-label={`Category of ${asset.name}`} value={categoryOf(asset)} onChange={event => void setAssetMeta(asset, { category: event.target.value as AssetCategory })}>{ASSET_CATEGORIES.map(category => <option key={category} value={category}>{CATEGORY_LABELS[category]}</option>)}</select>
    </li>)}</ul> : <p className="empty-record">还没有内容：上传一张图片，或把节点保存到素材库。</p>}
  </section>;
}
