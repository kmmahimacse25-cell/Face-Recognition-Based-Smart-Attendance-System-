/**
 * face-logic.js - Face Recognition and Webcam Operations using face-api.js
 */

const FaceRecognition = {
  modelsLoaded: false,
  activeStream: null,

  /**
   * Load the face-api.js models from the local directory
   */
  async loadModels() {
    if (this.modelsLoaded) return true;

    const CDN_URL = 'https://cdn.jsdelivr.net/gh/justadudewhohacks/face-api.js@master/weights';
    const LOCAL_URL = './models';

    console.log('Loading face-api.js models...');

    try {
      // Attempt 1: Load from fast jsDelivr CDN
      console.log('Attempting to load models from jsDelivr CDN...');
      await faceapi.nets.tinyFaceDetector.loadFromUri(CDN_URL);
      await faceapi.nets.faceLandmark68Net.loadFromUri(CDN_URL);
      await faceapi.nets.faceRecognitionNet.loadFromUri(CDN_URL);
      
      this.modelsLoaded = true;
      console.log('Face models loaded successfully from CDN.');
      return true;
    } catch (cdnError) {
      console.warn('CDN model load failed, falling back to local files:', cdnError);
      try {
        // Attempt 2: Fall back to local server folder
        await faceapi.nets.tinyFaceDetector.loadFromUri(LOCAL_URL);
        await faceapi.nets.faceLandmark68Net.loadFromUri(LOCAL_URL);
        await faceapi.nets.faceRecognitionNet.loadFromUri(LOCAL_URL);
        
        this.modelsLoaded = true;
        console.log('Face models loaded successfully from local directory.');
        return true;
      } catch (localError) {
        console.error('All model loading attempts failed:', localError);
        throw new Error('Could not load face recognition neural networks from CDN or local server. Please ensure you have an active internet connection.');
      }
    }
  },

  /**
   * Access user's webcam and stream to a video element
   */
  async startCamera(videoElement) {
    if (this.activeStream) {
      this.stopCamera();
    }

    try {
      const constraints = {
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          facingMode: 'user',
          frameRate: { ideal: 30 }
        },
        audio: false
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      videoElement.srcObject = stream;
      this.activeStream = stream;
      
      return new Promise((resolve) => {
        videoElement.onloadedmetadata = () => {
          videoElement.play();
          resolve(stream);
        };
      });
    } catch (error) {
      console.error('Webcam access error:', error);
      throw new Error('Webcam access denied. Please allow camera permissions in your browser.');
    }
  },

  /**
   * Stop any active webcam stream
   */
  stopCamera(videoElement = null) {
    if (this.activeStream) {
      this.activeStream.getTracks().forEach(track => track.stop());
      this.activeStream = null;
    }
    if (videoElement) {
      videoElement.srcObject = null;
    }
    console.log('Webcam stopped.');
  },

  /**
   * Captures a face from the webcam, returns the 128-float descriptor and a base64 crop image
   */
  async scanFace(videoElement) {
    if (!this.modelsLoaded) {
      await this.loadModels();
    }

    // Detector options: Tiny Face Detector
    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: 224,
      scoreThreshold: 0.5
    });

    // Detect single face with landmarks and descriptor
    const detection = await faceapi.detectSingleFace(videoElement, options)
      .withFaceLandmarks()
      .withFaceDescriptor();

    if (!detection) {
      throw new Error('No face detected. Please ensure you are positioned clearly in front of the camera and there is good lighting.');
    }

    // Crop the face out of the video stream to save as a thumbnail image
    const { x, y, width, height } = detection.detection.box;
    const canvas = document.createElement('canvas');
    canvas.width = 150;
    canvas.height = 150;
    const ctx = canvas.getContext('2d');

    // Draw the cropped face region onto the thumbnail canvas
    // We add a small padding (10%) around the bounding box for a better looking photo
    const padding = 0.15;
    const px = Math.max(0, x - width * padding);
    const py = Math.max(0, y - height * padding);
    const pWidth = Math.min(videoElement.videoWidth - px, width * (1 + 2 * padding));
    const pHeight = Math.min(videoElement.videoHeight - py, height * (1 + 2 * padding));

    ctx.drawImage(
      videoElement,
      px, py, pWidth, pHeight, // source coordinate
      0, 0, 150, 150          // destination size
    );

    const facePhotoBase64 = canvas.toDataURL('image/jpeg', 0.85);

    // Return descriptor (Array of 128 floats) and thumbnail
    return {
      descriptor: Array.from(detection.descriptor),
      photo: facePhotoBase64
    };
  },

  /**
   * Computes Euclidean distance between two 128-float arrays
   */
  computeDistance(descriptor1, descriptor2) {
    if (descriptor1.length !== descriptor2.length) return Infinity;
    let sum = 0;
    for (let i = 0; i < descriptor1.length; i++) {
      sum += Math.pow(descriptor1[i] - descriptor2[i], 2);
    }
    return Math.sqrt(sum);
  },

  /**
   * Matches a face descriptor against an array of enrolled students
   * Returns matching student or null
   */
  findBestMatch(detectedDescriptor, enrolledStudents, matchThreshold = 0.52) {
    if (!enrolledStudents || enrolledStudents.length === 0) return null;

    let bestMatch = null;
    let minDistance = Infinity;

    for (const student of enrolledStudents) {
      // IndexedDB might retrieve descriptor as a normal array or typed array, check it
      const studentDescriptor = Array.isArray(student.faceDescriptor) 
        ? student.faceDescriptor 
        : Array.from(student.faceDescriptor);

      const distance = this.computeDistance(detectedDescriptor, studentDescriptor);
      
      if (distance < minDistance) {
        minDistance = distance;
        bestMatch = { student, distance };
      }
    }

    // If the distance is below the match threshold, it's a positive identification
    if (bestMatch && bestMatch.distance < matchThreshold) {
      return {
        student: bestMatch.student,
        distance: bestMatch.distance,
        isMatch: true
      };
    }

    // Return the closest student but mark isMatch as false (for error tracing)
    return {
      student: bestMatch ? bestMatch.student : null,
      distance: bestMatch ? bestMatch.distance : Infinity,
      isMatch: false
    };
  }
};

// Export FaceRecognition globally
window.FaceRecognition = FaceRecognition;
