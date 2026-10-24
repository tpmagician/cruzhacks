/* global Vision */
// Camera tracking for interview delivery coaching: the face (smiles, nods, head
// direction) on every frame, and body pose (side-to-side movement, gestures) on
// every other frame so the face keeps enough frames for nod detection.
// A classic worker supports MediaPipe's WASM loader (which uses importScripts).
let face;
let pose;
let measureFace;
let measureFrame;
let frameCount = 0;

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      importScripts('/vendor/mediapipe/vision_bundle.js');
      ({ measureFace } = await import('./delivery-metrics.js'));
      ({ measureFrame } = await import('./body-language.js'));
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
      pose = await Vision.PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate: 'CPU' },
        canvas: new OffscreenCanvas(1, 1),
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.6,
        minPosePresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
        outputSegmentationMasks: false,
      });
      self.postMessage({ type: 'ready' });
    } catch (error) {
      face?.close();
      pose?.close();
      self.postMessage({ type: 'error', message: `Could not load camera tracking. Run npm run setup:models, then reload. ${error.message}` });
    }
  } else if (data.type === 'frame') {
    try {
      const { width, height } = data.bitmap;
      const sample = measureFace(face.detectForVideo(data.bitmap, data.timestamp), width, height);
      // null means pose did not run on this frame; { shoulders: null, wrists: null } means nothing was visible.
      let body = null;
      if (frameCount++ % 2 === 0) {
        const { shoulders, wrists } = measureFrame(pose.detectForVideo(data.bitmap, data.timestamp), null, width, height);
        body = { shoulders, wrists };
      }
      self.postMessage({ type: 'sample', sample, body, timestamp: data.timestamp });
    } catch (error) {
      self.postMessage({ type: 'error', message: `Camera tracking stopped: ${error.message}` });
    } finally {
      data.bitmap.close();
    }
  }
};
