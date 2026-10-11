import type { SavedDocument } from './storage';
import { thumbnailKey } from './thumbnail-key';
export type ThumbnailJob = { key: string; doc: SavedDocument };
type Entry = ThumbnailJob & { uri: string | null; status: 'reading' | 'queued' | 'rendering' | 'ready' | 'failed' };
type Options = {
  renderEnabled?: boolean;
  read: (doc: SavedDocument) => Promise<string | null>;
  write: (doc: SavedDocument, uri: string) => Promise<string>;
  remove: (doc: SavedDocument) => Promise<void>;
  onJob: (job: ThumbnailJob | null) => void;
};
export function createThumbnailStore({ read, write, remove, onJob, renderEnabled = true }: Options) {
  const entries = new Map<string, Entry>();
  const listeners = new Map<string, Set<() => void>>();
  let active: Entry | null = null, timeout: ReturnType<typeof setTimeout> | undefined;
  const emit = (key: string) => listeners.get(key)?.forEach(listener => listener());
  function advance() {
    if (active) return;
    const next = [...entries.values()].find(entry => entry.status === 'queued');
    if (!next) { onJob(null); return; }
    active = next; next.status = 'rendering';
    timeout = setTimeout(() => { void complete(next.key, null); }, 30000);
    onJob({ key: next.key, doc: next.doc });
  }
  async function complete(key: string, uri: string | null) {
    if (active?.key !== key) return;
    clearTimeout(timeout);
    const entry = active;
    if (entries.get(key) === entry && uri?.startsWith('data:image/jpeg') && uri.length < 400000) {
      let saved = uri;
      try { saved = await write(entry.doc, uri); } catch { /* Keep the in-memory image if the cache is full. */ }
      if (entries.get(key) === entry) { entry.uri = saved; entry.status = 'ready'; emit(key); }
      else { try { await remove(entry.doc); } catch { /* Cache cleanup is best effort. */ } }
    } else if (entries.get(key) === entry) entry.status = 'failed';
    if (active === entry) { active = null; advance(); }
  }
  return {
    update(documents: SavedDocument[]) {
      const keys = new Set(documents.map(thumbnailKey));
      for (const key of entries.keys()) if (!keys.has(key)) { entries.delete(key); emit(key); }
      if (active && !keys.has(active.key)) { clearTimeout(timeout); active = null; onJob(null); }
      for (const doc of documents) {
        const key = thumbnailKey(doc);
        if (entries.has(key)) continue;
        const entry: Entry = { key, doc, uri: null, status: 'reading' };
        entries.set(key, entry);
        void read(doc).catch(() => null).then(uri => {
          if (entries.get(key) !== entry) return;
          entry.uri = uri; entry.status = uri ? 'ready' : renderEnabled ? 'queued' : 'failed';
          if (uri) emit(key);
          advance();
        });
      }
      advance();
    },
    complete,
    get: (key: string) => entries.get(key)?.uri ?? null,
    subscribe(key: string, listener: () => void) {
      let subscribers = listeners.get(key);
      if (!subscribers) { subscribers = new Set(); listeners.set(key, subscribers); }
      subscribers.add(listener);
      return () => { subscribers.delete(listener); if (!subscribers.size) listeners.delete(key); };
    },
  };
}
export type ThumbnailStore = ReturnType<typeof createThumbnailStore>;
