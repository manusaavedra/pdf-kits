import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { PREVIEW_CHUNK_SIZE, readPreviewRange } from '@/lib/preview-range';
import { viewerHtml } from '@/lib/pdf-viewer';
import { styles as s } from './pdf-styles';
import type { PreviewProps, ViewerMessage } from './pdf-preview-types';
const viewerSource = { html: viewerHtml };
const noSources: NonNullable<PreviewProps['sources']> = [];
const documentKey = (doc: PreviewProps['doc']) => `${doc.id}:${doc.updated}:${doc.size}`;
export default function PdfPreview({ doc, sources = noSources, edits, page = 1, thumbnailPages, onPageChange, onThumbnail }: PreviewProps) {
  const viewer = useRef<WebView>(null);
  const key = documentKey(doc);
  const latest = useRef({ doc, key, sources, page, edits, thumbnailPages });
  const sent = useRef<typeof latest.current | null>(null);
  const ready = useRef(false);
  const [error, setError] = useState('');
  const sendSources = useCallback(() => {
    const definitions = latest.current.sources.map(doc => ({ id: doc.id, key: documentKey(doc), fileKey: documentKey(doc), length: doc.size }));
    viewer.current?.injectJavaScript(`window.pdfKitSources?.(${JSON.stringify(definitions)});true;`);
  }, []);
  const load = useCallback(() => {
    const current = latest.current;
    setError('');
    sendSources();
    viewer.current?.injectJavaScript(`window.pdfKitLoadFile?.(${JSON.stringify(current.key)},${current.doc.size},${current.page},${JSON.stringify(current.edits ?? null)});window.pdfKitVisiblePages?.(${JSON.stringify(current.thumbnailPages ?? null)});true;`);
    sent.current = current;
  }, [sendSources]);
  useEffect(() => {
    latest.current = { doc, key, sources, page, edits, thumbnailPages };
    if (!ready.current) return;
    if (sent.current?.sources !== sources) sendSources();
    if (sent.current?.key !== key) {
      load();
    } else if (sent.current.edits !== edits) {
      viewer.current?.injectJavaScript(`window.pdfKitEdit?.(${JSON.stringify(edits ?? null)},${page});true;`);
    } else if (sent.current.page !== page) {
      viewer.current?.injectJavaScript(`window.pdfKitPage?.(${page});true;`);
    }
    if (sent.current?.thumbnailPages !== thumbnailPages) viewer.current?.injectJavaScript(`window.pdfKitVisiblePages?.(${JSON.stringify(thumbnailPages ?? null)});true;`);
    sent.current = latest.current;
  }, [doc, key, sources, edits, page, thumbnailPages, load, sendSources]);
  async function supplyRange(message: ViewerMessage) {
    const current = latest.current;
    const requested = message.key === current.key ? current.doc : current.sources.find(doc => documentKey(doc) === message.key);
    if (!requested || !Number.isSafeInteger(message.requestId) || message.requestId! <= 0 || !Number.isSafeInteger(message.begin) || !Number.isSafeInteger(message.end) || message.begin! < 0 || message.end! <= message.begin! || message.end! > requested.size) return;
    try {
      for (let begin = message.begin!; begin < message.end!; begin += PREVIEW_CHUNK_SIZE) {
        const data = await readPreviewRange(requested, begin, Math.min(begin + PREVIEW_CHUNK_SIZE, message.end!));
        if (latest.current.key !== current.key || (requested !== current.doc && !latest.current.sources.some(doc => documentKey(doc) === message.key)) || !viewer.current) return;
        viewer.current.injectJavaScript(`window.pdfKitRangeData?.(${JSON.stringify(message.key)},${message.requestId},${begin},${JSON.stringify(data)});true;`);
      }
    } catch {
      if (latest.current.key === current.key) {
        setError('No se pudo leer una parte del PDF. Vuelve a abrir el documento.');
        viewer.current?.injectJavaScript(`window.pdfKitRangeError?.(${JSON.stringify(message.key)});true;`);
      }
    }
  }
  return <View style={{ flex: 1, minHeight: 150, borderRadius: 8, overflow: 'hidden', borderWidth: 1, borderColor: '#DCE5D4' }}><WebView ref={viewer} source={viewerSource} originWhitelist={['*']} javaScriptEnabled nestedScrollEnabled onLoadStart={() => { ready.current = false; }} onLoadEnd={() => {
    ready.current = true;
    load();
  }} onMessage={event => {
    try { const message = JSON.parse(event.nativeEvent.data) as ViewerMessage;
      if (message.type === 'pdf-kit-range') { void supplyRange(message); return; }
      if (!Number.isInteger(message.page) || message.page < 1) return;
      if (message.type === 'pdf-kit-page') onPageChange?.(message.page);
      if (message.type === 'pdf-kit-thumbnail' && message.uri?.startsWith('data:image/jpeg')) onThumbnail?.(message.page, message.uri, message.key ?? 'original-' + (message.page - 1));
    } catch { /* Ignore malformed messages. */ }
  }} onContentProcessDidTerminate={() => setError('El visor se cerró al procesar la página. Vuelve a abrir el documento.')} onRenderProcessGone={() => setError('El visor se cerró al procesar la página. Vuelve a abrir el documento.')} onShouldStartLoadWithRequest={request => request.url === 'about:blank'} renderError={() => <Text style={s.modalDescription}>No se pudo iniciar el visor. Vuelve a abrir el documento.</Text>} />{error !== '' && <View style={{ position: 'absolute', inset: 0, backgroundColor: '#F7F9F2', padding: 24, justifyContent: 'center' }}><Text accessibilityRole="alert" style={s.modalDescription}>{error}</Text></View>}</View>;
}
