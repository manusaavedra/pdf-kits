import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Keyboard, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import type { ViewToken } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, ArrowRight, Check, ChevronLeft, FileText, Plus, RotateCw, Save, Trash2, Type, X } from 'lucide-react-native';
import { useLibrary } from '@/lib/library';
import { retainDocuments, type SavedDocument } from '@/lib/storage';
import { pickPdfs, scanPhotos } from '@/lib/pdf';
import { insertDocumentPages, type EditorPage } from '@/lib/editor-pages';
import type { ImportProgress } from '@/lib/import-progress';
import { useImageCrop } from '@/hooks/use-image-crop';
import { ImageCropDialog } from '@/components/image-crop-dialog';
import { OperationDialog } from '@/components/operation-dialog';
import { EditorAddPagesDialog, type AddPagesSource } from '@/components/editor-add-pages-dialog';
import { saveEditorDocument } from '@/lib/editor-save';
import type { EditorSaveProgress } from '@/lib/save-progress';
import { EditorSaveDialog } from '@/components/editor-save-dialog';
import PdfLivePreview from '@/components/pdf-live-preview';
import { Button, IconButton } from '@/components/pdf-ui';
import { green } from '@/components/pdf-styles';

const initialPages = (doc: SavedDocument): EditorPage[] => Array.from({ length: doc.pages }, (_, source) => ({ key: `${doc.updated}-${source}`, source, rotation: 0, text: '' }));
const stripViewability = { itemVisiblePercentThreshold: 1, minimumViewTime: 100 };

export default function EditorRoute() {
  const { id, blank } = useLocalSearchParams<{ id: string; blank?: string }>();
  const { documents, loaded, error } = useLibrary();
  const doc = documents.find(document => document.id === id);
  if (!loaded) return <SafeAreaView style={e.loading}><ActivityIndicator color={green} /></SafeAreaView>;
  if (!doc) return <SafeAreaView style={e.loading}><Text style={e.hint}>{error || 'Este documento ya no está en tu biblioteca.'}</Text><Button label="Volver a mis documentos" onPress={() => router.replace('/')} /></SafeAreaView>;
  return <EditorWorkspace key={doc.id} document={doc} addBlank={blank === '1'} />;
}

