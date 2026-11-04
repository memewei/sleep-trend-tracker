// Serves the app on this computer only and keeps its data in a CSV file.
'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const Core = require('../js/core.js');
const { CsvProblem, readEntries, writeEntries } = require('./csv.js');

const ROOT = path.resolve(__dirname, '..');
const MAX_BODY_BYTES = 5 * 1024 * 1024;

// An explicit list, so the CSV and anything else in the folder are never served as files.
const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/js/core.js': ['js/core.js', 'text/javascript; charset=utf-8'],
  '/js/charts.js': ['js/charts.js', 'text/javascript; charset=utf-8'],
  '/js/time-track.js': ['js/time-track.js', 'text/javascript; charset=utf-8'],
  '/js/app.js': ['js/app.js', 'text/javascript; charset=utf-8'],
};

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) tooLarge = true;
      else chunks.push(chunk);
    });
    req.on('error', reject);
    req.on('end', () => {
      if (tooLarge) {
        reject(new RequestError(413, 'That update is too large.'));
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new RequestError(400, 'The request was not valid JSON.'));
      }
    });
  });
}

// Validates every change before anything is written, so a bad update changes nothing.
function validateChanges(body) {
  const changes = body && typeof body === 'object' ? body.entries : null;
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new RequestError(400, 'Expected an "entries" object.');
  }
  const clean = {};
  for (const [date, value] of Object.entries(changes)) {
    if (!Core.isValidDateKey(date)) throw new RequestError(400, `Invalid date: ${date}`);
    if (value === null) {
      clean[date] = null;
    } else {
      const entry = Core.sanitizeEntry(value);
      if (!entry) throw new RequestError(400, `Invalid entry for ${date}`);
      clean[date] = entry;
    }
  }
  return clean;
}

// Reads the file fresh for each save and touches only the changed days, so edits made to
// the CSV while the app is open are kept. The synchronous calls keep each save whole.
function applyChanges(csvPath, changes) {
  const entries = readEntries(csvPath);
  for (const [date, entry] of Object.entries(changes)) {
    if (entry === null) delete entries[date];
    else entries[date] = entry;
  }
  fs.mkdirSync(path.dirname(csvPath), { recursive: true });
  writeEntries(csvPath, entries);
}

function createServer({ csvPath }) {
  const fileInfo = { file: path.basename(csvPath), path: csvPath };

  const server = http.createServer(async (req, res) => {
    try {
      // Stops other websites reaching this server through the visitor's browser.
      const { port } = server.address();
      const allowedHosts = [`localhost:${port}`, `127.0.0.1:${port}`];
      if (!allowedHosts.includes(req.headers.host)) throw new RequestError(403, 'Forbidden.');
      const { origin } = req.headers;
      if (origin && !allowedHosts.map((host) => `http://${host}`).includes(origin)) {
        throw new RequestError(403, 'Forbidden.');
      }

      const { pathname } = new URL(req.url, 'http://localhost');

      if (pathname === '/api/entries') {
        if (req.method === 'GET') {
          sendJson(res, 200, { ...fileInfo, entries: readEntries(csvPath) });
          return;
        }
        if (req.method === 'PATCH') {
          if (!/^application\/json\b/.test(req.headers['content-type'] || '')) {
            throw new RequestError(415, 'Expected JSON.');
          }
          applyChanges(csvPath, validateChanges(await readJsonBody(req)));
          sendJson(res, 200, fileInfo);
          return;
        }
        throw new RequestError(405, 'Method not allowed.');
      }

      if (pathname === '/favicon.ico') {
        res.writeHead(204);
        res.end();
        return;
      }

      const asset = STATIC_FILES[pathname];
      if (!asset || (req.method !== 'GET' && req.method !== 'HEAD')) throw new RequestError(404, 'Not found.');
      const content = fs.readFileSync(path.join(ROOT, asset[0]));
      res.writeHead(200, { 'Content-Type': asset[1], 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (error instanceof CsvProblem) {
        sendJson(res, 422, { error: error.message, problems: error.problems });
      } else if (error instanceof RequestError) {
        sendJson(res, error.status, { error: error.message });
      } else {
        console.error(error);
        sendJson(res, 500, { error: `Could not access ${fileInfo.file}: ${error.message}` });
      }
    }
  });
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 4173;
  const csvPath = path.resolve(process.env.SLEEP_CSV || path.join(ROOT, 'sleep-data.csv'));
  const server = createServer({ csvPath });
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${port} is already in use. Close whatever is using it, or run: PORT=4174 npm start`);
      process.exit(1);
    }
    throw error;
  });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Sleep tracker: http://localhost:${port}`);
    console.log(`Data file:     ${csvPath}`);
  });
}

module.exports = { createServer };
