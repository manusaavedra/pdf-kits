const fs = require('node:fs');
const { Buffer } = require('node:buffer');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { PDFDocument, PDFName, PDFStream, PDFWriter, StandardFonts, degrees } = require('pdf-lib');
const filename = path.resolve(process.cwd(), 'src/lib/pdf-engine.ts');
const engine = new Module(filename, module);
engine.filename = filename;
engine.paths = Module._nodeModulePaths(path.dirname(filename));
engine._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);
const { makeDocument, blankDocument, mergeDocuments, editDocument } = engine.exports;
const chunksFile = path.resolve('src/lib/pdf-chunks.ts'), chunks = new Module(chunksFile, module);
chunks.filename = chunksFile; chunks.paths = Module._nodeModulePaths(path.dirname(chunksFile));
chunks._compile(ts.transpileModule(fs.readFileSync(chunksFile, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, chunksFile);
async function source() {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]).setRotation(degrees(90));
  pdf.addPage([500, 600]);
  return makeDocument(await pdf.save(), 'Original.pdf');
}
test('creates an A4 document and retains its metadata', async () => {
  const doc = await blankDocument(); const pdf = await PDFDocument.load(doc.bytes);
  assert.equal(doc.pages, 1); assert.equal(doc.size, doc.bytes.length);
  assert.equal(pdf.getPage(0).getWidth(), 595.28);
});

test('editing combines imported pages, original edits and blanks in order without leaking notes between copies', async () => {
  const original = await source(), additional = await PDFDocument.create();
  const font = await additional.embedFont(StandardFonts.Helvetica);
  additional.addPage([360, 480]).drawText('Imported page', { font, size: 16, x: 20, y: 300 });
  const extra = await makeDocument(await additional.save(), 'Importado');
  const pages = [
    { source: 1, rotation: 90, text: 'Original edit' },
    { source: 0, documentId: extra.id, rotation: 90, text: 'Imported note' },
    { source: null, rotation: 0, text: '' },
    { source: 0, rotation: 0, text: '' },
    { source: 0, documentId: extra.id, rotation: 0, text: '' },
  ];
  const reads = [], result = await editDocument(original, pages, 'Resultado', async document => { reads.push(document.id); return document.bytes; }, { sources: [extra] });
  assert.deepEqual(reads, [original.id, extra.id]);
  const output = await PDFDocument.load(result.bytes);
  assert.deepEqual(output.getPages().map(page => Math.round(page.getWidth())), [500, 360, 595, 300, 360]);
  assert.deepEqual(output.getPages().map(page => page.getRotation().angle), [90, 90, 0, 90, 0]);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({ data: new Uint8Array(result.bytes), useSystemFonts: true, isEvalSupported: false });
  try {
    const rendered = await loading.promise;
    const text = await Promise.all(Array.from({ length: 5 }, async (_, index) => (await (await rendered.getPage(index + 1)).getTextContent()).items.map(item => item.str).join(' ')));
    assert.ok(text[0].includes('Original edit')); assert.ok(text[1].includes('Imported page') && text[1].includes('Imported note'));
    assert.equal(text[2], ''); assert.ok(text[4].includes('Imported page')); assert.ok(!text[4].includes('Imported note'));
  } finally { await loading.destroy(); }
  await assert.rejects(editDocument(original, pages, 'Sin origen'), /documentos añadidos/);
});

test('large imported PDF streams are shared with the input and deduplicated across added pages', async () => {
  const { PDFName, PDFStream } = require('pdf-lib');
  const main = await blankDocument(), additional = await PDFDocument.create();
  const bytes = new Uint8Array(16 * 1024 * 1024);
  bytes.fill(32); bytes.set(Buffer.from('0 0 0 rg 20 20 50 50 re f\n%')); bytes[bytes.length - 1] = 10;
  const shared = additional.context.register(additional.context.stream(bytes, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 400] }));
  for (let index = 0; index < 2; index++) {
    const page = additional.addPage([300 + index, 400]);
    page.node.set(PDFName.of('Resources'), additional.context.obj({ XObject: { Shared: shared } }));
    page.node.set(PDFName.of('Contents'), additional.context.register(additional.context.stream(Buffer.from('q /Shared Do Q'))));
  }
  const extra = await makeDocument(await additional.save(), 'Grande');
  await editDocument(main, [{ source: 0, rotation: 0, text: '' }, ...[1, 0, 1].map(source => ({ source, documentId: extra.id, rotation: 0, text: '' }))], 'Añadido', undefined, {
    sources: [extra], serialize: async pdf => {
      const streams = pdf.context.enumerateIndirectObjects().map(([, object]) => object).filter(object => object instanceof PDFStream && object.getContentsSize() > 1000000);
      assert.equal(streams.length, 1); assert.equal(streams[0].getContents().buffer, extra.bytes.buffer, 'Copying imported pages must not duplicate their large image/stream buffers');
      const output = await pdf.save(); return { bytes: output, size: output.length };
    },
  });
});
test('merges all pages in selected document order', async () => {
  const original = await source(); const blank = await blankDocument();
  const doc = await mergeDocuments([blank, original]); const pdf = await PDFDocument.load(doc.bytes);
  assert.deepEqual(pdf.getPages().map(p => p.getWidth()), [595.28, 300, 500]);
  assert.equal(doc.pages, 3); assert.equal(pdf.getPage(1).getRotation().angle, 90);
});

