import { useCallback, useEffect, useRef } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { createThumbnailTransfer } from '@/lib/thumbnail-transfer';
import { viewerHtml } from '@/lib/pdf-viewer';
import type { ThumbnailJob } from '@/lib/thumbnail-store';
import { readDocumentBytes } from '@/lib/storage';
type Props = { job: ThumbnailJob | null; onResult: (key: string, uri: string | null) => void };
export default function PdfThumbnailRenderer({ job, onResult }: Props) {
  const viewer = useRef<WebView>(null), ready = useRef(false);
  const transfer = useRef<{ key: string; sender: ReturnType<typeof createThumbnailTransfer> } | null>(null);
  const latest = useRef(job);
  const reading = useRef<AbortController | null>(null);
  const start = useCallback(async (current: ThumbnailJob) => {
    reading.current?.abort();
    const controller = new AbortController(); reading.current = controller;
    transfer.current?.sender.cancel();
    try {
      const bytes = await readDocumentBytes(current.doc, controller.signal);
      if (controller.signal.aborted || latest.current?.key !== current.key) return;
      const sender = createThumbnailTransfer({ ...current, doc: { ...current.doc, bytes } }, script => viewer.current?.injectJavaScript(script));
      transfer.current = { key: current.key, sender }; sender.start();
    } catch { if (!controller.signal.aborted) onResult(current.key, null); }
  }, [onResult]);
  useEffect(() => {
    latest.current = job;
    if (ready.current && job) void start(job);
    return () => { reading.current?.abort(); transfer.current?.sender.cancel(); transfer.current = null; };
  }, [job, start]);
  return <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ position: 'absolute', left: -2, top: -2, width: 1, height: 1, opacity: 0 }}><WebView ref={viewer} source={{ html: viewerHtml }} originWhitelist={['*']} javaScriptEnabled onLoadStart={() => { ready.current = false; }} onLoadEnd={() => {
    ready.current = true;
    const current = latest.current;
    if (current) void start(current);
  }} onMessage={event => {
    try {
      const message = JSON.parse(event.nativeEvent.data) as { type?: string; key?: string; uri?: string; offset?: number };
      const currentTransfer = transfer.current;
      if (message.type === 'pdf-kit-thumbnail-transfer' && currentTransfer && message.key === currentTransfer.key && typeof message.offset === 'number') currentTransfer.sender.acknowledge(message.offset);
      if (message.type === 'pdf-kit-document-thumbnail' && typeof message.key === 'string' && message.key === latest.current?.key) onResult(message.key, message.uri ?? null);
    } catch { /* Ignore unrelated viewer messages. */ }
  }} onError={() => { if (latest.current) onResult(latest.current.key, null); }} onContentProcessDidTerminate={() => { if (latest.current) onResult(latest.current.key, null); }} onRenderProcessGone={() => { if (latest.current) onResult(latest.current.key, null); }} onShouldStartLoadWithRequest={request => request.url === 'about:blank'} /></View>;
}