function EditorWorkspace({ document, addBlank }: { document: SavedDocument; addBlank: boolean }) {
  const { documents, commit } = useLibrary();
  const compact = useWindowDimensions().width < 650;
  const [source, setSource] = useState(document);
  const [pages, setPages] = useState<EditorPage[]>(() => [...initialPages(document), ...(addBlank ? [{ key: 'initial-blank', source: null, rotation: 0, text: '' }] : [])]);
  const [selected, setSelected] = useState(addBlank ? document.pages : 0);
  const [name, setName] = useState(document.name);
  const [dirty, setDirty] = useState(addBlank);
  const [saving, setSaving] = useState(false);
  const [showAddPages, setShowAddPages] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addProgress, setAddProgress] = useState<ImportProgress | null>(null);
  const [addTitle, setAddTitle] = useState('Añadiendo páginas');
  const [sources, setSources] = useState<SavedDocument[]>([]);
  const addingRef = useRef(false);
  const addOperation = useRef<AbortController | null>(null);
  const { cropRequest, cropPhoto } = useImageCrop();
  const busy = saving || adding;
  const [saveProgress, setSaveProgress] = useState<EditorSaveProgress>({ percentage: 0, detail: 'Preparando el guardado…' });
  const savingRef = useRef(false);
  const [error, setError] = useState('');
  const [showText, setShowText] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
  const [thumbnailPages, setThumbnailPages] = useState<number[]>([]);
  const strip = useRef<FlatList<EditorPage>>(null);
  useEffect(() => () => addOperation.current?.abort(), []);
  useEffect(() => { strip.current?.scrollToIndex({ index: selected, animated: true, viewPosition: 0.5 }); }, [selected, pages.length]);
  const visiblePages = useCallback(({ viewableItems }: { viewableItems: ViewToken<EditorPage>[] }) => {
    const next = viewableItems.flatMap(item => item.index === null ? [] : [item.index + 1]);
    setThumbnailPages(previous => previous.length === next.length && previous.every((page, index) => page === next[index]) ? previous : next);
  }, []);
  const goBack = () => router.canGoBack() ? router.back() : router.replace('/');
  const thumbnail = useCallback((_page: number, uri: string, key: string) => { setThumbnails(previous => previous[key] === uri ? previous : { ...previous, [key]: uri }); }, []);
  const select = useCallback((index: number) => {
    if (index < 0 || index >= pages.length) return;
    setSelected(index);
  }, [pages.length]);
  const onViewerPage = useCallback((page: number) => select(page - 1), [select]);
  function update(next: EditorPage[], index = selected) {
    if (next.length < pages.length) {
      const remaining = new Set(next.map(page => page.key));
      setThumbnails(previous => Object.fromEntries(Object.entries(previous).filter(([key]) => remaining.has(key))));
    }
    setPages(next); setSelected(index); setDirty(true); setError('');
    setSources(previous => previous.filter(doc => next.some(page => page.documentId === doc.id)));
  }
  function move(direction: number) {
    const index = selected + direction; if (index < 0 || index >= pages.length) return;
    const next = [...pages]; [next[selected], next[index]] = [next[index], next[selected]];
    update(next, index);
  }
  function insertBlank() {
    setShowAddPages(false);
    const next = [...pages]; next.splice(selected + 1, 0, { key: `blank-${Date.now()}`, source: null, rotation: 0, text: '' });
    update(next, selected + 1);
  }
  async function addPages(choice: AddPagesSource) {
    if (addingRef.current || savingRef.current) return;
    if (choice === 'blank') { insertBlank(); return; }
    Keyboard.dismiss(); setShowAddPages(false); addingRef.current = true; setAdding(true); setError('');
    const controller = new AbortController(); addOperation.current = controller;
    setAddTitle(choice === 'pdf' ? 'Añadiendo PDF' : 'Añadiendo imágenes');
    setAddProgress({ phase: 'selecting', completed: 0, total: 0, detail: choice === 'pdf' ? 'Selecciona el PDF que quieres añadir.' : 'Selecciona las imágenes en la cámara o la galería.' });
    try {
      let documents: SavedDocument[];
      if (choice === 'pdf') documents = await pickPdfs({ signal: controller.signal, onProgress: setAddProgress });
      else {
        const scanned = await scanPhotos(choice === 'camera', {
          signal: controller.signal,
          cropPhoto: (source, index, total) => cropPhoto(source, index, total, controller.signal),
          onProgress: (completed, total) => setAddProgress({ phase: 'checking', completed, total, detail: `Preparando imagen ${Math.min(completed + 1, total)} de ${total}…` }),
        });
        documents = scanned ? [scanned] : [];
      }
      if (controller.signal.aborted || !documents.length) return;
      const imported = retainDocuments(documents);
      const next = insertDocumentPages(pages, selected, imported);
      update(next.pages, next.selected);
      setSources(previous => [...previous, ...imported]);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'No se pudieron añadir las páginas.');
    } finally { addingRef.current = false; addOperation.current = null; setAdding(false); setAddProgress(null); }
  }
  async function save() {
    if (savingRef.current || addingRef.current) return;
    Keyboard.dismiss();
    savingRef.current = true; setSaving(true); setError('');
    try {
      const result = await saveEditorDocument(source, pages, name, documents, commit, setSaveProgress, sources);
      setSource(result); setPages(initialPages(result)); setSources([]); setThumbnails({}); setDirty(false);
      router.setParams({ blank: '0' });
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'No se pudieron guardar los cambios.'); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <SafeAreaView style={e.root}>
    <View style={[e.header, compact && { paddingHorizontal: 12, gap: 8 }]}>
      <IconButton icon={ChevronLeft} label="Volver a la biblioteca" disabled={busy} onPress={() => dirty ? setConfirmClose(true) : goBack()} />
      {!compact && <View style={e.fileIcon}><FileText size={24} color={green} /></View>}
      <View style={{ flex: 1 }}><Text style={e.eyebrow}>EDITOR DE PDF</Text><TextInput accessibilityLabel="Nombre del documento" value={name} onChangeText={value => { setName(value); setDirty(true); }} editable={!busy} maxLength={100} style={[e.name, compact && { fontSize: 15 }]} /></View>
      {!compact && <View style={e.status}><View style={[e.dot, dirty && { backgroundColor: '#B79050' }]} /><Text style={e.hint}>{dirty ? 'Cambios sin guardar' : 'Todo guardado'}</Text></View>}
      <Button label={saving ? 'Guardando…' : 'Guardar'} icon={saving ? undefined : Save} onPress={save} disabled={busy || !name.trim() || !dirty} />
    </View>
    {error !== '' && <View style={e.error}><Text accessibilityRole="alert" style={{ flex: 1, color: '#A44F4F', fontSize: 12 }}>{error}</Text><IconButton icon={X} label="Cerrar aviso" onPress={() => setError('')} /></View>}
    <View style={e.tools}><Text style={e.pageLabel}>Página {selected + 1} de {pages.length}</Text><View style={e.toolGroup}><Pressable disabled={busy} onPress={() => setShowText(value => !value)} style={[e.textTool, showText && { backgroundColor: '#E5ECDD' }]}><Type size={17} color={green} /><Text style={e.toolLabel}>Añadir texto</Text></Pressable><IconButton icon={RotateCw} label="Girar la página seleccionada" disabled={busy} onPress={() => update(pages.map((page, index) => index === selected ? { ...page, rotation: (page.rotation + 90) % 360 } : page))} /></View></View>
    {showText && <View style={e.textPanel}><Type size={16} color={green} /><TextInput accessibilityLabel={`Texto de la página ${selected + 1}`} placeholder="Escribe una nota para la parte superior de esta página…" value={pages[selected].text} onChangeText={text => update(pages.map((page, index) => index === selected ? { ...page, text } : page))} editable={!busy} multiline maxLength={800} style={e.textInput} /><IconButton icon={X} label="Cerrar herramienta de texto" onPress={() => setShowText(false)} /></View>}
    <View style={[e.center, compact && { padding: 12 }]}>{!busy && <PdfLivePreview doc={source} sources={sources} pages={pages} name={name} page={selected + 1} thumbnailPages={thumbnailPages} onPageChange={onViewerPage} onThumbnail={thumbnail} />}</View>
    <View style={e.sidebar}>
      <View style={[e.stripHeader, compact && { paddingHorizontal: 12 }]}><View><Text style={e.stripTitle}>{compact ? 'Páginas' : 'Páginas del documento'}</Text>{!compact && <Text style={e.hint}>Selecciona una página para verla · usa las flechas para cambiar su orden</Text>}</View><View style={e.toolGroup}><IconButton icon={ArrowLeft} label="Mover la página antes" disabled={busy || selected === 0} onPress={() => move(-1)} /><IconButton icon={ArrowRight} label="Mover la página después" disabled={busy || selected === pages.length - 1} onPress={() => move(1)} /><IconButton icon={Trash2} label="Eliminar la página seleccionada" disabled={busy || pages.length === 1} onPress={() => update(pages.filter((_, index) => index !== selected), Math.min(selected, pages.length - 2))} /><Button label="Añadir" icon={Plus} secondary onPress={() => setShowAddPages(true)} disabled={busy} /></View></View>
      <FlatList
        style={{ height: 128, flexGrow: 0 }} ref={strip} horizontal data={pages}
        onViewableItemsChanged={visiblePages} viewabilityConfig={stripViewability}
        keyExtractor={page => page.key} extraData={{ selected, thumbnails }} contentContainerStyle={e.strip} showsHorizontalScrollIndicator
        getItemLayout={(_, index) => ({ length: 104, offset: 104 * index, index })} onScrollToIndexFailed={() => {}}
        renderItem={({ item, index }) => <Pressable accessibilityLabel={`Ver página ${index + 1}`} accessibilityRole="button" accessibilityState={{ selected: index === selected }} disabled={busy} onPress={() => select(index)} style={[e.thumbnail, index === selected && e.thumbnailSelected]}><View style={e.miniPage}>{thumbnails[item.key] ? <Image source={{ uri: thumbnails[item.key] }} resizeMode="contain" style={{ width: '100%', height: '100%' }} /> : item.source === null ? <Text style={e.blankLabel}>Hoja en blanco</Text> : <FileText size={30} color="#A1B298" strokeWidth={1} />}</View><View style={e.thumbFooter}><Text style={[e.thumbNumber, index === selected && { color: green, fontWeight: '700' }]}>{String(index + 1).padStart(2, '0')}</Text>{index === selected && <Check size={12} color={green} />}</View></Pressable>}
      />
    </View>
    <Modal visible={confirmClose} transparent animationType="fade" onRequestClose={() => setConfirmClose(false)}><View style={e.backdrop}><View style={e.dialog}><Text style={e.dialogTitle}>Tienes cambios sin guardar</Text><Text style={[e.hint, { lineHeight: 21, marginVertical: 16 }]}>Puedes seguir editando o salir y descartar estos cambios. El PDF guardado en tu biblioteca se conservará.</Text><View style={{ gap: 10 }}><Button label="Seguir editando" icon={ArrowLeft} onPress={() => setConfirmClose(false)} /><Button label="Descartar y salir" secondary onPress={goBack} /></View></View></View></Modal>
    <EditorAddPagesDialog visible={showAddPages && !busy} page={selected + 1} onClose={() => setShowAddPages(false)} onChoose={addPages} />
    <OperationDialog visible={adding && !cropRequest && (Platform.OS === 'web' || addProgress?.phase !== 'selecting')} progress={addProgress} title={addTitle} onCancel={() => addOperation.current?.abort()} />
    {cropRequest && <ImageCropDialog key={cropRequest.index} request={cropRequest} />}
    <EditorSaveDialog visible={saving} progress={saveProgress} />
  </SafeAreaView>;
}

