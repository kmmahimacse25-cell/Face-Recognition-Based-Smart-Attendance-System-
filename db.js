/**
 * db.js - Smart Attendance Database Wrapper (IndexedDB)
 */

class SmartAttendanceDB {
  constructor() {
    this.dbName = 'SmartAttendanceDB';
    this.dbVersion = 1;
    this.db = null;
  }

  /**
   * Initialize the database and create stores if they don't exist
   */
  init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = (event) => {
        console.error('Database failed to open:', event.target.error);
        reject(event.target.error);
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        console.log('Database initialized successfully.');
        resolve(this);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Faculty store: key is username
        if (!db.objectStoreNames.contains('faculty')) {
          db.createObjectStore('faculty', { keyPath: 'username' });
        }

        // Students store: auto-incrementing id
        if (!db.objectStoreNames.contains('students')) {
          const studentStore = db.createObjectStore('students', { keyPath: 'id', autoIncrement: true });
          studentStore.createIndex('classId', 'classId', { unique: false });
          studentStore.createIndex('rollNumber', 'rollNumber', { unique: false });
          // Combined index to quickly check if a roll number exists in a class
          studentStore.createIndex('class_roll', ['classId', 'rollNumber'], { unique: true });
        }

        // Attendance sessions store: auto-incrementing id
        if (!db.objectStoreNames.contains('attendance')) {
          const attendanceStore = db.createObjectStore('attendance', { keyPath: 'id', autoIncrement: true });
          attendanceStore.createIndex('date', 'date', { unique: false });
          attendanceStore.createIndex('classId', 'classId', { unique: false });
        }
      };
    });
  }

  // --- FACULTY ACCOUNT MANAGEMENT ---

  registerFaculty(username, password) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['faculty'], 'readwrite');
      const store = transaction.objectStore('faculty');

      // Check if user already exists
      const checkRequest = store.get(username);
      checkRequest.onsuccess = () => {
        if (checkRequest.result) {
          reject(new Error('Faculty username already exists.'));
          return;
        }

        // Add new faculty with empty subjects array
        const addRequest = store.add({ username, password, subjects: [] });
        addRequest.onsuccess = () => resolve(true);
        addRequest.onerror = (e) => reject(e.target.error);
      };
    });
  }

  addFacultySubject(username, subjectName) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['faculty'], 'readwrite');
      const store = transaction.objectStore('faculty');
      const request = store.get(username);

      request.onsuccess = () => {
        const faculty = request.result;
        if (!faculty) {
          reject(new Error('Faculty profile not found.'));
          return;
        }

        if (!faculty.subjects) {
          faculty.subjects = [];
        }

        // Case-insensitive duplicate check
        const isDuplicate = faculty.subjects.some(sub => sub.toLowerCase() === subjectName.toLowerCase());
        if (isDuplicate) {
          reject(new Error(`Subject "${subjectName}" is already registered on your profile.`));
          return;
        }

        faculty.subjects.push(subjectName);
        const updateRequest = store.put(faculty);

        updateRequest.onsuccess = () => resolve(faculty.subjects);
        updateRequest.onerror = (e) => reject(e.target.error);
      };

      request.onerror = (e) => reject(e.target.error);
    });
  }

  loginFaculty(username, password) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['faculty'], 'readonly');
      const store = transaction.objectStore('faculty');
      const request = store.get(username);

      request.onsuccess = () => {
        const user = request.result;
        if (user && user.password === password) {
          resolve({ username: user.username });
        } else {
          reject(new Error('Invalid username or password.'));
        }
      };

      request.onerror = (e) => reject(e.target.error);
    });
  }

  hasFaculty() {
    return new Promise((resolve) => {
      const transaction = this.db.transaction(['faculty'], 'readonly');
      const store = transaction.objectStore('faculty');
      const request = store.count();
      request.onsuccess = () => resolve(request.result > 0);
      request.onerror = () => resolve(false);
    });
  }

  // --- STUDENT DATABASE MANAGEMENT ---

  addStudent(student) {
    // student format: { name, rollNumber, classId, faceDescriptor: Array/Float32Array, photo: base64 }
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['students'], 'readwrite');
      const store = transaction.objectStore('students');

      // Check if roll number already exists in this class
      const classRollIndex = store.index('class_roll');
      const checkRequest = classRollIndex.get([student.classId, student.rollNumber]);

      checkRequest.onsuccess = () => {
        if (checkRequest.result) {
          reject(new Error(`Roll number ${student.rollNumber} is already registered in class ${student.classId}.`));
          return;
        }

        const addRequest = store.add(student);
        addRequest.onsuccess = (e) => resolve(e.target.result); // Returns the generated ID
        addRequest.onerror = (e) => reject(e.target.error);
      };
      
      checkRequest.onerror = (e) => reject(e.target.error);
    });
  }

  getAllStudents() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['students'], 'readonly');
      const store = transaction.objectStore('students');
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  getStudentsByClass(classId) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['students'], 'readonly');
      const store = transaction.objectStore('students');
      const index = store.index('classId');
      const request = index.getAll(classId);

      request.onsuccess = () => resolve(request.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  deleteStudent(id) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['students'], 'readwrite');
      const store = transaction.objectStore('students');
      const request = store.delete(id);

      request.onsuccess = () => resolve(true);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  // --- ATTENDANCE SESSION MANAGEMENT ---

  saveAttendanceSession(session) {
    // session format: { date, time, classId, subject, presentStudents: [{ rollNumber, name, timeMarked }] }
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['attendance'], 'readwrite');
      const store = transaction.objectStore('attendance');
      const request = store.add(session);

      request.onsuccess = (e) => resolve(e.target.result);
      request.onerror = (e) => reject(e.target.error);
    });
  }

  getAllAttendanceSessions() {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['attendance'], 'readonly');
      const store = transaction.objectStore('attendance');
      const request = store.getAll();

      request.onsuccess = () => {
        // Sort sessions by date and time descending (newest first)
        const sorted = request.result.sort((a, b) => {
          const dateTimeA = new Date(`${a.date}T${a.time}`);
          const dateTimeB = new Date(`${b.date}T${b.time}`);
          return dateTimeB - dateTimeA;
        });
        resolve(sorted);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  deleteAttendanceSession(id) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction(['attendance'], 'readwrite');
      const store = transaction.objectStore('attendance');
      const request = store.delete(id);

      request.onsuccess = () => resolve(true);
      request.onerror = (e) => reject(e.target.error);
    });
  }
}

// Export database class globally so we don't need imports in our vanilla script
window.AppDB = new SmartAttendanceDB();
