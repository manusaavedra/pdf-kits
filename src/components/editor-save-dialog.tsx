import { ActivityIndicator, Text, View } from 'react-native';
import { CenteredDialog } from './centered-dialog';
import { green, styles as s } from './pdf-styles';
import type { EditorSaveProgress } from '@/lib/save-progress';

const keepOpen = () => {};
export function EditorSaveDialog({ visible, progress }: { visible: boolean; progress: EditorSaveProgress }) {
  return <CenteredDialog visible={visible} onRequestClose={keepOpen}>
    <View style={s.modalBackdrop}><View style={[s.modalCard, { maxWidth: 420, alignItems: 'center', gap: 16 }]}>
      <ActivityIndicator size="large" color={green} />
      <Text style={s.modalTitle}>Guardando cambios</Text>
      <Text accessibilityLiveRegion="polite" style={[s.modalDescription, { textAlign: 'center', marginBottom: 0 }]}>{progress.detail}</Text>
      <View style={{ width: '100%', gap: 10 }}>
        <View accessibilityRole="progressbar" accessibilityLabel="Progreso del guardado" accessibilityValue={{ min: 0, max: 100, now: progress.percentage }} style={{ height: 7, backgroundColor: '#E5ECDD', borderRadius: 4, overflow: 'hidden' }}>
          <View style={{ width: `${progress.percentage}%`, height: '100%', backgroundColor: green }} />
        </View>
        <Text style={[s.documentMeta, { textAlign: 'center' }]}>{progress.percentage}%</Text>
      </View>
    </View></View>
  </CenteredDialog>;
}
