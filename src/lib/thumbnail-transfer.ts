import { encodePdfBytes } from './base64';
import type { ThumbnailJob } from './thumbnail-store';

// One acknowledged chunk at a time keeps large PDF strings out of the native queue.
export function createThumbnailTransfer(job: ThumbnailJob, send: (script: string) => void) {
  const key = JSON.stringify(job.key);
  let expected = 0, finished = false;
  return {
    start() { send(`window.pdfKitThumbnailBegin(${job.doc.bytes.length},${key});true;`); },
    acknowledge(offset: number) {
      if (finished || offset !== expected) return;
      if (offset === job.doc.bytes.length) {
        finished = true;
        send(`window.pdfKitThumbnailFinish(${key});true;`);
        return;
      }
      const end = Math.min(offset + 192 * 1024, job.doc.bytes.length);
      const chunk = encodePdfBytes(job.doc.bytes.subarray(offset, end));
      expected = end;
      send(`window.pdfKitThumbnailChunk(${JSON.stringify(chunk)},${offset},${key});true;`);
    },
    cancel() { finished = true; send(`window.pdfKitThumbnailCancel(${key});true;`); },
  };
}
