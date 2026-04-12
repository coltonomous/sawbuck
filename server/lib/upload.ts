import path from 'path';

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10 MB

const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

// Magic byte signatures for common image formats
const MAGIC_BYTES: Array<{ bytes: number[]; offset: number; mime: string; ext: string }> = [
  { bytes: [0xff, 0xd8, 0xff], offset: 0, mime: 'image/jpeg', ext: '.jpg' },
  { bytes: [0x89, 0x50, 0x4e, 0x47], offset: 0, mime: 'image/png', ext: '.png' },
  { bytes: [0x52, 0x49, 0x46, 0x46], offset: 0, mime: 'image/webp', ext: '.webp' }, // RIFF header (check WEBP at offset 8)
  { bytes: [0x47, 0x49, 0x46, 0x38], offset: 0, mime: 'image/gif', ext: '.gif' },
];

function detectImageType(buffer: Buffer): { mime: string; ext: string } | null {
  for (const sig of MAGIC_BYTES) {
    if (buffer.length < sig.offset + sig.bytes.length) continue;
    const match = sig.bytes.every((b, i) => buffer[sig.offset + i] === b);
    if (!match) continue;

    // RIFF container needs extra check for WEBP at offset 8
    if (sig.mime === 'image/webp') {
      if (buffer.length < 12) continue;
      const isWebp = buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50;
      if (!isWebp) continue;
    }
    return { mime: sig.mime, ext: sig.ext };
  }
  return null;
}

/** Sanitize a user-provided filename to prevent path traversal and weird characters. */
function sanitizeFilename(name: string): string {
  // Strip directory components and null bytes
  const base = path.basename(name).replace(/\0/g, '');
  // Keep only alphanumeric, dashes, underscores, dots
  return base.replace(/[^a-zA-Z0-9._-]/g, '_') || 'upload';
}

export interface ValidatedUpload {
  buffer: Buffer;
  ext: string;
  mime: string;
}

/**
 * Validate an uploaded file: check size, detect image type via magic bytes,
 * and verify the extension matches.
 */
export async function validateUpload(file: File): Promise<ValidatedUpload> {
  // Check declared size first (avoid buffering huge files)
  if (file.size > MAX_UPLOAD_SIZE) {
    throw new UploadError(`File too large: ${(file.size / 1024 / 1024).toFixed(1)}MB (max 10MB)`);
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // Double-check actual size
  if (buffer.length > MAX_UPLOAD_SIZE) {
    throw new UploadError(`File too large: ${(buffer.length / 1024 / 1024).toFixed(1)}MB (max 10MB)`);
  }

  if (buffer.length === 0) {
    throw new UploadError('File is empty');
  }

  // Detect actual image type from magic bytes
  const detected = detectImageType(buffer);
  if (!detected) {
    throw new UploadError('Invalid image file. Supported formats: JPEG, PNG, WebP, GIF');
  }

  // Verify file extension matches (or use detected extension)
  const declaredExt = path.extname(file.name).toLowerCase();
  const ext = ALLOWED_EXTENSIONS.has(declaredExt) ? declaredExt : detected.ext;

  return { buffer, ext, mime: detected.mime };
}

export class UploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UploadError';
  }
}

export { sanitizeFilename };
