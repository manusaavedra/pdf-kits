import * as DocumentPicker from 'expo-document-picker';
import { abortable } from './import-progress';
export function selectPdfs(signal?: AbortSignal) {
  return abortable(DocumentPicker.getDocumentAsync({ type: 'application/pdf', multiple: true, copyToCacheDirectory: true, base64: false }), signal);
}
