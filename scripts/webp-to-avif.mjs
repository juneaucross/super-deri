import sharp from "sharp";
import { readdirSync, existsSync } from "fs";
import path from "path";

const VIDEO_DIR = "public/videos";
const files = readdirSync(VIDEO_DIR).filter((f) => f.endsWith("_poster.webp"));

for (const file of files) {
  const inputPath = path.join(VIDEO_DIR, file);
  const outputPath = path.join(VIDEO_DIR, file.replace("_poster.webp", "_poster.avif"));

  if (existsSync(outputPath)) {
    console.log(`⏩ Skipping ${file} (already converted)`);
    continue;
  }

  console.log(`🎬 Converting ${file} → ${path.basename(outputPath)}`);
  await sharp(inputPath)
    .avif({ quality: 45, effort: 4 }) // качество можно настроить
    .toFile(outputPath);
  console.log(`  ✅ ${outputPath}`);
}

console.log("✨ All AVIF posters generated.");
