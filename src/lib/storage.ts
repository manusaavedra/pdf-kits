import * as FileSystem from 'expo-file-system/legacy';
import { File } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { encodePdfBytes } from './base64';
import { writePdfChunks } from './pdf-chunks';
import type { PDFDocument } from 'pdf-lib';
import { readNativeFile, readSourceUri, rememberReadSource } from './native-file-read';
import { thumbnailKey } from './thumbnail-key';
import type { CommitOptions } from './library-store';
export type SavedDocument = { id: string; name: string; pages: number; size: number; updated: number; favorite: boolean; kind: 'pdf' | 'scan'; bytes: Uint8Array; fileUri?: string };
async function folder() {
  if (!FileSystem.documentDirectory) throw new Error('El almacenamiento del dispositivo no está disponible.');
  const uri = FileSystem.documentDirectory + 'pdf-kit/';
  await FileSystem.makeDirectoryAsync(uri, { intermediates: true });
  return uri;
}
async function writePdf(uri: string, bytes: Uint8Array, fileUri?: string) {
  const source = readSourceUri(bytes) ?? (bytes.length ? undefined : fileUri);
  if (source === uri) return;
  if (source && source !== uri) await FileSystem.copyAsync({ from: source, to: uri });
  else {
    if (!bytes.length) throw new Error('No se encuentra el archivo del documento.');
    const file = new File(uri + '.writing');
    for (let offset = 0; offset < bytes.length; offset += 192 * 1024) {
      file.write(encodePdfBytes(bytes.subarray(offset, offset + 192 * 1024)), { encoding: 'base64', append: offset > 0 });
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    await FileSystem.copyAsync({ from: file.uri, to: uri });
    try { file.delete(); } catch { /* Temporary files can be overwritten on retry. */ }
  }
}
export async function loadDocuments(): Promise<SavedDocument[]> {
  const dir = await folder(), index = dir + 'index.json';
  if (!(await FileSystem.getInfoAsync(index)).exists) return [];
  const records = JSON.parse(await FileSystem.readAsStringAsync(index)) as (Omit<SavedDocument, 'bytes'> & { fileName?: string })[];
  const documents: SavedDocument[] = [];
  for (const { fileName, ...record } of records) documents.push({ ...record, bytes: new Uint8Array(0), fileUri: dir + (fileName ?? record.id + '.pdf') });
  return documents;
}
export const readDocumentBytes = (doc: SavedDocument, signal?: AbortSignal, onProgress?: (loaded: number, total: number) => void) => {
  if (doc.bytes.length) { onProgress?.(doc.bytes.length, doc.bytes.length); return Promise.resolve(doc.bytes); }
  return readNativeFile(doc.fileUri!, { signal, onProgress });
};
export function retainDocuments(documents: SavedDocument[]) {
  return documents.map(doc => {
    const fileUri = readSourceUri(doc.bytes) ?? doc.fileUri;
    return fileUri && (doc.bytes.length || doc.fileUri !== fileUri) ? { ...doc, bytes: new Uint8Array(0), fileUri } : doc;
  });
}
const pendingEdits = new Set<string>();
export async function writeEditedPdf(pdf: PDFDocument, onProgress: (written: number, total: number) => void) {
  if (!FileSystem.cacheDirectory) throw new Error('La carpeta temporal del dispositivo no está disponible.');
  const file = new File(FileSystem.cacheDirectory + `pdf-kit-edit-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.pdf`);
  let append = false;
  try {
    const size = await writePdfChunks(pdf, async chunk => {
      file.write(encodePdfBytes(chunk), { encoding: 'base64', append });
      append = true;
      await new Promise(resolve => setTimeout(resolve, 0));
    }, onProgress);
    pendingEdits.add(file.uri);
    return { bytes: new Uint8Array(0), fileUri: file.uri, size };
  } catch (error) {
    void FileSystem.deleteAsync(file.uri, { idempotent: true }).catch(() => {});
    throw error;
  }
}
export function discardEditedPdf(doc: SavedDocument) {
  if (!doc.fileUri || !pendingEdits.delete(doc.fileUri)) return;
  void FileSystem.deleteAsync(doc.fileUri, { idempotent: true }).catch(() => {});
}
export async function persistDocuments(documents: SavedDocument[], previous: SavedDocument[] = [], onProgress?: CommitOptions['onProgress']) {
  const before = new Map(previous.map(doc => [doc.id, doc]));
  const contentChanged = (doc: SavedDocument) => {
    const old = before.get(doc.id);
    return !old || (!doc.bytes.length && !old.bytes.length ? doc.fileUri !== old.fileUri : old.bytes !== doc.bytes);
  };
  const changed = documents.filter(contentChanged);
  const total = changed.length + 2;
  let completed = 0;
  onProgress?.({ detail: 'Preparando la carpeta de documentos…', completed, total });
  const dir = await folder();
  completed++;
  const previousUris = new Map(previous.map(doc => [doc.id, readSourceUri(doc.bytes) ?? doc.fileUri ?? dir + doc.id + '.pdf']));
  const destinations = new Map<string, string>(), created: string[] = [];
  let published = false;
  try {
    for (const doc of documents) {
      const old = before.get(doc.id);
      // Save changes to a new version. The original stays readable until the
      // library index has successfully committed the replacement.
      const uri = contentChanged(doc)
        ? dir + (old ? `${doc.id}-${doc.updated}-${Math.random().toString(36).slice(2, 9)}.pdf` : doc.id + '.pdf')
        : previousUris.get(doc.id) ?? readSourceUri(doc.bytes) ?? doc.fileUri ?? dir + doc.id + '.pdf';
      destinations.set(doc.id, uri);
      if (contentChanged(doc)) {
        onProgress?.({ detail: 'Guardando el archivo PDF…', completed, total, name: doc.name });
        created.push(uri);
        await writePdf(uri, doc.bytes, doc.fileUri);
        completed++;
      }
    }
    onProgress?.({ detail: 'Actualizando el índice de la biblioteca…', completed, total });
    // Select metadata explicitly: never enumerate or serialize the PDF contents.
    const index = JSON.stringify(documents.map(doc => ({
      id: doc.id, name: doc.name, pages: doc.pages, size: doc.size,
      updated: doc.updated, favorite: doc.favorite, kind: doc.kind,
      ...(destinations.get(doc.id) === dir + doc.id + '.pdf' ? {} : { fileName: destinations.get(doc.id)!.slice(dir.length) }),
    })));
    // Only the small index uses string I/O; PDF bodies use native copies or
    // bounded writes. Write the index before publishing the replacement.
    const pendingIndex = new File(dir + 'index.tmp');
    pendingIndex.write(index);
    onProgress?.({ detail: 'Publicando el índice de la biblioteca…', completed, total });
    // Use the same native copy as PDF import, avoiding the stalled moveAsync.
    await FileSystem.copyAsync({ from: pendingIndex.uri, to: dir + 'index.json' });
    published = true;
    completed++;
    onProgress?.({ detail: 'Finalizando el guardado…', completed, total });
    for (const doc of documents) rememberReadSource(doc.bytes, destinations.get(doc.id)!);
    try { pendingIndex.delete(); } catch { /* A leftover temporary index is overwritten on the next save. */ }
    for (const old of previous) {
      const uri = previousUris.get(old.id)!;
      if (destinations.get(old.id) === uri) continue;
      // Cleanup must not keep a successful import or deletion waiting.
      void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    }
    const nextById = new Map(documents.map(doc => [doc.id, doc]));
    for (const doc of previous) if (!nextById.has(doc.id) || thumbnailKey(nextById.get(doc.id)!) !== thumbnailKey(doc)) {
      void removeThumbnail(doc).catch(() => {});
    }
    onProgress?.({ detail: 'Documentos guardados.', completed: total, total });
  } catch (error) {
    if (!published) for (const uri of created) void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
    throw error;
  }
}
async function thumbnailUri(doc: SavedDocument) {
  if (!FileSystem.cacheDirectory) throw new Error('La caché del dispositivo no está disponible.');
  const dir = FileSystem.cacheDirectory + 'pdf-kit-thumbnails/';
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  return dir + thumbnailKey(doc) + '.jpg';
}
export async function loadThumbnail(doc: SavedDocument) { const uri = await thumbnailUri(doc); return (await FileSystem.getInfoAsync(uri)).exists ? uri : null; }
export async function saveThumbnail(doc: SavedDocument, data: string) {
  const uri = await thumbnailUri(doc);
  new File(uri).write(data.slice(data.indexOf(',') + 1), { encoding: 'base64' });
  return uri;
}
export async function removeThumbnail(doc: SavedDocument) { const file = new File(await thumbnailUri(doc)); if (file.exists) file.delete(); }
export const readUri = readNativeFile;
export async function exportDocument(doc: SavedDocument) {
  if (!(await Sharing.isAvailableAsync())) throw new Error('Compartir no está disponible en este dispositivo.');
  if (!FileSystem.cacheDirectory) throw new Error('La caché del dispositivo no está disponible.');
  const uri = FileSystem.cacheDirectory + doc.name.replace(/[^a-zA-Z0-9áéíóúñ_. -]/g, '_') + '.pdf';
  await writePdf(uri, doc.bytes, doc.fileUri);
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: 'Guardar o compartir PDF' });
}
