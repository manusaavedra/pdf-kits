import { PDFArray, PDFDict, PDFDocument, PDFName, PDFPage, PDFRef, PDFStream, StandardFonts, degrees, rgb, type PDFObject } from 'pdf-lib';
import type { SavedDocument } from './storage';
export type PageEdit = { source: number | null; documentId?: string; rotation: number; text: string };
export async function makeDocument(bytes: Uint8Array, name: string, kind: SavedDocument['kind'] = 'pdf'): Promise<SavedDocument> {
  const pdf = await PDFDocument.load(bytes);
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, name: name.replace(/\.pdf$/i, ''), pages: pdf.getPageCount(), size: bytes.length, updated: Date.now(), favorite: false, kind, bytes };
}
export async function mergeDocuments(docs: SavedDocument[], options: { blankBetweenDocuments?: boolean; readBytes?: (doc: SavedDocument) => Promise<Uint8Array> } = {}) {
  const merged = await PDFDocument.create();
  for (const [index, doc] of docs.entries()) {
    if (index > 0 && options.blankBetweenDocuments) merged.addPage([595.28, 841.89]);
    const source = await PDFDocument.load(options.readBytes ? await options.readBytes(doc) : doc.bytes);
    const pages = await merged.copyPages(source, source.getPageIndices());
    pages.forEach(page => merged.addPage(page));
  }
  return makeDocument(await merged.save(), 'Documentos unidos');
}
export async function blankDocument() { const pdf = await PDFDocument.create(); pdf.addPage([595.28, 841.89]); return makeDocument(await pdf.save(), 'Documento sin título'); }
export function writePageText(page: import('pdf-lib').PDFPage, font: import('pdf-lib').PDFFont, text: string) {
  if (!text.trim()) return;
  try { font.encodeText(text); } catch { throw new Error('Usa caracteres latinos en el texto añadido; esta fuente no admite emojis.'); }
  page.drawText(text, { x: 32, y: page.getHeight() - 48, size: 14, font, color: rgb(0.12, 0.28, 0.23), maxWidth: page.getWidth() - 64, lineHeight: 20 });
}
// Only the parser receives this view. Its stream slices can reference the
// immutable input file buffer rather than duplicating every embedded image.
class PdfReadBuffer extends Uint8Array<ArrayBuffer> {
  constructor(input: Uint8Array) {
    const buffer = input.buffer instanceof ArrayBuffer ? input.buffer : new Uint8Array(input).buffer;
    super(buffer, buffer === input.buffer ? input.byteOffset : 0, input.byteLength);
  }
  static get [Symbol.species]() { return Uint8Array; }
  slice(start?: number, end?: number): Uint8Array<ArrayBuffer> { return new PdfReadBuffer(this.subarray(start, end)); }
}
async function removeUnusedObjects(pdf: PDFDocument) {
  const refs = new Set<PDFRef>(), seen = new Set<PDFObject>();
  const pending = Object.values(pdf.context.trailerInfo).filter((object): object is PDFObject => !!object);
  let visited = 0;
  while (pending.length) {
    const object = pending.pop()!;
    if (seen.has(object)) continue;
    seen.add(object);
    if (object instanceof PDFRef) {
      refs.add(object);
      const value = pdf.context.lookup(object); if (value) pending.push(value);
    } else if (object instanceof PDFStream) pending.push(object.dict);
    else if (object instanceof PDFDict) for (const value of object.values()) pending.push(value);
    else if (object instanceof PDFArray) for (let index = 0; index < object.size(); index++) pending.push(object.get(index));
    if (++visited % 1000 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  for (const [ref] of pdf.context.enumerateIndirectObjects()) if (!refs.has(ref)) pdf.context.delete(ref);
}
export type EditOptions = {
  sources?: SavedDocument[];
  onProgress?: (phase: 'checking' | 'editing' | 'writing', completed: number, total: number) => void;
  serialize?: (pdf: PDFDocument, onProgress: (completed: number, total: number) => void) => Promise<{ bytes: Uint8Array; size: number; fileUri?: string }>;
};
export async function editDocument(doc: SavedDocument, edits: PageEdit[], name: string, readBytes?: (doc: SavedDocument) => Promise<Uint8Array>, options: EditOptions = {}) {
  if (!edits.length) throw new Error('El documento debe tener al menos una página.');
  const input = readBytes ? await readBytes(doc) : doc.bytes;
  options.onProgress?.('checking', 0, 1);
  await new Promise(resolve => setTimeout(resolve, 0));
  const pdf = await PDFDocument.load(new PdfReadBuffer(input), { parseSpeed: 20 });
  const originals = pdf.getPages();
  const font = edits.some(edit => edit.text.trim()) ? await pdf.embedFont(StandardFonts.Helvetica) : null;
  const prepared = edits.map(edit => {
    if (edit.source === null || edit.documentId) return null;
    const original = originals[edit.source];
    if (!original) throw new Error('Una de las páginas seleccionadas no existe en el PDF.');
    const node = original.node.clone(pdf.context);
    for (const key of ['Resources', 'MediaBox', 'CropBox', 'Rotate']) {
      const name = PDFName.of(key), value = original.node.getInheritableAttribute(name);
      if (!node.get(name) && value) node.set(name, value);
    }
    // Notes must append to a page's own content array, even when the source
    // document shares that array between several pages.
    const contents = node.Contents();
    if (contents instanceof PDFArray) node.set(PDFName.of('Contents'), contents.clone(pdf.context));
    node.delete(PDFName.of('Parent'));
    return PDFPage.of(node, pdf.context.register(node), pdf);
  });
  const additions = new Map((options.sources ?? []).map(source => [source.id, source]));
  for (const documentId of new Set(edits.filter(edit => edit.source !== null && edit.documentId).map(edit => edit.documentId!))) {
    const document = additions.get(documentId);
    if (!document) throw new Error('No se encontró uno de los documentos añadidos. Vuelve a importarlo.');
    const bytes = readBytes ? await readBytes(document) : document.bytes;
    const extra = await PDFDocument.load(new PdfReadBuffer(bytes), { parseSpeed: 20 });
    const indices = edits.flatMap((edit, index) => edit.documentId === documentId && edit.source !== null ? [index] : []);
    if (indices.some(index => edits[index].source! < 0 || edits[index].source! >= extra.getPageCount())) throw new Error('Una de las páginas añadidas no existe en el PDF.');
    const copied = await pdf.copyPages(extra, indices.map(index => edits[index].source!));
    indices.forEach((index, offset) => {
      const page = copied[offset], contents = page.node.Contents();
      if (contents instanceof PDFArray) page.node.set(PDFName.of('Contents'), contents.clone(pdf.context));
      prepared[index] = page;
    });
  }
  options.onProgress?.('editing', 0, edits.length);
  for (let index = 0; index < originals.length; index++) {
    pdf.removePage(0);
    if (index % 20 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  for (const [index, edit] of edits.entries()) {
    const page = prepared[index] ? pdf.addPage(prepared[index]!) : pdf.addPage([595.28, 841.89]);
    page.setRotation(degrees((page.getRotation().angle + edit.rotation) % 360));
    if (font) writePageText(page, font, edit.text);
    options.onProgress?.('editing', index + 1, edits.length);
    if (index % 10 === 0) await new Promise(resolve => setTimeout(resolve, 0));
  }
  await pdf.flush(); await removeUnusedObjects(pdf);
  options.onProgress?.('writing', 0, 1);
  const output = options.serialize ? await options.serialize(pdf, (completed, total) => options.onProgress?.('writing', completed, total)) : await pdf.save({ objectsPerTick: 20 }).then(bytes => ({ bytes, size: bytes.length }));
  options.onProgress?.('writing', 1, 1);
  return { ...doc, ...output, name: name.trim() || doc.name, pages: edits.length, updated: Math.max(Date.now(), doc.updated + 1) };
}
