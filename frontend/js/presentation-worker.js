/* global Vision */
// A classic worker supports MediaPipe's WASM loader (which uses importScripts).
let pose;
let face;
let measureFrame;

self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      importScripts('/vendor/mediapipe/vision_bundle.js');
      ({ measureFrame } = await import('./body-language.js'));
      const files = await Vision.FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
      pose = await Vision.PoseLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/models/pose_landmarker_lite.task', delegate: 'CPU' },
        canvas: new OffscreenCanvas(1, 1),
        runningMode: 'VIDEO', numPoses: 1,
        minPoseDetectionConfidence: 0.6, minPosePresenceConfidence: 0.6, minTrackingConfidence: 0.6,
        outputSegmentationMasks: false,
      });
      face = await Vision.FaceLandmarker.createFromOptions(files, {
        baseOptions: { modelAssetPath: '/models/face_landmarker.task', delegate: 'CPU' },
        canvas: new OffscreenCanvas(1, 1),
        runningMode: 'VIDEO', numFaces: 1,
        minFaceDetectionConfidence: 0.6, minFacePresenceConfidence: 0.6, minTrackingConfidence: 0.6,
        outputFaceBlendshapes: false, outputFacialTransformationMatrixes: true,
      });
      self.postMessage({ type: 'ready' });
    } catch (error) {
      pose?.close();
      face?.close();
      self.postMessage({ type: 'error', message: `Could not load body tracking. Run npm run setup:models, then try again. ${error.message}` });
    }
  } else if (data.type === 'frame') {
    try {
      const poseResult = pose.detectForVideo(data.bitmap, data.timestamp);
      const faceResult = face.detectForVideo(data.bitmap, data.timestamp);
      const sample = measureFrame(poseResult, faceResult, data.bitmap.width, data.bitmap.height);
      self.postMessage({ type: 'sample', sample, epoch: data.epoch, seconds: data.seconds, timestamp: data.timestamp });
    } catch (error) {
      self.postMessage({ type: 'error', message: `Tracking stopped: ${error.message}` });
    } finally {
      data.bitmap.close();
    }
  }
};
