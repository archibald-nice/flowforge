import { validateProject, type Project } from '../domain/project.ts';
import { assetPathFor, isAssetPath, validateAsset, validateGeneratedBlob } from '../domain/assets.ts';
import { fetchFixture, mediaPaths, verifyMedia, type StoredMedia } from './fixture-media.ts';

export type ProjectSummary = Readonly<{ id: string; name: string; revision: number; updatedAt?: string }>;
export type AssetCategory = 'character' | 'scene' | 'prop' | 'style' | 'sound' | 'other';
export type StoredAsset = Readonly<{ path: string; name: string; type: string; size: number; blob: Blob; createdAt: string;
  category?: AssetCategory; favorite?: boolean; note?: string }>;

export class ConflictError extends Error {
  constructor() { super('A newer revision exists. Reload before saving; your draft remains in this tab.'); }
}

export class ProjectStore {
  private db: Promise<IDBDatabase>;
  private media = new Map<string, StoredMedia>();
  private assets = new Map<string, StoredAsset>();
  failNextSave = false;
  simulateQuota = false;
  lastSaveTiming: { preparationMs: number; transactionMs: number } | null = null;

  constructor(name = 'flowforge-m1') {
    this.db = new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 3);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'path' });
        if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'path' });
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error ?? new Error('Storage could not open.'));
      request.onblocked = () => reject(new Error('Storage upgrade blocked. Close older FlowForge tabs and reload.'));
    });
  }

  async load(id: string): Promise<Project | null> {
    const db = await this.db;
    const result = await new Promise<{ project: Project | null; records: { path: string; value: unknown }[] }>((resolve, reject) => {
      // 'assets' must be in scope: asset-backed media is read from its own store
      // below, and IDB throws NotFoundError when a transaction touches a store
      // it was not opened with.
      const tx = db.transaction(['projects', 'media', 'assets'], 'readonly');
      const request = tx.objectStore('projects').get(id);
      let project: Project | null = null;
      const records: { path: string; value: unknown }[] = [];
      request.onsuccess = () => {
        try {
          project = request.result === undefined ? null : validateProject(request.result);
          if (project?.mediaVersion === 1) for (const path of mediaPaths(project)) {
            const read = path.startsWith('asset:') ? tx.objectStore('assets').get(path) : tx.objectStore('media').get(path);
            read.onsuccess = () => records.push({ path, value: read.result });
          }
        } catch (error) { reject(error); tx.abort(); }
      };
      tx.oncomplete = () => resolve({ project, records });
      tx.onerror = () => reject(tx.error ?? new Error('Storage read failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('Storage read aborted.'));
    });
    // Verification must happen outside IDB transactions, which cannot await decode.
    for (const { path, value } of result.records) {
      if (isAssetPath(path)) {
        const asset = value as StoredAsset | undefined;
        if (!asset?.blob) throw new Error(`Missing local asset: ${path}. Import the bundle again.`);
        this.assets.set(path, asset); this.media.set(path, { path, sha256: '', blob: asset.blob });
        continue;
      }
      this.media.set(path, await verifyMedia(value, path));
    }
    return result.project;
  }

  /** Local project list, newest first. No account, team or remote source is involved. */
  async list(): Promise<ProjectSummary[]> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('projects', 'readonly');
      const request = tx.objectStore('projects').getAll();
      request.onsuccess = () => {
        const rows = (request.result as Project[]).map(project => ({
          id: project.id, name: project.name, revision: project.revision, updatedAt: project.updatedAt }));
        rows.sort((a, b) => (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0));
        resolve(rows);
      };
      request.onerror = () => reject(request.error ?? new Error('Storage list failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('Storage list aborted.'));
    });
  }

  async prepareMedia(project: Project): Promise<Map<string, StoredMedia>> {
    const paths = mediaPaths(project);
    for (const path of paths) if (!this.media.has(path)) {
      if (isAssetPath(path)) {
        const asset = this.assets.get(path) ?? await this.readAsset(path);
        if (!asset) throw new Error(`Missing local asset: ${path}. Import the bundle again.`);
        this.assets.set(path, asset); this.media.set(path, { path, sha256: '', blob: asset.blob });
        continue;
      }
      if (project.mediaVersion === 1) throw new Error(`Local media is not loaded: ${path}. Reload stored revision.`);
      this.media.set(path, await fetchFixture(path));
    }
    return new Map(paths.map(path => [path, this.media.get(path)!]));
  }

  private async readAsset(path: string): Promise<StoredAsset | undefined> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const request = db.transaction('assets', 'readonly').objectStore('assets').get(path);
      request.onsuccess = () => resolve(request.result as StoredAsset | undefined);
      request.onerror = () => reject(request.error ?? new Error('Local asset read failed.'));
    });
  }

  /** Adds one local image asset. Validation and the 5 MB ceiling are designed. */
  async addAsset(file: File): Promise<StoredAsset> {
    const checked = validateAsset(file);
    const asset: StoredAsset = { path: assetPathFor(crypto.randomUUID()), name: checked.name, type: checked.type,
      size: checked.size, blob: file, createdAt: new Date().toISOString() };
    const db = await this.db;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction('assets', 'readwrite');
      tx.objectStore('assets').put(asset);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Local asset write failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('Local asset write aborted.'));
    });
    this.assets.set(asset.path, asset); this.media.set(asset.path, { path: asset.path, sha256: '', blob: asset.blob });
    return asset;
  }

  /** Copies an existing local blob into the library (save-as from a node). */
  /**
   * Slice 1.6: media produced by a provider (mp4 / mp3) is not a user upload, so
   * the PNG/JPEG/WebP whitelist must not apply. It still gets a size ceiling so a
   * runaway response cannot fill the local store.
   */
  async addGeneratedBlob(blob: Blob, name: string, category: AssetCategory = 'other'): Promise<StoredAsset> {
    validateGeneratedBlob(blob.size);
    const asset: StoredAsset = { path: assetPathFor(crypto.randomUUID()), name,
      type: blob.type || 'application/octet-stream', size: blob.size, blob, createdAt: new Date().toISOString(), category, favorite: false };
    await this.put('assets', asset);
    this.assets.set(asset.path, asset);
    this.media.set(asset.path, { path: asset.path, sha256: '', blob });
    return asset;
  }

  async addAssetFromBlob(blob: Blob, name: string, category: AssetCategory = 'other'): Promise<StoredAsset> {
    const checked = validateAsset(new File([blob], name, { type: blob.type || 'image/png' }));
    const asset: StoredAsset = { path: assetPathFor(crypto.randomUUID()), name: checked.name, type: checked.type,
      size: checked.size, blob, createdAt: new Date().toISOString(), category, favorite: false };
    await this.put('assets', asset);
    this.assets.set(asset.path, asset);
    this.media.set(asset.path, { path: asset.path, sha256: '', blob });
    return asset;
  }

  private async put(storeName: string, value: unknown): Promise<void> {
    const db = await this.db;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(storeName, 'readwrite');
      tx.objectStore(storeName).put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Local media write failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('Local media write aborted.'));
    });
  }

  /** Restores the media a bundle carries. Stays in this browser only. */
  async importMedia(media: Map<string, Blob>): Promise<void> {
    for (const [path, blob] of media) {
      if (isAssetPath(path)) {
        const asset: StoredAsset = { path, name: path.slice(6), type: blob.type, size: blob.size, blob, createdAt: new Date().toISOString() };
        await this.put('assets', asset); this.assets.set(path, asset);
        this.media.set(path, { path, sha256: '', blob });
        continue;
      }
      const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      await this.put('media', { path, sha256, blob });
      this.media.set(path, { path, sha256, blob });
    }
  }

  /** Assets live in this browser only; nothing is uploaded or synced. */
  async listAssets(): Promise<StoredAsset[]> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const request = db.transaction('assets', 'readonly').objectStore('assets').getAll();
      request.onsuccess = () => resolve((request.result as StoredAsset[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
      request.onerror = () => reject(request.error ?? new Error('Local asset list failed.'));
    });
  }

  /** Reads one local blob without preparing a whole project. */
  async mediaBlob(path: string): Promise<Blob | undefined> {
    const cached = this.media.get(path);
    if (cached) return cached.blob;
    if (isAssetPath(path)) {
      const asset = this.assets.get(path) ?? await this.readAsset(path);
      return asset?.blob;
    }
    return undefined;
  }

  /** Library metadata only: the bytes stay where they are. */
  async updateAsset(path: string, patch: { category?: AssetCategory; favorite?: boolean; note?: string }): Promise<StoredAsset> {
    const existing = this.assets.get(path) ?? (await this.listAssets()).find(asset => asset.path === path);
    if (!existing) throw new Error('Asset not found in this browser.');
    const next: StoredAsset = { ...existing, ...patch };
    await this.put('assets', next);
    this.assets.set(path, next);
    return next;
  }

  async save(project: Project, expectedRevision: number | null): Promise<Project> {
    const start = performance.now();
    const checked = validateProject(project);
    const assets = await this.prepareMedia(checked);
    const db = await this.db;
    const preparationMs = performance.now() - start;
    const fail = this.failNextSave; this.failNextSave = false;
    const quota = this.simulateQuota; this.simulateQuota = false;
    const transactionStart = performance.now();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['projects', 'media'], 'readwrite');
      const store = tx.objectStore('projects');
      const request = store.get(project.id);
      let failure: Error | null = null;
      let saved: Project;
      request.onsuccess = () => {
        const current = request.result as Project | undefined;
        if ((current?.revision ?? null) !== expectedRevision) {
          failure = new ConflictError(); tx.abort(); return;
        }
        saved = { ...checked, mediaVersion: 1, revision: (current?.revision ?? 0) + 1, updatedAt: new Date().toISOString() };
        for (const asset of assets.values()) tx.objectStore('media').put(asset);
        store.put(saved);
        // Inject after scheduling both writes to prove atomic rollback.
        if (fail || quota) {
          failure = quota ? new DOMException('模拟配额耗尽；草稿已保留。', 'QuotaExceededError') : new Error('模拟的本地写入失败；草稿已保留。');
          tx.abort();
        }
      };
      // The request succeeding is not a durable save; only the transaction is.
      tx.oncomplete = () => {
        this.lastSaveTiming = { preparationMs, transactionMs: performance.now() - transactionStart };
        resolve(saved);
      };
      tx.onabort = () => reject(failure ?? tx.error ?? new Error('Storage write aborted.'));
      tx.onerror = () => reject(failure ?? tx.error ?? new Error('Storage write failed.'));
    });
  }
}
