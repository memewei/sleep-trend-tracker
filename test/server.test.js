'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server/index.js');
const { parseCsv, serializeCsv } = require('../server/csv.js');

const OLD_HEADER = 'date,sleep_start,wake_time,sleep_hours,sleep_quality,sugar,alcohol,stretching,coffee';
const HEADER = `${OLD_HEADER},nap_start,nap_wake`;

function tempCsv(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sleep-tracker-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'sleep-data.csv');
}

async function start(t, csvPath) {
  const server = createServer({ csvPath });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  return { server, base };
}

function patch(base, entries) {
  return fetch(`${base}/api/entries`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries }),
  });
}

function rawGet(base, pathname, headers) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    http.get({ hostname, port, path: pathname, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    }).on('error', reject);
  });
}

const FULL = { start: '23:30', wake: '07:15', duration: 7.75, quality: 84, habits: ['sugar', 'coffee'] };

test('CSV keeps every field through a save and load', () => {
  const entries = {
    '2026-11-03': FULL,
    '2026-11-01': { start: '22:00', wake: '06:00', duration: 7, durationManual: true },
    '2026-11-02': { habits: ['alcohol'] },
  };
  const text = serializeCsv(entries);
  assert.equal(text.split('\n')[0], HEADER);
  assert.equal(text.split('\n')[1].slice(0, 10), '2026-11-01', 'rows are in date order');
  assert.deepEqual(parseCsv(text), entries);
});

test('CSV accepts what spreadsheets produce', () => {
  const text = `﻿${HEADER}\r\n2026-11-03,23:30:00,07:15:00,,84,x,,,1\r\n,,,,,,,,\r\n\r\n`;
  assert.deepEqual(parseCsv(text), {
    '2026-11-03': { start: '23:30', wake: '07:15', duration: 7.75, quality: 84, habits: ['sugar', 'coffee'] },
  });
  assert.deepEqual(parseCsv(''), {});
});

test('CSV problems name the line and the value', () => {
  const bad = [
    [`${OLD_HEADER}\n04/11/2026,23:30,07:15,7.75,84,0,0,0,0\n`, /Line 2: date "04\/11\/2026"/],
    [`${OLD_HEADER}\n2026-11-03,23:30,07:15,7.75,500,0,0,0,0\n`, /Line 2: sleep_quality "500"/],
    [`${OLD_HEADER}\n2026-11-03,late,07:15,7.75,84,0,0,0,0\n`, /Line 2: sleep_start "late"/],
    [`${OLD_HEADER}\n2026-11-03,23:30,07:15,99,84,0,0,0,0\n`, /Line 2: sleep_hours "99"/],
    [`${OLD_HEADER}\n2026-11-03,23:30,07:15,7.75,84,maybe,0,0,0\n`, /Line 2: sugar "maybe"/],
    [`${OLD_HEADER}\n2026-11-03,23:30\n`, /Line 2: expected 9 columns/],
    [`${OLD_HEADER}\n2026-11-03,,,,1,0,0,0,0\n2026-11-03,,,,2,0,0,0,0\n`, /Line 3: 2026-11-03 appears more than once/],
    [`${OLD_HEADER},notes\n`, /Unknown columns: notes/],
    ['date,sleep_start\n', /Missing columns: wake_time/],
  ];
  for (const [text, pattern] of bad) assert.throws(() => parseCsv(text), pattern);
});

test('a file saved before naps existed loads, and its rows survive the next save', async (t) => {
  const csvPath = tempCsv(t);
  fs.writeFileSync(csvPath, `${OLD_HEADER}\n2026-08-15,23:59,06:33,6,67,0,1,0,1\n2026-08-16,23:42,10:15,10,91,0,0,0,1\n`);
  const { base } = await start(t, csvPath);
  const { entries } = await (await fetch(`${base}/api/entries`)).json();
  assert.equal(entries['2026-08-15'].duration, 6);
  assert.equal(entries['2026-08-15'].durationManual, true);

  await patch(base, { '2026-08-17': { napStart: '13:00', napWake: '14:30' } });
  assert.equal(fs.readFileSync(csvPath, 'utf8'), [
    HEADER,
    '2026-08-15,23:59,06:33,6,67,0,1,0,1,,',
    '2026-08-16,23:42,10:15,10,91,0,0,0,1,,',
    '2026-08-17,,,,,0,0,0,0,13:00,14:30',
    '',
  ].join('\n'));
  const reloaded = await (await fetch(`${base}/api/entries`)).json();
  assert.deepEqual(reloaded.entries['2026-08-17'], { napStart: '13:00', napWake: '14:30' });
  assert.deepEqual(reloaded.entries['2026-08-15'], entries['2026-08-15']);
});

