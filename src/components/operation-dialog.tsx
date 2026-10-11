import { CenteredDialog } from './centered-dialog';
import { ActivityIndicator, Text, View } from 'react-native';
import type { ImportProgress } from '@/lib/import-progress';
import { Button } from './pdf-ui';
import { styles as s, green } from './pdf-styles';

export function OperationDialog({ visible, progress, title, onCancel }: { visible: boolean; progress: ImportProgress | null; title?: string; onCancel?: () => void }) {
  const messages = { selecting: 'Selecciona los PDF en la ventana de archivos.', reading: 'Leyendo el archivo…', checking: 'Comprobando las páginas del PDF…', saving: 'Guardando en tu biblioteca…' };
  const showCount = progress && progress.total > 0;
  const readingBytes = progress?.phase === 'reading' && !!progress.bytesTotal;
  const percentage = readingBytes ? Math.round(progress!.bytesRead! / progress!.bytesTotal! * 100) : showCount ? Math.round(progress.completed / progress.total * 100) : 0;
  return <CenteredDialog visible={visible} onRequestClose={() => onCancel?.()}>
    <View style={s.modalBackdrop}><View accessibilityRole="alert" style={[s.modalCard, { maxWidth: 420, alignItems: 'center', gap: 16 }]}>
      <ActivityIndicator size="large" color={green} />
      <Text style={s.modalTitle}>{title ?? (progress ? 'Importando PDF' : 'Procesando documento')}</Text>
      <Text style={[s.modalDescription, { marginBottom: 0, textAlign: 'center' }]}>{progress ? progress.detail || messages[progress.phase] : 'Preparando tu documento…'}</Text>
      {progress?.name && <Text numberOfLines={2} style={s.documentTitle}>{progress.name}</Text>}
      {showCount && <View style={{ width: '100%', gap: 10 }}>
        <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percentage }} style={{ height: 7, backgroundColor: '#E5ECDD', borderRadius: 4, overflow: 'hidden' }}><View style={{ width: `${percentage}%`, height: '100%', backgroundColor: green }} /></View>
        <Text style={[s.documentMeta, { textAlign: 'center' }]}>{readingBytes ? `Lectura del archivo · ${percentage}%` : progress.phase === 'saving' ? `Guardado · ${percentage}%` : `${progress.completed} de ${progress.total} archivos preparados · ${percentage}%`}</Text>
      </View>}
      {progress?.phase === 'saving' && <Text style={s.documentMeta}>Último paso: guardar los archivos.</Text>}
      {onCancel && <Button label="Cancelar importación" secondary onPress={onCancel} />}
    </View></View>
  </CenteredDialog>;
}
