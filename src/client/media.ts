// Фото сжимаются на телефоне до 1920 px по длинной стороне, JPEG ~85%. Время съёмки — из EXIF.

export async function readTakenAt(file: File): Promise<string | null> {
  try {
    const exifr = (await import('exifr')).default;
    const r = await exifr.parse(file, ['DateTimeOriginal', 'CreateDate']);
    const d: unknown = r?.DateTimeOriginal ?? r?.CreateDate;
    return d instanceof Date && !isNaN(d.getTime()) ? d.toISOString() : null;
  } catch {
    return null;
  }
}

export function compressImage(file: File, maxSide = 1920, quality = 0.85): Promise<Blob> {
  return new Promise(resolve => {
    if (!file.type.startsWith('image/')) return resolve(file);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      const ctx = c.getContext('2d');
      if (!ctx) { URL.revokeObjectURL(url); return resolve(file); }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => resolve(b && (b.size < file.size || k < 1) ? b : file), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}