test('a row may leave off blank nap columns, but not required ones', () => {
  assert.deepEqual(parseCsv(`${HEADER}\n2026-11-03,,,,84,0,0,0,0\n2026-11-04,,,,85,0,0,0,0,13:00\n`), {
    '2026-11-03': { quality: 84 },
    '2026-11-04': { quality: 85, napStart: '13:00' },
  });
  assert.throws(() => parseCsv(`${HEADER}\n2026-11-03,,,,84,0,0,0\n`), /Line 2: expected 11 columns but found 8/);
  assert.throws(() => parseCsv(`${HEADER}\n2026-11-03,,,,84,0,0,0,0,13:00,14:00,extra\n`), /Line 2: expected 11 columns but found 12/);
});

test('bad nap times in the CSV are reported', () => {
  assert.throws(() => parseCsv(`${HEADER}\n2026-11-03,,,,84,0,0,0,0,late,14:00\n`), /Line 2: nap_start "late"/);
  assert.throws(() => parseCsv(`${HEADER}\n2026-11-03,,,,84,0,0,0,0,13:00,soon\n`), /Line 2: nap_wake "soon"/);
});

test('saved data is in the CSV and loads after a restart', async (t) => {
  const csvPath = tempCsv(t);
  const first = await start(t, csvPath);
  assert.equal(fs.existsSync(csvPath), false);
  assert.deepEqual((await (await fetch(`${first.base}/api/entries`)).json()).entries, {});

  assert.equal((await patch(first.base, { '2026-11-03': FULL })).status, 200);
  assert.equal(fs.readFileSync(csvPath, 'utf8'), `${HEADER}\n2026-11-03,23:30,07:15,7.75,84,1,0,0,1,,\n`);
  assert.deepEqual(fs.readdirSync(path.dirname(csvPath)), ['sleep-data.csv'], 'no temp file left behind');

  const second = await start(t, csvPath);
  const body = await (await fetch(`${second.base}/api/entries`)).json();
  assert.deepEqual(body.entries, { '2026-11-03': FULL });
  assert.equal(body.file, 'sleep-data.csv');
});

test('a save keeps hand edits to other days, and null removes a day', async (t) => {
  const csvPath = tempCsv(t);
  const { base } = await start(t, csvPath);
  await patch(base, { '2026-11-03': FULL, '2026-11-04': { quality: 50 } });

  fs.appendFileSync(csvPath, '2026-11-05,,,,66,0,0,0,0,,\n');
  await patch(base, { '2026-11-03': null });

  const { entries } = await (await fetch(`${base}/api/entries`)).json();
  assert.deepEqual(entries, { '2026-11-04': { quality: 50 }, '2026-11-05': { quality: 66 } });
});

test('a CSV with problems is reported and never overwritten', async (t) => {
  const csvPath = tempCsv(t);
  const broken = `${OLD_HEADER}\n2026-11-03,,,,84,0,0,0,0\n04/11/2026,,,,70,0,0,0,0\n`;
  fs.writeFileSync(csvPath, broken);
  const { base } = await start(t, csvPath);

  const load = await fetch(`${base}/api/entries`);
  assert.equal(load.status, 422);
  assert.match((await load.json()).error, /Line 3: date/);

  assert.equal((await patch(base, { '2026-11-06': { quality: 90 } })).status, 422);
  assert.equal(fs.readFileSync(csvPath, 'utf8'), broken);
});

test('a bad update writes nothing at all', async (t) => {
  const csvPath = tempCsv(t);
  const { base } = await start(t, csvPath);
  const response = await patch(base, { '2026-11-03': FULL, '2026-02-30': { quality: 50 } });
  assert.equal(response.status, 400);
  assert.equal((await patch(base, { '2026-11-03': { quality: 999 } })).status, 400);
  assert.equal(fs.existsSync(csvPath), false);
});

test('only the app files are served', async (t) => {
  const csvPath = tempCsv(t);
  const { base } = await start(t, csvPath);
  await patch(base, { '2026-11-03': FULL });
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/js/core.js`)).status, 200);
  for (const pathname of ['/sleep-data.csv', '/package.json', '/server/index.js', '/js/../package.json', '/%2e%2e/package.json']) {
    assert.equal(await rawGet(base, pathname), 404, pathname);
  }
});

test('requests from other websites are refused', async (t) => {
  const { base } = await start(t, tempCsv(t));
  assert.equal(await rawGet(base, '/api/entries', { Host: 'evil.example' }), 403);
  const response = await fetch(`${base}/api/entries`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
    body: '{"entries":{}}',
  });
  assert.equal(response.status, 403);
  const notJson = await fetch(`${base}/api/entries`, { method: 'PATCH', body: '{"entries":{}}', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(notJson.status, 415);
});
