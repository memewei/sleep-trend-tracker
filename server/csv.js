// Reads and writes the CSV file that holds all sleep data.
'use strict';

const fs = require('node:fs');
const Core = require('../js/core.js');

const REQUIRED_COLUMNS = ['date', 'sleep_start', 'wake_time', 'sleep_hours', 'sleep_quality', ...Core.HABITS];
// Files saved before naps existed don't have these. The next save adds them.
const OPTIONAL_COLUMNS = ['nap_start', 'nap_wake'];
const COLUMNS = [...REQUIRED_COLUMNS, ...OPTIONAL_COLUMNS];
const TRUE_FLAGS = new Set(['1', 'x', 'yes', 'true']);
const FALSE_FLAGS = new Set(['', '0', 'no', 'false']);

// Thrown when the file can't be fully understood. Rewriting it would lose whatever we
// couldn't read, so callers must not write until the user has fixed it.
class CsvProblem extends Error {
  constructor(problems) {
    super(`The CSV file needs fixing before it can be used. ${problems.join(' ')}`);
    this.problems = problems;
  }
}

function splitLine(line) {
  return line.split(',').map((field) => field.trim().replace(/^"(.*)"$/, '$1').trim());
}

// Spreadsheets often save times with seconds, such as 23:30:00.
function normalizeTime(value) {
  return value.replace(/^(\d{1,2}:\d{2}):\d{2}$/, '$1');
}

function parseRow(fields, lineNumber, problems) {
  const report = (column, value, rule) => {
    problems.push(`Line ${lineNumber}: ${column} "${value}" ${rule}.`);
  };
  const raw = {};

  if (fields.sleep_start) {
    raw.start = normalizeTime(fields.sleep_start);
    if (Core.parseTime(raw.start) === null) report('sleep_start', fields.sleep_start, 'must be a time like 23:30');
  }
  if (fields.wake_time) {
    raw.wake = normalizeTime(fields.wake_time);
    if (Core.parseTime(raw.wake) === null) report('wake_time', fields.wake_time, 'must be a time like 07:15');
  }
  if (fields.sleep_hours) {
    raw.duration = fields.sleep_hours;
    if (Core.parseDuration(raw.duration) === null) report('sleep_hours', fields.sleep_hours, 'must be above 0 and at most 24');
  }
  if (fields.sleep_quality) {
    raw.quality = fields.sleep_quality;
    if (Core.parseQuality(raw.quality) === null) report('sleep_quality', fields.sleep_quality, 'must be a whole number from 1 to 100');
  }

  if (fields.nap_start) {
    raw.napStart = normalizeTime(fields.nap_start);
    if (Core.parseTime(raw.napStart) === null) report('nap_start', fields.nap_start, 'must be a time like 13:30');
  }
  if (fields.nap_wake) {
    raw.napWake = normalizeTime(fields.nap_wake);
    if (Core.parseTime(raw.napWake) === null) report('nap_wake', fields.nap_wake, 'must be a time like 14:15');
  }

  raw.habits = [];
  for (const habit of Core.HABITS) {
    const flag = fields[habit].toLowerCase();
    if (TRUE_FLAGS.has(flag)) raw.habits.push(habit);
    else if (!FALSE_FLAGS.has(flag)) report(habit, fields[habit], 'must be 1 or 0');
  }
  return raw;
}

function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  const firstLine = lines.findIndex((line) => line.trim() !== '');
  if (firstLine === -1) return {};

  const header = splitLine(lines[firstLine]);
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  const unknown = header.filter((column) => !COLUMNS.includes(column));
  const problems = [];
  if (missing.length) problems.push(`Missing columns: ${missing.join(', ')}.`);
  // Extra columns would be silently dropped by the next save.
  if (unknown.length) problems.push(`Unknown columns: ${unknown.join(', ')}.`);
  if (problems.length) throw new CsvProblem(problems);

  const entries = {};
  for (let i = firstLine + 1; i < lines.length; i += 1) {
    const values = splitLine(lines[i]);
    if (values.every((value) => value === '')) continue;
    const lineNumber = i + 1;
    // Hand-added rows and some spreadsheets leave off blank columns at the end of a row.
    // That's fine for optional columns, which are simply empty.
    if (values.length < header.length && header.slice(values.length).every((column) => OPTIONAL_COLUMNS.includes(column))) {
      values.push(...new Array(header.length - values.length).fill(''));
    }
    if (values.length !== header.length) {
      problems.push(`Line ${lineNumber}: expected ${header.length} columns but found ${values.length}.`);
      continue;
    }
    const fields = Object.fromEntries(header.map((column, index) => [column, values[index]]));
    if (!Core.isValidDateKey(fields.date)) {
      problems.push(`Line ${lineNumber}: date "${fields.date}" must look like 2026-11-04.`);
      continue;
    }
    if (entries[fields.date]) {
      problems.push(`Line ${lineNumber}: ${fields.date} appears more than once.`);
      continue;
    }
    const countBefore = problems.length;
    const raw = parseRow(fields, lineNumber, problems);
    if (problems.length > countBefore) continue;
    const entry = Core.sanitizeEntry(raw);
    if (entry) entries[fields.date] = entry;
  }
  if (problems.length) throw new CsvProblem(problems);
  return entries;
}

function serializeCsv(entries) {
  const rows = Object.keys(entries).sort().map((date) => {
    const entry = entries[date];
    const optional = (value) => (value === undefined ? '' : String(value));
    return [
      date, optional(entry.start), optional(entry.wake), optional(entry.duration), optional(entry.quality),
      ...Core.HABITS.map((habit) => ((entry.habits || []).includes(habit) ? '1' : '0')),
      optional(entry.napStart), optional(entry.napWake),
    ].join(',');
  });
  return `${[COLUMNS.join(','), ...rows].join('\n')}\n`;
}

function readEntries(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  return parseCsv(text);
}

// Writes to a temporary file first, so a crash mid-save can't leave a half-written CSV.
function writeEntries(file, entries) {
  const temp = `${file}.tmp-${process.pid}`;
  try {
    const handle = fs.openSync(temp, 'w');
    try {
      fs.writeSync(handle, serializeCsv(entries));
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

module.exports = { COLUMNS, CsvProblem, parseCsv, serializeCsv, readEntries, writeEntries };
