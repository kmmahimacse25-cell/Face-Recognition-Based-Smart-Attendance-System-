/**
 * server.js - Zero-dependency Local Static File Web Server
 * Used to host the Smart Attendance System and satisfy webcam secure origin permissions (localhost).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3000;

// MIME types mapping for all application assets
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.bin': 'application/octet-stream', // Crucial for loading face-api binary weight shards
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((req, res) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);

  // Normalize request path and resolve it relative to the server root
  let filePath = req.url === '/' ? '/index.html' : req.url;
  filePath = path.join(__dirname, filePath);

  // Security check: prevent directory traversal attacks (ensure file stays inside root)
  if (!filePath.startsWith(__dirname)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('403 Forbidden: Directory traversal blocked.');
    return;
  }

  // Check if file exists
  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found: The requested resource does not exist.');
      return;
    }

    // Determine correct MIME type
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Set headers and stream the file contents
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
      'X-Content-Type-Options': 'nosniff'
    });

    const readStream = fs.createReadStream(filePath);
    readStream.on('error', (streamErr) => {
      console.error('Error streaming file:', streamErr);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
      }
    });
    readStream.pipe(res);
  });
});

server.listen(PORT, 'localhost', () => {
  console.log('===============================================================');
  console.log('    AURA - Smart Face Recognition Attendance Tracking System    ');
  console.log('===============================================================');
  console.log(`\nServer is running securely at:`);
  console.log(`>>> http://localhost:${PORT}/ <<<\n`);
  console.log('Keep this terminal running and open the link above in Chrome/Edge.');
  console.log('Press Ctrl+C to terminate the server.\n');
});
