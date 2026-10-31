import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const HOST = process.env.HOST || '127.0.0.1';
export const PORT = Number(process.env.PORT) || 3000;
export const DB_PATH = process.env.DB_PATH || path.join(root, 'data', 'flix.db');
