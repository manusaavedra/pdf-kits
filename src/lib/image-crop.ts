export type ImageSize = { width: number; height: number };
export type CropImageSource = ImageSize & { uri: string };
export type CropRectangle = { x: number; y: number; width: number; height: number };
export type PixelCrop = { originX: number; originY: number; width: number; height: number };
export type CropHandle = 'move' | 'top' | 'bottom' | 'left' | 'right' | 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight';

export const fullImageCrop: CropRectangle = { x: 0, y: 0, width: 1, height: 1 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function fitCropImage(image: ImageSize, viewport: ImageSize, padding = 32) {
  if (image.width <= 0 || image.height <= 0 || viewport.width <= padding * 2 || viewport.height <= padding * 2) return null;
  const scale = Math.min((viewport.width - padding * 2) / image.width, (viewport.height - padding * 2) / image.height);
  const width = image.width * scale, height = image.height * scale;
  return { left: (viewport.width - width) / 2, top: (viewport.height - height) / 2, width, height };
}

// Keep the selection relative to the image, so layout changes never change the crop.
export function dragCrop(start: CropRectangle, handle: CropHandle, dx: number, dy: number, display: ImageSize): CropRectangle {
  if (display.width <= 0 || display.height <= 0) return start;
  const x = dx / display.width, y = dy / display.height;
  if (handle === 'move') return { ...start, x: clamp(start.x + x, 0, 1 - start.width), y: clamp(start.y + y, 0, 1 - start.height) };
  const minWidth = Math.min(1, 64 / display.width), minHeight = Math.min(1, 64 / display.height);
  let left = start.x, top = start.y, right = start.x + start.width, bottom = start.y + start.height;
  if (handle === 'left' || handle === 'topLeft' || handle === 'bottomLeft') left = clamp(left + x, 0, right - minWidth);
  if (handle === 'right' || handle === 'topRight' || handle === 'bottomRight') right = clamp(right + x, left + minWidth, 1);
  if (handle === 'top' || handle === 'topLeft' || handle === 'topRight') top = clamp(top + y, 0, bottom - minHeight);
  if (handle === 'bottom' || handle === 'bottomLeft' || handle === 'bottomRight') bottom = clamp(bottom + y, top + minHeight, 1);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function cropToPixels(crop: CropRectangle, image: ImageSize): PixelCrop {
  const imageWidth = Math.max(1, Math.round(image.width)), imageHeight = Math.max(1, Math.round(image.height));
  const originX = clamp(Math.round(crop.x * imageWidth), 0, imageWidth - 1);
  const originY = clamp(Math.round(crop.y * imageHeight), 0, imageHeight - 1);
  const right = clamp(Math.round((crop.x + crop.width) * imageWidth), originX + 1, imageWidth);
  const bottom = clamp(Math.round((crop.y + crop.height) * imageHeight), originY + 1, imageHeight);
  return { originX, originY, width: right - originX, height: bottom - originY };
}
