const { test } = require('node:test');
const { Buffer } = require('node:buffer');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { PDFDocument, PDFName, StandardFonts, rgb, degrees } = require('pdf-lib');
const filename = path.resolve('src/lib/pdf-engine.ts');
const engine = new Module(filename, module);
engine.filename = filename;
engine.paths = Module._nodeModulePaths(path.dirname(filename));
engine._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, filename);

test('packaged viewer JavaScript is valid and includes a local worker', () => {
  const scripts = JSON.parse(fs.readFileSync('src/generated/pdf-viewer.json', 'utf8'));
  assert.doesNotThrow(() => new vm.Script(scripts.main));
  assert.ok(scripts.worker.includes('WorkerMessageHandler'));
  assert.ok(!scripts.main.includes('https://cdnjs.cloudflare.com'));
});

test('viewer navigates to a selected thumbnail, renders thumbnails and respects zoom bounds', async () => {
  const elements = Object.fromEntries(['page', 'paper', 'status', 'counter', 'previous', 'next', 'zoom', 'minus', 'plus', 'fit'].map(id => [id, { clientWidth: 400, style: {}, getContext: () => ({}), scrollTo: () => {} }]));
  const messages = [];
  const document = { numPages: 3, getPage: async () => ({ getViewport: ({ scale }) => ({ width: 200 * scale, height: 300 * scale }), render: () => ({ promise: Promise.resolve(), cancel: () => {} }) }) };
  const context = { window: { pdfKitWorker: '', devicePixelRatio: 1, parent: { postMessage: message => messages.push(message) }, addEventListener: () => {} }, document: { getElementById: id => elements[id], createElement: () => ({ style: {}, getContext: () => ({}), toDataURL: () => 'data:image/jpeg;base64,test' }) }, Blob, URL, Uint8Array, atob, setTimeout, clearTimeout, GlobalWorkerOptions: {}, getDocument: () => ({ promise: Promise.resolve(document), destroy: async () => {} }) };
  context.window.document = context.document;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('scripts/pdf-viewer-entry.js', 'utf8').replace(/^import .*;\s*/gm, ''), context);
  await context.window.pdfKitLoad(new Uint8Array([1]), 2);
  assert.equal(elements.counter.textContent, '2 / 3');
  assert.equal(elements.previous.disabled, false);
  context.window.pdfKitPage(3);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(elements.counter.textContent, '3 / 3');
  assert.equal(elements.next.disabled, true);
  assert.ok(messages.some(message => message.type === 'pdf-kit-page' && message.page === 3));
  await waitFor(() => messages.filter(message => message.type === 'pdf-kit-thumbnail').length === 3);
  assert.equal(messages.filter(message => message.type === 'pdf-kit-thumbnail').length, 3);
  for (let i = 0; i < 20; i++) elements.minus.onclick();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(elements.zoom.textContent, '50%');
  elements.fit.onclick();
  assert.equal(elements.zoom.textContent, '100%');
});

test('PDF.js renders the generated text, rotation and blank page', async () => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = require('@napi-rs/canvas');
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([300, 400]);
  page.drawText('Vista previa de prueba', { font, size: 16, x: 24, y: 350, color: rgb(0.1, 0.3, 0.2) });
  const original = await engine.exports.makeDocument(await pdf.save(), 'Prueba');
  const edited = await engine.exports.editDocument(original, [{ source: 0, rotation: 90, text: 'Texto añadido antes de guardar' }, { source: null, rotation: 0, text: '' }], 'Resultado');
  const loading = getDocument({ data: edited.bytes, useSystemFonts: true, isEvalSupported: false });
  try {
    const rendered = await loading.promise;
    assert.equal(rendered.numPages, 2);
    const first = await rendered.getPage(1);
    const text = await first.getTextContent();
    assert.ok(text.items.some(item => item.str === 'Vista previa de prueba'));
    assert.ok(text.items.some(item => item.str === 'Texto añadido antes de guardar'));
    const viewport = first.getViewport({ scale: 1 });
    assert.equal(viewport.width, 400); assert.equal(viewport.height, 300);
    const canvas = createCanvas(viewport.width, viewport.height);
    await first.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
    const image = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    assert.ok(image.some((component, i) => i % 4 !== 3 && component < 200), 'The page contains visible ink');
    const blank = await rendered.getPage(2);
    assert.equal((await blank.getTextContent()).items.length, 0);
  } finally { await loading.destroy(); }
});

