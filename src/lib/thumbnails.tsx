import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import { thumbnailKey } from './thumbnail-key';
import type { SavedDocument } from './storage';
import type { ThumbnailStore } from './thumbnail-store';
export const ThumbnailContext = createContext<ThumbnailStore | null>(null);
export function useDocumentThumbnail(doc: SavedDocument) {
  const store = useContext(ThumbnailContext);
  const key = thumbnailKey(doc);
  const subscribe = useCallback((listener: () => void) => store?.subscribe(key, listener) ?? (() => {}), [store, key]);
  const snapshot = useCallback(() => store?.get(key) ?? null, [store, key]);
  return useSyncExternalStore(subscribe, snapshot, () => null);
}
