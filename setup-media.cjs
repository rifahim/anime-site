const fs = require('node:fs');
const path = require('node:path');

const mediaDir = path.join(__dirname, 'public', 'media');
if (!fs.existsSync(mediaDir)) {
  fs.mkdirSync(mediaDir, { recursive: true });
}

// Write sample local info file
const sampleMeta = {
  title: "Local Demo Video",
  description: "Place your own owned or permissioned .mp4/.m3u8 files in public/media/ to test playback without opening folders.",
  fileUrl: "/media/sample.mp4"
};

const metaPath = path.join(mediaDir, 'index.json');
if (!fs.existsSync(metaPath)) {
  fs.writeFileSync(metaPath, JSON.stringify(sampleMeta, null, 2));
}

console.log('Local media directory ready at public/media/');
