/**
 * Client-side image compression before upload.
 * - Resizes to fit within maxDimension × maxDimension (maintains aspect ratio)
 * - Converts to WebP at the configured quality
 * - Typical result: a 4MB JPEG → ~200–400 KB WebP
 *
 * Falls back to the original file if canvas processing fails.
 */

const MAX_DIMENSION = 1920;
const WEBP_QUALITY = 0.82;

export async function compressImage(file: File): Promise<File> {
  // Skip non-image files or GIFs (preserve animation)
  if (!file.type.startsWith('image/') || file.type === 'image/gif') {
    return file;
  }

  return new Promise((resolve) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) { resolve(file); return; }
      ctx.drawImage(img, 0, 0, w, h);

      canvas.toBlob(
        (blob) => {
          if (!blob) { resolve(file); return; }
          const name = file.name.replace(/\.[^.]+$/, '.webp');
          resolve(new File([blob], name, { type: 'image/webp' }));
        },
        'image/webp',
        WEBP_QUALITY,
      );
    };

    img.onerror = () => { URL.revokeObjectURL(objectUrl); resolve(file); };
    img.src = objectUrl;
  });
}
