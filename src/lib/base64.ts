import { encodeToBase64 } from 'pdf-lib';

export function encodePdfBytes(bytes: Uint8Array) {
  const chunks: string[] = [];
  // Multiples of three keep padding confined to the final chunk.
  for (let offset = 0; offset < bytes.length; offset += 49152) chunks.push(encodeToBase64(bytes.subarray(offset, offset + 49152)));
  return chunks.join('');
}
