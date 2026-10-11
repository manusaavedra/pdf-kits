import { memo } from 'react';
import { Image } from 'expo-image';
import { FileText } from 'lucide-react-native';
import { useDocumentThumbnail } from '@/lib/thumbnails';
import type { SavedDocument } from '@/lib/storage';
export const DocumentThumbnail = memo(function DocumentThumbnail({ doc, compact }: { doc: SavedDocument; compact: boolean }) {
  const uri = useDocumentThumbnail(doc);
  return uri ? <Image source={{ uri }} contentFit="contain" cachePolicy="memory-disk" accessibilityLabel={`Primera página de ${doc.name}`} style={{ width: '100%', height: '100%' }} /> : <FileText size={compact ? 28 : 45} color={doc.kind === 'scan' ? '#779A91' : '#8D9F80'} strokeWidth={1} />;
});
