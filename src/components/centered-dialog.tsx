import { useEffect, type ReactNode } from 'react';
import { BackHandler, Modal, Platform, StyleSheet, View } from 'react-native';

export function CenteredDialog({ visible, onRequestClose, children }: { visible: boolean; onRequestClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { onRequestClose(); return true; });
    return () => subscription.remove();
  }, [visible, onRequestClose]);
  if (Platform.OS === 'web') return <Modal visible={visible} transparent animationType="none" onRequestClose={onRequestClose}>{children}</Modal>;
  // Stay inside the screen: presenting another native controller while the system
  // picker is dismissing can leave iOS waiting for a presentation that never finishes.
  if (!visible) return null;
  return <View accessibilityViewIsModal style={[StyleSheet.absoluteFill, { zIndex: 1000, elevation: 1000 }]}>{children}</View>;
}
