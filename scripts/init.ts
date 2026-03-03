import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');

const dirs = [
  'data',
  'data/images',
  'data/images/originals',
  'data/images/resized',
];

for (const dir of dirs) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) {
    fs.mkdirSync(full, { recursive: true });
    console.log(`Created ${dir}/`);
  }
}

// Create .gitkeep files
for (const dir of ['data/images/originals', 'data/images/resized']) {
  const keepFile = path.join(root, dir, '.gitkeep');
  if (!fs.existsSync(keepFile)) {
    fs.writeFileSync(keepFile, '');
  }
}

console.log('Directories initialized.');
console.log('Run "npm run db:generate && npm run db:migrate" to set up the database.');
