import type { SavedDocument } from './storage';
// Bump the format when thumbnail dimensions or rendering change.
export const thumbnailKey = (doc: SavedDocument) => `thumb-v1-${encodeURIComponent(doc.id)}-${doc.updated}-${doc.size}`;
