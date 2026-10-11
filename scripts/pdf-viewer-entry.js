import { getDocument, GlobalWorkerOptions, PDFDataRangeTransport } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';
import { writePageText } from '../src/lib/pdf-engine';

GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([window.pdfKitWorker], { type: 'text/javascript' }));
const options = { isEvalSupported: false, useSystemFonts: true, isOffscreenCanvasSupported: false, isImageDecoderSupported: false };
let task, pdf, rendering, originalBytes, editableSource;
let lazyThumbnails = false, rangeSequence = 0;
const nativeRanges = new Map(), sourceDefinitions = new Map(), sourceLoads = new Map();
window.pdfKitRangeData = (key, requestId, begin, encoded) => {
  const range = nativeRanges.get(key);
  if (!range) return;
  const pending = range.requests.get(requestId);
  if (!pending) return;
  const chunk = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
  if (begin !== pending.begin + pending.received || !chunk.length || chunk.length > 65536 || pending.received + chunk.length > pending.bytes.length) {
    showError('No se pudo completar la lectura de la página. Vuelve a abrir el documento.'); return;
  }
  pending.bytes.set(chunk, pending.received); pending.received += chunk.length;
  if (pending.received === pending.bytes.length) {
    range.requests.delete(requestId);
    // PDF.js consumes one complete response per requested range, even when it
    // spans several bounded messages across the native bridge.
    range.onDataRange(pending.begin, pending.bytes);
  }
};
window.pdfKitRangeError = key => { if (nativeRanges.has(key)) showError('No se pudo leer una parte del PDF. Vuelve a abrir el documento.'); };
window.pdfKitLoadFile = (key, length, page, edits) => window.pdfKitLoad({ fileKey: key, length }, page, edits);
let revision = 0, loadSequence = 0, editSequence = 0, pageNumber = 1, zoom = 1, edits = null, lastPaint = '';
let visibleThumbnailPages = null, thumbnailRevision = 0, thumbnailRunning = false, thumbnailTimer;
const prepared = new Map();
const thumbnailCache = new Map();
const publishedThumbnails = new Map();
const canvas = document.getElementById('page');
const status = document.getElementById('status');
const counter = document.getElementById('counter');
const previous = document.getElementById('previous');
const next = document.getElementById('next');
const zoomLabel = document.getElementById('zoom');
const pageCount = () => edits?.length ?? pdf?.numPages ?? 0;
const descriptor = index => edits?.[index] ?? { key: `original-${index}`, source: index, rotation: 0, text: '' };
const signature = edit => JSON.stringify([edit.documentId ?? null, edit.source, edit.rotation, edit.text]);
function createPdfLoading(data) {
  if (data?.fileKey) {
    const range = new PDFDataRangeTransport(data.length, new Uint8Array(0));
    range.key = data.fileKey; range.requests = new Map();
    range.abort = () => { range.requests.clear(); if (nativeRanges.get(range.key) === range) nativeRanges.delete(range.key); };
    range.requestDataRange = (begin, end) => {
      const requestId = ++rangeSequence;
      range.requests.set(requestId, { begin, bytes: new Uint8Array(end - begin), received: 0 });
      notify({ type: 'range', key: range.key, requestId, begin, end });
    };
    nativeRanges.set(range.key, range);
    return { range, bytes: null, loading: getDocument({ ...options, range, length: data.length, rangeChunkSize: 65536, disableAutoFetch: true, disableStream: true }) };
  }
  const bytes = typeof data === 'string' ? Uint8Array.from(atob(data), char => char.charCodeAt(0)) : new Uint8Array(data);
  return { bytes, loading: getDocument({ ...options, data: new Uint8Array(bytes) }) };
}
function disposeSource(entry) { return entry.loading.destroy().catch(() => {}); }
window.pdfKitSources = definitions => {
  const active = new Set();
  for (const definition of definitions ?? []) {
    active.add(definition.id);
    const previous = sourceDefinitions.get(definition.id);
    if (previous?.key === definition.key) continue;
    const old = sourceLoads.get(definition.id);
    if (old) { sourceLoads.delete(definition.id); void disposeSource(old); }
    sourceDefinitions.set(definition.id, definition);
  }
  for (const id of sourceDefinitions.keys()) if (!active.has(id)) {
    sourceDefinitions.delete(id);
    const old = sourceLoads.get(id);
    if (old) { sourceLoads.delete(id); void disposeSource(old); }
  }
};
async function loadSource(id) {
  if (!sourceLoads.has(id)) {
    const definition = sourceDefinitions.get(id);
    if (!definition) throw new Error('No se encontró el PDF añadido. Vuelve a importarlo.');
    const loadId = loadSequence;
    const entry = createPdfLoading(definition.fileKey ? definition : definition.bytes);
    sourceLoads.set(id, entry);
    entry.promise = entry.loading.promise.then(document => {
      if (loadId !== loadSequence || sourceLoads.get(id) !== entry) { void disposeSource(entry); throw new Error('Documento reemplazado'); }
      entry.document = document; return entry;
    });
    entry.promise.catch(() => { if (sourceLoads.get(id) === entry) sourceLoads.delete(id); });
  }
  return sourceLoads.get(id).promise;
}
function notify(message) {
  const data = { ...message, type: `pdf-kit-${message.type}` };
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(data));
  else window.parent.postMessage(data, '*');
}
function showError(message) { status.textContent = message || 'No se pudo mostrar el PDF. Prueba a abrir de nuevo el documento.'; status.hidden = false; }
function publishThumbnail(edit, index, uri) {
  const key = signature(edit);
  if (publishedThumbnails.get(edit.key) === key) return;
  publishedThumbnails.set(edit.key, key);
  notify({ type: 'thumbnail', page: index + 1, key: edit.key, uri });
}
function refreshControls() {
  previous.disabled = pageNumber <= 1; next.disabled = pageNumber >= pageCount();
  counter.textContent = `${pageNumber} / ${pageCount()}`;
  zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  notify({ type: 'page', page: pageNumber });
}
async function resolvePage(edit) {
  if (!edit.text.trim()) {
    if (edit.source === null) return { page: null, rotation: edit.rotation };
    const source = edit.documentId ? (await loadSource(edit.documentId)).document : pdf;
    const page = await source.getPage(edit.source + 1);
    return { page, rotation: (page.rotate ?? 0) + edit.rotation };
  }
  const key = signature(edit);
  if (!prepared.has(key)) {
    const loadId = loadSequence;
    const pending = (async () => {
      const output = await PDFDocument.create();
      let page;
      if (edit.source === null) page = output.addPage([595.28, 841.89]);
      else {
        let source;
        if (edit.documentId) {
          const entry = await loadSource(edit.documentId);
          entry.editable ||= (entry.bytes ? Promise.resolve(entry.bytes) : entry.document.getData()).then(bytes => PDFDocument.load(bytes));
          source = await entry.editable;
        } else {
          editableSource ||= (originalBytes ? Promise.resolve(originalBytes) : pdf.getData()).then(bytes => PDFDocument.load(bytes));
          source = await editableSource;
        }
        page = output.addPage((await output.copyPages(source, [edit.source]))[0]);
      }
      page.setRotation(degrees((page.getRotation().angle + edit.rotation) % 360));
      writePageText(page, await output.embedFont(StandardFonts.Helvetica), edit.text);
      const loading = getDocument({ ...options, data: await output.save() });
      const document = await loading.promise;
      if (loadId !== loadSequence) { await loading.destroy(); throw new Error('Documento reemplazado'); }
      const result = { page: await document.getPage(1), rotation: page.getRotation().angle, loading };
      // Retain only a small set of rendered annotation variants, not every keystroke.
      if (prepared.size > 12) {
        for (const [oldKey, oldPromise] of prepared) {
          if (oldKey !== key && oldKey !== signature(descriptor(pageNumber - 1))) {
            prepared.delete(oldKey); oldPromise.then(old => old.loading.destroy()).catch(() => {}); break;
          }
        }
      }
      return result;
    })();
    prepared.set(key, pending);
    pending.catch(() => { if (prepared.get(key) === pending) prepared.delete(key); });
  }
  return prepared.get(key);
}
function blankViewport(rotation, scale) {
  const landscape = rotation % 180 !== 0;
  return { width: (landscape ? 841.89 : 595.28) * scale, height: (landscape ? 595.28 : 841.89) * scale };
}
async function paint(target, edit, width, ratio = 1, isCurrent = () => true) {
  const resolved = await resolvePage(edit);
  if (!isCurrent()) return null;
  const base = resolved.page ? resolved.page.getViewport({ scale: 1, rotation: resolved.rotation }) : blankViewport(resolved.rotation, 1);
  const scale = width / base.width;
  const viewport = resolved.page ? resolved.page.getViewport({ scale, rotation: resolved.rotation }) : blankViewport(resolved.rotation, scale);
  const pixels = Math.min(ratio, Math.sqrt(8000000 / (viewport.width * viewport.height)));
  target.width = Math.floor(viewport.width * pixels); target.height = Math.floor(viewport.height * pixels);
  target.style.width = `${viewport.width}px`; target.style.height = `${viewport.height}px`;
  const context = target.getContext('2d');
  if (!resolved.page) { context.fillStyle = '#fff'; context.fillRect(0, 0, target.width, target.height); return null; }
  return resolved.page.render({ canvas: target, canvasContext: context, viewport, transform: [pixels, 0, 0, pixels, 0, 0] });
}
async function render() {
  if (!pdf || !pageCount()) return;
  refreshControls();
  const edit = descriptor(pageNumber - 1);
  const width = Math.max(180, document.getElementById('paper').clientWidth - 32) * zoom;
  const paintKey = `${signature(edit)}:${width}`;
  if (lastPaint === paintKey) { ++revision; rendering?.cancel(); status.hidden = true; return; }
  const current = ++revision;
  rendering?.cancel();
  status.hidden = false; status.textContent = 'Preparando página…';
  try {
    // Resolve before touching the visible canvas; obsolete requests never overwrite it.
    await resolvePage(edit);
    if (current !== revision) return;
    lastPaint = '';
    const result = await paint(canvas, edit, width, Math.min(window.devicePixelRatio || 1, 2), () => current === revision);
    if (current !== revision) { result?.cancel(); return; }
    rendering = result;
    await result?.promise;
    if (current === revision) { lastPaint = paintKey; status.hidden = true; }
  } catch (error) { if (error.name !== 'RenderingCancelledException' && current === revision) showError(error.message); }
}
async function thumbnails(loadId, editId, thumbnailId) {
  const thumbnail = window.document.createElement('canvas');
  const indices = visibleThumbnailPages !== null
    ? [...new Set([pageNumber, ...visibleThumbnailPages])].map(number => number - 1)
    : lazyThumbnails
      ? Array.from({ length: 5 }, (_, offset) => pageNumber - 1 + offset - 2)
      : Array.from({ length: pageCount() }, (_, index) => index);
  for (const index of indices) {
    if (index < 0 || index >= pageCount()) continue;
    if (loadId !== loadSequence || editId !== editSequence || thumbnailId !== thumbnailRevision) return;
    const edit = descriptor(index); const key = signature(edit);
    // Unchanged page thumbnails are retained by stable page keys in the editor.
    if (thumbnailCache.has(key)) { publishThumbnail(edit, index, thumbnailCache.get(key)); continue; }
    try {
      const result = await paint(thumbnail, edit, 120, 1, () => loadId === loadSequence && editId === editSequence && thumbnailId === thumbnailRevision);
      await result?.promise;
      if (loadId !== loadSequence || editId !== editSequence || thumbnailId !== thumbnailRevision) return;
      const uri = thumbnail.toDataURL('image/jpeg', 0.7);
      thumbnailCache.set(key, uri);
      publishThumbnail(edit, index, uri);
      await new Promise(resolve => setTimeout(resolve, 0));
    } catch { /* Keep the placeholder for a page that cannot be rendered. */ }
  }
}
function scheduleThumbnails() {
  ++thumbnailRevision;
  clearTimeout(thumbnailTimer);
  thumbnailTimer = setTimeout(async () => {
    if (thumbnailRunning || !pdf) return;
    thumbnailRunning = true;
    try {
      let work;
      do { work = thumbnailRevision; await thumbnails(loadSequence, editSequence, work); }
      while (pdf && work !== thumbnailRevision);
    } finally { thumbnailRunning = false; }
  }, 0);
}
window.pdfKitVisiblePages = numbers => {
  const next = Array.isArray(numbers) ? [...new Set(numbers.filter(number => Number.isInteger(number) && number > 0))] : null;
  if (JSON.stringify(next) === JSON.stringify(visibleThumbnailPages)) return;
  visibleThumbnailPages = next; scheduleThumbnails();
};
window.pdfKitEdit = (nextEdits, selectedPage = pageNumber) => {
  edits = nextEdits; ++editSequence;
  const activeSignatures = new Set(Array.from({ length: pageCount() }, (_, index) => signature(descriptor(index))));
  for (const key of thumbnailCache.keys()) if (!activeSignatures.has(key)) thumbnailCache.delete(key);
  pageNumber = Math.max(1, Math.min(selectedPage, pageCount() || selectedPage));
  // Only an affected page is redrawn; insertion/removal never reloads the document.
  render();
  for (let index = 0; index < pageCount(); index++) {
    const edit = descriptor(index); const uri = thumbnailCache.get(signature(edit));
    if (uri) publishThumbnail(edit, index, uri);
  }
  scheduleThumbnails();
};
window.pdfKitPage = number => {
  const requested = Math.max(1, Math.min(pageCount() || number, number));
  if (pageNumber === requested) return;
  pageNumber = requested; document.getElementById('paper').scrollTo(0, 0); render();
  scheduleThumbnails();
};
window.pdfKitLoad = async (data, selectedPage = pageNumber, nextEdits = null) => {
  const loadId = ++loadSequence;
  ++revision; ++editSequence; ++thumbnailRevision; rendering?.cancel(); lastPaint = '';
  visibleThumbnailPages = null;
  const oldTask = task; task = null; pdf = null; edits = nextEdits; pageNumber = selectedPage;
  const oldSources = [...sourceLoads.values()]; sourceLoads.clear();
  for (const pending of prepared.values()) pending.then(result => result.loading.destroy()).catch(() => {});
  prepared.clear(); thumbnailCache.clear(); publishedThumbnails.clear(); editableSource = null;
  status.hidden = false; status.textContent = 'Abriendo tu PDF…';
  try {
    await Promise.all([oldTask?.destroy(), ...oldSources.map(disposeSource)]); if (loadId !== loadSequence) return;
    lazyThumbnails = !!data?.fileKey;
    const opened = createPdfLoading(data), loading = opened.loading;
    originalBytes = opened.bytes;
    task = loading;
    const result = await loading.promise;
    if (task !== loading) { await loading.destroy(); return; }
    pdf = result;
    window.pdfKitEdit(edits, pageNumber);
  } catch { if (loadId === loadSequence) showError(); }
};
let documentThumbnailTask, documentThumbnailRevision = 0, thumbnailTransfer;
window.pdfKitThumbnailCancel = key => {
  if (thumbnailTransfer && thumbnailTransfer.key !== key) return;
  thumbnailTransfer = null;
  documentThumbnailRevision++;
  void documentThumbnailTask?.destroy();
};
window.pdfKitThumbnailBegin = (length, key) => {
  if (!Number.isSafeInteger(length) || length <= 0) {
    notify({ type: 'document-thumbnail', key, uri: null }); return;
  }
  thumbnailTransfer = { bytes: new Uint8Array(length), key, offset: 0 };
  notify({ type: 'thumbnail-transfer', key, offset: 0 });
};
window.pdfKitThumbnailChunk = (encoded, offset, key) => {
  const transfer = thumbnailTransfer;
  if (!transfer || transfer.key !== key || transfer.offset !== offset) return;
  const chunk = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
  if (chunk.length > 192 * 1024 || offset + chunk.length > transfer.bytes.length || !chunk.length) return;
  transfer.bytes.set(chunk, offset); transfer.offset += chunk.length;
  notify({ type: 'thumbnail-transfer', key, offset: transfer.offset });
};
window.pdfKitThumbnailFinish = key => {
  const transfer = thumbnailTransfer;
  if (!transfer || transfer.key !== key || transfer.offset !== transfer.bytes.length) return;
  thumbnailTransfer = null;
  void window.pdfKitDocumentThumbnail(transfer.bytes, key);
};
window.pdfKitDocumentThumbnail = async (data, key) => {
  const revision = ++documentThumbnailRevision;
  let loading;
  try {
    await documentThumbnailTask?.destroy();
    if (revision !== documentThumbnailRevision) return;
    const bytes = typeof data === 'string' ? Uint8Array.from(atob(data), char => char.charCodeAt(0)) : data instanceof Uint8Array ? data : new Uint8Array(data);
    loading = getDocument({ ...options, data: bytes });
    documentThumbnailTask = loading;
    const document = await loading.promise;
    const page = await document.getPage(1);
    if (revision !== documentThumbnailRevision) return;
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: Math.min(240 / base.width, 360 / base.height) });
    const thumbnail = window.document.createElement('canvas');
    thumbnail.width = Math.max(1, Math.ceil(viewport.width)); thumbnail.height = Math.max(1, Math.ceil(viewport.height));
    await page.render({ canvas: thumbnail, canvasContext: thumbnail.getContext('2d'), viewport }).promise;
    if (revision === documentThumbnailRevision) notify({ type: 'document-thumbnail', key, uri: thumbnail.toDataURL('image/jpeg', 0.7) });
  } catch {
    if (revision === documentThumbnailRevision) notify({ type: 'document-thumbnail', key, uri: null });
  } finally {
    await loading?.destroy();
    if (documentThumbnailTask === loading) documentThumbnailTask = null;
  }
};
window.addEventListener('message', event => {
  if (event.source !== window.parent) return;
  if (event.data?.type === 'pdf-kit-load') window.pdfKitLoad(event.data.bytes, event.data.page, event.data.edits);
  if (event.data?.type === 'pdf-kit-sources') window.pdfKitSources(event.data.sources);
  if (event.data?.type === 'pdf-kit-edit') window.pdfKitEdit(event.data.edits, event.data.page);
  if (event.data?.type === 'pdf-kit-select-page') window.pdfKitPage(event.data.page);
  if (event.data?.type === 'pdf-kit-visible-pages') window.pdfKitVisiblePages(event.data.pages);
  if (event.data?.type === 'pdf-kit-document-thumbnail') window.pdfKitDocumentThumbnail(event.data.bytes, event.data.key);
});
previous.onclick = () => { if (pdf && pageNumber > 1) window.pdfKitPage(pageNumber - 1); };
next.onclick = () => { if (pdf && pageNumber < pageCount()) window.pdfKitPage(pageNumber + 1); };
document.getElementById('minus').onclick = () => { zoom = Math.max(0.5, zoom - 0.25); render(); };
document.getElementById('plus').onclick = () => { zoom = Math.min(2.5, zoom + 0.25); render(); };
document.getElementById('fit').onclick = () => { zoom = 1; render(); };
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150); });
