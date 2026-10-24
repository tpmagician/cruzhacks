/* global Vision */
// Face tracking for interview delivery coaching (smiles, nods, head direction).
// A classic worker supports MediaPipe's WASM loader (which uses importScripts).
let face;
let measureFace;

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      importScripts('/vendor/mediapipe/vision_bundle.js');
      ({ measureFace } = await import('./delivery-metrics.js'));
      const files = await Vision.FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
      face = await Vision.FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate: 'CPU' },
        canvas: new OffscreenCanvas(1, 1),
        runningMode: 'VIDEO',
        numFaces: 1,
        minFaceDetectionConfidence: 0.5,
        minFacePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
      self.postMessage({ type: 'ready' });
    } catch (error) {
      face?.close();
      self.postMessage({ type: 'error', message: `Could not load face tracking. Run npm run setup:models, then reload. ${error.message}` });
    }
  } else if (data.type === 'frame') {
    try {
      const result = face.detectForVideo(data.bitmap, data.timestamp);
      const sample = measureFace(result, data.bitmap.width, data.bitmap.height);
      self.postMessage({ type: 'sample', sample, timestamp: data.timestamp });
    } catch (error) {
      self.postMessage({ type: 'error', message: `Face tracking stopped: ${error.message}` });
    } finally {
      data.bitmap.close();
    }
  }
};
