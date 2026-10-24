import { useRef, useState } from 'react';

/** Single-select id (the inspector's context) plus the multi-select count the
 * canvas reports. The ref mirrors the id so event handlers can read the latest
 * selection without re-binding. */
export function useSelection(draftId: string) {
  const [selectedId, setSelectedId] = useState(draftId);
  const selectedIdRef = useRef(selectedId); selectedIdRef.current = selectedId;
  const [selectionCount, setSelectionCount] = useState(0);
  return { selectedId, setSelectedId, selectedIdRef, selectionCount, setSelectionCount };
}
