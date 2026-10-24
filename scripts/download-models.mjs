import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';

const directory = fileURLToPath(new URL('../frontend/models/', import.meta.url));
const models = [
  { file: 'pose_landmarker_lite.task', url: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task', sha256: '59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a' },
  { file: 'face_landmarker.task', url: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task', sha256: '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff' },
];

const checksum = (bytes) => createHash('sha256').update(bytes).digest('hex');
const valid = (bytes, model) => checksum(bytes) === model.sha256;

await mkdir(directory, { recursive: true });
for (const model of models) {
  const destination = path.join(directory, model.file);
  try {
    if (valid(await readFile(destination), model)) {
      console.log(`${model.file} is ready.`);
      continue;
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  console.log(`Downloading ${model.file} from Google's MediaPipe model storage…`);
  const response = await fetch(model.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Model download failed: HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!valid(bytes, model)) throw new Error(`Integrity check failed for ${model.file}. Please retry.`);
  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, destination);
  } finally {
    await unlink(temporary).catch((error) => { if (error.code !== 'ENOENT') throw error; });
  }
  console.log(`${model.file} is ready (${checksum(bytes)}).`);
}
