import { getInfoAsync, readAsStringAsync, EncodingType } from 'expo-file-system/legacy';
import { decodeFromBase64 } from 'pdf-lib';

export type ReadOptions = { signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void };
const sources = new WeakMap<Uint8Array, string>();
export const rememberReadSource = (bytes: Uint8Array, uri: string) => { sources.set(bytes, uri); };
export const readSourceUri = (bytes: Uint8Array) => sources.get(bytes);
export async function readNativeFile(uri: string, options: ReadOptions = {}) {
  const checkCanceled = () => { if (options.signal?.aborted) throw new Error('Importación cancelada.'); };
  checkCanceled();
  const info = await getInfoAsync(uri);
  if (!info.exists || info.isDirectory || !info.size) throw new Error('El archivo está vacío o no se puede leer.');
  const bytes = new Uint8Array(info.size);
  let loaded = 0;
  options.onProgress?.(loaded, info.size);
  while (loaded < info.size) {
    checkCanceled();
    const length = Math.min(192 * 1024, info.size - loaded);
    const encoded = await readAsStringAsync(uri, { encoding: EncodingType.Base64, position: loaded, length });
    checkCanceled();
    const chunk = decodeFromBase64(encoded);
    if (!chunk.length || chunk.length > length) throw new Error('No se pudo leer el archivo completo. Vuelve a seleccionarlo.');
    bytes.set(chunk, loaded); loaded += chunk.length;
    options.onProgress?.(loaded, info.size);
  }
  sources.set(bytes, uri);
  return bytes;
}
