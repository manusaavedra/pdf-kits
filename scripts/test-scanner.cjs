const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PDFDocument, PDFName, PDFRawStream } = require('pdf-lib');
const { createCanvas } = require('@napi-rs/canvas');

function load(file, mocks = {}) {
  const filename = path.resolve(file), compiled = new Module(filename, module);
  compiled.filename = filename; compiled.paths = Module._nodeModulePaths(path.dirname(filename));
  const requireModule = compiled.require.bind(compiled);
  compiled.require = name => mocks[name] ?? requireModule(name);
  compiled._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText, filename);
  return compiled.exports;
}

const crop = load('src/lib/image-crop.ts');
const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} should be approximately ${expected}`);
test('free crops resize independently, remain inside the image and map back to original pixels', () => {
  const viewport = { width: 400, height: 600 }, image = { width: 4000, height: 3000 };
  const frame = crop.fitCropImage(image, viewport);
  closeTo(frame.width, 336); closeTo(frame.height, 252);
  closeTo(frame.left, 32); closeTo(frame.top, 174);
  assert.equal(crop.fitCropImage({ width: 0, height: 0 }, viewport), null);
  const selection = crop.dragCrop(crop.fullImageCrop, 'topLeft', 84, 42, frame);
  closeTo(selection.x, 0.25); closeTo(selection.y, 1 / 6);
  closeTo(selection.width, 0.75); closeTo(selection.height, 5 / 6);
  assert.deepEqual(crop.cropToPixels(selection, image), { originX: 1000, originY: 500, width: 3000, height: 2500 });
  assert.notEqual(selection.width / selection.height, 1, 'No square aspect ratio is imposed');
  const moved = crop.dragCrop(selection, 'move', -2000, 2000, frame);
  assert.equal(moved.x, 0); assert.equal(moved.y, 1 - selection.height);
  assert.equal(moved.width, selection.width); assert.equal(moved.height, selection.height);
  const minimum = crop.dragCrop(selection, 'bottomRight', -99999, -99999, frame);
  assert.ok(Math.abs(minimum.width * frame.width - 64) < 0.0001);
  assert.ok(Math.abs(minimum.height * frame.height - 64) < 0.0001);
  assert.deepEqual(crop.cropToPixels(crop.fullImageCrop, { width: 4033, height: 3025 }), { originX: 0, originY: 0, width: 4033, height: 3025 });
  for (const handle of ['top', 'bottom', 'left', 'right', 'topLeft', 'topRight', 'bottomLeft', 'bottomRight']) {
    for (const delta of [-10000, 10000]) {
      const resized = crop.dragCrop(selection, handle, delta, delta, frame);
      const pixels = crop.cropToPixels(resized, image);
      assert.ok(pixels.originX >= 0 && pixels.originY >= 0 && pixels.width > 0 && pixels.height > 0);
      assert.ok(pixels.originX + pixels.width <= image.width && pixels.originY + pixels.height <= image.height);
    }
  }
});

function scannerHarness(assets, camera = false, fail = false) {
  const operations = [], releases = [], selections = [];
  const engine = load('src/lib/pdf-engine.ts');
  const { scanPhotos } = load('src/lib/pdf.ts', {
    './pdf-picker': {}, './import-progress': {}, './storage': {}, './pdf-engine': engine,
    'react-native': { Platform: { OS: 'ios' } },
    'expo-image-picker': {
      requestCameraPermissionsAsync: async () => ({ granted: true }),
      launchCameraAsync: async options => { assert.equal(camera, true); selections.push(options); return { canceled: false, assets }; },
      launchImageLibraryAsync: async options => { assert.equal(camera, false); selections.push(options); return { canceled: false, assets }; },
    },
    'expo-image-manipulator': {
      SaveFormat: { JPEG: 'jpeg' },
      ImageManipulator: { manipulate(uri) {
        let area, output;
        operations.push(['open', uri]);
        return {
          crop(rect) { area = rect; output = { width: rect.width, height: rect.height }; operations.push(['crop', uri, rect]); },
          resize(size) {
            const scale = (size.width || size.height) / (size.width ? area.width : area.height);
            output = { width: Math.round(area.width * scale), height: Math.round(area.height * scale) };
            operations.push(['resize', uri, size]);
          },
          async renderAsync() {
            if (fail) throw new Error('Image processing failed');
            return {
              async saveAsync(options) {
                assert.equal(options.base64, true);
                const canvas = createCanvas(output.width, output.height), context = canvas.getContext('2d');
                context.fillStyle = '#fafafa'; context.fillRect(0, 0, output.width, output.height);
                return { base64: canvas.toBuffer('image/jpeg').toString('base64') };
              },
              release() { releases.push(['image', uri]); },
            };
          },
          release() { releases.push(['context', uri]); },
        };
      } },
    },
  });
  return { scanPhotos, operations, releases, selections };
}

const photos = [
  { uri: 'file:///landscape.jpg', width: 4000, height: 3000 },
  { uri: 'file:///portrait.jpg', width: 3000, height: 4000 },
];
test('gallery photos are individually cropped before conversion and embedded at bounded resolution', async () => {
  const harness = scannerHarness(photos), requests = [], progress = [];
  const rectangles = [
    { originX: 600, originY: 300, width: 2800, height: 2100 },
    { originX: 400, originY: 700, width: 1800, height: 2800 },
  ];
  const document = await harness.scanPhotos(false, {
    cropPhoto: async (source, index, total) => {
      assert.equal(harness.operations.length, 0, 'No PDF image processing occurs while choosing crops');
      requests.push({ source, index, total }); return rectangles[index];
    },
    onProgress: (completed, total) => progress.push([completed, total]),
  });
  assert.deepEqual(requests.map(request => [request.source.uri, request.index, request.total]), photos.map((photo, index) => [photo.uri, index, 2]));
  assert.equal(harness.selections[0].allowsEditing, false); assert.equal(harness.selections[0].allowsMultipleSelection, true);
  assert.equal(harness.selections[0].orderedSelection, true);
  assert.deepEqual(harness.operations, [
    ['open', photos[0].uri], ['crop', photos[0].uri, rectangles[0]], ['resize', photos[0].uri, { width: 2000 }],
    ['open', photos[1].uri], ['crop', photos[1].uri, rectangles[1]], ['resize', photos[1].uri, { height: 2000 }],
  ]);
  assert.equal(document.kind, 'scan'); assert.equal(document.pages, 2);
  const pdf = await PDFDocument.load(document.bytes), images = pdf.context.enumerateIndirectObjects().map(([, object]) => object)
    .filter(object => object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
  assert.deepEqual(images.map(image => [image.dict.get(PDFName.of('Width')).asNumber(), image.dict.get(PDFName.of('Height')).asNumber()]), [[2000, 1500], [1286, 2000]]);
  assert.deepEqual(progress, [[0, 2], [1, 2], [2, 2]]);
  assert.equal(harness.releases.length, 4);
});

test('camera photos use the same free crop flow, and canceling any gallery crop discards the scan', async () => {
  const camera = scannerHarness([photos[0]], true);
  const document = await camera.scanPhotos(true, { cropPhoto: async () => ({ originX: 10, originY: 20, width: 700, height: 900 }) });
  assert.equal(document.pages, 1); assert.equal(camera.selections[0].allowsEditing, false);
  assert.equal(camera.operations.some(operation => operation[0] === 'resize'), false);
  const gallery = scannerHarness(photos);
  const canceled = await gallery.scanPhotos(false, { cropPhoto: async (_source, index) => index === 0 ? { originX: 0, originY: 0, width: 800, height: 1200 } : null });
  assert.equal(canceled, null); assert.deepEqual(gallery.operations, []);
  const failed = scannerHarness([photos[0]], true, true);
  await assert.rejects(failed.scanPhotos(true, { cropPhoto: async () => ({ originX: 0, originY: 0, width: 800, height: 1200 }) }), /Image processing failed/);
  assert.deepEqual(failed.releases, [['context', photos[0].uri]], 'Native resources are released on failure');
});

test('crop requests cancel on abort or unmount, and stale confirmations cannot accept the next image', async () => {
  let slots = [], cursor = 0, cleanup;
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], next => { slots[index] = next; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback: callback => callback, useEffect: effect => { cleanup = effect(); },
  };
  const hook = load('src/hooks/use-image-crop.ts', { react: hooks });
  const render = () => { cursor = 0; return hook.useImageCrop(); };
  const controller = new AbortController();
  let api = render();
  const first = api.cropPhoto(photos[0], 0, 2, controller.signal); api = render();
  const staleComplete = api.cropRequest.complete, rectangle = { originX: 100, originY: 200, width: 500, height: 600 };
  staleComplete(rectangle); assert.deepEqual(await first, rectangle);
  const second = api.cropPhoto(photos[1], 1, 2, controller.signal);
  staleComplete(rectangle); assert.equal(render().cropRequest.index, 1);
  controller.abort(); assert.equal(await second, null); assert.equal(render().cropRequest, null);
  const third = api.cropPhoto(photos[0], 0, 1); render(); cleanup();
  assert.equal(await third, null);
  assert.equal(await api.cropPhoto(photos[0], 0, 1), null, 'A picker returning after unmount cannot leave a pending crop');
  assert.equal(render().cropRequest, null);
});

function reactHarness() {
  const slots = []; let cursor = 0;
  const hooks = {
    createContext: () => ({ Provider: 'ActionsProvider' }),
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; }]; },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo: factory => factory(), useCallback: callback => callback, useEffect: () => {},
  };
  const element = (type, props) => ({ type, props });
  const runtime = { jsx: element, jsxs: element };
  return { hooks, runtime, render: component => { cursor = 0; return component(); } };
}
function nodes(node) {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!node || typeof node !== 'object') return [];
  return [node, ...nodes(node.props?.children), ...nodes(node.props?.ListHeaderComponent)];
}

test('crop dialog gestures use the original selection, preserve it across layouts, and confirm only once', () => {
  const react = reactHarness(), accepted = [];
  const { ImageCropDialog } = load('src/components/image-crop-dialog.tsx', {
    react: react.hooks, 'react/jsx-runtime': react.runtime,
    'react-native': { View: 'View', Text: 'Text', ActivityIndicator: 'ActivityIndicator', StyleSheet: { create: styles => styles, absoluteFill: {} }, PanResponder: { create: config => ({ panHandlers: config }) } },
    'expo-image': { Image: 'Image' }, 'lucide-react-native': {}, 'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    '@/lib/image-crop': crop, './centered-dialog': { CenteredDialog: 'CenteredDialog' },
    './pdf-ui': { Button: 'Button', IconButton: 'IconButton' }, './pdf-styles': { green: '#357761' },
  });
  const request = { source: photos[0], index: 0, total: 2, complete: rectangle => accepted.push(rectangle) };
  const render = () => nodes(react.render(() => ImageCropDialog({ request })));
  const buttons = () => render().filter(node => node.type === 'Button');
  assert.equal(buttons().at(-1).props.disabled, true);
  render().find(node => node.props?.onLayout).props.onLayout({ nativeEvent: { layout: { width: 400, height: 600 } } });
  render().find(node => node.type === 'Image').props.onLoad({ source: { width: 4000, height: 3000 } });
  const corner = render().find(node => node.props?.handle === 'topLeft');
  const handlers = corner.type(corner.props).props;
  handlers.onPanResponderGrant();
  handlers.onPanResponderMove({}, { dx: 30, dy: 20 });
  handlers.onPanResponderMove({}, { dx: 84, dy: 42 });
  handlers.onPanResponderRelease({}, { dx: 84, dy: 42 });
  render().find(node => node.props?.onLayout).props.onLayout({ nativeEvent: { layout: { width: 700, height: 1000 } } });
  const confirm = buttons().at(-1).props;
  assert.equal(confirm.label, 'Siguiente imagen');
  confirm.onPress(); confirm.onPress();
  assert.deepEqual(accepted, [{ originX: 1000, originY: 500, width: 3000, height: 2500 }]);
});

test('shared document actions show every crop without a processing overlay and save only after all are confirmed', async () => {
  const react = reactHarness(), scanner = scannerHarness(photos), commits = [], routes = [];
  const existing = { id: 'existing', name: 'Existing', kind: 'pdf', updated: 1, bytes: new Uint8Array(), pages: 1, size: 1, favorite: false };
  const hook = load('src/hooks/use-image-crop.ts', { react: react.hooks });
  const { DocumentActionsProvider } = load('src/components/document-actions.tsx', {
    react: react.hooks, 'react/jsx-runtime': react.runtime,
    'react-native': { ...Object.fromEntries(['ActivityIndicator', 'FlatList', 'Pressable', 'Text', 'TextInput', 'View'].map(name => [name, name])), Platform: { OS: 'ios' }, useWindowDimensions: () => ({ width: 390 }) },
    'react-native-safe-area-context': { SafeAreaView: 'SafeAreaView' },
    'expo-router': { router: { push: route => routes.push(route) }, useLocalSearchParams: () => ({ view: 'home' }) },
    'expo-linear-gradient': { LinearGradient: 'LinearGradient' }, 'lucide-react-native': new Proxy({}, { get: (_target, name) => name }),
    '@/lib/pdf': { scanPhotos: scanner.scanPhotos }, '@/lib/storage': {},
    '@/lib/library': { useLibrary: () => ({ documents: [existing], loaded: true, error: null, commit: async (documents, options) => { commits.push({ documents, options }); } }) },
    '@/hooks/use-image-crop': hook,
    '@/components/pdf-ui': { Button: 'Button', HeroIllustration: 'HeroIllustration', IconButton: 'IconButton' },
    '@/components/pdf-styles': { styles: new Proxy({}, { get: () => ({}) }), green: '#357761' },
    ...Object.fromEntries([
      ['pdf-dialogs', 'PdfDialogs'], ['document-card', 'DocumentCard'], ['document-delete-dialog', 'DocumentDeleteDialog'], ['operation-dialog', 'OperationDialog'], ['image-crop-dialog', 'ImageCropDialog'],
    ].map(([file, name]) => [`@/components/${file}`, { [name]: name }])),
  });
  const render = () => nodes(react.render(() => DocumentActionsProvider({ children: null })));
  const dialog = () => render().find(node => node.type === 'PdfDialogs').props;
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  let scanning = dialog().takePhotos(false); await tick();
  const firstRequest = render().find(node => node.type === 'ImageCropDialog').props.request;
  assert.equal(firstRequest.index, 0);
  assert.equal(render().find(node => node.type === 'OperationDialog').props.visible, false);
  firstRequest.complete({ originX: 0, originY: 0, width: 800, height: 1000 }); await tick();
  const secondRequest = render().find(node => node.type === 'ImageCropDialog').props.request;
  assert.equal(secondRequest.index, 1); assert.equal(commits.length, 0);
  secondRequest.complete(null); await scanning;
  assert.equal(commits.length, 0); assert.equal(routes.length, 0); assert.equal(render().some(node => node.type === 'ImageCropDialog'), false);
  scanning = dialog().takePhotos(false); await tick();
  render().find(node => node.type === 'ImageCropDialog').props.request.complete({ originX: 0, originY: 0, width: 800, height: 1000 }); await tick();
  render().find(node => node.type === 'ImageCropDialog').props.request.complete({ originX: 0, originY: 0, width: 900, height: 1100 });
  await scanning;
  assert.equal(commits.length, 1); assert.equal(commits[0].documents[0].pages, 2);
  assert.equal(commits[0].documents[1].id, existing.id);
  assert.equal(commits[0].options.optimistic, false, 'Publish the scan only after storage succeeds');
  assert.equal(routes[0].params.id, commits[0].documents[0].id);
  assert.equal(render().find(node => node.type === 'OperationDialog').props.visible, false);
});
