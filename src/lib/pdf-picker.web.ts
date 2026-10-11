import type { DocumentPickerResult } from 'expo-document-picker';

// Expo's web picker has no fallback when browsers omit the cancel event.
export function selectPdfs(signal?: AbortSignal): Promise<DocumentPickerResult> {
  if (typeof document === 'undefined') return Promise.resolve({ canceled: true, assets: null });
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = 'application/pdf,.pdf'; input.multiple = true;
    input.style.display = 'none'; document.body.appendChild(input);
    let settled = false, focusTimer: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => { clearTimeout(focusTimer); window.removeEventListener('focus', onFocus); signal?.removeEventListener('abort', onAbort); input.remove(); };
    const finish = () => {
      if (settled) return; settled = true;
      const files = Array.from(input.files ?? []); cleanup();
      resolve(files.length ? { canceled: false, assets: files.map(file => ({ name: file.name, size: file.size, lastModified: file.lastModified, mimeType: file.type, uri: '', file })) } : { canceled: true, assets: null });
    };
    const onAbort = () => { if (settled) return; settled = true; cleanup(); reject(new Error('Importación cancelada.')); };
    const onFocus = () => { clearTimeout(focusTimer); focusTimer = setTimeout(finish, 750); };
    input.addEventListener('change', finish); input.addEventListener('cancel', finish);
    window.addEventListener('focus', onFocus); signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    // Keep this synchronous with the button press to preserve browser user activation.
    try { input.click(); } catch (error) { settled = true; cleanup(); reject(error); }
  });
}
