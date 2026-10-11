import { PDFStream, PDFWriter, type PDFDocument } from 'pdf-lib';

export const PDF_WRITE_CHUNK_SIZE = 192 * 1024;
type Serializable = { sizeInBytes(): number; copyBytesInto(bytes: Uint8Array, offset: number): number };
const encoded = (object: Serializable) => {
  const bytes = new Uint8Array(object.sizeInBytes());
  object.copyBytesInto(bytes, 0);
  return bytes;
};
const ascii = (text: string) => Uint8Array.from(text, char => char.charCodeAt(0));

class ChunkWriter extends PDFWriter {
  constructor(pdf: PDFDocument) { super(pdf.context, 20); }
  layout() { return this.computeBufferSize(); }
}

// Use pdf-lib's object offsets and cross-reference table, but stream the bodies
// to disk instead of allocating a second buffer the size of the entire PDF.
export async function writePdfChunks(pdf: PDFDocument, write: (chunk: Uint8Array) => Promise<void>, onProgress?: (written: number, total: number) => void) {
  await pdf.flush();
  const layout = await new ChunkWriter(pdf).layout();
  const buffer = new Uint8Array(PDF_WRITE_CHUNK_SIZE);
  let used = 0, written = 0;
  const flush = async () => {
    if (!used) return;
    await write(buffer.subarray(0, used));
    written += used; used = 0;
    onProgress?.(written, layout.size);
  };
  const emit = async (bytes: Uint8Array) => {
    for (let offset = 0; offset < bytes.length;) {
      const length = Math.min(buffer.length - used, bytes.length - offset);
      buffer.set(bytes.subarray(offset, offset + length), used);
      used += length; offset += length;
      if (used === buffer.length) await flush();
    }
  };
  onProgress?.(0, layout.size);
  await emit(encoded(layout.header)); await emit(ascii('\n\n'));
  for (const [ref, object] of layout.indirectObjects) {
    await emit(ascii(`${ref.objectNumber} ${ref.generationNumber} obj\n`));
    if (object instanceof PDFStream) {
      object.updateDict();
      await emit(encoded(object.dict)); await emit(ascii('\nstream\n'));
      await emit(object.getContents()); await emit(ascii('\nendstream'));
    } else await emit(encoded(object));
    await emit(ascii('\nendobj\n\n'));
  }
  if (layout.xref) { await emit(encoded(layout.xref)); await emit(ascii('\n')); }
  if (layout.trailerDict) { await emit(encoded(layout.trailerDict)); await emit(ascii('\n\n')); }
  await emit(encoded(layout.trailer)); await flush();
  if (written !== layout.size) throw new Error('No se pudo escribir el PDF completo.');
  return written;
}
