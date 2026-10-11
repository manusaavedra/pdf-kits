import { PDFDocument } from 'pdf-lib';
import { selectPdfs } from './pdf-picker';
import { importPdfAssets, type ImportProgress } from './import-progress';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Platform } from 'react-native';
import { readUri, readDocumentBytes, type SavedDocument } from './storage';
import { makeDocument, mergeDocuments as merge } from './pdf-engine';
import type { CropImageSource, PixelCrop } from './image-crop';
export { blankDocument, editDocument, makeDocument } from './pdf-engine';
export const mergeDocuments = (docs: SavedDocument[], options: { blankBetweenDocuments?: boolean } = {}) => merge(docs, { ...options, readBytes: readDocumentBytes });
export type { PageEdit } from './pdf-engine';
export async function pickPdfs(options: { signal?: AbortSignal; onProgress?: (progress: ImportProgress) => void } = {}) {
  options.onProgress?.({ phase: 'selecting', completed: 0, total: 0 });
  const result = await selectPdfs(options.signal);
  if (result.canceled) return [];
  return importPdfAssets(result.assets, readUri, makeDocument, options);
}
export async function scanPhotos(camera: boolean, options: {
  cropPhoto: (source: CropImageSource, index: number, total: number) => Promise<PixelCrop | null>;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}) {
  if (camera && Platform.OS !== 'web') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new Error('Activa el permiso de cámara en los ajustes para digitalizar documentos.');
  }
  const result = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: false, quality: 0.9 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: false, allowsMultipleSelection: true, orderedSelection: true, selectionLimit: 30, quality: 0.9 });
  if (result.canceled || options.signal?.aborted) return null;
  const photos: { source: CropImageSource; crop: PixelCrop }[] = [];
  for (const [index, source] of result.assets.entries()) {
    const crop = await options.cropPhoto(source, index, result.assets.length);
    if (!crop || options.signal?.aborted) return null;
    photos.push({ source, crop });
  }
  // Finish choosing all crops before allocating or embedding any PDF image data.
  options.onProgress?.(0, photos.length);
  const pdf = await PDFDocument.create();
  for (const [index, { source, crop }] of photos.entries()) {
    if (options.signal?.aborted) return null;
    const context = ImageManipulator.manipulate(source.uri);
    let rendered: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
    try {
      context.crop(crop);
      if (Math.max(crop.width, crop.height) > 2000) context.resize(crop.width >= crop.height ? { width: 2000 } : { height: 2000 });
      rendered = await context.renderAsync();
      const image = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
      if (options.signal?.aborted) return null;
      const embedded = await pdf.embedJpg(image.base64!); const page = pdf.addPage([595.28, 841.89]);
      const scale = Math.min(555.28 / embedded.width, 801.89 / embedded.height);
      const width = embedded.width * scale; const height = embedded.height * scale;
      page.drawImage(embedded, { x: (595.28 - width) / 2, y: (841.89 - height) / 2, width, height });
      options.onProgress?.(index + 1, photos.length);
    } finally {
      rendered?.release();
      context.release();
    }
  }
  return makeDocument(await pdf.save(), `Digitalización ${new Date().toLocaleDateString('es-ES').replaceAll('/', '-')}`, 'scan');
}
