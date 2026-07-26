const fs = require('fs');
const path = require('path');

const MODELS_DIR = path.join(__dirname, 'models');
const BASE_URL = 'https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights/';

const files = [
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model-shard1',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model-shard1',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model-shard1'
];

async function downloadFile(fileName) {
  const fileUrl = `${BASE_URL}${fileName}`;
  const destPath = path.join(MODELS_DIR, fileName);

  console.log(`Downloading ${fileName}...`);
  const response = await fetch(fileUrl);
  if (!response.ok) {
    throw new Error(`Failed to download ${fileName}: ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  fs.writeFileSync(destPath, Buffer.from(buffer));
  console.log(`Saved ${fileName} successfully.`);
}

async function main() {
  if (!fs.existsSync(MODELS_DIR)) {
    fs.mkdirSync(MODELS_DIR, { recursive: true });
    console.log('Created models directory.');
  }

  console.log('Starting model download from GitHub Raw...');
  for (const file of files) {
    try {
      await downloadFile(file);
    } catch (error) {
      console.error(`Error downloading ${file}:`, error.message);
      process.exit(1);
    }
  }
  console.log('\nAll models downloaded successfully!');
}

main();
