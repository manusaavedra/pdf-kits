const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { Buffer } = require('node:buffer');
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
const pages = load('src/lib/editor-pages.ts');
const element = (type, props) => ({ type, props });
const runtime = { jsx: element, jsxs: element };
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  return [node, ...nodes(node.props?.children)];
}
const document = (id, count = 1) => ({ id, name: id, updated: 1, size: 1, bytes: new Uint8Array([1]), pages: count, favorite: false, kind: 'pdf' });

test('the add dialog offers all four sources and reports the insertion position', () => {
  const chosen = [];
  const { EditorAddPagesDialog } = load('src/components/editor-add-pages-dialog.tsx', {
    'react/jsx-runtime': runtime, 'react-native': { Pressable: 'Pressable', View: 'View', Text: 'Text' },
    'lucide-react-native': {}, './centered-dialog': { CenteredDialog: 'CenteredDialog' }, './pdf-ui': { IconButton: 'IconButton' }, './pdf-styles': { styles: {}, green: 'green' },
  });
  const tree = nodes(EditorAddPagesDialog({ visible: true, page: 4, onClose() {}, onChoose: value => chosen.push(value) }));
  const choices = tree.filter(node => node.type === 'Pressable');
  assert.deepEqual(choices.map(choice => choice.props.accessibilityLabel), ['Hoja en blanco', 'Desde la cámara', 'Desde la galería', 'Desde un archivo PDF']);
  choices.forEach(choice => choice.props.onPress()); assert.deepEqual(chosen, ['blank', 'camera', 'gallery', 'pdf']);
  assert.ok(tree.some(node => (Array.isArray(node.props?.children) ? node.props.children.join('') : String(node.props?.children)).includes('después de la página 4')));
});

test('inserting documents retains existing edits and keys, keeps import order, and selects the first addition', () => {
  const original = [{ key: 'first', source: 0, rotation: 90, text: 'Existing note' }, { key: 'second', source: 1, rotation: 0, text: '' }];
  const result = pages.insertDocumentPages(original, 0, [document('a', 2), document('b')]);
  assert.deepEqual(result.pages.map(page => page.key), ['first', 'a:0', 'a:1', 'b:0', 'second']);
  assert.equal(result.pages[0], original[0]); assert.equal(result.pages.at(-1), original[1]);
  assert.equal(result.selected, 1);
});

