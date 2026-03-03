import fs from 'fs';
import path from 'path';
import { analyzeWithVision, type ImageInput } from '../server/lib/claude.js';

const imagePath = process.argv[2];
if (!imagePath) {
  console.error('Usage: npx tsx scripts/test-vision.ts <image_path>');
  console.error('Example: npx tsx scripts/test-vision.ts ./test-dresser.jpg');
  process.exit(1);
}

const fullPath = path.resolve(imagePath);
if (!fs.existsSync(fullPath)) {
  console.error(`Image not found: ${fullPath}`);
  process.exit(1);
}

async function main() {
  console.log(`Analyzing: ${fullPath}\n`);

  const buffer = fs.readFileSync(fullPath);
  const base64 = buffer.toString('base64');
  const ext = path.extname(fullPath).toLowerCase();
  const mediaType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';

  const images: ImageInput[] = [{ base64, mediaType: mediaType as ImageInput['mediaType'] }];

  const response = await analyzeWithVision(
    images,
    `Analyze this furniture piece. Return a JSON object with: furniture_type, furniture_style, condition_score (1-10), condition_notes, wood_species (or null), wood_confidence (0-1), notable_features (array), damage_items (array), refinishing_potential (high/medium/low), flip_recommendation (strong_buy/buy/maybe/pass)`,
    'You are a professional furniture appraiser. Respond with ONLY valid JSON.',
  );

  try {
    let jsonStr = response.trim();
    const match = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (match) jsonStr = match[1].trim();
    const parsed = JSON.parse(jsonStr);
    console.log(JSON.stringify(parsed, null, 2));
  } catch {
    console.log('Raw response:');
    console.log(response);
  }
}

main().catch(console.error);