function viewerHarness(loadDocument, canvasFactory) {
  const statistics = { loads: 0, mainRenders: 0, thumbnailRenders: 0, blankPaints: 0 };
  const messages = [];
  const elements = Object.fromEntries(['page', 'paper', 'status', 'counter', 'previous', 'next', 'zoom', 'minus', 'plus', 'fit'].map(id => [id, { clientWidth: 400, style: {}, getContext: () => ({ fillRect: () => statistics.blankPaints++ }), scrollTo: () => {} }]));
  if (canvasFactory) { elements.page = canvasFactory(); elements.page.style = {}; }
  const source = { numPages: 3, getPage: async () => ({ rotate: 0, getViewport: ({ scale }) => ({ width: 200 * scale, height: 300 * scale }), render: ({ canvas }) => {
    statistics[canvas === elements.page ? 'mainRenders' : 'thumbnailRenders']++;
    return { promise: Promise.resolve(), cancel: () => {} };
  } }) };
  const context = { window: { pdfKitWorker: '', devicePixelRatio: 1, parent: { postMessage: message => messages.push(message) }, addEventListener: () => {} }, document: { getElementById: id => elements[id], createElement: () => ({ style: {}, getContext: () => ({ fillRect: () => statistics.blankPaints++ }), toDataURL: () => 'data:image/jpeg;base64,test' }) }, Blob, URL, Uint8Array, atob, setTimeout, clearTimeout, GlobalWorkerOptions: {}, getDocument: () => {
    statistics.loads++;
    return { promise: loadDocument ? loadDocument(source) : Promise.resolve(source), destroy: async () => {} };
  } };
  context.window.document = context.document;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('scripts/pdf-viewer-entry.js', 'utf8').replace(/^import .*;\s*/gm, ''), context);
  return { viewer: context.window, statistics, messages, elements, context };
}
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
async function waitFor(condition) {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    assert.ok(Date.now() < deadline, 'The viewer did not finish the expected update');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
const originalEdits = () => Array.from({ length: 3 }, (_, source) => ({ key: `page-${source}`, source, rotation: 0, text: '' }));

test('added PDFs render lazily in the same preview, keep distinct thumbnails and preserve the original cache', async () => {
  const { viewer, context, messages, elements } = viewerHarness();
  let loads = 0, destroys = 0;
  context.getDocument = ({ data }) => {
    loads++;
    const color = data[0];
    return { destroy: async () => { destroys++; }, promise: Promise.resolve({
      numPages: 3, getPage: async number => ({ rotate: 0,
        getViewport: ({ scale }) => ({ width: 200 * scale, height: 300 * scale }),
        render: ({ canvas }) => { canvas.color = color; canvas.number = number; return { promise: Promise.resolve(), cancel() {} }; },
      }),
    }) };
  };
  context.document.createElement = () => ({ style: {}, getContext: () => ({}), toDataURL() { return `data:image/jpeg;base64,${this.color}-${this.number}`; } });
  const edits = originalEdits();
  await viewer.pdfKitLoad(new Uint8Array([1]), 1, edits);
  await waitFor(() => messages.filter(message => message.type === 'pdf-kit-thumbnail').length === 3);
  viewer.pdfKitSources([{ id: 'extra', key: 'extra-v1', bytes: new Uint8Array([2]).buffer }, { id: 'unused', key: 'unused-v1', bytes: new Uint8Array([3]).buffer }]);
  assert.equal(loads, 1, 'Registering added files does not eagerly load their pages');
  const added = { key: 'extra-0', documentId: 'extra', source: 0, rotation: 0, text: '' };
  viewer.pdfKitEdit([edits[0], added, ...edits.slice(1)], 2);
  await waitFor(() => elements.status.hidden && elements.page.color === 2);
  await waitFor(() => messages.some(message => message.key === 'extra-0' && message.type === 'pdf-kit-thumbnail'));
  assert.equal(loads, 2);
  const main = messages.find(message => message.key === 'page-0' && message.type === 'pdf-kit-thumbnail');
  const extra = messages.find(message => message.key === 'extra-0' && message.type === 'pdf-kit-thumbnail');
  assert.notEqual(main.uri, extra.uri, 'Page zero in two different PDFs cannot share a thumbnail');
  viewer.pdfKitSources([{ id: 'extra', key: 'extra-v1' }, { id: 'unused', key: 'unused-v1' }]);
  viewer.pdfKitPage(1); await waitFor(() => elements.status.hidden && elements.page.color === 1);
  viewer.pdfKitPage(2); await waitFor(() => elements.status.hidden && elements.page.color === 2);
  assert.equal(loads, 2, 'Moving between original and imported pages reuses each loaded PDF');
  viewer.pdfKitEdit(edits, 1); viewer.pdfKitSources([]); await settle();
  assert.equal(destroys, 1, 'Deleting all pages of an imported PDF releases its loading task');
});

test('inserting, deleting and reordering reuse the loaded PDF and unchanged thumbnails', async () => {
  const { viewer, statistics, messages, elements } = viewerHarness();
  const originals = originalEdits();
  await viewer.pdfKitLoad(new Uint8Array([1]), 2, originals);
  await waitFor(() => messages.filter(message => message.type === 'pdf-kit-thumbnail').length === 3);
  assert.equal(statistics.mainRenders, 1);
  assert.equal(statistics.thumbnailRenders, 3);
  const blank = { key: 'blank', source: null, rotation: 0, text: '' };
  viewer.pdfKitEdit([...originals, blank], 2);
  assert.equal(elements.counter.textContent, '2 / 4');
  await waitFor(() => messages.filter(message => message.type === 'pdf-kit-thumbnail').length === 4);
  assert.equal(messages.filter(message => message.type === 'pdf-kit-thumbnail').length, 4);
  for (let i = 0; i < 50; i++) {
    viewer.pdfKitEdit([originals[2], originals[1], originals[0], blank], 2);
    viewer.pdfKitEdit([...originals, blank], 2);
  }
  await settle();
  assert.equal(statistics.loads, 1, 'Structural edits must never reload the source PDF');
  assert.equal(statistics.mainRenders, 1, 'The selected unchanged page must not be redrawn');
  assert.equal(statistics.thumbnailRenders, 3, 'Existing thumbnails must not be rerendered');
  assert.equal(messages.filter(message => message.type === 'pdf-kit-thumbnail').length, 4, 'Reordering must not retransmit cached images');
  viewer.pdfKitEdit([originals[1], originals[2], blank], 1);
  await settle();
  assert.equal(statistics.mainRenders, 1, 'Deleting another page must retain the selected page preview');
  assert.equal(statistics.thumbnailRenders, 3, 'Deleting a page must retain the remaining thumbnails');
  viewer.pdfKitEdit([blank, originals[1], originals[2]], 1);
  await settle();
  assert.equal(elements.counter.textContent, '1 / 3');
  assert.ok(statistics.blankPaints >= 2, 'Blank pages must be painted in the preview and strip');
  assert.equal(statistics.loads, 1);
});

test('changes made while the PDF is opening retain the latest pages and selection', async () => {
  let finish;
  const { viewer, elements, messages } = viewerHarness(source => new Promise(resolve => { finish = () => resolve(source); }));
  const loading = viewer.pdfKitLoad(new Uint8Array([1]), 1, originalEdits());
  await new Promise(resolve => setTimeout(resolve, 0));
  viewer.pdfKitEdit([originalEdits()[2], { key: 'new-blank', source: null, rotation: 0, text: '' }], 2);
  finish(); await loading; await settle();
  assert.equal(elements.counter.textContent, '2 / 2');
  assert.equal(messages.filter(message => message.type === 'pdf-kit-page').at(-1).page, 2);
  assert.equal(messages.filter(message => message.type === 'pdf-kit-thumbnail').length, 2);
});

test('scrolling the editor strip loads newly visible thumbnails without rendering the entire document', async () => {
  const { viewer, messages, statistics } = viewerHarness(source => { source.numPages = 16; return Promise.resolve(source); });
  const edits = Array.from({ length: 16 }, (_, source) => ({ key: `strip-${source}`, source, rotation: 0, text: '' }));
  const loading = viewer.pdfKitLoad(new Uint8Array([1]), 1, edits);
  viewer.pdfKitVisiblePages([1, 2, 3]);
  await loading;
  await waitFor(() => messages.filter(message => message.type === 'pdf-kit-thumbnail').length === 3);
  viewer.pdfKitVisiblePages([8, 9, 10]);
  await waitFor(() => messages.filter(message => message.type === 'pdf-kit-thumbnail').length === 6);
  assert.deepEqual(messages.filter(message => message.type === 'pdf-kit-thumbnail').map(message => message.page), [1, 2, 3, 8, 9, 10]);
  viewer.pdfKitPage(16);
  await waitFor(() => messages.some(message => message.type === 'pdf-kit-thumbnail' && message.page === 16));
  viewer.pdfKitVisiblePages([1, 2, 3]);
  await settle();
  assert.equal(statistics.thumbnailRenders, 7, 'Cached thumbnails are reused when scrolling back');
  assert.equal(statistics.loads, 1, 'Scrolling and navigation do not reload the PDF');
});

test('rapid strip scrolling keeps a single thumbnail renderer and drops obsolete results', async () => {
  let active = 0, maximum = 0;
  const { viewer, messages, elements } = viewerHarness(source => {
    source.numPages = 16;
    source.getPage = async () => ({ rotate: 0, getViewport: ({ scale }) => ({ width: 200 * scale, height: 300 * scale }), render: ({ canvas }) => {
      if (canvas === elements.page) return { promise: Promise.resolve(), cancel() {} };
      active++; maximum = Math.max(maximum, active);
      return { promise: new Promise(resolve => setTimeout(() => { active--; resolve(); }, 30)), cancel() {} };
    } });
    return Promise.resolve(source);
  });
  const loading = viewer.pdfKitLoad(new Uint8Array([1]), 1);
  viewer.pdfKitVisiblePages([1]);
  await loading;
  await waitFor(() => messages.some(message => message.type === 'pdf-kit-thumbnail' && message.page === 1));
  viewer.pdfKitVisiblePages([2, 3]);
  await waitFor(() => active === 1);
  viewer.pdfKitVisiblePages([8, 9]);
  viewer.pdfKitVisiblePages([14, 15]);
  await waitFor(() => messages.some(message => message.type === 'pdf-kit-thumbnail' && message.page === 15));
  assert.equal(maximum, 1, 'Only one thumbnail render runs at a time');
  assert.deepEqual(messages.filter(message => message.type === 'pdf-kit-thumbnail').map(message => message.page), [1, 14, 15]);
});

test('per-page annotation preview preserves source content, rotation and blank-page text', async () => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const source = await PDFDocument.create();
  const font = await source.embedFont(StandardFonts.Helvetica);
  source.addPage([300, 400]).drawText('Original page', { font, size: 16, x: 24, y: 320 });
  source.getPage(0).setRotation(degrees(90));
  const bytes = await source.save();
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false });
  const { context } = viewerHarness();
  // pdf-lib validates arrays with instanceof; bridge arrays from the VM realm.
  const sameRealmPDFDocument = { load: bytes => PDFDocument.load(bytes), create: async () => {
    const output = await PDFDocument.create();
    const copyPages = output.copyPages.bind(output), addPage = output.addPage.bind(output);
    output.copyPages = (source, indices) => copyPages(source, Array.from(indices));
    output.addPage = page => addPage(Array.isArray(page) ? Array.from(page) : page);
    return output;
  } };
  Object.assign(context, { PDFDocument: sameRealmPDFDocument, StandardFonts, degrees, writePageText: engine.exports.writePageText, getDocument, sourceProxy: await loading.promise, sourceBytes: bytes });
  vm.runInContext('pdf = sourceProxy; originalBytes = sourceBytes;', context);
  try {
    const edit = { key: 'annotated', source: 0, rotation: 90, text: 'Nota visible' };
    context.edit = edit;
    const result = await vm.runInContext('resolvePage(edit)', context);
    const text = await result.page.getTextContent();
    assert.ok(text.items.some(item => item.str === 'Original page'));
    assert.ok(text.items.some(item => item.str === 'Nota visible'));
    assert.equal(result.rotation, 180);
    assert.equal(result.page.getViewport({ scale: 1, rotation: result.rotation }).width, 300);
    assert.equal(await vm.runInContext('resolvePage(edit)', context), result, 'Main preview and thumbnail reuse the same prepared page');
    context.edit = { key: 'blank-text', source: null, rotation: 90, text: 'Texto en hoja nueva' };
    const blank = await vm.runInContext('resolvePage(edit)', context);
    assert.ok((await blank.page.getTextContent()).items.some(item => item.str === 'Texto en hoja nueva'));
    assert.equal(blank.rotation, 90);
    assert.equal(Math.round(blank.page.getViewport({ scale: 1, rotation: blank.rotation }).width), 842);
    context.window.pdfKitSources([{ id: 'imported', key: 'imported-v1', bytes: new Uint8Array(bytes).buffer }]);
    context.edit = { key: 'imported-note', source: 0, documentId: 'imported', rotation: 0, text: 'Nota importada' };
    const imported = await vm.runInContext('resolvePage(edit)', context);
    const importedText = (await imported.page.getTextContent()).items.map(item => item.str).join(' ');
    assert.ok(importedText.includes('Original page') && importedText.includes('Nota importada'));
    assert.equal(imported.rotation, 90);
  } finally {
    await vm.runInContext('Promise.all([...prepared.values()].map(async pending => (await pending).loading.destroy()))', context);
    await vm.runInContext('Promise.all([...sourceLoads.values()].map(entry => entry.loading.destroy()))', context);
    await loading.destroy();
  }
});

