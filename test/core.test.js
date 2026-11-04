'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../js/core.js');

test('duration crosses midnight', () => {
  assert.equal(Core.durationFromTimes('23:30', '07:00'), 7.5);
  assert.equal(Core.durationFromTimes('01:00', '09:15'), 8.25);
  assert.equal(Core.durationFromTimes('14:00', '15:30'), 1.5);
});

test('duration is unknown when a time is missing or the times match', () => {
  assert.equal(Core.durationFromTimes('23:30', undefined), null);
  assert.equal(Core.durationFromTimes('07:00', '07:00'), null);
});

test('parseDuration accepts decimals and h:mm, and rejects out-of-range values', () => {
  assert.equal(Core.parseDuration('7.5'), 7.5);
  assert.equal(Core.parseDuration('7:30'), 7.5);
  assert.equal(Core.parseDuration('24'), 24);
  for (const bad of ['0', '24.5', '-1', 'abc', '7:75', '']) {
    assert.equal(Core.parseDuration(bad), null, bad);
  }
});

test('parseQuality only accepts whole numbers from 1 to 100', () => {
  assert.equal(Core.parseQuality('1'), 1);
  assert.equal(Core.parseQuality('100'), 100);
  for (const bad of ['0', '101', '84.5', '-5', 'good', '']) {
    assert.equal(Core.parseQuality(bad), null, bad);
  }
});

test('calendar helpers handle month lengths and year boundaries', () => {
  assert.equal(Core.daysInMonth('2028-02'), 29);
  assert.equal(Core.daysInMonth('2026-02'), 28);
  assert.equal(Core.daysInMonth('2026-11'), 30);
  assert.equal(Core.shiftMonth('2026-12', 1), '2027-01');
  assert.equal(Core.shiftMonth('2026-01', -1), '2025-12');
  assert.equal(Core.isValidDateKey('2026-02-29'), false);
  assert.equal(Core.isValidDateKey('2028-02-29'), true);
});

test('average clock time wraps around midnight', () => {
  const avg = Core.circularMeanMinutes([Core.parseTime('23:30'), Core.parseTime('00:30')]);
  const distanceFromMidnight = Math.min(avg, 1440 - avg);
  assert.ok(distanceFromMidnight < 0.001, `got ${avg}`);
  assert.equal(Core.circularMeanMinutes([]), null);
});

test('duration follows the times until it is typed over', () => {
  let { entry } = Core.updateEntry(undefined, 'start', '23:00');
  assert.equal(entry.duration, undefined);
  ({ entry } = Core.updateEntry(entry, 'wake', '07:00'));
  assert.equal(entry.duration, 8);

  ({ entry } = Core.updateEntry(entry, 'duration', '7.25'));
  assert.equal(entry.duration, 7.25);
  ({ entry } = Core.updateEntry(entry, 'wake', '07:30'));
  assert.equal(entry.duration, 7.25, 'a typed duration survives time edits');

  ({ entry } = Core.updateEntry(entry, 'duration', ''));
  assert.equal(entry.duration, 8.5, 'clearing returns to the calculated value');

  ({ entry } = Core.updateEntry(entry, 'wake', ''));
  assert.equal(entry.duration, undefined, 'a calculated duration goes when its time goes');
});

test('time bar positions run noon to noon and snap to the step', () => {
  assert.equal(Core.timeToPosition(Core.parseTime('12:00')), 0);
  assert.equal(Core.timeToPosition(Core.parseTime('00:00')), 0.5);
  assert.equal(Core.formatClock(Core.positionToMinutes(0.5, 5)), '00:00');
  assert.equal(Core.formatClock(Core.positionToMinutes(0.25, 5)), '18:00');
  assert.equal(Core.formatClock(Core.positionToMinutes(1, 5)), '12:00');
  assert.equal(Core.formatClock(Core.positionToMinutes(-0.2, 5)), '12:00', 'clamped at the left edge');
  assert.equal(Core.formatClock(Core.positionToMinutes(1.2, 5)), '12:00', 'clamped at the right edge');
  assert.equal(Core.positionToMinutes(0.5007, 5) % 5, 0);
});

test('keyboard steps land on the grid and wrap around midnight', () => {
  const step = (time, direction, size) => Core.formatClock(Core.stepMinutes(Core.parseTime(time), direction, size));
  assert.equal(step('23:00', 1, 5), '23:05');
  assert.equal(step('23:00', -1, 5), '22:55');
  assert.equal(step('06:16', 1, 5), '06:20');
  assert.equal(step('06:16', -1, 5), '06:15');
  assert.equal(step('23:55', 1, 5), '00:00');
  assert.equal(step('00:00', -1, 5), '23:55');
  assert.equal(step('23:10', 1, 30), '23:30');
});

