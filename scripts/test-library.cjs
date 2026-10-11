const fs = require('node:fs');
const { Buffer } = require('node:buffer');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { test } = require('node:test');
const assert = require('node:assert/strict');
function load(file, mocks = {}) {
  const filename = path.resolve(file), compiled = new Module(filename, module);
  compiled.filename = filename; compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  const requireModule = compiled.require.bind(compiled);
  compiled.require = name => mocks[name] ?? requireModule(name);
  compiled._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
  return compiled.exports;
}
const { createLibraryStore } = load('src/lib/library-store.ts');
const keys = load('src/lib/thumbnail-key.ts');
const base64 = load('src/lib/base64.ts');
const doc = id => ({ id, name: id, pages: 1, size: 3, updated: 1, favorite: false, kind: 'pdf', bytes: new Uint8Array([1, 2, 3]) });
const tick = () => new Promise(resolve => setTimeout(resolve, 10));

test('thumbnail isolation retains cached images without starting the hidden renderer', async () => {
  const first = doc('cached'), second = doc('uncached'), jobs = [];
  const { createThumbnailStore } = load('src/lib/thumbnail-store.ts', { './thumbnail-key': keys });
  const store = createThumbnailStore({ renderEnabled: false, read: async document => document.id === 'cached' ? 'cache/first.jpg' : null, write: async () => { throw new Error('must not render'); }, remove: async () => {}, onJob: job => { if (job) jobs.push(job); } });
  store.update([first, second]); await tick();
  assert.equal(store.get(keys.thumbnailKey(first)), 'cache/first.jpg');
  assert.equal(store.get(keys.thumbnailKey(second)), null);
  store.update([second]); await tick();
  assert.equal(store.get(keys.thumbnailKey(first)), null);
  assert.deepEqual(jobs, []);
});