test('optional blank separators appear only between complete documents', async () => {
  const first = await source(); const second = await blankDocument(); const third = await source();
  const before = new Uint8Array(first.bytes);
  const merged = await mergeDocuments([first, second, third], { blankBetweenDocuments: true });
  const pdf = await PDFDocument.load(merged.bytes);
  assert.equal(merged.pages, 7);
  assert.deepEqual(pdf.getPages().map(page => page.getWidth()), [300, 500, 595.28, 595.28, 595.28, 300, 500]);
  for (const index of [2, 4]) {
    assert.equal(pdf.getPage(index).getHeight(), 841.89);
    assert.equal(pdf.getPage(index).getRotation().angle, 0);
    assert.ok(!pdf.getPage(index).node.Contents(), 'Separators contain no content');
  }
  assert.equal(pdf.getPage(0).getRotation().angle, 90);
  assert.equal(pdf.getPage(5).getRotation().angle, 90);
  assert.deepEqual(first.bytes, before);
  const single = await mergeDocuments([first], { blankBetweenDocuments: true });
  assert.equal(single.pages, first.pages, 'A single document gets no leading or trailing separator');
  const disabled = await mergeDocuments([first, third], { blankBetweenDocuments: false });
  assert.equal(disabled.pages, 4);
});
test('reorders, rotates, adds a blank page and adds text while preserving original bytes', async () => {
  const original = await source(); const before = new Uint8Array(original.bytes);
  const edited = await editDocument(original, [{ source: 1, rotation: 90, text: 'Nota: revisión' }, { source: null, rotation: 0, text: '' }, { source: 0, rotation: 90, text: '' }], 'Nuevo nombre');
  const pdf = await PDFDocument.load(edited.bytes);
  assert.deepEqual(pdf.getPages().map(p => p.getWidth()), [500, 595.28, 300]);
  assert.deepEqual(pdf.getPages().map(p => p.getRotation().angle), [90, 0, 180]);
  assert.equal(edited.name, 'Nuevo nombre'); assert.equal(edited.id, original.id);
  assert.deepEqual(original.bytes, before); assert.ok(pdf.getPage(0).node.Contents());
});
test('deletes pages and rejects an empty document or unsupported text', async () => {
  const original = await source();
  const edited = await editDocument(original, [{ source: 1, rotation: 0, text: '' }], 'Una página');
  assert.equal(edited.pages, 1);
  await assert.rejects(editDocument(original, [], 'Vacío'), /al menos una página/);
  await assert.rejects(editDocument(original, [{ source: 0, rotation: 0, text: '😀' }], 'Emoji'), /caracteres latinos/);
});
test('rejects malformed PDFs', async () => {
  await assert.rejects(makeDocument(new Uint8Array([1, 2, 3]), 'incorrecto.pdf'));
});

test('chunk serialization matches pdf-lib bytes and cross-reference offsets exactly', async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([300, 400]).drawText('Serialización correcta');
  const parts = [];
  const size = await chunks.exports.writePdfChunks(pdf, async part => { parts.push(new Uint8Array(part)); });
  const serialized = Buffer.concat(parts.map(part => Buffer.from(part)));
  assert.equal(serialized.length, size);
  assert.deepEqual(serialized, Buffer.from(await PDFWriter.forContext(pdf.context, 20).serializeToBuffer()));
});

