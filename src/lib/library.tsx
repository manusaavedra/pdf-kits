import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import Constants from 'expo-constants';
import { loadDocuments, persistDocuments, loadThumbnail, saveThumbnail, removeThumbnail, retainDocuments, type SavedDocument } from './storage';
import { thumbnailKey } from './thumbnail-key';
import { createLibraryStore, type CommitOptions } from './library-store';
import { createThumbnailStore, type ThumbnailJob } from './thumbnail-store';
import { ThumbnailContext } from './thumbnails';
import PdfThumbnailRenderer from '@/components/pdf-thumbnail-renderer';
type Library = { documents: SavedDocument[]; loaded: boolean; error: string | null; commit: (next: SavedDocument[], options?: CommitOptions) => Promise<void>; removeDocument: (id: string) => Promise<void> };
const Context = createContext<Library | null>(null);
export function LibraryProvider({ children }: { children: ReactNode }) {
  const [documents, setDocuments] = useState<SavedDocument[]>([]);
  const [persistedDocuments, setPersistedDocuments] = useState<SavedDocument[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [store] = useState(() => createLibraryStore(persistDocuments, setDocuments, setPersistedDocuments, retainDocuments));
  const [thumbnailState, setThumbnailState] = useState<{ job: ThumbnailJob | null; started: boolean }>({ job: null, started: false });
  // Keep automatic thumbnails disabled in Expo Go after the confirmed crash.
  // Cached images stay available; development/production builds retain generation.
  const [thumbnails] = useState(() => createThumbnailStore({ renderEnabled: Constants.appOwnership !== 'expo', read: loadThumbnail, write: saveThumbnail, remove: removeThumbnail, onJob: job => setThumbnailState(previous => previous.job === job ? previous : { job, started: previous.started || job !== null }) }));
  useEffect(() => {
    if (!loaded) return;
    const saved = new Set(persistedDocuments.map(thumbnailKey));
    thumbnails.update(documents.filter(doc => saved.has(thumbnailKey(doc))));
  }, [loaded, documents, persistedDocuments, thumbnails]);
  useEffect(() => { loadDocuments().then(store.initialize).catch(() => setError('No se pudo cargar la biblioteca. Vuelve a abrir la aplicación.')).finally(() => setLoaded(true)); }, [store]);
  const value = useMemo(() => ({ documents, loaded, error, commit: store.commit, removeDocument: store.remove }), [documents, loaded, error, store]);
  return <ThumbnailContext.Provider value={thumbnails}><Context.Provider value={value}>{children}</Context.Provider>{thumbnailState.job && <PdfThumbnailRenderer job={thumbnailState.job} onResult={thumbnails.complete} />}</ThumbnailContext.Provider>;
}
export function useLibrary() { const library = useContext(Context); if (!library) throw new Error('Biblioteca no disponible.'); return library; }
