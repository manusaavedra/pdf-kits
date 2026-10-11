import { Camera, ChevronRight, FilePlus2, ImagePlus, Upload, X } from 'lucide-react-native';
import { Pressable, Text, View } from 'react-native';
import { CenteredDialog } from './centered-dialog';
import { IconButton } from './pdf-ui';
import { styles as s, green } from './pdf-styles';

export type AddPagesSource = 'blank' | 'camera' | 'gallery' | 'pdf';
const choices = [
  { id: 'blank', label: 'Hoja en blanco', description: 'Añadir una página A4 vacía', icon: FilePlus2 },
  { id: 'camera', label: 'Desde la cámara', description: 'Tomar una foto y recortarla', icon: Camera },
  { id: 'gallery', label: 'Desde la galería', description: 'Elegir y recortar una o varias imágenes', icon: ImagePlus },
  { id: 'pdf', label: 'Desde un archivo PDF', description: 'Importar todas sus páginas', icon: Upload },
] as const;

export function EditorAddPagesDialog({ visible, page, onClose, onChoose }: { visible: boolean; page: number; onClose: () => void; onChoose: (source: AddPagesSource) => void }) {
  return <CenteredDialog visible={visible} onRequestClose={onClose}>
    <View style={s.modalBackdrop}><View style={[s.modalCard, { maxWidth: 470 }]}>
      <View style={s.modalHeader}><Text style={s.modalTitle}>Añadir páginas</Text><IconButton icon={X} label="Cerrar opciones para añadir páginas" onPress={onClose} /></View>
      <Text style={s.modalDescription}>¿Qué quieres añadir? Las nuevas páginas se insertarán después de la página {page}.</Text>
      <View style={{ gap: 10 }}>{choices.map(({ id, label, description, icon: Icon }) => <Pressable key={id} accessibilityRole="button" accessibilityLabel={label} onPress={() => onChoose(id)} style={({ pressed }) => [s.chooseRow, pressed && { backgroundColor: '#EFF5ED' }]}>
        <Icon size={22} color={green} /><View style={{ flex: 1, gap: 4 }}><Text style={s.chooseName}>{label}</Text><Text style={s.documentMeta}>{description}</Text></View><ChevronRight size={18} color="#94A18F" />
      </Pressable>)}</View>
    </View></View>
  </CenteredDialog>;
}
