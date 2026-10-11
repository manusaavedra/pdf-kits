import { useEffect, useRef } from 'react';
import { viewerHtml } from '@/lib/pdf-viewer';
import type { ThumbnailJob } from '@/lib/thumbnail-store';
type Props = { job: ThumbnailJob | null; onResult: (key: string, uri: string | null) => void };
export default function PdfThumbnailRenderer({ job, onResult }: Props) {
  const frame = useRef<HTMLIFrameElement>(null), ready = useRef(false), sent = useRef('');
  const latest = useRef(job);
  function send(current: ThumbnailJob) {
    sent.current = current.key;
    const bytes = new Uint8Array(current.doc.bytes);
    frame.current?.contentWindow?.postMessage({ type: 'pdf-kit-document-thumbnail', bytes: bytes.buffer, key: current.key }, '*', [bytes.buffer]);
  }
  useEffect(() => {
    latest.current = job;
    if (ready.current && job && sent.current !== job.key) send(job);
  }, [job]);
  useEffect(() => {
    const receive = (event: MessageEvent<{ type?: string; key?: string; uri?: string }>) => {
      if (event.source === frame.current?.contentWindow && event.data?.type === 'pdf-kit-document-thumbnail' && typeof event.data.key === 'string' && event.data.key === latest.current?.key) onResult(event.data.key, event.data.uri ?? null);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onResult]);
  return <iframe ref={frame} srcDoc={viewerHtml} title="Generador de miniaturas" aria-hidden tabIndex={-1} onLoad={() => { ready.current = true; if (latest.current) send(latest.current); }} style={{ position: 'absolute', left: -10000, width: 1, height: 1, border: 0 }} />;
}
