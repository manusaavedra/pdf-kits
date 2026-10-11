import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, PanResponder, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, RotateCcw, X } from 'lucide-react-native';
import type { ImageCropRequest } from '@/hooks/use-image-crop';
import { cropToPixels, dragCrop, fitCropImage, fullImageCrop, type CropHandle, type CropRectangle } from '@/lib/image-crop';
import { CenteredDialog } from './centered-dialog';
import { Button, IconButton } from './pdf-ui';
import { green } from './pdf-styles';

type ControlProps = {
  handle: CropHandle;
  label: string;
  style: StyleProp<ViewStyle>;
  getCrop: () => CropRectangle;
  onDrag: (start: CropRectangle, handle: CropHandle, dx: number, dy: number) => void;
  children?: ReactNode;
};

// Gesture state belongs to the responder, and is read only from touch callbacks.
function createCropResponder(handle: CropHandle, getCrop: ControlProps['getCrop'], onDrag: ControlProps['onDrag']) {
  let start: CropRectangle | null = null;
  return PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { start = getCrop(); },
    onPanResponderMove: (_event, gesture) => { if (start) onDrag(start, handle, gesture.dx, gesture.dy); },
    onPanResponderRelease: (_event, gesture) => { if (start) onDrag(start, handle, gesture.dx, gesture.dy); start = null; },
    onPanResponderTerminate: () => { start = null; },
    onPanResponderTerminationRequest: () => false,
  });
}

function CropControl({ handle, label, style, getCrop, onDrag, children }: ControlProps) {
  const responder = useMemo(() => createCropResponder(handle, getCrop, onDrag), [getCrop, handle, onDrag]);
  return <View {...responder.panHandlers} style={style} accessible accessibilityRole="adjustable" accessibilityLabel={label}
    accessibilityActions={[{ name: 'increment', label: 'Aumentar' }, { name: 'decrement', label: 'Disminuir' }]}
    onAccessibilityAction={event => { const delta = event.nativeEvent.actionName === 'increment' ? 12 : -12; onDrag(getCrop(), handle, delta, delta); }}>
    {children}
  </View>;
}

const handles: { handle: Exclude<CropHandle, 'move'>; x: number; y: number; label: string }[] = [
  { handle: 'top', x: 0.5, y: 0, label: 'Borde superior' },
  { handle: 'bottom', x: 0.5, y: 1, label: 'Borde inferior' },
  { handle: 'left', x: 0, y: 0.5, label: 'Borde izquierdo' },
  { handle: 'right', x: 1, y: 0.5, label: 'Borde derecho' },
  { handle: 'topLeft', x: 0, y: 0, label: 'Esquina superior izquierda' },
  { handle: 'topRight', x: 1, y: 0, label: 'Esquina superior derecha' },
  { handle: 'bottomLeft', x: 0, y: 1, label: 'Esquina inferior izquierda' },
  { handle: 'bottomRight', x: 1, y: 1, label: 'Esquina inferior derecha' },
];

