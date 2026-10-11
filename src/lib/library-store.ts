import type { SavedDocument } from './storage';

export type SaveProgress = { detail: string; completed: number; total: number; name?: string };
export type CommitOptions = { onProgress?: (progress: SaveProgress) => void; optimistic?: boolean };
type Persist = (next: SavedDocument[], previous: SavedDocument[], onProgress?: CommitOptions['onProgress']) => Promise<void>;
export function yieldToPaint() {
  return new Promise<void>(resolve => {
    if (typeof requestAnimationFrame !== 'function') { setTimeout(resolve, 0); return; }
    let frame: number;
    const finish = () => { clearTimeout(timeout); cancelAnimationFrame(frame); resolve(); };
    // A backgrounded app may stop delivering frames; its storage still needs to finish.
    const timeout = setTimeout(finish, 100);
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(finish); });
  });
}
export function createLibraryStore(persist: Persist, publish: (documents: SavedDocument[]) => void, persisted: (documents: SavedDocument[]) => void = () => {}, retain: (documents: SavedDocument[]) => SavedDocument[] = documents => documents) {
  let current: SavedDocument[] = [], durable: SavedDocument[] = [];
  let queue = Promise.resolve();
  function commit(next: SavedDocument[], options: CommitOptions = {}) {
    current = next;
    if (options.optimistic !== false) publish(next);
    options.onProgress?.({ detail: 'Esperando el turno de guardado…', completed: 0, total: 0 });
    const operation = queue.then(async () => {
      // Deletions paint immediately; imports publish after their files are saved.
      if (options.optimistic !== false) await yieldToPaint();
      try {
        await persist(next, durable, options.onProgress);
        durable = retain(next);
        if (current === next) {
          current = durable;
          if (options.optimistic === false || durable !== next) publish(durable);
        }
        persisted(durable);
      }
      catch (error) {
        if (current === next) { current = durable; publish(durable); }
        throw error;
      }
    });
    queue = operation.catch(() => {});
    return operation;
  }
  return {
    initialize(documents: SavedDocument[]) { current = durable = documents; publish(documents); persisted(documents); },
    commit,
    remove(id: string) {
      if (!current.some(document => document.id === id)) return Promise.resolve();
      return commit(current.filter(document => document.id !== id));
    },
  };
}