test('setTimes follows the same duration rules as typed edits', () => {
  let entry = Core.setTimes(undefined, '23:30', '07:15');
  assert.equal(entry.duration, 7.75);
  entry = Core.setTimes(entry, '23:30', undefined);
  assert.equal(entry.wake, undefined);
  assert.equal(entry.duration, undefined);
  const typed = Core.updateEntry(Core.setTimes(undefined, '23:00', '07:00'), 'duration', '6').entry;
  assert.equal(Core.setTimes(typed, '22:00', '07:00').duration, 6, 'typed hours are kept');
  assert.equal(Core.isEmptyEntry(Core.setTimes(undefined, undefined, undefined)), true);
});

test('naps are stored separately and only count when included', () => {
  let entry = Core.setTimes(undefined, '23:00', '07:00');
  entry = Core.setNap(entry, '13:00', '14:30');
  assert.equal(entry.duration, 8, 'a nap never changes the night');
  assert.equal(Core.napHours(entry), 1.5);
  assert.equal(Core.setTimes(entry, '23:00', '06:00').duration, 7, 'moving the night keeps the nap apart');

  const data = { entries: { '2026-11-01': entry, '2026-11-02': { duration: 7 }, '2026-11-03': { napStart: '13:00', napWake: '14:00' } } };
  assert.equal(Core.withNaps(data, false), data);
  const included = Core.withNaps(data, true).entries;
  assert.equal(included['2026-11-01'].duration, 9.5);
  assert.equal(included['2026-11-01'].nightDuration, 8);
  assert.equal(included['2026-11-02'].duration, 7);
  assert.equal(included['2026-11-03'].duration, undefined, 'a nap with no night is not plotted');
  assert.equal(data.entries['2026-11-01'].duration, 8, 'the saved data is untouched');
  assert.equal(Core.summarizeMonth({ entries: included }, '2026-11').avgDuration, 8.25);

  const cleared = Core.setNap(Core.setNap(undefined, '13:00', undefined), undefined, undefined);
  assert.equal(Core.isEmptyEntry(cleared), true);
  assert.equal(Core.isEmptyEntry({ napStart: '13:00' }), false);
  assert.equal(Core.napHours({ napStart: '13:00' }), null, 'an unfinished nap counts as nothing');
});

test('linearFit recovers a known line and refuses when it has too little', () => {
  const fit = Core.linearFit([{ x: 1, y: 5 }, { x: 2, y: 7 }, { x: 3, y: 9 }, { x: 4, y: 11 }]);
  assert.ok(Math.abs(fit.slope - 2) < 1e-9);
  assert.ok(Math.abs(fit.intercept - 3) < 1e-9);
  assert.ok(Math.abs(fit.r - 1) < 1e-9);
  const noisy = Core.linearFit([{ x: 1, y: 3 }, { x: 2, y: 1 }, { x: 3, y: 2 }]);
  assert.ok(Math.abs(noisy.r + 0.5) < 1e-9);
  assert.equal(Core.linearFit([{ x: 1, y: 1 }, { x: 2, y: 2 }]), null, 'too few points');
  assert.equal(Core.linearFit([{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }]), null, 'no spread in x');
  assert.equal(Core.linearFit([{ x: 1, y: 2 }, { x: 2, y: 2 }, { x: 3, y: 2 }]), null, 'no spread in y');
});

test('rolling series covers every calendar day and needs enough nights', () => {
  const entries = {};
  for (let d = 1; d <= 4; d += 1) entries[`2026-10-0${d}`] = { duration: d, quality: d * 10, start: '23:00' };
  entries['2026-10-20'] = { duration: 9, quality: 90, start: '23:00' };
  const series = Core.rollingSeries({ entries }, 7, 4);
  assert.equal(series.length, 20, 'one point per day, including unlogged ones');
  assert.equal(series[0].date, '2026-10-01');
  assert.equal(series[2].hours, null, 'only 3 nights so far');
  assert.equal(series[3].hours, 2.5);
  assert.equal(series[3].quality, 25);
  assert.equal(series[3].startVariation, 0);
  assert.equal(series[6].hours, 2.5, 'days without a log still average their window');
  assert.equal(series[7].hours, null, 'the window has moved past too many nights');
  assert.equal(series[19].hours, null, 'one night alone is not enough');
  assert.equal(series[19].night.hours, 9);
  assert.equal(series[10].night, null);
  assert.deepEqual(Core.rollingSeries({ entries: {} }, 7, 4), []);
});

test('rolling start variation treats times either side of midnight as close', () => {
  const entries = {
    '2026-10-01': { start: '23:30' },
    '2026-10-02': { start: '00:30' },
    '2026-10-03': { start: '23:30' },
    '2026-10-04': { start: '00:30' },
  };
  assert.equal(Core.rollingSeries({ entries }, 7, 4)[3].startVariation, 30);
});

