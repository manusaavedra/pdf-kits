import { readAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import { encodePdfBytes } from './base64';
import { readSourceUri } from './native-file-read';
import type { SavedDocument } from './storage';

export const PREVIEW_CHUNK_SIZE = 64 * 1024;
export async function readPreviewRange(doc: SavedDocument, begin: number, end: number) {
  if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin || end > doc.size || end - begin > PREVIEW_CHUNK_SIZE) throw new Error('El visor solicitó un bloque de archivo inválido.');
  const uri = doc.fileUri ?? readSourceUri(doc.bytes);
  if (uri) return readAsStringAsync(uri, { encoding: EncodingType.Base64, position: begin, length: end - begin });
  return encodePdfBytes(doc.bytes.subarray(begin, end));
}
