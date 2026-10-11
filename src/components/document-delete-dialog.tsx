import { memo, useImperativeHandle, useState, type Ref } from 'react';
import { Text, View } from 'react-native';
import { CenteredDialog } from './centered-dialog';
import { Trash2 } from 'lucide-react-native';
import type { SavedDocument } from '@/lib/storage';
import { Button } from './pdf-ui';
import { styles as s } from './pdf-styles';

export type DeleteDialogHandle = { show: (doc: SavedDocument) => void };
export const DocumentDeleteDialog = memo(function DocumentDeleteDialog({ ref, onRemove }: { ref: Ref<DeleteDialogHandle>; onRemove: (id: string) => void }) {
  const [document, setDocument] = useState<{ id: string; name: string } | null>(null);
  useImperativeHandle(ref, () => ({ show: doc => setDocument({ id: doc.id, name: doc.name }) }), []);
  const close = () => setDocument(null);
  return <CenteredDialog visible={document !== null} onRequestClose={close}>
    <View style={s.modalBackdrop}><View style={[s.modalCard, { maxWidth: 420 }]}>
      <Text style={s.modalTitle}>¿Eliminar este documento?</Text>
      <Text style={s.modalDescription}>Se eliminará «{document?.name}» de tu biblioteca. Esta acción no se puede deshacer.</Text>
      <View style={[s.row, { justifyContent: 'flex-end' }]}>
        <Button label="Cancelar" secondary onPress={close} />
        <Button label="Eliminar" icon={Trash2} onPress={() => { if (!document) return; close(); onRemove(document.id); }} />
      </View>
    </View></View>
  </CenteredDialog>;
});