const e = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#EDF1E8' }, loading: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 20, backgroundColor: '#FAFBF7' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 24, paddingVertical: 14, backgroundColor: '#FEFFFB', borderBottomWidth: 1, borderColor: '#DFE7D8' }, fileIcon: { width: 42, height: 44, borderRadius: 10, backgroundColor: '#EAF0E3', justifyContent: 'center', alignItems: 'center' }, eyebrow: { fontSize: 9, letterSpacing: 1.3, color: '#829778', marginBottom: 4 }, name: { color: '#354F39', fontSize: 19, fontWeight: '600', padding: 0 }, status: { flexDirection: 'row', alignItems: 'center', gap: 7 }, dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#779B67' }, hint: { color: '#89987C', fontSize: 11 },
  tools: { backgroundColor: '#F7F9F2', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, minHeight: 48, borderBottomWidth: 1, borderColor: '#E3EADD' }, toolGroup: { flexDirection: 'row', alignItems: 'center', gap: 4 }, pageLabel: { color: '#778D68', fontSize: 12 }, textTool: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 6, paddingHorizontal: 12, height: 38 }, toolLabel: { color: green, fontSize: 11 }, textPanel: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, gap: 10, backgroundColor: '#FEFFFB', borderBottomWidth: 1, borderColor: '#DFE7D8' }, textInput: { flex: 1, minHeight: 54, maxHeight: 100, fontSize: 13, color: '#365638', paddingVertical: 12 },
  center: { flex: 1, paddingHorizontal: 28, paddingVertical: 16, minHeight: 120 }, sidebar: { backgroundColor: '#FEFFFB', borderTopWidth: 1, borderColor: '#D7E2CD', paddingBottom: 8 }, stripHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingHorizontal: 24, paddingVertical: 9 }, stripTitle: { color: '#3D5739', fontSize: 13, fontWeight: '600', marginBottom: 4 }, strip: { paddingHorizontal: 24, paddingBottom: 4, gap: 12 }, thumbnail: { width: 92, borderWidth: 1, borderColor: '#DDE5D5', borderRadius: 8, padding: 6, backgroundColor: '#F5F7F0' }, thumbnailSelected: { borderColor: green, backgroundColor: '#EBF1E4', borderWidth: 2, padding: 5 }, miniPage: { height: 87, width: '100%', backgroundColor: 'white', borderRadius: 3, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }, blankLabel: { color: '#B0BCA6', fontSize: 9, textAlign: 'center' }, thumbFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 5, paddingTop: 7, paddingBottom: 2 }, thumbNumber: { fontSize: 10, color: '#92A186' },
  error: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, backgroundColor: '#FFF4EF' }, backdrop: { flex: 1, backgroundColor: '#21352266', alignItems: 'center', justifyContent: 'center', padding: 24 }, dialog: { backgroundColor: '#FEFFFB', borderRadius: 16, padding: 24, width: '100%', maxWidth: 430 }, dialogTitle: { color: green, fontSize: 19, fontWeight: '600' },
});
