import { editDocument, type PageEdit } from './pdf-engine';
import { discardEditedPdf, readDocumentBytes, retainDocuments, writeEditedPdf, type SavedDocument } from './storage';
import { yieldToPaint, type CommitOptions } from './library-store';
import { savePercentage, type EditorSaveProgress } from './save-progress';

export async function saveEditorDocument(doc: SavedDocument, pages: PageEdit[], name: string, documents: SavedDocument[], commit: (next: SavedDocument[], options?: CommitOptions) => Promise<void>, onProgress: (progress: EditorSaveProgress) => void, sources: SavedDocument[] = []) {
  let percentage = 0;
  const report = (progress: EditorSaveProgress) => { percentage = Math.max(percentage, progress.percentage); onProgress({ ...progress, percentage }); };
  report({ percentage: 0, detail: 'Preparando el guardado…' });
  // The progress overlay paints and the viewer unmounts before reading the PDF.
  await yieldToPaint();
  let result: SavedDocument | undefined;
  try {
    const unchanged = pages.length === doc.pages && pages.every((page, index) => !page.documentId && page.source === index && page.rotation === 0 && !page.text.trim());
    result = unchanged ? { ...doc, name: name.trim() || doc.name, updated: Math.max(Date.now(), doc.updated + 1) } : await editDocument(doc, pages, name,
      current => readDocumentBytes(current, undefined, (completed, total) => report({ percentage: savePercentage(completed, total, 0, 20), detail: current.id === doc.id ? 'Leyendo el archivo…' : `Leyendo ${current.name}…` })), {
        serialize: writeEditedPdf, sources,
        onProgress: (phase, completed, total) => report(phase === 'checking'
          ? { percentage: 20, detail: 'Comprobando el PDF…' }
          : phase === 'editing'
            ? { percentage: savePercentage(completed, total, 25, 65), detail: `Aplicando cambios · ${completed} de ${total} páginas` }
            : { percentage: savePercentage(completed, total, 65, 95), detail: 'Escribiendo el PDF…' }),
      });
    await commit(documents.map(document => document.id === doc.id ? result! : document), {
      optimistic: false,
      onProgress: progress => report({ percentage: savePercentage(progress.completed, progress.total, 95, 99), detail: progress.detail }),
    });
    const saved = retainDocuments([result])[0];
    report({ percentage: 100, detail: 'Cambios guardados.' });
    await yieldToPaint();
    return saved;
  } finally { if (result) discardEditedPdf(result); }
}
