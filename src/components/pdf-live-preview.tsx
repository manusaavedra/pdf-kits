import { Text, View } from 'react-native';
import type { PageEdit } from '@/lib/pdf-engine';
import PdfPreview from './pdf-preview';
import { green } from './pdf-styles';
import type { PreviewProps } from './pdf-preview-types';

export default function PdfLivePreview({ pages, ...preview }: { pages: (PageEdit & { key: string })[]; name: string } & PreviewProps) {
  return <View style={{ flex: 1 }}><Text style={{ fontSize: 11, color: green, marginBottom: 9 }}>Vista previa del resultado</Text><PdfPreview {...preview} edits={pages} /></View>;
}
