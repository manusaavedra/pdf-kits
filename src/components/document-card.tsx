import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Clock3, Download, Heart, Trash2 } from 'lucide-react-native';
import type { SavedDocument } from '@/lib/storage';
import { IconButton, formatSize } from './pdf-ui';
import { DocumentThumbnail } from './document-thumbnail';
import { styles as s } from './pdf-styles';
type Props = { doc: SavedDocument; grid: boolean; busy: boolean; onOpen: (doc: SavedDocument) => void; onFavorite: (doc: SavedDocument) => void; onExport: (doc: SavedDocument) => void; onDelete: (doc: SavedDocument) => void };
export const DocumentCard = memo(function DocumentCard({ doc, grid, busy, onOpen, onFavorite, onExport, onDelete }: Props) {
  return <View style={[s.documentCard, grid ? { width: '100%' } : { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 20 }]}><Pressable onPress={() => onOpen(doc)} style={[s.documentPreview, !grid && { width: 65, height: 78, marginBottom: 0 }]}><DocumentThumbnail doc={doc} compact={!grid} /><View style={s.docType}><Text style={s.docTypeText}>PDF</Text></View></Pressable><Pressable onPress={() => onOpen(doc)} style={{ flex: 1 }}><Text numberOfLines={1} style={s.documentTitle}>{doc.name}</Text><Text style={s.documentMeta}>{doc.pages} {doc.pages === 1 ? 'página' : 'páginas'} · {formatSize(doc.size)}</Text><View style={[s.row, { marginTop: 9, gap: 5 }]}><Clock3 size={11} color="#99A18F" /><Text style={s.documentDate}>{new Date(doc.updated).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</Text></View></Pressable><View style={[s.row, grid && { marginTop: 10, justifyContent: 'space-between', borderTopWidth: 1, borderColor: '#EDF0E8', paddingTop: 8 }]}><IconButton icon={Heart} disabled={busy} label={doc.favorite ? 'Quitar de favoritos' : 'Añadir a favoritos'} color={doc.favorite ? '#B87383' : '#98A18F'} onPress={() => onFavorite(doc)} /><View style={s.row}><IconButton icon={Download} disabled={busy} label="Guardar o compartir PDF" onPress={() => onExport(doc)} /><IconButton icon={Trash2} disabled={busy} label="Eliminar documento" onPress={() => onDelete(doc)} /></View></View></View>;
});