test('editing preserves shared and inherited resources without duplicating streams or leaking notes to another page', async () => {
  const original = await PDFDocument.create();
  const shared = original.context.register(original.context.stream(Buffer.from('0 0 0 rg 10 10 30 30 re f')));
  const contents = original.context.register(original.context.obj([shared]));
  for (let index = 0; index < 4; index++) original.addPage([300, 400]).node.set(PDFName.of('Contents'), contents);
  const root = original.catalog.Pages();
  root.set(PDFName.of('MediaBox'), original.context.obj([0, 0, 300, 400]));
  root.set(PDFName.of('Rotate'), original.context.obj(90));
  for (const page of original.getPages()) { page.node.delete(PDFName.of('MediaBox')); page.node.delete(PDFName.of('Rotate')); }
  const doc = await makeDocument(await original.save(), 'Compartido');
  const edits = [{ source: 3, rotation: 90, text: 'Nota exclusiva' }, { source: 1, rotation: 0, text: '' }, { source: 3, rotation: 0, text: '' }];
  const edited = await editDocument(doc, edits, 'Ordenado');
  const pdf = await PDFDocument.load(edited.bytes);
  assert.deepEqual(pdf.getPages().map(page => page.getRotation().angle), [180, 90, 90]);
  assert.deepEqual(pdf.getPages().map(page => page.getWidth()), [300, 300, 300]);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({ data: new Uint8Array(edited.bytes), useSystemFonts: true });
  try {
    const result = await loading.promise;
    assert.ok((await (await result.getPage(1)).getTextContent()).items.some(item => item.str === 'Nota exclusiva'));
    assert.equal((await (await result.getPage(2)).getTextContent()).items.length, 0);
    assert.equal((await (await result.getPage(3)).getTextContent()).items.length, 0);
  } finally { await loading.destroy(); }
});

test('saving a 90 MB PDF streams bounded blocks, reuses the input streams and preserves the edited pages', async () => {
  const source = await PDFDocument.create();
  const content = new Uint8Array(90 * 1024 * 1024);
  const prefix = Buffer.from('0 0 0 rg 20 20 50 50 re f\n%');
  content.set(prefix); content.fill(32, prefix.length); content[content.length - 1] = 10;
  const shared = source.context.register(source.context.stream(content, { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 300, 400] }));
  for (let index = 0; index < 6; index++) {
    const page = source.addPage([300 + index, 400]);
    page.node.set(PDFName.of('Resources'), source.context.obj({ XObject: { Shared: shared } }));
    page.node.set(PDFName.of('Contents'), source.context.register(source.context.stream(Buffer.from('q /Shared Do Q'))));
  }
  const bytes = await source.save(), doc = { id: 'heavy', name: 'Pesado', pages: 6, size: bytes.length, updated: 1, favorite: false, kind: 'pdf', bytes };
  assert.ok(bytes.length > 90 * 1024 * 1024);
  const edits = [{ source: 5, rotation: 90, text: 'Guardado correcto' }, { source: null, rotation: 0, text: '' }, { source: 2, rotation: 0, text: '' }, { source: 0, rotation: 0, text: '' }];
  fs.mkdirSync('.expo/pdf-save-tests', { recursive: true });
  const filename = path.resolve('.expo/pdf-save-tests/heavy-edited.pdf');
  const file = await fs.promises.open(filename, 'w'), sizes = [], progress = [];
  let closed = false;
  try {
    const result = await editDocument(doc, edits, 'Editado', undefined, {
      serialize: async (pdf, report) => {
        const large = pdf.context.enumerateIndirectObjects().map(([, object]) => object).filter(object => object instanceof PDFStream && object.getContentsSize() > 1000000);
        assert.equal(large.length, 1, 'All pages reference the same large stream');
        assert.equal(large[0].getContents().buffer, bytes.buffer, 'Parsing must not duplicate the 90 MB input stream');
        pdf.save = () => { throw new Error('Do not allocate a whole output buffer'); };
        const size = await chunks.exports.writePdfChunks(pdf, async chunk => { sizes.push(chunk.length); assert.equal((await file.write(chunk)).bytesWritten, chunk.length); }, report);
        return { size, bytes: new Uint8Array(0), fileUri: filename };
      },
      onProgress: (phase, completed, total) => progress.push({ phase, completed, total }),
    });
    await file.close(); closed = true;
    assert.equal(result.bytes.length, 0);
    assert.ok(sizes.length > 400 && sizes.every(size => size <= 192 * 1024));
    assert.equal(fs.statSync(filename).size, result.size);
    assert.ok(result.size < bytes.length * 1.02, 'Saving must not multiply the source file size');
    assert.equal(progress.at(-1).completed, progress.at(-1).total);
    const output = await PDFDocument.load(fs.readFileSync(filename));
    assert.deepEqual(output.getPages().map(page => page.getWidth()), [305, 595.28, 302, 300]);
    assert.deepEqual(output.getPages().map(page => page.getRotation().angle), [90, 0, 0, 0]);
  } finally { if (!closed) await file.close(); fs.unlinkSync(filename); }
});