test('native thumbnail transfer waits for acknowledgments and bounds every PDF payload', () => {
  const { createThumbnailTransfer } = load('src/lib/thumbnail-transfer.ts', { './base64': base64 });
  const bytes = Uint8Array.from({ length: 1200001 }, (_, index) => index % 251);
  const scripts = [], job = { key: 'large', doc: { ...doc('large'), bytes } };
  const transfer = createThumbnailTransfer(job, script => scripts.push(script));
  transfer.start();
  assert.equal(scripts.length, 1);
  let offset = 0;
  const received = new Uint8Array(bytes.length);
  while (offset < bytes.length) {
    transfer.acknowledge(offset);
    const script = scripts.at(-1);
    const match = script.match(/^window\.pdfKitThumbnailChunk\(("[^"]*"),(\d+),"large"\);true;$/);
    assert.ok(match);
    const chunk = new Uint8Array(Buffer.from(JSON.parse(match[1]), 'base64'));
    assert.ok(chunk.length <= 192 * 1024);
    received.set(chunk, Number(match[2]));
    const count = scripts.length;
    transfer.acknowledge(offset); // Duplicate acknowledgments cannot queue more chunks.
    assert.equal(scripts.length, count);
    offset += chunk.length;
  }
  assert.deepEqual(received, bytes);
  transfer.acknowledge(offset);
  assert.match(scripts.at(-1), /pdfKitThumbnailFinish/);
  const count = scripts.length;
  transfer.cancel(); transfer.acknowledge(offset);
  assert.equal(scripts.length, count + 1);
});

test('imports save before publishing and report the exact pending storage step', async () => {
  let visible, finish;
  const original = [doc('existing')], imported = [doc('imported'), ...original], stages = [];
  const store = createLibraryStore(async (next, previous, report) => {
    assert.equal(visible, original);
    assert.equal(previous, original);
    report({ detail: 'copy', completed: 0, total: 1 });
    await new Promise(resolve => { finish = resolve; });
    report({ detail: 'done', completed: 1, total: 1 });
  }, next => { visible = next; });
  store.initialize(original);
  const pending = store.commit(imported, { optimistic: false, onProgress: step => stages.push(step.detail) });
  assert.equal(visible, original);
  await tick();
  assert.equal(stages.at(-1), 'copy');
  finish(); await pending;
  assert.equal(visible, imported);
  assert.equal(stages.at(-1), 'done');
});

test('failed imports leave the original list visible and permit retry', async () => {
  let visible, fail = true;
  const original = [doc('existing')], imported = [doc('imported'), ...original];
  const store = createLibraryStore(async () => { if (fail) throw new Error('cannot copy'); }, next => { visible = next; });
  store.initialize(original);
  await assert.rejects(store.commit(imported, { optimistic: false }), /cannot copy/);
  assert.equal(visible, original);
  fail = false;
  await store.commit(imported, { optimistic: false });
  assert.equal(visible, imported);
});

test('deletion updates the visible library before storage finishes', async () => {
  let visible, finish;
  const first = doc('first'), second = doc('second');
  const store = createLibraryStore(() => new Promise(resolve => { finish = resolve; }), next => { visible = next; });
  store.initialize([first, second]);
  const pending = store.commit([second]);
  assert.deepEqual(visible, [second]);
  await tick(); finish(); await pending;
  assert.deepEqual(visible, [second]);
});

test('storage failures restore the durable library and allow retry', async () => {
  let visible, fail = true;
  const original = [doc('original')];
  const store = createLibraryStore(async () => { if (fail) throw new Error('disk full'); }, next => { visible = next; });
  store.initialize(original);
  const pending = store.commit([]);
  assert.deepEqual(visible, []);
  await assert.rejects(pending, /disk full/);
  assert.equal(visible, original);
  fail = false; await store.commit([]);
  assert.deepEqual(visible, []);
});

test('queued writes use the last durable snapshot and preserve newer visible changes', async () => {
  let visible, finishFirst;
  const original = [doc('original')], next = [doc('next')], final = [doc('final')], calls = [];
  const store = createLibraryStore(async (documents, previous) => {
    calls.push({ documents, previous });
    if (calls.length === 1) await new Promise(resolve => { finishFirst = resolve; });
  }, documents => { visible = documents; });
  store.initialize(original);
  const first = store.commit(next), second = store.commit(final);
  assert.equal(visible, final);
  await tick(); assert.equal(calls.length, 1);
  finishFirst(); await Promise.all([first, second]);
  assert.equal(calls[0].previous, original); assert.equal(calls[1].previous, next);
  assert.equal(visible, final);
});

test('a failed earlier write cannot roll back a later queued edit', async () => {
  let visible, calls = 0;
  const original = [doc('original')], final = [doc('final')];
  const store = createLibraryStore(async (documents, previous) => {
    if (++calls === 1) throw new Error('temporary failure');
    assert.equal(previous, original); assert.equal(documents, final);
  }, documents => { visible = documents; });
  store.initialize(original);
  const first = store.commit([]), second = store.commit(final);
  await assert.rejects(first, /temporary failure/); await second;
  assert.equal(visible, final);
});

function nativeStorage() {
  const files = new Map(), writes = [], deletes = [], copies = [], shares = [];
  const fileSystem = {
    documentDirectory: 'document/', cacheDirectory: 'cache/', EncodingType: { Base64: 'base64' },
    makeDirectoryAsync: async () => {},
    getInfoAsync: async uri => files.has(uri) ? { exists: true, isDirectory: false, size: files.get(uri).length } : { exists: false },
    readAsStringAsync: async (uri, options = {}) => {
      if (!files.has(uri)) throw new Error('File not found');
      const bytes = files.get(uri);
      if (options.encoding === 'base64') return Buffer.from(bytes.slice(options.position ?? 0, (options.position ?? 0) + (options.length ?? bytes.length))).toString('base64');
      return bytes;
    },
    writeAsStringAsync: async (uri, contents, options = {}) => { writes.push(uri); files.set(uri, options.encoding === 'base64' ? new Uint8Array(Buffer.from(contents, 'base64')) : contents); },
    copyAsync: async ({ from, to }) => { if (!files.has(from)) throw new Error('Source missing'); copies.push({ from, to }); files.set(to, files.get(from)); },
    moveAsync: () => { throw new Error('Must not use the stalled native move'); },
    deleteAsync: async uri => { if (files.has(uri)) { deletes.push(uri); files.delete(uri); } },
  };
  const reader = load('src/lib/native-file-read.ts', { 'expo-file-system/legacy': fileSystem });
  class File {
    constructor(uri) { this.uri = uri; }
    get exists() { return files.has(this.uri); }
    write(contents, options = {}) {
      writes.push(this.uri);
      const value = options.encoding === 'base64' ? new Uint8Array(Buffer.from(contents, 'base64')) : contents;
      files.set(this.uri, options.append ? new Uint8Array(Buffer.concat([Buffer.from(files.get(this.uri)), Buffer.from(value)])) : value);
    }
    delete() { files.delete(this.uri); }
  }
  return { api: load('src/lib/storage.ts', { './base64': base64, './pdf-chunks': load('src/lib/pdf-chunks.ts'), './thumbnail-key': keys, './native-file-read': reader, 'expo-file-system': { File }, 'expo-file-system/legacy': fileSystem, 'expo-sharing': { isAvailableAsync: async () => true, shareAsync: async uri => shares.push(uri) } }), files, writes, deletes, copies, shares, File, fileSystem };
}

test('native saving reports its stages and never updates the index after a failed copy', async () => {
  const { api, files } = nativeStorage();
  files.set('cache/picked.pdf', new Uint8Array([1, 2, 3]));
  const bytes = await api.readUri('cache/picked.pdf');
  const imported = { ...doc('imported'), bytes }, steps = [];
  await api.persistDocuments([imported], [], step => steps.push(step));
  assert.deepEqual(steps.map(step => step.detail), [
    'Preparando la carpeta de documentos…', 'Guardando el archivo PDF…',
    'Actualizando el índice de la biblioteca…', 'Publicando el índice de la biblioteca…', 'Finalizando el guardado…', 'Documentos guardados.',
  ]);
  assert.deepEqual(steps.map(step => step.completed), [0, 1, 2, 2, 3, 3]);
  const originalIndex = files.get('document/pdf-kit/index.json');
  files.set('cache/missing.pdf', new Uint8Array([4, 5, 6]));
  const missing = { ...doc('missing'), bytes: await api.readUri('cache/missing.pdf') };
  files.delete('cache/missing.pdf'); steps.length = 0;
  await assert.rejects(api.persistDocuments([missing, imported], [imported], step => steps.push(step)), /Source missing/);
  assert.equal(steps.at(-1).detail, 'Guardando el archivo PDF…');
  assert.equal(files.get('document/pdf-kit/index.json'), originalIndex);
});

test('native index contains only metadata and preserves the previous index when writing fails', async () => {
  const { api, files, File } = nativeStorage();
  const first = { ...doc('first'), name: 'Documento ñ á 📄' };
  Object.defineProperty(first, 'unrelated', { enumerable: true, get() { throw new Error('Must not enumerate imported objects'); } });
  await api.persistDocuments([first]);
  const index = files.get('document/pdf-kit/index.json');
  assert.deepEqual(JSON.parse(index), [{ id: first.id, name: first.name, pages: first.pages, size: first.size, updated: first.updated, favorite: false, kind: 'pdf' }]);
  assert.ok(index.length < 300);
  assert.equal(files.has('document/pdf-kit/index.tmp'), false);
  const write = File.prototype.write;
  File.prototype.write = () => { throw new Error('disk full'); };
  await assert.rejects(api.persistDocuments([], [first]), /disk full/);
  assert.equal(files.get('document/pdf-kit/index.json'), index);
  assert.ok(files.has('document/pdf-kit/first.pdf'));
  File.prototype.write = write;
  await api.persistDocuments([], [first]);
  assert.deepEqual(JSON.parse(files.get('document/pdf-kit/index.json')), []);
});

test('a stalled native cleanup cannot block a saved deletion or the next import', async () => {
  const { api, files, fileSystem } = nativeStorage();
  const first = doc('first');
  await api.persistDocuments([first]);
  fileSystem.deleteAsync = () => new Promise(() => {});
  const store = createLibraryStore(api.persistDocuments, () => {});
  store.initialize([first]);
  const deletion = store.remove('first');
  await Promise.race([deletion, new Promise((_, reject) => setTimeout(() => reject(new Error('cleanup blocked save')), 500))]);
  assert.deepEqual(await api.loadDocuments(), []);
  assert.ok(files.has('document/pdf-kit/first.pdf'), 'Old file cleanup may still be pending');
  const next = doc('next');
  await store.commit([next], { optimistic: false });
  assert.deepEqual((await api.loadDocuments()).map(document => document.id), ['next']);
});

test('native deletion and favorites do not rewrite unchanged PDF bytes', async () => {
  const { api, files, writes, deletes } = nativeStorage();
  const first = doc('first'), second = doc('second');
  await api.persistDocuments([first, second]); writes.length = 0;
  await api.persistDocuments([second], [first, second]);
  assert.deepEqual(writes, ['document/pdf-kit/index.tmp']);
  assert.deepEqual(deletes, ['document/pdf-kit/first.pdf']);
  assert.deepEqual(files.get('document/pdf-kit/second.pdf'), second.bytes);
  assert.deepEqual((await api.loadDocuments()).map(document => document.id), ['second']);
  writes.length = 0;
  const favorite = { ...second, favorite: true };
  await api.persistDocuments([favorite], [second]);
  assert.deepEqual(writes, ['document/pdf-kit/index.tmp']);
  assert.equal((await api.loadDocuments())[0].favorite, true);
  writes.length = 0;
  const changed = { ...favorite, bytes: new Uint8Array([4, 5, 6]) };
  await api.persistDocuments([changed], [favorite]);
  const saved = (await api.loadDocuments())[0];
  assert.notEqual(saved.fileUri, 'document/pdf-kit/second.pdf', 'Edited PDFs are published as a new version');
  assert.deepEqual(writes, [saved.fileUri + '.writing', 'document/pdf-kit/index.tmp']);
  assert.deepEqual(files.get(saved.fileUri), changed.bytes);
});

test('native library releases PDF buffers after saving and reads only metadata on restart', async () => {
  const { api, files, fileSystem, copies } = nativeStorage();
  const original = doc('original');
  let visible;
  const store = createLibraryStore(api.persistDocuments, next => { visible = next; }, () => {}, api.retainDocuments);
  store.initialize([]);
  await store.commit([original], { optimistic: false });
  const initialPdfCopies = copies.filter(copy => copy.to.endsWith('.pdf')).length;
  assert.equal(visible[0].bytes.length, 0);
  assert.equal(visible[0].fileUri, 'document/pdf-kit/original.pdf');
  assert.deepEqual(await api.readDocumentBytes(visible[0]), original.bytes);
  const read = fileSystem.readAsStringAsync;
  fileSystem.readAsStringAsync = async (uri, options) => {
    assert.ok(!uri.endsWith('.pdf'), 'Opening the library must not read all PDF files');
    return read(uri, options);
  };
  const reopened = await api.loadDocuments();
  assert.equal(reopened[0].bytes.length, 0);
  await store.commit(reopened.map(document => ({ ...document, favorite: true })));
  assert.deepEqual(files.get('document/pdf-kit/original.pdf'), original.bytes);
  assert.equal(copies.filter(copy => copy.to.endsWith('.pdf')).length, initialPdfCopies);
  await store.remove('original');
  assert.deepEqual(visible, []);
});

test('native preview reads only requested 64 KB ranges from a 90 MB file', async () => {
  const requests = [];
  const { readPreviewRange } = load('src/lib/preview-range.ts', {
    './base64': base64, './native-file-read': { readSourceUri: () => undefined },
    'expo-file-system/legacy': { EncodingType: { Base64: 'base64' }, readAsStringAsync: async (uri, options) => { requests.push({ uri, ...options }); return 'AQID'; } },
  });
  const large = { ...doc('large'), size: 90 * 1024 * 1024, bytes: new Uint8Array(0), fileUri: 'document/large.pdf' };
  assert.equal(await readPreviewRange(large, large.size - 65536, large.size), 'AQID');
  assert.deepEqual(requests, [{ uri: large.fileUri, encoding: 'base64', position: large.size - 65536, length: 65536 }]);
  await assert.rejects(readPreviewRange(large, 0, 65537), /inválido/);
  assert.equal(requests.length, 1);
});

test('file-backed documents can be edited, merged and exported without eager library reads', async () => {
  const { PDFDocument } = require('pdf-lib');
  const engine = load('src/lib/pdf-engine.ts');
  const native = nativeStorage(), pdf = await PDFDocument.create();
  pdf.addPage(); pdf.addPage();
  const original = await engine.makeDocument(await pdf.save(), 'Original');
  await native.api.persistDocuments([original]);
  const [stored] = native.api.retainDocuments([original]);
  assert.equal(stored.bytes.length, 0);
  const edited = await engine.editDocument(stored, [{ source: 1, rotation: 90, text: '' }], 'Editado', native.api.readDocumentBytes);
  await native.api.persistDocuments([edited], [stored]);
  const [saved] = native.api.retainDocuments([edited]);
  assert.equal(saved.bytes.length, 0);
  const result = await PDFDocument.load(await native.api.readDocumentBytes(saved));
  assert.equal(result.getPageCount(), 1); assert.equal(result.getPage(0).getRotation().angle, 90);
  const merged = await engine.mergeDocuments([saved, saved], { readBytes: native.api.readDocumentBytes, blankBetweenDocuments: true });
  assert.equal(merged.pages, 3);
  await native.api.exportDocument(saved);
  assert.deepEqual(native.files.get(native.shares[0]), edited.bytes);
});

test('failed generated PDF chunk writes preserve the saved file and index', async () => {
  const { api, files, File } = nativeStorage();
  const original = doc('original');
  await api.persistDocuments([original]);
  const index = files.get('document/pdf-kit/index.json'), write = File.prototype.write;
  File.prototype.write = function(contents, options) {
    if (options?.append) throw new Error('disk full');
    write.call(this, contents, options);
  };
  const changed = { ...original, bytes: new Uint8Array(700000) };
  await assert.rejects(api.persistDocuments([changed], [original]), /disk full/);
  assert.deepEqual(files.get('document/pdf-kit/original.pdf'), original.bytes);
  assert.equal(files.get('document/pdf-kit/index.json'), index);
});

function editorSaver(storage) {
  return load('src/lib/editor-save.ts', {
    './pdf-engine': load('src/lib/pdf-engine.ts'), './storage': storage,
    './library-store': load('src/lib/library-store.ts'), './save-progress': load('src/lib/save-progress.ts'),
  }).saveEditorDocument;
}

test('editor saves imported file-backed pages inside the current PDF without adding sources to the library', async () => {
  const { PDFDocument } = require('pdf-lib'), engine = load('src/lib/pdf-engine.ts');
  const primary = await PDFDocument.create(); primary.addPage([300, 400]);
  const original = await engine.makeDocument(await primary.save(), 'Original');
  const additional = await PDFDocument.create(); additional.addPage([500, 600]);
  const extra = await engine.makeDocument(await additional.save(), 'Añadido');
  const native = nativeStorage(); let documents = [];
  const store = createLibraryStore(native.api.persistDocuments, next => { documents = next; }, () => {}, native.api.retainDocuments);
  store.initialize([]); await store.commit([original], { optimistic: false });
  native.files.set('cache/imported-extra.pdf', extra.bytes);
  const imported = { ...extra, bytes: new Uint8Array(), fileUri: 'cache/imported-extra.pdf' }, progress = [];
  const result = await editorSaver(native.api)(documents[0], [{ source: 0, documentId: imported.id, rotation: 0, text: '' }], 'Resultado', documents, store.commit, step => progress.push(step), [imported]);
  assert.equal(documents.length, 1); assert.equal(result.id, original.id);
  const reopened = await native.api.loadDocuments(); assert.equal(reopened.length, 1);
  const output = await PDFDocument.load(await native.api.readDocumentBytes(reopened[0]));
  assert.equal(output.getPage(0).getWidth(), 500, 'Replacing a page from an added PDF cannot use the rename-only fast path');
  assert.ok(progress.every((step, index) => !index || step.percentage >= progress[index - 1].percentage));
  assert.equal(progress.at(-1).percentage, 100);
  assert.ok(!native.files.has('docs/' + imported.id + '.pdf'), 'The imported source stays temporary');
});

test('editor saving reports actual stages, publishes a file-backed result and reopens all saved edits', async () => {
  const { PDFDocument, degrees } = require('pdf-lib');
  const source = await PDFDocument.create();
  source.addPage([300, 400]).setRotation(degrees(90)); source.addPage([500, 600]);
  const original = await load('src/lib/pdf-engine.ts').makeDocument(await source.save(), 'Original');
  const native = nativeStorage();
  let documents = [];
  const store = createLibraryStore(native.api.persistDocuments, next => { documents = next; }, () => {}, native.api.retainDocuments);
  store.initialize([]); await store.commit([original], { optimistic: false });
  const before = documents[0], progress = [], read = native.fileSystem.readAsStringAsync;
  let pdfReads = 0;
  native.fileSystem.readAsStringAsync = (...args) => { if (args[0].endsWith('.pdf')) pdfReads++; return read(...args); };
  const pending = editorSaver(native.api)(before, [{ source: 1, rotation: 90, text: 'Cambios guardados' }, { source: null, rotation: 0, text: '' }], 'Resultado', documents, store.commit, step => progress.push(step));
  assert.equal(progress[0].percentage, 0);
  assert.equal(pdfReads, 0, 'Show the dialog before starting PDF work');
  const result = await pending;
  assert.equal(result.bytes.length, 0);
  assert.notEqual(result.fileUri, before.fileUri);
  assert.ok(!result.fileUri.startsWith('cache/'), 'The editor must use the durable file after save');
  assert.equal(documents[0].fileUri, result.fileUri);
  assert.ok(progress.every((step, index) => index === 0 || step.percentage >= progress[index - 1].percentage));
  assert.equal(progress.at(-1).percentage, 100);
  assert.ok(progress.some(step => step.detail.startsWith('Aplicando cambios')));
  assert.ok(progress.some(step => step.detail === 'Escribiendo el PDF…'));
  assert.equal([...native.files.keys()].some(uri => uri.startsWith('cache/pdf-kit-edit-')), false, 'Temporary output is cleaned after publication');
  const [reopened] = await native.api.loadDocuments();
  assert.equal(reopened.name, 'Resultado'); assert.equal(reopened.fileUri, result.fileUri);
  const pdf = await PDFDocument.load(await native.api.readDocumentBytes(reopened));
  assert.deepEqual(pdf.getPages().map(page => page.getWidth()), [500, 595.28]);
  assert.equal(pdf.getPage(0).getRotation().angle, 90);
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({ data: new Uint8Array(await native.api.readDocumentBytes(reopened)), useSystemFonts: true });
  try { assert.ok((await (await (await loading.promise).getPage(1)).getTextContent()).items.some(item => item.str === 'Cambios guardados')); }
  finally { await loading.destroy(); }
});

test('an editor index publication failure keeps the original PDF and permits retry', async () => {
  const { PDFDocument } = require('pdf-lib');
  const source = await PDFDocument.create(); source.addPage([300, 400]); source.addPage([500, 600]);
  const original = await load('src/lib/pdf-engine.ts').makeDocument(await source.save(), 'Original');
  const native = nativeStorage();
  let documents;
  const store = createLibraryStore(native.api.persistDocuments, next => { documents = next; }, () => {}, native.api.retainDocuments);
  store.initialize([]); await store.commit([original], { optimistic: false });
  const before = documents[0], oldIndex = native.files.get('document/pdf-kit/index.json');
  const copy = native.fileSystem.copyAsync;
  native.fileSystem.copyAsync = async options => {
    if (options.to.endsWith('/index.json')) throw new Error('Cannot publish index');
    return copy(options);
  };
  const save = editorSaver(native.api), edits = [{ source: 1, rotation: 90, text: '' }], progress = [];
  await assert.rejects(save(before, edits, 'Nuevo', documents, store.commit, step => progress.push(step)), /Cannot publish index/);
  assert.equal(native.files.get('document/pdf-kit/index.json'), oldIndex);
  assert.deepEqual(native.files.get(before.fileUri), original.bytes, 'Original bytes remain untouched');
  assert.equal(documents[0].fileUri, before.fileUri);
  assert.ok(progress.every(step => step.percentage < 100));
  assert.equal([...native.files.keys()].some(uri => uri.startsWith('cache/pdf-kit-edit-')), false);
  native.fileSystem.copyAsync = copy;
  const saved = await save(before, edits, 'Nuevo', documents, store.commit, () => {});
  assert.equal(saved.pages, 1); assert.equal(saved.name, 'Nuevo');
  assert.ok(native.files.has(saved.fileUri));
  assert.equal(native.files.has(before.fileUri), false, 'Discard the old version only after the successful retry');
});

test('renaming from the editor updates only metadata without reading or regenerating the PDF', async () => {
  const native = nativeStorage(), original = doc('rename');
  await native.api.persistDocuments([original]);
  const [before] = native.api.retainDocuments([original]);
  const store = createLibraryStore(native.api.persistDocuments, () => {}, () => {}, native.api.retainDocuments); store.initialize([before]);
  native.writes.length = 0; native.copies.length = 0;
  native.fileSystem.readAsStringAsync = () => { throw new Error('Do not read a PDF when renaming'); };
  const saved = await editorSaver(native.api)(before, [{ source: 0, rotation: 0, text: '' }], 'Renombrado', [before], store.commit, () => {});
  assert.equal(saved.name, 'Renombrado'); assert.equal(saved.fileUri, before.fileUri);
  assert.deepEqual(native.writes, ['document/pdf-kit/index.tmp']);
  assert.equal(native.copies.filter(copy => copy.to.endsWith('.pdf')).length, 0);
});

test('the editor save dialog exposes its current percentage and pending stage', () => {
  const { EditorSaveDialog } = load('src/components/editor-save-dialog.tsx', {
    'react-native': { ActivityIndicator: 'Spinner', Text: 'Text', View: 'View' },
    './centered-dialog': { CenteredDialog: 'CenteredDialog' }, './pdf-styles': { green: '#245e4c', styles: {} },
  });
  const dialog = EditorSaveDialog({ visible: true, progress: { percentage: 72, detail: 'Escribiendo el PDF…' } });
  assert.equal(dialog.props.visible, true);
  const nodes = [];
  const visit = node => { if (!node || typeof node !== 'object') return; nodes.push(node); for (const child of [node.props?.children].flat()) visit(child); };
  visit(dialog);
  const bar = nodes.find(node => node.props?.accessibilityRole === 'progressbar');
  assert.equal(bar.props.accessibilityValue.now, 72);
  assert.ok(nodes.some(node => node.props?.children === 'Escribiendo el PDF…'));
  assert.ok(nodes.some(node => Array.isArray(node.props?.children) && node.props.children.join('') === '72%'));
});

// A transaction-level IDB double verifies requests without browser dependencies.
function browserStorage(legacyDocuments) {
  let stores = new Map([['library', new Map([['documents', legacyDocuments]])]]), version = 1;
  const writes = [], deletes = [];
  function transaction() {
    const staged = new Map([...stores].map(([name, values]) => [name, new Map(values)]));
    let timer, pending = 0, aborted = false;
    const tx = { objectStore: name => store(name), abort: () => { aborted = true; clearTimeout(timer); setTimeout(() => tx.onabort?.(), 0); } };
    const finish = () => { clearTimeout(timer); timer = setTimeout(() => { if (!aborted && !pending) { stores = staged; tx.oncomplete?.(); } }, 0); };
    function request(read) {
      const result = {}; pending++;
      setTimeout(() => { result.result = read(); result.onsuccess?.(); pending--; finish(); }, 0);
      return result;
    }
    function store(name) {
      const values = staged.get(name);
      return {
        get: key => request(() => values.get(key)), getAll: () => request(() => [...values.values()]),
        put: (value, key = value.id) => { values.set(key, value); writes.push({ store: name, key, value }); finish(); },
        delete: key => { values.delete(key); deletes.push({ store: name, key }); finish(); },
      };
    }
    tx.createStore = name => { staged.set(name, new Map()); return store(name); };
    finish(); return tx;
  }
  const indexedDB = { open: (_name, nextVersion) => {
    const request = {};
    setTimeout(() => {
      const db = { close: () => {}, objectStoreNames: { contains: name => stores.has(name) }, transaction };
      request.result = db;
      if (version < nextVersion) {
        const tx = transaction(); request.transaction = tx; db.createObjectStore = tx.createStore;
        tx.oncomplete = () => { version = nextVersion; request.onsuccess?.(); };
        request.onupgradeneeded?.();
      } else request.onsuccess?.();
    }, 0);
    return request;
  } };
  return { indexedDB, writes, deletes, snapshot: () => stores };
}

test('web storage migrates the existing library and deletes just one record', async () => {
  const first = doc('first'), second = doc('second');
  const backend = browserStorage([second, first]);
  const previousIndexedDB = global.indexedDB; global.indexedDB = backend.indexedDB;
  try {
    const api = load('src/lib/storage.web.ts', { './thumbnail-key': keys });
    const previous = await api.loadDocuments();
    assert.deepEqual(previous.map(document => document.id), ['second', 'first']);
    assert.equal(backend.snapshot().get('library').has('documents'), false, 'Legacy array is replaced by individual records');
    assert.equal(backend.snapshot().get('documents').size, 2);
    backend.writes.length = 0; backend.deletes.length = 0;
    await api.persistDocuments([second], previous);
    assert.deepEqual(backend.writes.map(write => [write.store, write.key]), [['library', 'order']]);
    assert.deepEqual(backend.deletes, [{ store: 'documents', key: 'first' }, { store: 'library', key: keys.thumbnailKey(first) }]);
    assert.deepEqual((await api.loadDocuments()).map(document => document.id), ['second']);
    const result = doc('merged'); backend.writes.length = 0;
    await api.persistDocuments([result, second], [second]);
    assert.deepEqual(backend.writes.map(write => [write.store, write.key]), [['documents', 'merged'], ['library', 'order']]);
    assert.deepEqual((await api.loadDocuments()).map(document => document.id), ['merged', 'second']);
  } finally { global.indexedDB = previousIndexedDB; }
});

test('merge imports stay temporary, cancellation discards them, and only the result is committed', async () => {
  const slots = []; let cursor = 0, picked = [], view = 'home', documents = [doc('existing')];
  const commits = [], merged = [], routes = [];
  const hooks = {
    createContext: () => ({ Provider: 'ActionsProvider' }),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo: factory => factory(), useCallback: callback => callback, useEffect: () => {},
  };
  const element = (type, props) => ({ type, props });
  const components = names => Object.fromEntries(names.map(name => [name, name]));
  const mocks = {
    react: hooks,
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'react-native': { ...components(['ActivityIndicator', 'Pressable', 'FlatList', 'Text', 'TextInput', 'View']), Platform: { OS: 'web' }, useWindowDimensions: () => ({ width: 390 }) },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { useLocalSearchParams: () => ({ view }), router: { push: route => routes.push(route) } },
    'lucide-react-native': new Proxy({}, { get: (_target, name) => name }),
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' },
    '@/lib/pdf': { pickPdfs: async options => picked instanceof Promise ? abortable(picked, options.signal) : picked, mergeDocuments: async (selected, options) => { merged.push({ selected, options }); return doc('result'); } },
    '@/lib/storage': {},
    '@/components/pdf-ui': { ...components(['Button', 'HeroIllustration', 'IconButton']), formatSize: () => '3 B' },
    '@/components/pdf-styles': { styles: new Proxy({}, { get: () => ({}) }), green: '#357761' },
    '@/components/pdf-dialogs': { PdfDialogs: 'PdfDialogs' },
    '@/components/document-card': { DocumentCard: 'DocumentCard' },
    '@/components/document-delete-dialog': { DocumentDeleteDialog: 'DocumentDeleteDialog' },
    '@/components/operation-dialog': { OperationDialog: 'OperationDialog' },
    '@/components/image-crop-dialog': { ImageCropDialog: 'ImageCropDialog' },
    '@/hooks/use-image-crop': { useImageCrop: () => ({ cropRequest: null }) },
    '@/lib/library': { useLibrary: () => ({ documents, loaded: true, error: null, commit: async next => { commits.push(next); documents = next; } }) },
  };
  const { DocumentActionsProvider } = load('src/components/document-actions.tsx', mocks);
  let actions;
  const { DocumentWorkspace } = load('src/components/document-workspace.tsx', { ...mocks, '@/components/document-actions': { useDocumentActions: () => actions } });
  function render() {
    cursor = 0;
    const provider = DocumentActionsProvider({ children: null });
    actions = provider.props.value;
    return element('View', { children: [DocumentWorkspace({ section: view }), provider] });
  }
  function nodes(node) { if (Array.isArray(node)) return node.flatMap(nodes); if (!node || typeof node !== 'object') return []; return [node, ...nodes(node.props?.children), ...nodes(node.props?.ListHeaderComponent)]; }
  const dialog = () => nodes(render()).find(node => node.type === 'PdfDialogs').props;
  function openMerge() {
    const button = nodes(render()).find(node => node.type === 'Pressable' && nodes(node).some(child => child.type === 'Text' && child.props.children === 'Unir documentos'));
    button.props.onPress();
  }
  openMerge(); picked = [doc('import-a'), doc('import-b')];
  await dialog().importFiles();
  assert.equal(commits.length, 0);
  assert.deepEqual(dialog().selected, ['import-a', 'import-b']);
  assert.deepEqual(dialog().mergeCandidates.map(document => document.id), ['import-a', 'import-b', 'existing']);
  dialog().setDialog(null);
  assert.deepEqual(dialog().mergeCandidates.map(document => document.id), ['existing']);
  assert.equal(commits.length, 0);
  openMerge(); await dialog().importFiles();
  dialog().setBlankBetweenDocuments(true);
  await dialog().merge();
  assert.deepEqual(merged[0].selected.map(document => document.id), ['import-a', 'import-b']);
  assert.equal(merged[0].options.blankBetweenDocuments, true);
  assert.deepEqual(commits[0].map(document => document.id), ['result', 'existing']);
  assert.equal(commits.length, 1);
  assert.equal(routes[0].params.id, 'result');
  assert.deepEqual(dialog().mergeCandidates.map(document => document.id), ['result', 'existing']);
  view = 'files'; documents = Array.from({ length: 1000 }, (_, index) => doc(String(index)));
  const tree = render(), list = nodes(tree).find(node => node.type === 'FlatList');
  assert.equal(list.props.numColumns, 1, 'The library defaults to list view');
  assert.equal(list.props.data.length, 1000);
  assert.equal(nodes(tree).filter(node => node.type === 'DocumentCard').length, 0, 'Rows are created by the virtual list rather than all at once');
  const row = nodes(list.props.renderItem({ item: documents[0] })).find(node => node.type === 'DocumentCard');
  const deletion = nodes(tree).find(node => node.type === 'DocumentDeleteDialog');
  let shown; deletion.props.ref.current = { show: document => { shown = document; } };
  const previousSlots = [...slots]; row.props.onDelete(documents[0]);
  assert.equal(shown, documents[0]);
  assert.deepEqual(slots, previousSlots, 'Opening confirmation must not update the workspace state');
  picked = new Promise(() => {});
  const importing = dialog().importFiles();
  const operation = nodes(render()).find(node => node.type === 'OperationDialog');
  assert.equal(operation.props.visible, true); operation.props.onCancel(); await importing;
  assert.equal(nodes(render()).find(node => node.type === 'OperationDialog').props.visible, false, 'Cancellation must clear the processing dialog');
  picked = Promise.reject(new Error('No se puede leer este archivo'));
  await dialog().importFiles();
  assert.equal(nodes(render()).find(node => node.type === 'OperationDialog').props.visible, false, 'Read failures must clear the processing dialog');
  assert.equal(commits.length, 1, 'Canceled and failed imports never reach persistence');


});

const { createThumbnailStore } = load('src/lib/thumbnail-store.ts', { './thumbnail-key': keys });
function thumbnailHarness(cache = new Map()) {
  const jobs = [], reads = [], writes = [], removed = [];
  const store = createThumbnailStore({
    read: async document => { reads.push(document.id); return cache.get(keys.thumbnailKey(document)) ?? null; },
    write: async (document, uri) => { writes.push(document.id); cache.set(keys.thumbnailKey(document), uri); return uri; },
    remove: async document => { removed.push(document.id); cache.delete(keys.thumbnailKey(document)); },
    onJob: job => { if (job) jobs.push(job); },
  });
  return { store, jobs, reads, writes, removed, cache };
}
const jpeg = 'data:image/jpeg;base64,dGVzdA==';

test('thumbnail cache renders only added or changed documents and survives app restart', async () => {
  const first = doc('first'), second = doc('second'), added = doc('added');
  const { store, jobs, reads, cache } = thumbnailHarness();
  let firstChanges = 0, secondChanges = 0;
  store.subscribe(keys.thumbnailKey(first), () => firstChanges++);
  store.subscribe(keys.thumbnailKey(second), () => secondChanges++);
  store.update([first, second]); await tick();
  assert.equal(jobs.length, 1, 'Only one PDF may render at a time');
  await store.complete(jobs[0].key, jpeg);
  assert.equal(secondChanges, 0, 'Finishing one thumbnail must not notify other cards');
  await store.complete(jobs[1].key, jpeg);
  assert.equal(firstChanges, 1); assert.equal(secondChanges, 1);
  store.update([second, added]); await tick();
  assert.equal(store.get(keys.thumbnailKey(second)), jpeg);
  assert.deepEqual(reads, ['first', 'second', 'added']);
  assert.deepEqual(jobs.map(job => job.doc.id), ['first', 'second', 'added']);
  await store.complete(jobs[2].key, jpeg);
  store.update([{ ...second, favorite: true }, added]); await tick();
  assert.equal(jobs.length, 3, 'Favorite changes must reuse the thumbnail');
  const restart = thumbnailHarness(cache);
  restart.store.update([second, added]); await tick();
  assert.equal(restart.jobs.length, 0, 'Persisted thumbnails must not be regenerated after reopening');
  assert.equal(restart.store.get(keys.thumbnailKey(second)), jpeg);
  const edited = { ...second, updated: second.updated + 1, bytes: new Uint8Array([4, 5, 6]) };
  store.update([edited, added]); await tick();
  assert.equal(jobs.length, 4); assert.equal(jobs[3].doc.id, 'second');
  await store.complete(jobs[3].key, jpeg);
});

test('deleting during generation ignores stale results and leaves the next document queued', async () => {
  const first = doc('first'), second = doc('second');
  const { store, jobs, writes } = thumbnailHarness();
  store.update([first, second]); await tick();
  store.update([second]);
  await store.complete(jobs[0].key, jpeg);
  assert.equal(store.get(keys.thumbnailKey(first)), null);
  assert.deepEqual(writes, []);
  assert.equal(jobs[1].doc.id, 'second');
  await store.complete(jobs[1].key, jpeg);
  assert.deepEqual(writes, ['second']);
});

test('native and browser thumbnail caches persist separately from PDF bytes', async () => {
  const first = doc('first'), second = doc('second');
  const native = nativeStorage();
  assert.equal(await native.api.loadThumbnail(first), null);
  const uri = await native.api.saveThumbnail(first, jpeg);
  assert.equal(await native.api.loadThumbnail(first), uri);
  assert.equal(native.writes.length, 1); assert.ok(native.writes[0].endsWith('.jpg'));
  await native.api.saveThumbnail(second, jpeg);
  await native.api.persistDocuments([first, second]);
  await native.api.persistDocuments([second], [first, second]);
  assert.equal(await native.api.loadThumbnail(first), null);
  assert.ok(await native.api.loadThumbnail(second));
  const backend = browserStorage([first, second]);
  const previousIndexedDB = global.indexedDB; global.indexedDB = backend.indexedDB;
  try {
    const api = load('src/lib/storage.web.ts', { './thumbnail-key': keys });
    await api.loadDocuments(); backend.writes.length = 0;
    await api.saveThumbnail(first, jpeg); await api.saveThumbnail(second, jpeg);
    assert.equal(await api.loadThumbnail(first), jpeg);
    assert.ok(backend.writes.every(write => write.store === 'library'), 'Caching an image must not rewrite the PDF record');
    await api.persistDocuments([second], [first, second]);
    assert.equal(await api.loadThumbnail(first), null);
    assert.equal(await api.loadThumbnail(second), jpeg);
  } finally { global.indexedDB = previousIndexedDB; }
});

test('thumbnail cache handles write failures and removes images saved after deletion', async () => {
  const first = doc('first'), second = doc('second');
  let finishWrite; const jobs = [], removed = [];
  const store = createThumbnailStore({
    read: async () => null,
    write: async document => {
      if (document.id === first.id) await new Promise(resolve => { finishWrite = resolve; });
      else throw new Error('cache full');
      return jpeg;
    },
    remove: async document => { removed.push(document.id); },
    onJob: job => { if (job) jobs.push(job); },
  });
  store.update([first, second]); await tick();
  const saving = store.complete(jobs[0].key, jpeg);
  store.update([second]); finishWrite(); await saving;
  assert.deepEqual(removed, ['first']);
  assert.equal(store.get(keys.thumbnailKey(first)), null);
  await store.complete(jobs[1].key, jpeg);
  assert.equal(store.get(keys.thumbnailKey(second)), jpeg, 'Memory cache still works when disk caching fails');
});


test('consecutive deletes use the current library while storage is still pending', async () => {
  let visible, finishFirst;
  const first = doc('first'), second = doc('second'), third = doc('third'), writes = [];
  const store = createLibraryStore(async (next, previous) => {
    writes.push({ next, previous });
    if (writes.length === 1) await new Promise(resolve => { finishFirst = resolve; });
  }, next => { visible = next; });
  store.initialize([first, second, third]);
  const a = store.remove(first.id);
  assert.deepEqual(visible, [second, third]);
  const b = store.remove(second.id);
  assert.deepEqual(visible, [third]);
  await store.remove('missing');
  await tick(); assert.equal(writes.length, 1);
  finishFirst(); await Promise.all([a, b]);
  assert.deepEqual(writes[1].previous, [second, third]);
  assert.deepEqual(writes[1].next, [third]);
  assert.equal(visible[0], third, 'Unchanged documents keep their identity and thumbnail');
});

test('delete confirmation keeps its own state and closes before requesting persistence', () => {
  let selected = null, handle, modal, removed;
  const ref = { current: null };
  const element = (type, props) => ({ type, props });
  const Dialog = load('src/components/document-delete-dialog.tsx', {
    react: { memo: component => component, useState: () => [selected, value => { selected = value; }], useImperativeHandle: (_ref, create) => { handle = create(); } },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    'react-native': { Modal: 'Modal', Text: 'Text', View: 'View' },
    'lucide-react-native': { Trash2: 'Trash2' },
    './pdf-ui': { Button: 'Button' },
    './centered-dialog': { CenteredDialog: 'CenteredDialog' },
    './pdf-styles': { styles: {} },
  }).DocumentDeleteDialog;
  const render = () => modal = Dialog({ ref, onRemove: id => { assert.equal(selected, null); removed = id; } });
  render(); assert.equal(modal.props.visible, false);
  handle.show(doc('first'));
  assert.deepEqual(selected, { id: 'first', name: 'first' }, 'The modal does not retain PDF bytes');
  render(); assert.equal(modal.props.visible, true); assert.equal(modal.type, 'CenteredDialog');
  const buttons = modal.props.children.props.children.props.children[2].props.children;
  buttons[0].props.onPress(); assert.equal(selected, null); assert.equal(removed, undefined);
  handle.show(doc('second')); render();
  modal.props.children.props.children.props.children[2].props.children[1].props.onPress();
  assert.equal(removed, 'second'); render(); assert.equal(modal.props.visible, false);
});


test('persistence gives the optimistic deletion time to paint', async () => {
  const oldRequest = global.requestAnimationFrame, oldCancel = global.cancelAnimationFrame;
  const frames = []; let writes = 0, visible;
  global.requestAnimationFrame = callback => { frames.push(callback); return frames.length; };
  global.cancelAnimationFrame = () => {};
  try {
    const store = createLibraryStore(async () => { writes++; }, next => { visible = next; });
    store.initialize([doc('first')]); const pending = store.remove('first');
    assert.deepEqual(visible, []);
    await Promise.resolve(); assert.equal(writes, 0);
    frames[0](); await Promise.resolve(); assert.equal(writes, 0);
    frames[1](); await pending; assert.equal(writes, 1);
  } finally { global.requestAnimationFrame = oldRequest; global.cancelAnimationFrame = oldCancel; }
});


const { importPdfAssets, abortable } = load('src/lib/import-progress.ts');
test('imports larger than 50 MB retain chunked reading and reach document validation', async () => {
  const native = nativeStorage(), size = 51 * 1024 * 1024;
  const source = new Uint8Array(size);
  source[0] = 37; source[size - 1] = 42;
  native.files.set('cache/large.pdf', source);
  const progress = [];
  const result = await importPdfAssets([{ name: 'large.pdf', uri: 'cache/large.pdf', size }], native.api.readUri, async (bytes, name) => {
    assert.deepEqual(bytes, source);
    return { ...doc('large'), bytes, name, size: bytes.length };
  }, { onProgress: step => progress.push(step) });
  assert.equal(result[0].size, size);
  const readings = progress.filter(step => step.phase === 'reading' && step.bytesTotal);
  assert.equal(readings.at(-1).bytesRead, size);
  assert.ok(readings.length > 2);
  assert.equal(progress.at(-1).completed, 1);
});
test('PDF imports read browser files directly and report completed files', async () => {
  const progress = [], created = [];
  const assets = ['first.pdf', 'second.pdf'].map(name => ({ name, uri: 'unused', file: { arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer } }));
  const result = await importPdfAssets(assets, async () => { throw new Error('Should not fetch blob URLs'); }, async (bytes, name) => { created.push(name); return { ...doc(name), bytes }; }, { onProgress: value => progress.push(value) });
  assert.equal(result.length, 2); assert.deepEqual(created, ['first.pdf', 'second.pdf']);
  assert.deepEqual(progress.map(value => [value.phase, value.completed]), [['reading', 0], ['checking', 0], ['checking', 1], ['reading', 1], ['checking', 1], ['checking', 2]]);
});
test('canceling a stalled read exits without importing or allowing a late result', async () => {
  const controller = new AbortController(); let finish, created = 0;
  const pending = importPdfAssets([{ name: 'first.pdf', uri: 'file' }], () => new Promise(resolve => { finish = resolve; }), async () => { created++; return doc('first'); }, { signal: controller.signal });
  await tick(); controller.abort(); await assert.rejects(pending, /cancelada/);
  finish(new Uint8Array([1])); await tick(); assert.equal(created, 0);
  await assert.rejects(abortable(new Promise(() => {}), undefined, 5), /tardando demasiado/);
});
test('web picker cleans up after selection, cancellation and focus fallback', async () => {
  const previousDocument = global.document, previousWindow = global.window;
  let input, focused, clicked = 0, removed = 0;
  global.document = { body: { appendChild() {} }, createElement: () => input = { style: {}, files: [], handlers: {}, addEventListener(name, handler) { this.handlers[name] = handler; }, remove() { removed++; }, click() { clicked++; } } };
  global.window = { addEventListener(_name, handler) { focused = handler; }, removeEventListener() { focused = null; } };
  try {
    const { selectPdfs } = load('src/lib/pdf-picker.web.ts');
    const selected = selectPdfs(); assert.equal(clicked, 1);
    const file = { name: 'test.pdf', size: 3, lastModified: 1, type: 'application/pdf', arrayBuffer: async () => new ArrayBuffer(3) };
    input.files = [file]; input.handlers.change(); const result = await selected;
    assert.equal(result.assets[0].file, file); assert.equal(result.assets[0].uri, ''); assert.equal(removed, 1);
    const canceled = selectPdfs(); input.handlers.cancel(); assert.equal((await canceled).canceled, true);
    const fallback = selectPdfs(); focused(); assert.equal((await fallback).canceled, true);
    const controller = new AbortController(), aborted = selectPdfs(controller.signal); controller.abort(); await assert.rejects(aborted, /cancelada/);
    assert.equal(removed, 4); assert.equal(focused, null);
  } finally { global.document = previousDocument; global.window = previousWindow; }
});


test('native PDF selection reads binary data, imports real pages and persists the result', async () => {
  const { PDFDocument } = require('pdf-lib');
  const pdf = await PDFDocument.create(); pdf.addPage(); pdf.addPage();
  const bytes = await pdf.save(), native = nativeStorage(), uri = 'file:///cache/DocumentPicker/test.pdf';
  native.files.set(uri, bytes);
  const picker = load('src/lib/pdf-picker.ts', {
    'expo-document-picker': { getDocumentAsync: async options => { assert.equal(options.copyToCacheDirectory, true); return { canceled: false, assets: [{ uri, name: 'test.pdf', size: bytes.length }] }; } },
    './import-progress': { abortable },
  });
  const engine = load('src/lib/pdf-engine.ts');
  const { pickPdfs } = load('src/lib/pdf.ts', {
    './pdf-picker': picker, './import-progress': { importPdfAssets }, './storage': native.api, './pdf-engine': engine,
    'expo-image-picker': {}, 'expo-image-manipulator': {}, 'react-native': { Platform: { OS: 'android' } },
  });
  const progress = [], imported = await pickPdfs({ onProgress: value => progress.push(value) });
  assert.equal(imported.length, 1); assert.equal(imported[0].pages, 2); assert.equal(imported[0].name, 'test');
  assert.deepEqual(imported[0].bytes, bytes);
  let visible; const store = createLibraryStore(native.api.persistDocuments, next => { visible = next; });
  store.initialize([]); await store.commit(imported);
  assert.equal(visible[0].id, imported[0].id);
  assert.equal(native.copies.filter(copy => copy.to.endsWith('.pdf')).length, 1, 'Imports copy the selected file instead of transferring PDF bytes back across the bridge');
  const reopened = await native.api.loadDocuments();
  assert.equal(reopened[0].pages, 2); assert.equal(reopened[0].bytes.length, 0); assert.deepEqual(await native.api.readDocumentBytes(reopened[0]), bytes);
  assert.equal(progress[0].phase, 'selecting'); assert.equal(progress.at(-1).completed, 1);
});

test('native progress overlays do not present a second native modal', () => {
  let os = 'ios', back, removed = false, cleanup;
  const { CenteredDialog } = load('src/components/centered-dialog.tsx', {
    react: { useEffect: effect => { cleanup = effect(); } },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }) },
    'react-native': { Modal: 'Modal', View: 'View', Platform: { get OS() { return os; } }, StyleSheet: { absoluteFill: {} }, BackHandler: { addEventListener: (_event, handler) => { back = handler; return { remove: () => { removed = true; } }; } } },
  });
  const props = { visible: true, onRequestClose: () => { removed = true; }, children: 'progress' };
  assert.equal(CenteredDialog(props).type, 'View');
  os = 'android'; assert.equal(CenteredDialog(props).type, 'View'); assert.equal(back(), true); assert.equal(removed, true);
  removed = false; cleanup(); assert.equal(removed, true);
  assert.equal(CenteredDialog({ ...props, visible: false }), null);
  os = 'web'; assert.equal(CenteredDialog(props).type, 'Modal');
});


