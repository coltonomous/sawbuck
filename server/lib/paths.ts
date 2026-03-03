import path from 'path';
import { fileURLToPath } from 'url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const DB_PATH = path.join(DATA_DIR, 'sawbuck.db');
export const IMAGES_DIR = path.join(DATA_DIR, 'images');
export const ORIGINALS_DIR = path.join(IMAGES_DIR, 'originals');
export const RESIZED_DIR = path.join(IMAGES_DIR, 'resized');
export const PROJECT_PHOTOS_DIR = path.join(IMAGES_DIR, 'projects');
