/** Photos from a phone camera run 4–12 MB; the invoice behind them is readable at a fraction. */
export const PHOTO_TARGET_BYTES = 2 * 1024 * 1024

const MAX_SIDE = 2400
const MIN_SIDE = 900
const QUALITIES = [0.85, 0.75, 0.65, 0.55]

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() }
    } catch {
      /* Fall through to an <img>: some engines refuse the options bag. */
    }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      close: () => URL.revokeObjectURL(url),
    }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
}

function jpegName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, '') || 'foto'
  return `${base}.jpg`
}

/**
 * Shrink a camera photo below `target` bytes by drawing it on a canvas and re-encoding it
 * as JPEG. Anything that is not an image, is already small enough, or the browser cannot
 * decode (HEIC outside Safari) comes back untouched: the server still takes it up to its
 * own limit, and a photo that is too big stays the person's to retry.
 */
export async function compressImage(file: File, target = PHOTO_TARGET_BYTES): Promise<File> {
  if (!file.type.startsWith('image/') || file.size <= target) return file
  let decoded: Awaited<ReturnType<typeof decode>>
  try {
    decoded = await decode(file)
  } catch {
    return file
  }
  try {
    let longest = Math.min(MAX_SIDE, Math.max(decoded.width, decoded.height))
    let best: Blob | null = null
    while (longest >= MIN_SIDE) {
      const scale = Math.min(1, longest / Math.max(decoded.width, decoded.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(decoded.width * scale))
      canvas.height = Math.max(1, Math.round(decoded.height * scale))
      const context = canvas.getContext('2d')
      if (!context) return file
      context.fillStyle = '#fff'
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height)
      for (const quality of QUALITIES) {
        const blob = await toBlob(canvas, quality)
        if (!blob) return file
        if (!best || blob.size < best.size) best = blob
        if (blob.size <= target) return new File([blob], jpegName(file.name), { type: 'image/jpeg', lastModified: Date.now() })
      }
      longest = Math.round(longest * 0.8)
    }
    if (best && best.size < file.size) {
      return new File([best], jpegName(file.name), { type: 'image/jpeg', lastModified: Date.now() })
    }
    return file
  } finally {
    decoded.close()
  }
}