test('native reads transfer bounded Base64 strings, report bytes and stop when canceled', async () => {
  const source = new Uint8Array(700000).map((_, index) => index % 251), sizes = [], progress = [];
  let reads = 0;
  const { readNativeFile } = load('src/lib/native-file-read.ts', {
    'expo-file-system/legacy': {
      EncodingType: { Base64: 'base64' }, getInfoAsync: async () => ({ exists: true, isDirectory: false, size: source.length }),
      readAsStringAsync: async (_uri, options) => { reads++; sizes.push(options.length); return Buffer.from(source.slice(options.position, options.position + options.length)).toString('base64'); },
    },
  });
  const bytes = await readNativeFile('file:///cache/test.pdf', { onProgress: (loaded, total) => progress.push([loaded, total]) });
  assert.deepEqual(bytes, source); assert.ok(sizes.every(size => size <= 192 * 1024)); assert.equal(progress.at(-1)[0], source.length);
  const controller = new AbortController(), before = reads;
  await assert.rejects(readNativeFile('file:///cache/test.pdf', { signal: controller.signal, onProgress: loaded => { if (loaded) controller.abort(); } }), /cancelada/);
  assert.equal(reads, before + 1);
  await assert.rejects(readNativeFile('file:///cache/test.pdf', { signal: controller.signal }), /cancelada/);
  assert.equal(reads, before + 1);
});


test('thumbnail generation can wait until persistence completes without delaying optimistic updates', async () => {
  let visible, saved, finish;
  const next = [doc('new')];
  const store = createLibraryStore(() => new Promise(resolve => { finish = resolve; }), docs => { visible = docs; }, docs => { saved = docs; });
  store.initialize([]); const pending = store.commit(next);
  assert.equal(visible, next); assert.deepEqual(saved, []);
  await tick(); finish(); await pending; assert.equal(saved, next);
});
test('bounded Base64 encoding preserves byte boundaries and final padding', () => {
  for (const length of [0, 1, 2, 49151, 49152, 49153, 200003]) {
    const bytes = new Uint8Array(length).map((_, index) => index % 251);
    assert.equal(base64.encodePdfBytes(bytes), Buffer.from(bytes).toString('base64'));
  }
});