test('library thumbnails render the first page only, with bounded image dimensions', async () => {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas, loadImage } = require('@napi-rs/canvas');
  const original = await PDFDocument.create();
  const font = await original.embedFont(StandardFonts.Helvetica);
  original.addPage([300, 400]).drawText('Primera pagina', { font, size: 30, x: 15, y: 300 });
  original.addPage([300, 400]).drawRectangle({ x: 0, y: 0, width: 300, height: 400, color: rgb(1, 0, 0) });
  const bytes = await original.save();
  const { viewer, context, messages } = viewerHarness();
  const requested = [];
  let destroyed = 0;
  context.getDocument = options => {
    const loading = getDocument(options);
    return { destroy: async () => { destroyed++; await loading.destroy(); }, promise: loading.promise.then(document => ({ getPage: number => { requested.push(number); return document.getPage(number); } })) };
  };
  context.document.createElement = () => createCanvas(1, 1);
  viewer.pdfKitThumbnailBegin(bytes.length, 'library-test');
  for (let offset = 0; offset < bytes.length; offset += 333) {
    viewer.pdfKitThumbnailChunk(Buffer.from(bytes.subarray(offset, offset + 333)).toString('base64'), offset, 'library-test');
  }
  viewer.pdfKitThumbnailFinish('library-test');
  await waitFor(() => destroyed === 1 && messages.some(message => message.type === 'pdf-kit-document-thumbnail'));
  assert.deepEqual(requested, [1]);
  assert.equal(destroyed, 1, 'PDF resources are released after producing the image');
  const message = messages.find(message => message.type === 'pdf-kit-document-thumbnail');
  assert.equal(message.key, 'library-test');
  assert.ok(message.uri.startsWith('data:image/jpeg;base64,'));
  const image = await loadImage(Buffer.from(message.uri.split(',')[1], 'base64'));
  assert.ok(image.width <= 240 && image.height <= 360);
  const canvas = createCanvas(image.width, image.height);
  canvas.getContext('2d').drawImage(image, 0, 0);
  const pixels = canvas.getContext('2d').getImageData(0, 0, image.width, image.height).data;
  assert.ok(pixels.some((component, i) => i % 4 !== 3 && component < 100), 'Thumbnail contains visible text');
});

