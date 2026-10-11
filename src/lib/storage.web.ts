import type { SavedDocument } from './storage';
import { thumbnailKey } from './thumbnail-key';
import type { PDFDocument } from 'pdf-lib';
export type { SavedDocument } from './storage';
export const retainDocuments = (documents: SavedDocument[]) => documents;
export const readDocumentBytes = (doc: SavedDocument, _signal?: AbortSignal, onProgress?: (loaded: number, total: number) => void) => { onProgress?.(doc.bytes.length, doc.bytes.length); return Promise.resolve(doc.bytes); };
export async function writeEditedPdf(pdf: PDFDocument, onProgress: (written: number, total: number) => void) {
  const bytes = await pdf.save({ objectsPerTick: 20 });
  onProgress(bytes.length, bytes.length);
  return { bytes, size: bytes.length };
}
export function discardEditedPdf(_doc: SavedDocument) {}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const timeout = setTimeout(() => { blocked = true; reject(new Error('El almacenamiento del navegador no responde. Cierra las otras pestañas y vuelve a intentarlo.')); }, 15000);
    const request = indexedDB.open('pdf-kit', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      const library = db.objectStoreNames.contains('library') ? request.transaction!.objectStore('library') : db.createObjectStore('library');
      const records = db.createObjectStore('documents', { keyPath: 'id' });
      // Migrate the existing library in the same atomic upgrade transaction.
      const legacy = library.get('documents');
      legacy.onsuccess = () => {
        const documents = (legacy.result ?? []) as SavedDocument[];
        for (const doc of documents) records.put(doc);
        library.put(documents.map(doc => doc.id), 'order');
        library.delete('documents');
      };
    };
    request.onsuccess = () => {
      clearTimeout(timeout);
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close(); resolve(request.result);
    };
    request.onerror = () => { clearTimeout(timeout); reject(new Error('No se puede acceder al almacenamiento del navegador.')); };
    request.onblocked = () => { clearTimeout(timeout); blocked = true; reject(new Error('Cierra las otras pestañas de PDF Kit y vuelve a abrir la aplicación.')); };
  });
}
export async function loadDocuments(): Promise<SavedDocument[]> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['library', 'documents']);
    const order = tx.objectStore('library').get('order');
    const records = tx.objectStore('documents').getAll();
    tx.oncomplete = () => {
      db.close();
      const documents = records.result as SavedDocument[];
      const byId = new Map(documents.map(doc => [doc.id, doc]));
      resolve(order.result ? (order.result as string[]).flatMap(id => { const doc = byId.get(id); return doc ? [doc] : []; }) : documents);
    };
    tx.onabort = () => { db.close(); reject(new Error('No se pudo leer la biblioteca.')); };
  });
}
export async function persistDocuments(documents: SavedDocument[], previous: SavedDocument[] = []) {
  const db = await database();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['library', 'documents'], 'readwrite');
    const timeout = setTimeout(() => tx.abort(), 30000);
    const close = () => { clearTimeout(timeout); db.close(); };
    tx.oncomplete = () => { close(); resolve(); };
    tx.onabort = () => { close(); reject(new Error('No se pudo guardar el cambio en la biblioteca. Comprueba el espacio disponible.')); };
    try {
      const records = tx.objectStore('documents');
      const before = new Map(previous.map(doc => [doc.id, doc]));
      for (const doc of documents) { if (before.get(doc.id) !== doc) records.put(doc); before.delete(doc.id); }
      for (const id of before.keys()) records.delete(id);
      const nextById = new Map(documents.map(doc => [doc.id, doc]));
      for (const doc of previous) if (!nextById.has(doc.id) || thumbnailKey(nextById.get(doc.id)!) !== thumbnailKey(doc)) tx.objectStore('library').delete(thumbnailKey(doc));
      tx.objectStore('library').put(documents.map(doc => doc.id), 'order');
    } catch (error) { tx.abort(); reject(error); }
  });
}
async function thumbnailCache(doc: SavedDocument, action: 'read' | 'write' | 'remove', uri?: string) {
  const db = await database();
  return new Promise<string | null>((resolve, reject) => {
    const tx = db.transaction('library', action === 'read' ? 'readonly' : 'readwrite');
    const store = tx.objectStore('library');
    const key = thumbnailKey(doc);
    const request = action === 'read' ? store.get(key) : action === 'write' ? store.put(uri, key) : store.delete(key);
    tx.oncomplete = () => { db.close(); resolve(action === 'read' ? (request.result as string | undefined) ?? null : uri ?? null); };
    tx.onabort = () => { db.close(); reject(new Error('No se pudo acceder a la caché de miniaturas.')); };
  });
}
export const loadThumbnail = (doc: SavedDocument) => thumbnailCache(doc, 'read');
export const saveThumbnail = async (doc: SavedDocument, uri: string) => { await thumbnailCache(doc, 'write', uri); return uri; };
export const removeThumbnail = async (doc: SavedDocument) => { await thumbnailCache(doc, 'remove'); };
export async function readUri(uri: string) { return new Uint8Array(await (await fetch(uri)).arrayBuffer()); }
export async function exportDocument(doc: SavedDocument) {
  const url = URL.createObjectURL(new Blob([new Uint8Array(doc.bytes)], { type: 'application/pdf' }));
  const link = document.createElement('a'); link.href = url; link.download = `${doc.name}.pdf`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
