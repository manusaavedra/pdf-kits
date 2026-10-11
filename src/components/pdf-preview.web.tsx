import { useEffect, useRef } from 'react';
import { viewerHtml } from '@/lib/pdf-viewer';
import type { PreviewProps, ViewerMessage } from './pdf-preview-types';
const noSources: NonNullable<PreviewProps['sources']> = [];
const documentKey = (doc: PreviewProps['doc']) => `${doc.id}:${doc.updated}:${doc.size}`;
export default function PdfPreview({ doc, sources = noSources, edits, page = 1, thumbnailPages, onPageChange, onThumbnail }: PreviewProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const latest = useRef({ bytes: doc.bytes, sources, page, edits, thumbnailPages });
  const sent = useRef<typeof latest.current | null>(null);
  const ready = useRef(false);
  const sendSources = (force = false) => {
    const transfers: ArrayBuffer[] = [];
    const definitions = latest.current.sources.map(doc => {
      const key = documentKey(doc);
      if (!force && sent.current?.sources.some(previous => documentKey(previous) === key)) return { id: doc.id, key };
      const bytes = new Uint8Array(doc.bytes).buffer; transfers.push(bytes);
      return { id: doc.id, key, bytes };
    });
    frame.current?.contentWindow?.postMessage({ type: 'pdf-kit-sources', sources: definitions }, '*', transfers);
  };
  const send = () => {
    const current = latest.current;
    const bytes = new Uint8Array(current.bytes);
    sendSources(true);
    frame.current?.contentWindow?.postMessage({ type: 'pdf-kit-load', bytes: bytes.buffer, page: current.page, edits: current.edits }, '*', [bytes.buffer]);
    frame.current?.contentWindow?.postMessage({ type: 'pdf-kit-visible-pages', pages: current.thumbnailPages ?? null }, '*');
    sent.current = current;
  };
  useEffect(() => {
    latest.current = { bytes: doc.bytes, sources, page, edits, thumbnailPages };
    if (!ready.current) return;
    if (sent.current?.sources !== sources) sendSources();
    if (sent.current?.bytes !== doc.bytes) {
      const bytes = new Uint8Array(doc.bytes);
      frame.current?.contentWindow?.postMessage({ type: 'pdf-kit-load', bytes: bytes.buffer, page, edits }, '*', [bytes.buffer]);
      frame.current?.contentWindow?.postMessage({ type: 'pdf-kit-visible-pages', pages: thumbnailPages ?? null }, '*');
    } else if (sent.current.edits !== edits) {
      frame.current?.contentWindow?.postMessage({ type: 'pdf-kit-edit', edits, page }, '*');
    } else if (sent.current.page !== page) {
      frame.current?.contentWindow?.postMessage({ type: 'pdf-kit-select-page', page }, '*');
    }
    if (sent.current?.thumbnailPages !== thumbnailPages) frame.current?.contentWindow?.postMessage({ type: 'pdf-kit-visible-pages', pages: thumbnailPages ?? null }, '*');
    sent.current = latest.current;
  }, [doc.bytes, sources, edits, page, thumbnailPages]);
  useEffect(() => {
    const receive = (event: MessageEvent<ViewerMessage>) => {
      if (event.source !== frame.current?.contentWindow || !Number.isInteger(event.data?.page) || event.data.page < 1) return;
      if (event.data.type === 'pdf-kit-page') onPageChange?.(event.data.page);
      if (event.data.type === 'pdf-kit-thumbnail' && event.data.uri?.startsWith('data:image/jpeg')) onThumbnail?.(event.data.page, event.data.uri, event.data.key ?? 'original-' + (event.data.page - 1));
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onPageChange, onThumbnail]);
  return <iframe ref={frame} srcDoc={viewerHtml} onLoad={() => { ready.current = true; send(); }} title="Vista previa del PDF con los cambios" style={{ width: '100%', flex: 1, minHeight: 150, border: '1px solid #E3EADD', borderRadius: 8 }} />;
}
