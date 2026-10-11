import { useCallback, useEffect, useRef, useState } from 'react';
import type { CropImageSource, PixelCrop } from '@/lib/image-crop';

export type ImageCropRequest = {
  source: CropImageSource;
  index: number;
  total: number;
  complete: (crop: PixelCrop | null) => void;
};

export function useImageCrop() {
  const [cropRequest, setCropRequest] = useState<ImageCropRequest | null>(null);
  const pending = useRef<((crop: PixelCrop | null) => void) | null>(null);
  const mounted = useRef(true);
  const cropPhoto = useCallback((source: CropImageSource, index: number, total: number, signal?: AbortSignal) => new Promise<PixelCrop | null>(resolve => {
    pending.current?.(null);
    if (!mounted.current || signal?.aborted) { resolve(null); return; }
    const cancel = () => complete(null);
    const complete = (crop: PixelCrop | null) => {
      if (pending.current !== complete) return;
      pending.current = null;
      signal?.removeEventListener('abort', cancel);
      setCropRequest(null);
      resolve(crop);
    };
    pending.current = complete;
    signal?.addEventListener('abort', cancel, { once: true });
    setCropRequest({ source, index, total, complete });
  }), []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; pending.current?.(null); };
  }, []);
  return { cropRequest, cropPhoto };
}
