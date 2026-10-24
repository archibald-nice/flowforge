/**
 * Local assets. The target product's upload flow was never executed (upload
 * feedback and validation remain unknown), so the accepted set, the ceilings and every message
 * here are FlowForge designs, not aligned behaviour.
 *
 * Slice 6.5-fix: local MP4 replacement is allowed for video nodes. Images keep
 * the 5 MB ceiling; video uses the same 50 MB ceiling as provider-produced
 * media (`MAX_GENERATED_BYTES`), because a 5 MB cap rules out every real clip.
 */
export const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const ACCEPTED_VIDEO_TYPES = ['video/mp4'] as const;
export const ACCEPTED_ASSET_TYPES = [...ACCEPTED_IMAGE_TYPES, ...ACCEPTED_VIDEO_TYPES] as const;
export const MAX_ASSET_BYTES = 5 * 1024 * 1024;
/** Provider media ceiling; also the local ceiling for MP4 replacement. */
export const MAX_GENERATED_BYTES = 50 * 1024 * 1024;

export type AssetFile = Readonly<{ name: string; type: string; size: number }>;

const megabytes = (bytes: number) => (bytes / (1024 * 1024)).toFixed(1);
const isVideo = (type: string) => (ACCEPTED_VIDEO_TYPES as readonly string[]).includes(type);
export const assetCeiling = (type: string) => (isVideo(type) ? MAX_GENERATED_BYTES : MAX_ASSET_BYTES);
export const isVideoAsset = (type: string) => isVideo(type);

export function validateAsset(file: AssetFile): AssetFile {
  if (!(ACCEPTED_ASSET_TYPES as readonly string[]).includes(file.type)) {
    throw new Error('只能添加 PNG / JPEG / WebP 图片或 MP4 视频。');
  }
  if (file.size <= 0) throw new Error('这个文件是空的。');
  const ceiling = assetCeiling(file.type);
  if (file.size > ceiling) {
    throw new Error(`这个文件 ${megabytes(file.size)} MB，超过本地上限 ${ceiling / (1024 * 1024)} MB。`);
  }
  return { name: file.name || (isVideo(file.type) ? 'untitled video' : 'untitled image'), type: file.type, size: file.size };
}

export function validateGeneratedBlob(size: number): void {
  if (!Number.isFinite(size) || size <= 0) throw new Error('The generated file is empty.');
  if (size > MAX_GENERATED_BYTES) {
    throw new Error(`The generated file is ${megabytes(size)} MB; the local ceiling is 50 MB.`);
  }
}

export const ASSET_PREFIX = 'asset:';
export const isAssetPath = (path: string) => path.startsWith(ASSET_PREFIX);
export const assetPathFor = (id: string) => `${ASSET_PREFIX}${id}`;