test('native range transport renders a real 90 MB PDF without loading the entire file', async () => {
  const { getDocument, PDFDataRangeTransport } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = require('@napi-rs/canvas');
  const original = await PDFDocument.create();
  original.addPage([300, 400]).drawRectangle({ x: 20, y: 20, width: 100, height: 100, color: rgb(0, 0, 0) });
  original.context.register(original.context.stream(new Uint8Array(90 * 1024 * 1024)));
  const bytes = await original.save({ useObjectStreams: false });
  assert.ok(bytes.length > 90 * 1024 * 1024);
  const { viewer, context, elements, messages } = viewerHarness(undefined, () => createCanvas(1, 1));
  context.PDFDataRangeTransport = PDFDataRangeTransport;
  context.getDocument = getDocument;
  context.document.createElement = () => { const canvas = createCanvas(1, 1); canvas.style = {}; return canvas; };
  let requested = 0;
  viewer.ReactNativeWebView = { postMessage(raw) {
    const message = JSON.parse(raw); messages.push(message);
    if (message.type === 'pdf-kit-range') {
      requested += message.end - message.begin;
      assert.ok(message.end - message.begin <= 65536);
      setTimeout(() => viewer.pdfKitRangeData(message.key, message.requestId, message.begin, Buffer.from(bytes.subarray(message.begin, message.end)).toString('base64')), 0);
    }
  } };
  await viewer.pdfKitLoadFile('large-file', bytes.length, 1, null);
  await waitFor(() => elements.status.hidden && elements.page.width > 100);
  assert.ok(requested < bytes.length / 10, `Read ${requested} of ${bytes.length} bytes`);
  const pixels = elements.page.getContext('2d').getImageData(0, 0, elements.page.width, elements.page.height).data;
  assert.ok(pixels.some((value, index) => index % 4 !== 3 && value < 100), 'First page contains the rendered rectangle');
  await vm.runInContext('task.destroy()', context);
});

