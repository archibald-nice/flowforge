/** Trigger a browser download for a text payload (bundles and result exports). */
export function download(name: string, body: string) {
  const url = URL.createObjectURL(new Blob([body], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  URL.revokeObjectURL(url);
}

/** Slice 6.5 — same idea, but for an existing Blob (media asset download). */
export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; anchor.click();
  URL.revokeObjectURL(url);
}