export function ImageCropDialog({ request }: { request: ImageCropRequest }) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [dimensions, setDimensions] = useState({ width: request.source.width, height: request.source.height });
  const [crop, setCrop] = useState(fullImageCrop);
  const currentCrop = useRef(fullImageCrop);
  const confirmed = useRef(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const frame = fitCropImage(dimensions, viewport);
  const getCrop = useCallback(() => currentCrop.current, []);
  const changeCrop = useCallback((next: CropRectangle) => { currentCrop.current = next; setCrop(next); }, []);
  const frameWidth = frame?.width ?? 0, frameHeight = frame?.height ?? 0;
  const onDrag = useCallback((start: CropRectangle, handle: CropHandle, dx: number, dy: number) => {
    changeCrop(dragCrop(start, handle, dx, dy, { width: frameWidth, height: frameHeight }));
  }, [changeCrop, frameWidth, frameHeight]);
  const cancel = () => request.complete(null);
  const confirm = () => {
    if (!ready || !frame || confirmed.current) return;
    confirmed.current = true;
    request.complete(cropToPixels(currentCrop.current, dimensions));
  };
  const selection = frame ? { left: frame.left + crop.x * frame.width, top: frame.top + crop.y * frame.height, width: crop.width * frame.width, height: crop.height * frame.height } : null;
  return <CenteredDialog visible onRequestClose={cancel}>
    <SafeAreaView style={styles.screen} edges={['top', 'bottom', 'left', 'right']}>
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 4 }}><Text style={styles.title}>Recortar imagen</Text><Text style={styles.subtitle}>Imagen {request.index + 1} de {request.total} · Recorte libre</Text></View>
        <IconButton icon={X} label="Cancelar digitalización" onPress={cancel} />
      </View>
      <Text style={styles.instruction}>Arrastra los bordes o las esquinas. Mueve el recuadro para elegir el área que quieres conservar.</Text>
      <View style={styles.stage} onLayout={event => setViewport({ width: event.nativeEvent.layout.width, height: event.nativeEvent.layout.height })}>
        <Image source={{ uri: request.source.uri }} style={frame ? [styles.image, frame] : styles.loadingImage} contentFit="contain" cachePolicy="none" allowDownscaling pointerEvents="none" accessibilityLabel="Imagen que vas a recortar"
          onLoad={event => {
            if (dimensions.width <= 0 || dimensions.height <= 0) setDimensions({ width: event.source.width, height: event.source.height });
            setReady(true);
          }} onError={() => { setError(true); setReady(false); }} />
        {ready && frame && selection && <>
          <View pointerEvents="none" style={[styles.shade, { left: frame.left, top: frame.top, width: frame.width, height: selection.top - frame.top }]} />
          <View pointerEvents="none" style={[styles.shade, { left: frame.left, top: selection.top + selection.height, width: frame.width, height: frame.top + frame.height - selection.top - selection.height }]} />
          <View pointerEvents="none" style={[styles.shade, { left: frame.left, top: selection.top, width: selection.left - frame.left, height: selection.height }]} />
          <View pointerEvents="none" style={[styles.shade, { left: selection.left + selection.width, top: selection.top, width: frame.left + frame.width - selection.left - selection.width, height: selection.height }]} />
          <CropControl handle="move" label="Mover el área de recorte" style={[styles.selection, selection]} getCrop={getCrop} onDrag={onDrag}>
            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              {[1, 2].map(line => <View key={`v${line}`} style={[styles.gridLine, { left: `${line * 100 / 3}%`, top: 0, bottom: 0, width: 1 }]} />)}
              {[1, 2].map(line => <View key={`h${line}`} style={[styles.gridLine, { top: `${line * 100 / 3}%`, left: 0, right: 0, height: 1 }]} />)}
            </View>
          </CropControl>
          {handles.map(({ handle, x, y, label }) => <CropControl key={handle} handle={handle} label={label} getCrop={getCrop} onDrag={onDrag}
            style={[styles.handle, { left: selection.left + x * selection.width - 24, top: selection.top + y * selection.height - 24 }]}>
            <View pointerEvents="none" style={[styles.grip, handle.length > 6 ? styles.cornerGrip : x === 0.5 ? styles.horizontalGrip : styles.verticalGrip]} />
          </CropControl>)}
        </>}
        {!ready && <View style={styles.loading}>{error ? <Text accessibilityRole="alert" style={styles.error}>No se pudo mostrar la imagen. Cancela y vuelve a seleccionarla.</Text> : <ActivityIndicator color="white" size="large" />}</View>}
      </View>
      <View style={styles.footer}>
        <Button label="Restablecer" icon={RotateCcw} secondary onPress={() => changeCrop(fullImageCrop)} disabled={!ready} />
        <Button label={request.index + 1 === request.total ? 'Usar recorte' : 'Siguiente imagen'} icon={Check} onPress={confirm} disabled={!ready || !frame} />
      </View>
    </SafeAreaView>
  </CenteredDialog>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FAFBF7', paddingTop: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 22, paddingBottom: 12 },
  title: { color: '#273B30', fontSize: 23, fontWeight: '600' },
  subtitle: { color: '#77857A', fontSize: 13 },
  instruction: { color: '#627267', fontSize: 14, lineHeight: 20, paddingHorizontal: 22, paddingBottom: 18 },
  stage: { flex: 1, minHeight: 120, backgroundColor: '#202B25', overflow: 'hidden' },
  image: { position: 'absolute' },
  loadingImage: { position: 'absolute', top: 32, left: 32, right: 32, bottom: 32 },
  shade: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.58)' },
  selection: { position: 'absolute', borderColor: 'white', borderWidth: 2 },
  gridLine: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.35)' },
  handle: { position: 'absolute', width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  grip: { backgroundColor: 'white', borderColor: green, borderWidth: 2, borderRadius: 4 },
  cornerGrip: { width: 18, height: 18 },
  horizontalGrip: { width: 26, height: 10 },
  verticalGrip: { width: 10, height: 26 },
  loading: { ...StyleSheet.absoluteFill, justifyContent: 'center', alignItems: 'center', padding: 24 },
  error: { color: 'white', textAlign: 'center', fontSize: 14, lineHeight: 22 },
  footer: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 12, padding: 18 },
});
