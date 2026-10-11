import type { SavedDocument } from './storage';

export type ImportProgress = { phase: 'selecting' | 'reading' | 'checking' | 'saving'; completed: number; total: number; name?: string; detail?: string; bytesRead?: number; bytesTotal?: number };
export function abortable<T>(operation: Promise<T>, signal?: AbortSignal, timeoutMs?: number): Promise<T> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
    const cancel = () => { cleanup(); reject(new Error('Importación cancelada.')); };
    operation.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (signal?.aborted) { cancel(); return; }
    signal?.addEventListener('abort', cancel, { once: true });
    if (timeoutMs) timer = setTimeout(() => { cleanup(); reject(new Error('El archivo está tardando demasiado. Prueba a descargarlo en tu dispositivo y vuelve a importarlo.')); }, timeoutMs);
  });
}
type Asset = { name: string; size?: number; uri: string; file?: { arrayBuffer: () => Promise<ArrayBuffer> } };
export async function importPdfAssets(assets: Asset[], read: (uri: string, options?: { signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void }) => Promise<Uint8Array>, create: (bytes: Uint8Array, name: string) => Promise<SavedDocument>, options: { signal?: AbortSignal; onProgress?: (progress: ImportProgress) => void } = {}) {
  const documents: SavedDocument[] = [];
  for (const asset of assets) {
    if (options.signal?.aborted) throw new Error('Importación cancelada.');
    options.onProgress?.({ phase: 'reading', completed: documents.length, total: assets.length, name: asset.name });
    const bytes = await abortable(asset.file ? asset.file.arrayBuffer().then(buffer => new Uint8Array(buffer)) : read(asset.uri, { signal: options.signal, onProgress: (bytesRead, bytesTotal) => options.onProgress?.({ phase: 'reading', completed: documents.length, total: assets.length, name: asset.name, bytesRead, bytesTotal }) }), options.signal, 60000);
    options.onProgress?.({ phase: 'checking', completed: documents.length, total: assets.length, name: asset.name });
    await new Promise(resolve => setTimeout(resolve, 1));
    if (options.signal?.aborted) throw new Error('Importación cancelada.');
    documents.push(await abortable(create(bytes, asset.name), options.signal, 60000));
    options.onProgress?.({ phase: 'checking', completed: documents.length, total: assets.length, name: asset.name });
  }
  return documents;
}