test('native range transport completes multi-block page requests and navigates through a heavy PDF', async () => {
  const { getDocument, PDFDataRangeTransport } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const { createCanvas } = require('@napi-rs/canvas');
  const original = await PDFDocument.create();
  const colors = ['1 0 0', '0 1 0', '0 0 1', '0 0 0', '1 0 1', '0 1 1'];
  for (const color of colors) {
    const page = original.addPage([300, 400]);
    const stream = original.context.stream(Buffer.from(`${color} rg 0 0 300 400 re f\n%${'padding '.repeat(33000)}\n`));
    page.node.set(PDFName.of('Contents'), original.context.register(stream));
  }
  original.context.register(original.context.stream(new Uint8Array(90 * 1024 * 1024)));
  const bytes = await original.save({ useObjectStreams: false });
  const additional = await PDFDocument.create(); additional.addPage([300, 400]).drawRectangle({ x: 0, y: 0, width: 300, height: 400, color: rgb(1, 1, 0) });
  const extraBytes = await additional.save();
  const { viewer, context, elements, messages } = viewerHarness(undefined, () => createCanvas(1, 1));
  Object.assign(context, { getDocument, PDFDataRangeTransport });
  context.document.createElement = () => { const canvas = createCanvas(1, 1); canvas.style = {}; return canvas; };
  const bridgeErrors = [];
  viewer.ReactNativeWebView = { postMessage(raw) {
    const message = JSON.parse(raw); messages.push(message);
    if (message.type !== 'pdf-kit-range') return;
    // Match the native bridge: each read and JavaScript message carries at most 64 KB.
    (async () => {
      for (let begin = message.begin; begin < message.end; begin += 65536) {
        await new Promise(resolve => setTimeout(resolve, 0));
        const source = message.key === 'added-file' ? extraBytes : bytes;
        const data = Buffer.from(source.subarray(begin, Math.min(begin + 65536, message.end))).toString('base64');
        try { viewer.pdfKitRangeData(message.key, message.requestId, begin, data); } catch (error) { bridgeErrors.push(error); }
      }
    })();
  } };
  try {
    const edits = colors.map((_, source) => ({ key: `heavy-${source}`, source, rotation: 0, text: '' }));
    const loading = viewer.pdfKitLoadFile('many-heavy-pages', bytes.length, 1, edits);
    viewer.pdfKitVisiblePages([1, 2]);
    await loading;
    await waitFor(() => elements.status.hidden && elements.page.width > 100);
    await waitFor(() => messages.filter(message => message.type === 'pdf-kit-thumbnail').length === 2);
    viewer.pdfKitVisiblePages([5, 6]);
    await waitFor(() => messages.some(message => message.type === 'pdf-kit-thumbnail' && message.page === 6));
    for (const number of [3, 6, 2, 5, 1, 4]) {
      viewer.pdfKitPage(number);
      viewer.pdfKitVisiblePages([number]);
      await waitFor(() => elements.status.hidden && elements.counter.textContent === `${number} / 6`);
      const pixel = elements.page.getContext('2d').getImageData(10, 10, 1, 1).data;
      const expected = colors[number - 1].split(' ').map(value => Number(value) * 255);
      assert.deepEqual(Array.from(pixel).slice(0, 3), expected, `Page ${number} must render its own content`);
    }
    await waitFor(() => messages.filter(message => message.type === 'pdf-kit-thumbnail').length === 6);
    viewer.pdfKitSources([{ id: 'added', key: 'added-file', fileKey: 'added-file', length: extraBytes.length }]);
    const added = { key: 'added-0', source: 0, documentId: 'added', rotation: 0, text: '' };
    viewer.pdfKitEdit([edits[0], added, ...edits.slice(1)], 2); viewer.pdfKitVisiblePages([1, 2, 3]);
    await waitFor(() => elements.status.hidden && elements.counter.textContent === '2 / 7');
    const pixel = elements.page.getContext('2d').getImageData(10, 10, 1, 1).data;
    assert.deepEqual(Array.from(pixel).slice(0, 3), [255, 255, 0], 'The inserted page reads its own file and renders in the central preview');
    await waitFor(() => messages.some(message => message.type === 'pdf-kit-thumbnail' && message.key === 'added-0'));
    assert.ok(messages.some(message => message.type === 'pdf-kit-range' && message.key === 'added-file'));
    viewer.pdfKitPage(4); await waitFor(() => elements.status.hidden && elements.counter.textContent === '4 / 7');
    assert.deepEqual(Array.from(elements.page.getContext('2d').getImageData(10, 10, 1, 1).data).slice(0, 3), [0, 0, 255], 'Navigation returns to the original PDF after the inserted page');
    assert.equal(bridgeErrors.length, 0, bridgeErrors.map(error => error.message).join('\n'));
    assert.ok(messages.some(message => message.type === 'pdf-kit-range' && message.end - message.begin > 65536), 'Exercise grouped PDF.js range requests');
    await waitFor(() => messages.filter(message => message.type === 'pdf-kit-thumbnail').length === 7);
  } finally { await vm.runInContext('Promise.all([task.destroy(), ...[...sourceLoads.values()].map(entry => entry.loading.destroy())])', context); }
});
