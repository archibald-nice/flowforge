export type Viewport = { x: number; y: number; zoom: number };

export function zoomAt(view: Viewport, pointer: { x: number; y: number }, factor: number): Viewport {
  const zoom = Math.min(4, Math.max(0.1, view.zoom * factor));
  return {
    x: pointer.x - ((pointer.x - view.x) / view.zoom) * zoom,
    y: pointer.y - ((pointer.y - view.y) / view.zoom) * zoom,
    zoom,
  };
}
