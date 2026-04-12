import { describe, it, expect } from 'vitest';
import { validateUpload, UploadError } from './upload.js';

function makeFile(bytes: number[], name: string, size?: number): File {
  const buffer = new Uint8Array(bytes);
  const blob = new Blob([buffer]);
  // Override size if provided (to test declared size check)
  const file = new File([blob], name);
  if (size !== undefined) {
    Object.defineProperty(file, 'size', { value: size });
  }
  return file;
}

// Minimal valid headers for each format
const JPEG_HEADER = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10];
const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF_HEADER = [0x47, 0x49, 0x46, 0x38, 0x39, 0x61];
// RIFF....WEBP
const WEBP_HEADER = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50];

describe('validateUpload', () => {
  it('accepts valid JPEG', async () => {
    const file = makeFile(JPEG_HEADER, 'photo.jpg');
    const result = await validateUpload(file);
    expect(result.mime).toBe('image/jpeg');
    expect(result.ext).toBe('.jpg');
  });

  it('accepts valid PNG', async () => {
    const file = makeFile(PNG_HEADER, 'photo.png');
    const result = await validateUpload(file);
    expect(result.mime).toBe('image/png');
    expect(result.ext).toBe('.png');
  });

  it('accepts valid WebP', async () => {
    const file = makeFile(WEBP_HEADER, 'photo.webp');
    const result = await validateUpload(file);
    expect(result.mime).toBe('image/webp');
    expect(result.ext).toBe('.webp');
  });

  it('accepts valid GIF', async () => {
    const file = makeFile(GIF_HEADER, 'animation.gif');
    const result = await validateUpload(file);
    expect(result.mime).toBe('image/gif');
    expect(result.ext).toBe('.gif');
  });

  it('rejects empty file', async () => {
    const file = makeFile([], 'empty.jpg');
    await expect(validateUpload(file)).rejects.toThrow(UploadError);
    await expect(validateUpload(file)).rejects.toThrow('empty');
  });

  it('rejects invalid magic bytes', async () => {
    const file = makeFile([0x00, 0x00, 0x00, 0x00], 'fake.jpg');
    await expect(validateUpload(file)).rejects.toThrow(UploadError);
    await expect(validateUpload(file)).rejects.toThrow('Invalid image');
  });

  it('rejects file exceeding size limit', async () => {
    const file = makeFile(JPEG_HEADER, 'huge.jpg', 11 * 1024 * 1024);
    await expect(validateUpload(file)).rejects.toThrow(UploadError);
    await expect(validateUpload(file)).rejects.toThrow('too large');
  });

  it('uses detected extension when declared extension is invalid', async () => {
    const file = makeFile(PNG_HEADER, 'photo.exe');
    const result = await validateUpload(file);
    expect(result.ext).toBe('.png');
    expect(result.mime).toBe('image/png');
  });

  it('preserves valid declared extension matching format', async () => {
    const file = makeFile(JPEG_HEADER, 'photo.jpeg');
    const result = await validateUpload(file);
    expect(result.ext).toBe('.jpeg');
  });

  it('rejects RIFF container that is not WebP', async () => {
    // RIFF header but with "AVI " instead of "WEBP" at offset 8
    const avi = [0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x41, 0x56, 0x49, 0x20];
    const file = makeFile(avi, 'video.webp');
    await expect(validateUpload(file)).rejects.toThrow('Invalid image');
  });
});