test('editor imports every source into the current draft, preserves crops, cancels cleanly and saves the combined pages', async () => {
  const slots = []; let cursor = 0, picked = [], scanNumber = 0;
  const scans = [], saves = [], original = document('original', 3);
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback: callback => callback, useEffect: () => {},
  };
  const hook = load('src/hooks/use-image-crop.ts', { react: hooks });
  const { default: Route } = load('src/app/editor.tsx', {
    react: hooks, 'react/jsx-runtime': runtime,
    'react-native': { ...Object.fromEntries(['ActivityIndicator', 'FlatList', 'Image', 'Modal', 'Pressable', 'Text', 'TextInput', 'View'].map(name => [name, name])), Keyboard: { dismiss() {} }, StyleSheet: { create: styles => styles }, Platform: { OS: 'ios' }, useWindowDimensions: () => ({ width: 390 }) },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { router: { setParams() {} }, useLocalSearchParams: () => ({ id: original.id }) },
    'lucide-react-native': new Proxy({}, { get: (_target, key) => key }),
    '@/lib/library': { useLibrary: () => ({ loaded: true, documents: [original], commit: async () => { throw new Error('Imports must not add library records'); } }) },
    '@/lib/storage': { retainDocuments: documents => documents }, '@/lib/editor-pages': pages,
    '@/lib/editor-save': { saveEditorDocument: async (...args) => { saves.push(args); return { ...original, pages: args[1].length, updated: 2 }; } },
    '@/lib/pdf': { pickPdfs: async () => picked, scanPhotos: async (camera, options) => {
      scans.push(camera); const id = 'scan-' + ++scanNumber, count = camera ? 1 : 2;
      for (let index = 0; index < count; index++) {
        const crop = await options.cropPhoto({ uri: `file:///${id}-${index}.jpg`, width: 400, height: 300 }, index, count);
        if (!crop) return null;
      }
      return document(id, count);
    } },
    '@/hooks/use-image-crop': hook,
    '@/components/pdf-live-preview': { __esModule: true, default: 'PdfLivePreview' },
    '@/components/pdf-ui': { Button: 'Button', IconButton: 'IconButton' }, '@/components/pdf-styles': { green: 'green' },
    ...Object.fromEntries([['editor-save-dialog', 'EditorSaveDialog'], ['editor-add-pages-dialog', 'EditorAddPagesDialog'], ['image-crop-dialog', 'ImageCropDialog'], ['operation-dialog', 'OperationDialog']].map(([file, name]) => [`@/components/${file}`, { [name]: name }])),
  });
  function render() { cursor = 0; const route = Route(); return nodes(route.type(route.props)); }
  const dialog = () => render().find(node => node.type === 'EditorAddPagesDialog').props;
  const list = () => render().find(node => node.type === 'FlatList').props;
  const button = label => render().find(node => node.type === 'Button' && node.props.label === label).props;
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(list().ListFooterComponent, undefined, 'Adding pages is available without scrolling to the end');
  button('Añadir').onPress(); assert.equal(dialog().visible, true); assert.equal(list().data.length, 3);
  await dialog().onChoose('blank'); assert.equal(list().data.length, 4); assert.equal(dialog().visible, false);
  assert.equal(list().data[1].source, null);
  picked = [document('imported', 2)]; button('Añadir').onPress(); await dialog().onChoose('pdf');
  assert.deepEqual(list().data.map(page => page.documentId ?? (page.source === null ? 'blank' : 'original')), ['original', 'blank', 'imported', 'imported', 'original', 'original']);
  const before = list().data;
  picked = []; await dialog().onChoose('pdf'); assert.equal(list().data, before, 'Canceling PDF selection preserves the draft');
  let adding = dialog().onChoose('gallery'); await tick();
  assert.equal(render().find(node => node.type === 'OperationDialog').props.visible, false);
  render().find(node => node.type === 'ImageCropDialog').props.request.complete(null); await adding;
  assert.equal(list().data, before, 'Canceling an image crop does not insert partial scans');
  adding = dialog().onChoose('camera'); await tick();
  render().find(node => node.type === 'ImageCropDialog').props.request.complete({ originX: 20, originY: 30, width: 200, height: 200 }); await adding;
  adding = dialog().onChoose('gallery'); await tick();
  render().find(node => node.type === 'ImageCropDialog').props.request.complete({ originX: 20, originY: 30, width: 200, height: 200 }); await tick();
  assert.equal(render().find(node => node.type === 'ImageCropDialog').props.request.index, 1);
  render().find(node => node.type === 'ImageCropDialog').props.request.complete({ originX: 0, originY: 0, width: 400, height: 300 }); await adding;
  assert.deepEqual(scans, [false, true, false]); assert.equal(list().data.length, 9);
  assert.equal(render().find(node => node.type === 'PdfLivePreview').props.sources.length, 3);
  await button('Guardar').onPress(); assert.equal(saves.length, 1);
  assert.equal(saves[0][1].length, 9); assert.equal(saves[0][6].length, 3);
  assert.ok(list().data.every(page => !page.documentId), 'After saving, all pages refer to the saved document');
  assert.equal(render().find(node => node.type === 'PdfLivePreview').props.sources.length, 0);
});

test('native preview registers added files before loading and routes bounded reads to the requested source', async () => {
  const slots = []; let cursor = 0;
  const scripts = [], reads = [], hooks = {
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useState: initial => [initial, () => {}], useCallback: callback => callback, useEffect: effect => effect(),
  };
  const { default: Preview } = load('src/components/pdf-preview.tsx', {
    react: hooks, 'react/jsx-runtime': runtime, 'react-native': { View: 'View', Text: 'Text' },
    'react-native-webview': { WebView: 'WebView' }, '@/lib/pdf-viewer': { viewerHtml: 'viewer' },
    '@/components/pdf-styles': { styles: {} }, './pdf-styles': { styles: {} },
    '@/lib/preview-range': { PREVIEW_CHUNK_SIZE: 65536, readPreviewRange: async (doc, begin, end) => { reads.push([doc.id, begin, end]); return Buffer.alloc(end - begin).toString('base64'); } },
  });
  const main = { ...document('base'), size: 120000 }, added = { ...document('extra'), size: 120000 };
  let sources = [added];
  const render = () => { cursor = 0; return nodes(Preview({ doc: main, sources })).find(node => node.type === 'WebView').props; };
  const viewer = render(); viewer.ref.current = { injectJavaScript: script => scripts.push(script) }; viewer.onLoadEnd();
  assert.ok(scripts[0].startsWith('window.pdfKitSources'), 'Added file metadata must arrive before the viewer starts rendering edited pages');
  viewer.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'pdf-kit-range', key: 'extra:1:120000', requestId: 1, begin: 0, end: 100000 }) } });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(reads, [['extra', 0, 65536], ['extra', 65536, 100000]]);
  assert.equal(scripts.filter(script => script.startsWith('window.pdfKitRangeData')).length, 2);
  sources = []; render();
  viewer.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'pdf-kit-range', key: 'extra:1:120000', requestId: 2, begin: 0, end: 10 }) } });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(reads.length, 2, 'Removed sources cannot issue additional file reads');
});
