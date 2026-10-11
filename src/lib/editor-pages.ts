import type { PageEdit } from './pdf-engine';
import type { SavedDocument } from './storage';

export type EditorPage = PageEdit & { key: string };
export function insertDocumentPages(pages: EditorPage[], selected: number, documents: SavedDocument[]) {
  const additions = documents.flatMap(document => Array.from({ length: document.pages }, (_, source) => ({
    key: `${document.id}:${source}`, documentId: document.id, source, rotation: 0, text: '',
  })));
  if (!additions.length) return { pages, selected };
  const next = [...pages]; next.splice(selected + 1, 0, ...additions);
  return { pages: next, selected: selected + 1 };
}