test('rolling series crosses month and year boundaries', () => {
  const entries = {};
  for (const date of ['2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01']) entries[date] = { duration: 8 };
  const series = Core.rollingSeries({ entries }, 7, 4);
  assert.deepEqual(series.map((s) => s.date), ['2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01']);
  assert.equal(series[3].hours, 8);
});

test('invalid input reports an error and leaves the original entry alone', () => {
  const original = { quality: 80 };
  const result = Core.updateEntry(original, 'quality', '500');
  assert.ok(result.error);
  assert.equal(result.entry, undefined);
  assert.deepEqual(original, { quality: 80 });
});

test('habit toggling keeps a fixed order and removes the field when empty', () => {
  let entry = Core.toggleHabit(undefined, 'coffee');
  entry = Core.toggleHabit(entry, 'sugar');
  assert.deepEqual(entry.habits, ['sugar', 'coffee']);
  entry = Core.toggleHabit(Core.toggleHabit(entry, 'sugar'), 'coffee');
  assert.equal(Core.isEmptyEntry(entry), true);
});

test('sanitizeData keeps valid fields and counts what it drops', () => {
  const { data, count, skipped, valid } = Core.sanitizeData({
    entries: {
      '2026-11-01': { start: '23:00', wake: '07:00', duration: 8, quality: 80, habits: ['coffee', 'nonsense'] },
      '2026-11-02': { quality: 999, start: 'late' },
      '2026-02-30': { quality: 50 },
      'not-a-date': { quality: 50 },
    },
  });
  assert.equal(valid, true);
  assert.equal(count, 1);
  assert.equal(skipped, 3);
  assert.deepEqual(data.entries['2026-11-01'].habits, ['coffee']);
  assert.equal(Core.sanitizeData({ nope: true }).valid, false);
  assert.equal(Core.sanitizeData(null).valid, false);
});

test('an imported duration the times do not explain survives later time edits', () => {
  const { data } = Core.sanitizeData({
    entries: {
      '2026-11-01': { duration: 7.5 },
      '2026-11-02': { start: '23:00', wake: '07:00', duration: 8 },
    },
  });
  assert.equal(data.entries['2026-11-01'].durationManual, true);
  assert.equal(data.entries['2026-11-02'].durationManual, undefined);
  const { entry } = Core.updateEntry(data.entries['2026-11-01'], 'start', '23:00');
  assert.equal(entry.duration, 7.5);
});

test('summarizeMonth averages each field over the nights that have it', () => {
  const data = {
    entries: {
      '2026-10-01': { start: '23:00', wake: '07:00', duration: 8, quality: 80, habits: ['coffee'] },
      '2026-10-02': { start: '01:00', wake: '07:00', duration: 6, habits: ['coffee', 'sugar'] },
      '2026-10-03': { habits: ['sugar'] },
      '2026-11-01': { duration: 12, quality: 1 },
    },
  };
  const s = Core.summarizeMonth(data, '2026-10');
  assert.equal(s.nights, 2);
  assert.equal(s.avgDuration, 7);
  assert.equal(s.avgQuality, 80);
  assert.equal(Core.formatClock(s.avgStart), '00:00');
  assert.equal(s.nightsInTarget, 1);
  assert.equal(s.nightsWithDuration, 2);
  assert.deepEqual(s.habits, { sugar: 2, alcohol: 0, stretching: 0, coffee: 2 });
  assert.deepEqual(Core.monthsWithData(data), ['2026-11', '2026-10']);
});

test('bedtimes either side of midnight sit together on the axis', () => {
  const { value, format } = Core.METRICS.bedtime;
  assert.equal(value({ start: '23:00' }), 11);
  assert.equal(value({ start: '01:00' }), 13);
  assert.equal(value(null), null);
  assert.equal(format(13), '01:00');
});

test('duration axis keeps the paper chart range and grows for outliers', () => {
  const standard = Core.axisFor('duration', [8, null, 6.5]);
  assert.equal(standard.ticks[0], 5);
  assert.equal(standard.ticks.at(-1), 12);
  assert.deepEqual(standard.guides, [7, 9]);
  const outliers = Core.axisFor('duration', [3.5, 14.2]);
  assert.equal(outliers.ticks[0], 3);
  assert.equal(outliers.ticks.at(-1), 15);
});

test('clock axes stay within a day and span at least four hours', () => {
  for (const values of [[], [0.2], [23.9], [11, 13], [0, 23.5]]) {
    const axis = Core.axisFor('wake', values);
    assert.ok(axis.min >= 0 && axis.max <= 24, JSON.stringify(axis));
    assert.ok(axis.max - axis.min >= 4, JSON.stringify(axis));
    for (const v of values) assert.ok(v >= axis.min && v <= axis.max, `${v} in ${JSON.stringify(axis)}`);
  }
});
