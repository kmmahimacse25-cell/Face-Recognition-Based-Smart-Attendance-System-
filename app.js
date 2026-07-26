/**
 * app.js - Main Application Controller
 */

document.addEventListener('DOMContentLoaded', async () => {
  // --- APPLICATION STATE ---
  let currentUser = null;
  let activeTab = 'attendance';
  
  // Registration capture temp state
  let enrollmentFaceData = null; // Holds { descriptor, photo } after scan
  
  // Active attendance session state
  let isAttendanceSessionActive = false;
  let sessionClass = '';
  let sessionSubject = '';
  let sessionPresentStudents = []; // List of { rollNumber, name, timeMarked, photo }
  let classStudentsList = []; // Students registered for the active class
  let attendanceIntervalId = null;

  // --- AUDIO SYNTHESIS FEEDBACK (Web Audio API) ---
  function playBeep(type = 'success') {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioCtx.createOscillator();
      const gainNode = audioCtx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      
      if (type === 'success') {
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5 note
        gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.15);
      } else if (type === 'error') {
        oscillator.type = 'sawtooth';
        oscillator.frequency.setValueAtTime(150, audioCtx.currentTime);
        gainNode.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.3);
      }
    } catch (e) {
      console.warn('Audio feedback failed to play:', e);
    }
  }

  // --- INITIALIZE APPLICATION ---
  try {
    // 1. Initialize IndexedDB database
    await window.AppDB.init();
    
    // 2. Pre-populate default faculty if database is completely empty
    const facultyExists = await window.AppDB.hasFaculty();
    if (!facultyExists) {
      // Register a default faculty account so they can log in immediately
      await window.AppDB.registerFaculty('admin', 'admin123');
      console.log('Default faculty account created: admin/admin123');
    }
    
    // 3. Start Live Clock
    startClock();
    
    // 4. Load face models in background immediately so there is no delay later
    // We catch errors silently here; if it fails, it will try again when camera opens
    window.FaceRecognition.loadModels().catch(err => {
      showWorkspaceAlert('warning', 'Neural networks loading failed. Please ensure the network models have been downloaded using the PowerShell script.');
    });

  } catch (error) {
    showAuthAlert('danger', 'System initialization error: ' + error.message);
  }

  // --- LIVE CLOCK HELPER ---
  function startClock() {
    const timeDisplay = document.getElementById('live-time-display');
    const updateTime = () => {
      const now = new Date();
      const options = { 
        weekday: 'short', 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit', 
        minute: '2-digit', 
        second: '2-digit',
        hour12: true 
      };
      timeDisplay.textContent = now.toLocaleDateString('en-US', options);
    };
    updateTime();
    setInterval(updateTime, 1000);
  }

  // --- ALERT HELPER SYSTEM ---
  function showAuthAlert(type, message) {
    const container = currentUser ? document.getElementById('workspace-alert-container') : 
      (document.getElementById('register-card').style.display === 'none' ? 
       document.getElementById('login-alert-container') : 
       document.getElementById('register-alert-container'));
       
    if (container) {
      container.innerHTML = `
        <div class="alert alert-${type}">
          <svg style="width:18px;height:18px;" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path></svg>
          <span>${message}</span>
        </div>
      `;
      // Auto-dismiss after 6 seconds
      setTimeout(() => { container.innerHTML = ''; }, 6000);
    }
  }

  function showWorkspaceAlert(type, message) {
    const container = document.getElementById('workspace-alert-container');
    if (container) {
      container.innerHTML = `
        <div class="alert alert-${type}">
          <svg style="width:18px;height:18px;" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"></path></svg>
          <span>${message}</span>
        </div>
      `;
      // Scroll to top of workspace to see alert
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(() => { container.innerHTML = ''; }, 6000);
    }
  }


  // --- VIEW ROUTING (TABS SWITCHING) ---
  const menuLinks = document.querySelectorAll('.menu-link');
  menuLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      
      const targetTab = link.getAttribute('data-tab');
      if (targetTab === activeTab) return;
      
      // Safety check: Don't allow navigating away if attendance is active
      if (isAttendanceSessionActive) {
        showWorkspaceAlert('danger', 'Please stop and save the current attendance session before switching tabs.');
        return;
      }
      
      // Deactivate cameras
      stopAllCameras();
      
      // Update sidebar links
      menuLinks.forEach(l => l.classList.remove('active'));
      link.classList.add('active');
      
      // Update Tab Content sections
      document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
      });
      document.getElementById(`tab-content-${targetTab}`).classList.add('active');
      
      activeTab = targetTab;
      
      // Update Heading Titles
      updateTabHeadingTitles(targetTab);
      
      // Load specific tab data
      if (targetTab === 'database') {
        loadStudentDatabase();
      } else if (targetTab === 'reports') {
        loadAttendanceReports();
      }
    });
  });

  function updateTabHeadingTitles(tabName) {
    const heading = document.getElementById('tab-heading');
    const subheading = document.getElementById('tab-subheading');
    
    switch (tabName) {
      case 'attendance':
        heading.textContent = 'Take Attendance';
        subheading.textContent = 'Verify student identity and track lecture check-ins';
        break;
      case 'enrollment':
        heading.textContent = 'Enrol Students';
        subheading.textContent = 'Capture face biometrics and enroll students in the database';
        break;
      case 'database':
        heading.textContent = 'Student Database';
        subheading.textContent = 'View and manage registered student profiles and face keys';
        break;
      case 'reports':
        heading.textContent = 'Attendance Reports';
        subheading.textContent = 'Inspect logged lecture sessions and export CSV lists';
        break;
    }
  }

  function stopAllCameras() {
    // Stop Take Attendance Camera
    const attendanceVideo = document.getElementById('attendance-video');
    window.FaceRecognition.stopCamera(attendanceVideo);
    
    // Stop Enrollment Camera
    const enrollmentVideo = document.getElementById('enrollment-video');
    window.FaceRecognition.stopCamera(enrollmentVideo);
    
    // Reset enrollment capture UI
    resetEnrollmentCaptureUI();
  }


  // --- AUTHENTICATION FLOW HANDLERS ---
  const authView = document.getElementById('auth-view');
  const dashboardView = document.getElementById('dashboard-view');
  const loginCard = document.getElementById('login-card');
  const registerCard = document.getElementById('register-card');

  // Toggle Login/Register Forms
  document.getElementById('link-show-register').addEventListener('click', (e) => {
    e.preventDefault();
    loginCard.style.display = 'none';
    registerCard.style.display = 'block';
    document.getElementById('login-alert-container').innerHTML = '';
  });

  document.getElementById('link-show-login').addEventListener('click', (e) => {
    e.preventDefault();
    registerCard.style.display = 'none';
    loginCard.style.display = 'block';
    document.getElementById('register-alert-container').innerHTML = '';
  });

    // Login Submission
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('login-username').value.trim();
      const password = document.getElementById('login-password').value;
  
      try {
        const user = await window.AppDB.loginFaculty(username, password);
        currentUser = user;
        
        // Update UI with User details
        document.getElementById('user-display-name').textContent = user.username;
        document.getElementById('user-avatar-initial').textContent = user.username.charAt(0).toUpperCase();
        
        // Transition screen views
        authView.style.display = 'none';
        dashboardView.style.display = 'flex';
        
        // Reset forms
        document.getElementById('login-form').reset();
        document.getElementById('login-alert-container').innerHTML = '';
        
        // Set to take attendance tab default
        triggerDefaultTab();
        
        showWorkspaceAlert('success', `Welcome back, Prof. ${user.username}!`);
      } catch (err) {
        showAuthAlert('danger', err.message);
      }
    });

  // Registration Submission
  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value;
    const confirmPassword = document.getElementById('register-confirm-password').value;

    if (password.length < 6) {
      showAuthAlert('danger', 'Password must be at least 6 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      showAuthAlert('danger', 'Passwords do not match. Please verify.');
      return;
    }

    try {
      await window.AppDB.registerFaculty(username, password);
      showWorkspaceAlert('success', 'Faculty account registered successfully!');
      
      // Auto transition back to login view
      registerCard.style.display = 'none';
      loginCard.style.display = 'block';
      document.getElementById('register-form').reset();
      
      // Set username in login field
      document.getElementById('login-username').value = username;
      showAuthAlert('success', 'Account created! Please sign in.');
    } catch (err) {
      showAuthAlert('danger', err.message);
    }
  });

  // Logout Handler
  document.getElementById('btn-sidebar-logout').addEventListener('click', () => {
    currentUser = null;
    stopAllCameras();
    
    // Transition views
    dashboardView.style.display = 'none';
    authView.style.display = 'flex';
    
    // Clear sidebar highlights
    menuLinks.forEach(l => l.classList.remove('active'));
    document.querySelector('[data-tab="attendance"]').classList.add('active');
    
    showAuthAlert('success', 'You have been logged out successfully.');
  });



  function triggerDefaultTab() {
    activeTab = 'attendance';
    menuLinks.forEach(l => l.classList.remove('active'));
    document.querySelector('[data-tab="attendance"]').classList.add('active');
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    document.getElementById('tab-content-attendance').classList.add('active');
    updateTabHeadingTitles('attendance');
  }


  // --- TAB: STUDENT ENROLLMENT LOGIC ---
  const enrollForm = document.getElementById('enrollment-form');
  const enrollVideo = document.getElementById('enrollment-video');
  const enrollPhotoCrop = document.getElementById('enrollment-photo-crop');
  const btnEnrollCamToggle = document.getElementById('btn-enroll-camera-toggle');
  const btnEnrollCapture = document.getElementById('btn-enroll-capture');
  const btnSaveEnrollment = document.getElementById('btn-save-enrollment');
  const enrollCamBox = document.getElementById('enrollment-camera-box');
  const enrollCamPlaceholder = document.getElementById('enrollment-camera-placeholder');

  let isEnrollCamStreaming = false;

  btnEnrollCamToggle.addEventListener('click', async () => {
    if (isEnrollCamStreaming) {
      // Stop Camera
      window.FaceRecognition.stopCamera(enrollVideo);
      resetEnrollmentCaptureUI();
    } else {
      // Start Camera
      try {
        btnEnrollCamToggle.textContent = 'Starting Camera...';
        btnEnrollCamToggle.disabled = true;
        
        // Ensure models are loaded first
        btnEnrollCamToggle.textContent = 'Loading AI Models...';
        await window.FaceRecognition.loadModels();
        
        btnEnrollCamToggle.textContent = 'Connecting Camera...';
        await window.FaceRecognition.startCamera(enrollVideo);
        
        // Show video, hide static crop and placeholder
        enrollVideo.style.display = 'block';
        enrollPhotoCrop.style.display = 'none';
        enrollCamPlaceholder.style.display = 'none';
        
        isEnrollCamStreaming = true;
        btnEnrollCamToggle.textContent = 'Close Camera';
        btnEnrollCamToggle.disabled = false;
        btnEnrollCapture.disabled = false;
        
        // Clear any previous captured face state
        enrollmentFaceData = null;
        btnSaveEnrollment.disabled = true;
      } catch (err) {
        showWorkspaceAlert('danger', err.message);
        resetEnrollmentCaptureUI();
      }
    }
  });

  btnEnrollCapture.addEventListener('click', async () => {
    if (!isEnrollCamStreaming) return;

    try {
      btnEnrollCapture.disabled = true;
      btnEnrollCapture.textContent = 'Scanning Face...';
      enrollCamBox.classList.add('scanning');

      // Detect and scan face (extracts descriptor and base64 crop photo)
      const faceData = await window.FaceRecognition.scanFace(enrollVideo);
      
      // Stop camera stream since face is scanned successfully
      window.FaceRecognition.stopCamera(enrollVideo);
      isEnrollCamStreaming = false;
      
      // Store captured face data
      enrollmentFaceData = faceData;
      
      // Update UI: Display the cropped static face, hide video
      enrollVideo.style.display = 'none';
      enrollPhotoCrop.src = faceData.photo;
      enrollPhotoCrop.style.display = 'block';
      
      btnEnrollCamToggle.textContent = 'Open Camera';
      btnEnrollCapture.textContent = 'Capture & Scan Face';
      btnEnrollCapture.disabled = true;
      enrollCamBox.classList.remove('scanning');
      enrollCamBox.classList.add('has-photo');
      
      // Enable registration save button
      btnSaveEnrollment.disabled = false;
      
      playBeep('success');
      showWorkspaceAlert('success', 'Face scan successful! You can now save the student record.');
    } catch (err) {
      playBeep('error');
      showWorkspaceAlert('danger', err.message);
      
      btnEnrollCapture.textContent = 'Capture & Scan Face';
      btnEnrollCapture.disabled = false;
      enrollCamBox.classList.remove('scanning');
    }
  });

  enrollForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!enrollmentFaceData) {
      showWorkspaceAlert('danger', 'Please scan a student face from the camera before registering.');
      return;
    }

    const name = document.getElementById('enroll-name').value.trim();
    const rollNumber = document.getElementById('enroll-roll').value.trim().toUpperCase();
    const classId = document.getElementById('enroll-class').value;

    const studentRecord = {
      name,
      rollNumber,
      classId,
      faceDescriptor: enrollmentFaceData.descriptor,
      photo: enrollmentFaceData.photo
    };

    try {
      btnSaveEnrollment.disabled = true;
      btnSaveEnrollment.textContent = 'Saving Student...';
      
      await window.AppDB.addStudent(studentRecord);
      
      showWorkspaceAlert('success', `Student "${name}" (${rollNumber}) enrolled successfully!`);
      
      // Reset enrollment portal state
      enrollForm.reset();
      resetEnrollmentCaptureUI();
    } catch (err) {
      showWorkspaceAlert('danger', err.message);
      btnSaveEnrollment.disabled = false;
      btnSaveEnrollment.textContent = 'Register & Save Student Face';
    }
  });

  function resetEnrollmentCaptureUI() {
    isEnrollCamStreaming = false;
    enrollmentFaceData = null;
    
    // Element visibility resets
    enrollVideo.srcObject = null;
    enrollVideo.style.display = 'none';
    enrollPhotoCrop.style.display = 'none';
    enrollPhotoCrop.src = '';
    enrollCamPlaceholder.style.display = 'flex';
    
    enrollCamBox.className = 'photo-preview-container'; // removes scanning/has-photo classes
    
    btnEnrollCamToggle.textContent = 'Start Webcam';
    btnEnrollCamToggle.disabled = false;
    btnEnrollCapture.textContent = 'Capture & Scan Face';
    btnEnrollCapture.disabled = true;
    btnSaveEnrollment.textContent = 'Register & Save Student Face';
    btnSaveEnrollment.disabled = true;
  }


  // --- TAB: TAKE ATTENDANCE LOGIC ---
  const selectClass = document.getElementById('attendance-class-select');
  const selectSubject = document.getElementById('attendance-subject-select'); // CHANGED: Dropdown
  const btnStartAttendance = document.getElementById('btn-start-attendance');
  const btnStopAttendance = document.getElementById('btn-stop-attendance');
  const attendanceVideo = document.getElementById('attendance-video');
  const attendancePlaceholder = document.getElementById('attendance-camera-placeholder');
  const attendanceCamBox = document.getElementById('attendance-camera-box');
  const canvasContainer = document.getElementById('attendance-overlay-canvas-container');
  const sessionStatus = document.getElementById('session-status-badge');
  const liveCheckinList = document.getElementById('live-checkin-list');
  const errorBanner = document.getElementById('face-error-banner');
  const errorText = document.getElementById('face-error-text');

  // Monitor form configurations to enable start button
  function validateAttendanceInputs() {
    const hasClass = selectClass.value !== '';
    const hasSubject = selectSubject.value !== ''; // CHANGED: Dropdown value check
    
    if (hasClass && hasSubject && !isAttendanceSessionActive) {
      btnStartAttendance.disabled = false;
    } else {
      btnStartAttendance.disabled = true;
    }
  }

  selectClass.addEventListener('change', validateAttendanceInputs);
  selectSubject.addEventListener('change', validateAttendanceInputs); // CHANGED: Dropdown change

  btnStartAttendance.addEventListener('click', async () => {
    sessionClass = selectClass.value;
    sessionSubject = selectSubject.value;

    if (!sessionClass || !sessionSubject) {
      showWorkspaceAlert('danger', 'Please select a Class and enter the Lecture Subject.');
      return;
    }

    try {
      btnStartAttendance.disabled = true;
      btnStartAttendance.textContent = 'Loading database...';

      // 1. Get class list templates from IndexedDB
      classStudentsList = await window.AppDB.getStudentsByClass(sessionClass);
      
      if (classStudentsList.length === 0) {
        showWorkspaceAlert('warning', `No students are enrolled in Class ${sessionClass} yet. Please enroll students for this class first.`);
        btnStartAttendance.disabled = false;
        btnStartAttendance.textContent = 'Start Session';
        return;
      }

      btnStartAttendance.textContent = 'Connecting Camera...';
      
      // Load face-api.js neural networks
      await window.FaceRecognition.loadModels();
      
      // Start camera feed
      await window.FaceRecognition.startCamera(attendanceVideo);

      // Show video viewport
      attendanceVideo.style.display = 'block';
      attendancePlaceholder.style.display = 'none';
      attendanceCamBox.classList.add('camera-active');
      
      // Session status updates
      isAttendanceSessionActive = true;
      sessionPresentStudents = [];
      
      sessionStatus.textContent = 'Live Scanning';
      sessionStatus.className = 'badge-pulse active';
      
      // Button states
      btnStartAttendance.disabled = true;
      btnStartAttendance.textContent = 'Start Session';
      btnStopAttendance.disabled = false;
      selectClass.disabled = true;
      selectSubject.disabled = true;
      
      // Clear live logs panel
      liveCheckinList.innerHTML = '';
      errorBanner.style.display = 'none';

      // Launch Face Detection & Recognition loop (every 350ms to keep CPU load low)
      attendanceIntervalId = setInterval(runAttendanceMatchingFrame, 350);
      
      showWorkspaceAlert('success', `Attendance scanning session started for ${sessionClass} - ${sessionSubject}!`);
    } catch (err) {
      showWorkspaceAlert('danger', err.message);
      stopAttendanceSessionUI();
    }
  });

  btnStopAttendance.addEventListener('click', async () => {
    if (!isAttendanceSessionActive) return;
    
    // Stop matching interval loop and camera
    clearInterval(attendanceIntervalId);
    window.FaceRecognition.stopCamera(attendanceVideo);
    
    // Save session logs to database
    const now = new Date();
    const sessionRecord = {
      date: now.toISOString().split('T')[0], // yyyy-mm-dd
      time: now.toTimeString().split(' ')[0].substring(0, 5), // hh:mm
      classId: sessionClass,
      subject: sessionSubject,
      facultyUsername: currentUser.username, // Track which faculty recorded this
      presentStudents: sessionPresentStudents.map(s => ({
        rollNumber: s.rollNumber,
        name: s.name,
        timeMarked: s.timeMarked,
        photo: s.photo || null
      }))
    };

    try {
      btnStopAttendance.disabled = true;
      btnStopAttendance.textContent = 'Saving session...';
      
      await window.AppDB.saveAttendanceSession(sessionRecord);
      
      showWorkspaceAlert('success', `Attendance session successfully logged! Total present: ${sessionPresentStudents.length} students.`);
    } catch (err) {
      showWorkspaceAlert('danger', 'Failed to save session logs: ' + err.message);
    } finally {
      stopAttendanceSessionUI();
    }
  });

  function stopAttendanceSessionUI() {
    isAttendanceSessionActive = false;
    if (attendanceIntervalId) clearInterval(attendanceIntervalId);
    
    // Stop stream and clean viewport overlays
    attendanceVideo.srcObject = null;
    attendanceVideo.style.display = 'none';
    attendancePlaceholder.style.display = 'flex';
    attendanceCamBox.classList.remove('camera-active');
    canvasContainer.innerHTML = '';
    
    sessionStatus.textContent = 'Inactive';
    sessionStatus.className = 'badge-pulse inactive';
    
    btnStartAttendance.disabled = false;
    btnStopAttendance.disabled = true;
    btnStopAttendance.textContent = 'Stop & Save Session';
    
    selectClass.disabled = false;
    selectSubject.disabled = false;
    
    // Clear selections
    selectClass.value = '';
    selectSubject.value = '';
    validateAttendanceInputs();
  }

  // --- RECURRING ATTENDANCE DETECTOR LOOP ---
  async function runAttendanceMatchingFrame() {
    if (!isAttendanceSessionActive || !attendanceVideo.srcObject) return;

    // Tiny face detector parameters
    const options = new faceapi.TinyFaceDetectorOptions({
      inputSize: 224,
      scoreThreshold: 0.5
    });

    try {
      // Detect all faces in video frame with landmarks and descriptors
      const detections = await faceapi.detectAllFaces(attendanceVideo, options)
        .withFaceLandmarks()
        .withFaceDescriptors();

      // Clear the overlay box container
      canvasContainer.innerHTML = '';

      if (detections.length === 0) return;

      // Calculate video layout ratios to place bounding boxes accurately on the overlay absolute div
      const videoWidth = attendanceVideo.videoWidth;
      const videoHeight = attendanceVideo.videoHeight;
      const containerWidth = attendanceVideo.clientWidth;
      const containerHeight = attendanceVideo.clientHeight;
      
      const scaleX = containerWidth / videoWidth;
      const scaleY = containerHeight / videoHeight;

      detections.forEach(detection => {
        // Extract detection bounding box coordinates
        const { x, y, width, height } = detection.detection.box;
        
        // Flip coordinates for mirrored camera view
        // The overlay canvas is placed on top of a mirrored video, so the coordinates must reflect the mirrored layout
        const boxLeft = containerWidth - (x + width) * scaleX;
        const boxTop = y * scaleY;
        const boxWidth = width * scaleX;
        const boxHeight = height * scaleY;

        // Perform face matching calculation
        const matchResult = window.FaceRecognition.findBestMatch(detection.descriptor, classStudentsList);
        
        let label = 'Unknown Student';
        let matchClass = 'face-unknown';
        
        if (matchResult && matchResult.isMatch) {
          const student = matchResult.student;
          label = `${student.name} (${student.rollNumber})`;
          matchClass = 'face-matched';
          
          // Mark student present if not already added to current session list
          markStudentPresent(student);
        } else {
          // Trigger the unrecognized error banner
          triggerFaceNotFoundErrorBanner();
        }

        // Draw custom HTML bounding box onto the video wrapper
        const borderDiv = document.createElement('div');
        borderDiv.className = `face-bounding-box ${matchClass}`;
        borderDiv.style.left = `${boxLeft}px`;
        borderDiv.style.top = `${boxTop}px`;
        borderDiv.style.width = `${boxWidth}px`;
        borderDiv.style.height = `${boxHeight}px`;

        const tagDiv = document.createElement('div');
        tagDiv.className = 'face-label-tag';
        tagDiv.textContent = label;
        borderDiv.appendChild(tagDiv);

        canvasContainer.appendChild(borderDiv);
      });

    } catch (err) {
      console.warn('Face detection cycle error:', err);
    }
  }

  function markStudentPresent(student) {
    // Check if student already marked present in this session
    const alreadyPresent = sessionPresentStudents.some(s => s.rollNumber === student.rollNumber);
    if (alreadyPresent) return;

    // Get time string
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0].substring(0, 5); // hh:mm

    const checkinLog = {
      rollNumber: student.rollNumber,
      name: student.name,
      timeMarked: timeStr,
      photo: student.photo
    };

    // Add to active session present list
    sessionPresentStudents.unshift(checkinLog); // Prepend to show newest first

    // Remove placeholder empty state if present
    const placeholder = liveCheckinList.querySelector('.log-item-placeholder');
    if (placeholder) placeholder.remove();

    // Render live checking feed item
    const entryDiv = document.createElement('div');
    entryDiv.className = 'log-entry';
    entryDiv.innerHTML = `
      <img src="${student.photo}" class="log-photo" alt="Face">
      <div class="log-info">
        <div class="log-name">${student.name}</div>
        <div class="log-meta">
          <span class="badge badge-blue">${student.rollNumber}</span>
          <span class="badge badge-purple">${student.classId}</span>
        </div>
      </div>
      <div class="log-time">${timeStr}</div>
    `;

    liveCheckinList.insertBefore(entryDiv, liveCheckinList.firstChild);
    
    // Play check-in alert success audio beep
    playBeep('success');
  }

  let errorBannerTimeoutId = null;
  function triggerFaceNotFoundErrorBanner() {
    errorBanner.style.display = 'flex';
    errorText.textContent = 'Face unrecognized! Face not found in registered student database.';
    
    // Play warning buzz sound (only if not recently played)
    if (!errorBannerTimeoutId) {
      playBeep('error');
    }
    
    // Clear old timers and reset auto-hide timeout
    if (errorBannerTimeoutId) clearTimeout(errorBannerTimeoutId);
    errorBannerTimeoutId = setTimeout(() => {
      errorBanner.style.display = 'none';
      errorBannerTimeoutId = null;
    }, 4000);
  }


  // --- TAB: STUDENT DATABASE MANAGEMENT ---
  const dbSearchInput = document.getElementById('db-search-input');
  const dbClassFilter = document.getElementById('db-class-filter');
  const studentTableBody = document.getElementById('student-table-body');
  const dbEmptyState = document.getElementById('db-empty-state');
  
  let allEnrolledStudents = [];

  async function loadStudentDatabase() {
    try {
      allEnrolledStudents = await window.AppDB.getAllStudents();
      renderStudentTable();
    } catch (err) {
      showWorkspaceAlert('danger', 'Failed to retrieve students from database: ' + err.message);
    }
  }

  function renderStudentTable() {
    const searchQuery = dbSearchInput.value.toLowerCase().trim();
    const classFilter = dbClassFilter.value;
    
    studentTableBody.innerHTML = '';

    // Filter students array based on toolbar controls
    const filtered = allEnrolledStudents.filter(student => {
      const matchesSearch = student.name.toLowerCase().includes(searchQuery) || 
                            student.rollNumber.toLowerCase().includes(searchQuery);
      const matchesClass = classFilter === '' || student.classId === classFilter;
      return matchesSearch && matchesClass;
    });

    if (filtered.length === 0) {
      dbEmptyState.style.display = 'flex';
      return;
    }

    dbEmptyState.style.display = 'none';

    filtered.forEach(student => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <img src="${student.photo || 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22currentColor%22%3E%3Cpath%20d%3D%22M12%2012c2.21%200%204-1.79%204-4s-1.79-4-4-4-4%201.79-4%204%201.79%204%204%204zm0%202c-2.67%200-8%201.34-8%204v2h16v-2c0-2.66-5.33-4-8-4z%22%2F%3E%3C%2Fsvg%3E'}" class="log-photo" style="width:40px;height:40px;border-radius:10px;" alt="Face Profile">
        </td>
        <td style="font-weight: 600;">${student.name}</td>
        <td><span class="badge badge-blue">${student.rollNumber}</span></td>
        <td><span class="badge badge-purple">${student.classId}</span></td>
        <td>
          <span style="display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--success);font-weight:600;">
            <span style="width:6px;height:6px;background-color:var(--success);border-radius:50%;"></span>
            128-float Bio Key
          </span>
        </td>
        <td style="text-align: center;">
          <button class="btn-icon btn-icon-danger btn-delete-student" data-id="${student.id}" title="Delete Record">
            <!-- Trash Icon -->
            <svg style="width:18px;height:18px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          </button>
        </td>
      `;

      // Event listener for delete student
      tr.querySelector('.btn-delete-student').addEventListener('click', async (e) => {
        const studentId = parseInt(e.currentTarget.getAttribute('data-id'));
        if (confirm(`Are you sure you want to delete student "${student.name}" from the face recognition database?`)) {
          try {
            await window.AppDB.deleteStudent(studentId);
            showWorkspaceAlert('success', `Student "${student.name}" record deleted.`);
            loadStudentDatabase(); // refresh
          } catch (err) {
            showWorkspaceAlert('danger', 'Failed to delete student: ' + err.message);
          }
        }
      });

      studentTableBody.appendChild(tr);
    });
  }

  // Hook up filter listeners
  dbSearchInput.addEventListener('input', renderStudentTable);
  dbClassFilter.addEventListener('change', renderStudentTable);


  // --- TAB: REPORTS & HISTORICAL LOGS ---
  const reportsTableBody = document.getElementById('reports-table-body');
  const reportsEmptyState = document.getElementById('reports-empty-state');
  
  // Modal Elements
  const sessionModal = document.getElementById('session-modal');
  const modalTitle = document.getElementById('modal-session-title');
  const modalInfo = document.getElementById('modal-session-info');
  const modalTableBody = document.getElementById('modal-student-table-body');
  const btnModalExport = document.getElementById('btn-modal-export');
  
  let allAttendanceSessions = [];
  let selectedSessionForExport = null;

  async function loadAttendanceReports() {
    try {
      const allSessions = await window.AppDB.getAllAttendanceSessions();
      // Filter so a faculty member only sees sessions they conducted
      allAttendanceSessions = allSessions.filter(s => {
        return !s.facultyUsername || s.facultyUsername === currentUser.username;
      });
      renderReportsTable();
    } catch (err) {
      showWorkspaceAlert('danger', 'Failed to retrieve reports: ' + err.message);
    }
  }

  function renderReportsTable() {
    reportsTableBody.innerHTML = '';

    if (allAttendanceSessions.length === 0) {
      reportsEmptyState.style.display = 'flex';
      return;
    }

    reportsEmptyState.style.display = 'none';

    allAttendanceSessions.forEach(session => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="font-family: monospace; font-size:12px; font-weight:600; color:var(--text-secondary);">#${session.id}</td>
        <td style="font-weight:600;">${session.date}</td>
        <td>${session.time}</td>
        <td><span class="badge badge-purple">${session.classId}</span></td>
        <td>${session.subject}</td>
        <td>
          <span class="badge badge-blue" style="font-weight: 700;">
            ${session.presentStudents.length} present
          </span>
        </td>
        <td style="text-align: right; display:flex; gap:8px; justify-content: flex-end;">
          <button class="btn-icon btn-view-report" data-id="${session.id}" title="View Details">
            <!-- Search/Detail Icon -->
            <svg style="width:18px;height:18px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path></svg>
          </button>
          <button class="btn-icon btn-export-report" data-id="${session.id}" title="Export CSV">
            <!-- Download Icon -->
            <svg style="width:18px;height:18px;color:var(--success);" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
          </button>
          <button class="btn-icon btn-icon-danger btn-delete-report" data-id="${session.id}" title="Delete Log">
            <!-- Trash Icon -->
            <svg style="width:18px;height:18px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          </button>
        </td>
      `;

      // Details Modal Listener
      tr.querySelector('.btn-view-report').addEventListener('click', () => {
        openSessionModal(session);
      });

      // Export CSV Listener
      tr.querySelector('.btn-export-report').addEventListener('click', () => {
        exportSessionToCSV(session);
      });

      // Delete Log Listener
      tr.querySelector('.btn-delete-report').addEventListener('click', async (e) => {
        const id = parseInt(e.currentTarget.getAttribute('data-id'));
        if (confirm(`Are you sure you want to permanently delete this attendance session for "${session.subject}" conducted on ${session.date}?`)) {
          try {
            await window.AppDB.deleteAttendanceSession(id);
            showWorkspaceAlert('success', 'Attendance session log deleted.');
            loadAttendanceReports();
          } catch (err) {
            showWorkspaceAlert('danger', 'Failed to delete report: ' + err.message);
          }
        }
      });

      reportsTableBody.appendChild(tr);
    });
  }

  // --- DETAIL MODAL LOGIC ---
  async function openSessionModal(session) {
    selectedSessionForExport = session;
    
    modalTitle.textContent = `Attendance Session #${session.id}`;
    modalInfo.innerHTML = `
      <div><strong>Class:</strong> ${session.classId}</div>
      <div><strong>Lecture Subject:</strong> ${session.subject}</div>
      <div><strong>Date:</strong> ${session.date}</div>
      <div><strong>Start Time:</strong> ${session.time}</div>
      <div><strong>Status:</strong> Completed</div>
      <div><strong>Present Students:</strong> ${session.presentStudents.length}</div>
    `;

    modalTableBody.innerHTML = '';
    
    // We need to query student info to check who is registered vs who checked in
    // This allows us to show present vs absent students!
    try {
      // Load all students to resolve details by roll number (case-insensitive)
      const allStudents = await window.AppDB.getAllStudents();
      const studentMapByRoll = new Map(allStudents.map(s => [s.rollNumber.toUpperCase(), s]));

      // Resolve present student details
      const resolvedPresent = (session.presentStudents || []).map(p => {
        let roll = "";
        let name = "";
        let time = "--";
        let photo = null;

        if (typeof p === 'string') {
          roll = p.toUpperCase();
        } else if (p && typeof p === 'object') {
          roll = (p.rollNumber || "").toUpperCase();
          name = p.name || "";
          time = p.timeMarked || "--";
          photo = p.photo || null;
        }

        const dbStudent = studentMapByRoll.get(roll);
        if (dbStudent) {
          if (!name) name = dbStudent.name;
          if (!photo) photo = dbStudent.photo;
        }

        return { rollNumber: roll, name, timeMarked: time, photo };
      });

      const presentMap = new Map(resolvedPresent.map(s => [s.rollNumber, s]));

      // Get students currently registered in this class
      const classRegisteredStudents = allStudents.filter(s => s.classId === session.classId);

      if (classRegisteredStudents.length === 0) {
        // Fallback: If no students registered in this class, just show present list
        resolvedPresent.forEach(present => {
          renderModalRow(present.rollNumber, present.name, present.photo, 'PRESENT', present.timeMarked);
        });
      } else {
        // Sort class students: present first
        const sortedStudents = [...classRegisteredStudents].sort((a, b) => {
          const aPresent = presentMap.has(a.rollNumber.toUpperCase()) ? 1 : 0;
          const bPresent = presentMap.has(b.rollNumber.toUpperCase()) ? 1 : 0;
          return bPresent - aPresent;
        });

        // Track rendered roll numbers to avoid duplicates
        const renderedRolls = new Set();

        sortedStudents.forEach(student => {
          const rollUpper = student.rollNumber.toUpperCase();
          renderedRolls.add(rollUpper);
          
          const checkin = presentMap.get(rollUpper);
          if (checkin) {
            renderModalRow(student.rollNumber, student.name, student.photo || checkin.photo, 'PRESENT', checkin.timeMarked);
          } else {
            renderModalRow(student.rollNumber, student.name, student.photo, 'ABSENT', '--');
          }
        });

        // Also render any present students who were not in the class list
        resolvedPresent.forEach(present => {
          if (!renderedRolls.has(present.rollNumber)) {
            renderModalRow(present.rollNumber, present.name, present.photo, 'PRESENT', present.timeMarked);
          }
        });
      }
    } catch (err) {
      console.error(err);
      // Fallback in case of database error
      (session.presentStudents || []).forEach(p => {
        let roll = "";
        let name = "";
        let time = "--";
        let photo = null;

        if (typeof p === 'string') {
          roll = p.toUpperCase();
        } else if (p && typeof p === 'object') {
          roll = (p.rollNumber || "").toUpperCase();
          name = p.name || "";
          time = p.timeMarked || "--";
          photo = p.photo || null;
        }
        renderModalRow(roll, name, photo, 'PRESENT', time);
      });
    }

    sessionModal.classList.add('active');
  }

  function renderModalRow(roll, name, photo, status, time) {
    const tr = document.createElement('tr');
    const isPresent = status === 'PRESENT';
    const faceImg = photo || 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20viewBox%3D%220%200%2024%2024%22%20fill%3D%22currentColor%22%3E%3Cpath%20d%3D%22M12%2012c2.21%200%204-1.79%204-4s-1.79-4-4-4-4%201.79-4%204%201.79%204%204%204zm0%202c-2.67%200-8%201.34-8%204v2h16v-2c0-2.66-5.33-4-8-4z%22%2F%3E%3C%2Fsvg%3E';
    tr.innerHTML = `
      <td><img src="${faceImg}" class="log-photo" style="width:32px;height:32px;border-radius:8px;" alt="Face"></td>
      <td style="font-weight:600;"><span class="badge badge-blue">${roll}</span></td>
      <td>${name}</td>
      <td>
        <span class="badge ${isPresent ? 'badge-pulse active' : 'badge-pulse inactive'}" style="text-transform:uppercase;">
          ${status}
        </span>
      </td>
      <td style="font-weight:600; color:${isPresent ? 'var(--accent-blue)' : 'var(--text-muted)'}">${time}</td>
    `;
    modalTableBody.appendChild(tr);
  }

  // Close Modals
  const closeModal = () => {
    sessionModal.classList.remove('active');
    selectedSessionForExport = null;
  };

  document.getElementById('btn-modal-close').addEventListener('click', closeModal);
  document.getElementById('btn-modal-close-footer').addEventListener('click', closeModal);
  
  // Close on background overlay click
  sessionModal.addEventListener('click', (e) => {
    if (e.target === sessionModal) closeModal();
  });

  // Modal export CSV trigger
  btnModalExport.addEventListener('click', () => {
    if (selectedSessionForExport) {
      exportSessionToCSV(selectedSessionForExport);
    }
  });


  // --- CSV GENERATOR AND EXPORT UTILITY ---
  async function exportSessionToCSV(session) {
    try {
      // Load all students to resolve details by roll number (case-insensitive)
      const allStudents = await window.AppDB.getAllStudents();
      const studentMapByRoll = new Map(allStudents.map(s => [s.rollNumber.toUpperCase(), s]));

      // Resolve present student details
      const resolvedPresent = (session.presentStudents || []).map(p => {
        let roll = "";
        let name = "";
        let time = "--";

        if (typeof p === 'string') {
          roll = p.toUpperCase();
        } else if (p && typeof p === 'object') {
          roll = (p.rollNumber || "").toUpperCase();
          name = p.name || "";
          time = p.timeMarked || "--";
        }

        const dbStudent = studentMapByRoll.get(roll);
        if (dbStudent) {
          if (!name) name = dbStudent.name;
        }

        return { rollNumber: roll, name, timeMarked: time };
      });

      const presentMap = new Map(resolvedPresent.map(s => [s.rollNumber, s]));

      // Get students currently registered in this class
      const classRegisteredStudents = allStudents.filter(s => s.classId === session.classId);

      // Build CSV contents
      let csvContent = `AURA ATTENDANCE REPORT\n`;
      csvContent += `Lecture/Subject,${session.subject}\n`;
      csvContent += `Class/Section,${session.classId}\n`;
      csvContent += `Date,${session.date}\n`;
      csvContent += `Time Logged,${session.time}\n`;
      csvContent += `Total Enrolled,${classRegisteredStudents.length}\n`;
      csvContent += `Total Present,${resolvedPresent.length}\n\n`;
      
      // Headers
      csvContent += `Roll Number,Student Name,Status,Check-in Time\n`;

      if (classRegisteredStudents.length === 0) {
        // Fallback if database is empty or no registered students in this class
        resolvedPresent.forEach(present => {
          csvContent += `"${present.rollNumber}","${present.name}","PRESENT","${present.timeMarked}"\n`;
        });
      } else {
        const renderedRolls = new Set();

        classRegisteredStudents.forEach(student => {
          const rollUpper = student.rollNumber.toUpperCase();
          renderedRolls.add(rollUpper);
          
          const checkin = presentMap.get(rollUpper);
          if (checkin) {
            csvContent += `"${student.rollNumber}","${student.name}","PRESENT","${checkin.timeMarked}"\n`;
          } else {
            csvContent += `"${student.rollNumber}","${student.name}","ABSENT","--"\n`;
          }
        });

        // Also add present students who are not in the class list
        resolvedPresent.forEach(present => {
          if (!renderedRolls.has(present.rollNumber)) {
            csvContent += `"${present.rollNumber}","${present.name}","PRESENT","${present.timeMarked}"\n`;
          }
        });
      }

      // 3. Generate browser file download download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      
      const fileName = `Attendance_${session.classId}_${session.subject.replace(/[^a-z0-9]/gi, '_')}_${session.date}.csv`;
      link.setAttribute('download', fileName);
      
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      showWorkspaceAlert('success', `CSV Report "${fileName}" downloaded successfully!`);
    } catch (err) {
      showWorkspaceAlert('danger', 'Failed to generate CSV: ' + err.message);
    }
  }

});
