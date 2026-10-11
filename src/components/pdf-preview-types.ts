import type { SavedDocument } from '@/lib/storage';
import type { PageEdit } from '@/lib/pdf-engine';
export type PreviewEdit = PageEdit & { key: string };
export type PreviewProps = { doc: SavedDocument; sources?: SavedDocument[]; edits?: PreviewEdit[]; page?: number; thumbnailPages?: number[]; onPageChange?: (page: number) => void; onThumbnail?: (page: number, uri: string, key: string) => void };
export type ViewerMessage = { type: string; page: number; key?: string; uri?: string; requestId?: number; begin?: number; end?: number };
