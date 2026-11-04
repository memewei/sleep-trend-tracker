// Pure data logic: no DOM, so it can run under `node --test` as well as in the page.
(function (root) {
  'use strict';

  const HABITS = ['sugar', 'alcohol', 'stretching', 'coffee'];
  const TARGET_HOURS = [7, 9];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const MINUTES_PER_DAY = 1440;
  const NOON = 720;

  const pad = (n) => String(n).padStart(2, '0');
  const mod = (n, m) => ((n % m) + m) % m;
  const round2 = (n) => Math.round(n * 100) / 100;
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

  // --- Dates. Months are "YYYY-MM" keys, days are "YYYY-MM-DD" keys. ---

  function monthKey(year, monthIndex) {
    return `${year}-${pad(monthIndex + 1)}`;
  }

  function dateKey(ym, day) {
    return `${ym}-${pad(day)}`;
  }

  function daysInMonth(ym) {
    const [y, m] = ym.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  }

  function shiftMonth(ym, delta) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return monthKey(d.getFullYear(), d.getMonth());
  }

  function monthLabel(ym, short) {
    const [y, m] = ym.split('-').map(Number);
    const name = MONTH_NAMES[m - 1];
    return short ? `${name.slice(0, 3)} ${y}` : `${name} ${y}`;
  }

  function isValidDateKey(key) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
    const [y, m, d] = key.split('-').map(Number);
    return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(`${y}-${pad(m)}`);
  }

  // --- Times and durations. ---

  function parseTime(value) {
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value).trim());
    if (!match) return null;
    const h = Number(match[1]);
    const m = Number(match[2]);
    return h <= 23 && m <= 59 ? h * 60 + m : null;
  }

  function formatClock(minutes) {
    const total = mod(Math.round(minutes), MINUTES_PER_DAY);
    return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
  }

  // Hours from start to wake. A wake time "before" the start means the next morning.
  function durationFromTimes(start, wake) {
    const s = parseTime(start);
    const w = parseTime(wake);
    if (s === null || w === null || s === w) return null;
    return round2(mod(w - s, MINUTES_PER_DAY) / 60);
  }

  // Accepts decimal hours ("7.5") or hours:minutes ("7:30").
  function parseDuration(value) {
    const text = String(value).trim();
    let hours = null;
    const clock = /^(\d{1,2}):(\d{2})$/.exec(text);
    if (clock && Number(clock[2]) <= 59) {
      hours = Number(clock[1]) + Number(clock[2]) / 60;
    } else if (/^\d+(\.\d+)?$/.test(text) || /^\.\d+$/.test(text)) {
      hours = Number(text);
    }
    if (hours === null || hours <= 0 || hours > 24) return null;
    return round2(hours);
  }

  function formatHours(hours) {
    const totalMinutes = Math.round(hours * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }

  function parseQuality(value) {
    const text = String(value).trim();
    if (!/^\d+$/.test(text)) return null;
    const n = Number(text);
    return n >= 1 && n <= 100 ? n : null;
  }

  // Clock times wrap at midnight, so a plain average of 23:30 and 00:30 would give noon.
  function circularMeanMinutes(minutes) {
    if (minutes.length === 0) return null;
    let x = 0;
    let y = 0;
    for (const m of minutes) {
      const angle = (m / MINUTES_PER_DAY) * 2 * Math.PI;
      x += Math.cos(angle);
      y += Math.sin(angle);
    }
    const angle = Math.atan2(y, x);
    return mod((angle / (2 * Math.PI)) * MINUTES_PER_DAY, MINUTES_PER_DAY);
  }

  // --- Entries. ---
  // { start: "23:15", wake: "07:00", duration: 7.75, durationManual: false,
  //   quality: 84, habits: ["coffee"] }. Absent fields are simply not present.

  function isEmptyEntry(entry) {
    return !entry || (entry.start === undefined && entry.wake === undefined &&
      entry.duration === undefined && entry.quality === undefined &&
      entry.napStart === undefined && entry.napWake === undefined &&
      !(entry.habits && entry.habits.length));
  }

  // The duration follows the times until the user types their own value, because
  // time asleep can be shorter than the gap between going to bed and waking.
  function withAutoDuration(entry) {
    if (entry.durationManual) return entry;
    const computed = durationFromTimes(entry.start, entry.wake);
    const next = { ...entry };
    if (computed === null) delete next.duration;
    else next.duration = computed;
    return next;
  }

  function updateEntry(entry, field, rawValue) {
    const value = String(rawValue).trim();
    const next = { ...(entry || {}) };

    if (field === 'start' || field === 'wake') {
      if (value === '') {
        delete next[field];
      } else {
        const minutes = parseTime(value);
        if (minutes === null) return { error: 'Enter the time as HH:MM.' };
        next[field] = formatClock(minutes);
      }
      return { entry: withAutoDuration(next) };
    }

    if (field === 'duration') {
      if (value === '') {
        delete next.durationManual;
        return { entry: withAutoDuration(next) };
      }
      const hours = parseDuration(value);
      if (hours === null) return { error: 'Sleep hours must be above 0 and at most 24, such as 7.5 or 7:30.' };
      next.duration = hours;
      next.durationManual = true;
      return { entry: next };
    }

    if (field === 'quality') {
      if (value === '') {
        delete next.quality;
        return { entry: next };
      }
      const quality = parseQuality(value);
      if (quality === null) return { error: 'Sleep quality must be a whole number from 1 to 100.' };
      next.quality = quality;
      return { entry: next };
    }

    throw new Error(`Unknown field: ${field}`);
  }

  function setTimes(entry, start, wake) {
    const withStart = updateEntry(entry, 'start', start === undefined ? '' : start).entry;
    return updateEntry(withStart, 'wake', wake === undefined ? '' : wake).entry;
  }

  // Naps never change the night's own hours. They're added on top by withNaps.
  function setNap(entry, napStart, napWake) {
    const next = { ...(entry || {}) };
    if (napStart === undefined) delete next.napStart;
    else next.napStart = napStart;
    if (napWake === undefined) delete next.napWake;
    else next.napWake = napWake;
    return next;
  }

  function napHours(entry) {
    return entry ? durationFromTimes(entry.napStart, entry.napWake) : null;
  }

  // A copy of the data for charts and averages, where sleep hours include that date's nap.
  // A nap on a date with no logged night isn't plotted, since there's no night to add it to.
  function withNaps(data, includeNaps) {
    if (!includeNaps) return data;
    const entries = {};
    for (const [date, entry] of Object.entries(data.entries)) {
      const nap = napHours(entry);
      entries[date] = nap !== null && entry.duration !== undefined
        ? { ...entry, nightDuration: entry.duration, duration: round2(entry.duration + nap) }
        : entry;
    }
    return { ...data, entries };
  }

  // The time bars run noon to noon so one night stays in one piece. Position is 0 to 1.
  function timeToPosition(minutes) {
    return mod(minutes - NOON, MINUTES_PER_DAY) / MINUTES_PER_DAY;
  }

  function positionToMinutes(position, step) {
    const clamped = Math.min(1, Math.max(0, position));
    const fromNoon = Math.round((clamped * MINUTES_PER_DAY) / step) * step;
    return mod(fromNoon + NOON, MINUTES_PER_DAY);
  }

  // Moves to the next multiple of step, so an off-grid time like 06:16 lands on the grid.
  function stepMinutes(minutes, direction, step) {
    const next = direction > 0
      ? Math.floor(minutes / step) * step + step
      : Math.ceil(minutes / step) * step - step;
    return mod(next, MINUTES_PER_DAY);
  }

  function toggleHabit(entry, habit) {
    const next = { ...(entry || {}) };
    const habits = new Set(next.habits || []);
    if (habits.has(habit)) habits.delete(habit);
    else habits.add(habit);
    if (habits.size === 0) delete next.habits;
    else next.habits = HABITS.filter((h) => habits.has(h));
    return next;
  }

  // Rebuilds an entry from untrusted JSON, keeping only the fields that validate.
  function sanitizeEntry(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const clean = {};
    if (parseTime(raw.start) !== null) clean.start = formatClock(parseTime(raw.start));
    if (parseTime(raw.wake) !== null) clean.wake = formatClock(parseTime(raw.wake));
    const duration = raw.duration === undefined ? null : parseDuration(raw.duration);
    if (duration !== null) {
      clean.duration = duration;
      // A value the times don't explain must be treated as typed, or the next time
      // edit would replace it.
      if (raw.durationManual === true || durationFromTimes(clean.start, clean.wake) !== duration) {
        clean.durationManual = true;
      }
    } else {
      const computed = durationFromTimes(clean.start, clean.wake);
      if (computed !== null) clean.duration = computed;
    }
    const quality = raw.quality === undefined ? null : parseQuality(raw.quality);
    if (quality !== null) clean.quality = quality;
    if (parseTime(raw.napStart) !== null) clean.napStart = formatClock(parseTime(raw.napStart));
    if (parseTime(raw.napWake) !== null) clean.napWake = formatClock(parseTime(raw.napWake));
    if (Array.isArray(raw.habits)) {
      const habits = HABITS.filter((h) => raw.habits.includes(h));
      if (habits.length) clean.habits = habits;
    }
    return isEmptyEntry(clean) ? null : clean;
  }

  function sanitizeData(raw) {
    const entries = {};
    let skipped = 0;
    const source = raw && typeof raw === 'object' && raw.entries && typeof raw.entries === 'object'
      ? raw.entries : null;
    if (source === null) return { data: { version: 1, entries }, count: 0, skipped: 0, valid: false };
    for (const [key, value] of Object.entries(source)) {
      const entry = isValidDateKey(key) ? sanitizeEntry(value) : null;
      if (entry) entries[key] = entry;
      else skipped += 1;
    }
    return { data: { version: 1, entries }, count: Object.keys(entries).length, skipped, valid: true };
  }

  // --- Monthly views. ---

  function monthEntries(data, ym) {
    const out = [];
    const days = daysInMonth(ym);
    for (let day = 1; day <= days; day += 1) out.push(data.entries[dateKey(ym, day)] || null);
    return out;
  }

  // Newest first. Months holding only habit marks count, since they were still logged.
  function monthsWithData(data) {
    const months = new Set(Object.keys(data.entries).map((key) => key.slice(0, 7)));
    return [...months].sort().reverse();
  }

  function summarizeMonth(data, ym) {
    const entries = monthEntries(data, ym).filter(Boolean);
    const durations = entries.map((e) => e.duration).filter((v) => v !== undefined);
    const qualities = entries.map((e) => e.quality).filter((v) => v !== undefined);
    const starts = entries.map((e) => parseTime(e.start)).filter((v) => v !== null);
    const wakes = entries.map((e) => parseTime(e.wake)).filter((v) => v !== null);
    const habits = {};
    for (const habit of HABITS) {
      habits[habit] = entries.filter((e) => (e.habits || []).includes(habit)).length;
    }
    return {
      nights: entries.filter((e) => e.duration !== undefined || e.quality !== undefined ||
        e.start !== undefined || e.wake !== undefined).length,
      avgDuration: durations.length ? mean(durations) : null,
      avgQuality: qualities.length ? mean(qualities) : null,
      avgStart: circularMeanMinutes(starts),
      avgWake: circularMeanMinutes(wakes),
      nightsWithDuration: durations.length,
      nightsInTarget: durations.filter((d) => d >= TARGET_HOURS[0] && d <= TARGET_HOURS[1]).length,
      habits,
    };
  }

  // --- Insights. ---

  function dayLabel(date) {
    const [, month, day] = date.split('-').map(Number);
    return `${MONTH_NAMES[month - 1].slice(0, 3)} ${day}`;
  }

  // Least-squares line through { x, y } points, or null if there's too little to fit.
  function linearFit(points) {
    const n = points.length;
    if (n < 3) return null;
    const meanX = mean(points.map((p) => p.x));
    const meanY = mean(points.map((p) => p.y));
    let sumXX = 0;
    let sumYY = 0;
    let sumXY = 0;
    for (const { x, y } of points) {
      sumXX += (x - meanX) ** 2;
      sumYY += (y - meanY) ** 2;
      sumXY += (x - meanX) * (y - meanY);
    }
    if (sumXX === 0 || sumYY === 0) return null;
    const slope = sumXY / sumXX;
    return { n, slope, intercept: meanY - slope * meanX, r: sumXY / Math.sqrt(sumXX * sumYY) };
  }

  // One row per logged day, in date order. Sleep start is in hours after noon, like the
  // bedtime metric, so times either side of midnight compare correctly.
  function insightPoints(data) {
    return Object.keys(data.entries).sort().map((date) => {
      const entry = data.entries[date];
      return {
        date,
        hours: entry.duration === undefined ? null : entry.duration,
        quality: entry.quality === undefined ? null : entry.quality,
        start: METRICS.bedtime.value(entry),
      };
    });
  }

  // Trailing averages for every calendar day from the first logged date to the last. A value
  // is null until its window has enough nights, so gaps in logging show as gaps in the line.
  function rollingSeries(data, windowDays, minNights) {
    const points = insightPoints(data);
    if (points.length === 0) return [];
    const byDate = new Map(points.map((point) => [point.date, point]));
    const toDate = (key) => {
      const [y, m, d] = key.split('-').map(Number);
      return new Date(y, m - 1, d);
    };
    const toKey = (d) => dateKey(monthKey(d.getFullYear(), d.getMonth()), d.getDate());
    const values = (field, end) => {
      const out = [];
      for (let back = 0; back < windowDays; back += 1) {
        const day = new Date(end.getFullYear(), end.getMonth(), end.getDate() - back);
        const value = byDate.get(toKey(day))?.[field];
        if (value !== null && value !== undefined) out.push(value);
      }
      return out;
    };
    const meanOrNull = (xs) => (xs.length >= minNights ? mean(xs) : null);

    const last = toDate(points[points.length - 1].date);
    const series = [];
    for (let day = toDate(points[0].date); day <= last;
      day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
      const starts = values('start', day);
      let startVariation = null;
      if (starts.length >= minNights) {
        const average = mean(starts);
        startVariation = Math.sqrt(mean(starts.map((s) => (s - average) ** 2))) * 60;
      }
      const date = toKey(day);
      const point = byDate.get(date);
      series.push({
        date,
        night: point || null,
        hours: meanOrNull(values('hours', day)),
        quality: meanOrNull(values('quality', day)),
        startVariation,
      });
    }
    return series;
  }

  // --- Metrics for the comparison chart. ---
  // Bedtime is measured from noon, so 23:00 and 01:00 sit next to each other on the
  // axis instead of at opposite ends.

  function timeValue(entry, field, originMinutes) {
    const minutes = entry ? parseTime(entry[field]) : null;
    return minutes === null ? null : mod(minutes - originMinutes, MINUTES_PER_DAY) / 60;
  }

  const clockFromAxis = (originMinutes) => (v) => formatClock(v * 60 + originMinutes);

  const METRICS = {
    duration: {
      label: 'Sleep hours',
      value: (e) => (e && e.duration !== undefined ? e.duration : null),
      format: formatHours,
      tick: String,
    },
    quality: {
      label: 'Sleep quality',
      value: (e) => (e && e.quality !== undefined ? e.quality : null),
      format: String,
      tick: String,
    },
    bedtime: {
      label: 'Sleep start time',
      value: (e) => timeValue(e, 'start', NOON),
      format: clockFromAxis(NOON),
      tick: clockFromAxis(NOON),
    },
    wake: {
      label: 'Wake time',
      value: (e) => timeValue(e, 'wake', 0),
      format: clockFromAxis(0),
      tick: clockFromAxis(0),
    },
  };

  function range(from, to, step) {
    const out = [];
    for (let v = from; v <= to; v += step) out.push(v);
    return out;
  }

  // Axis layout for a metric: the plotted window, labelled ticks and guide lines.
  function axisFor(metricKey, values) {
    const present = values.filter((v) => v !== null);
    const low = present.length ? Math.min(...present) : null;
    const high = present.length ? Math.max(...present) : null;

    if (metricKey === 'duration') {
      const min = low === null ? 5 : Math.min(5, Math.floor(low));
      const max = high === null ? 12 : Math.max(12, Math.ceil(high));
      return { min: Math.max(0, min - 1), max, ticks: range(min, max, 1), guides: TARGET_HOURS };
    }
    if (metricKey === 'quality') {
      return { min: 0, max: 100, ticks: range(0, 100, 20), guides: [] };
    }

    const fallback = metricKey === 'bedtime' ? [10, 14] : [6, 10];
    let min = low === null ? fallback[0] : Math.max(0, Math.floor(low) - 1);
    let max = high === null ? fallback[1] : Math.min(24, Math.ceil(high) + 1);
    if (max - min < 4) {
      max = Math.min(24, max + Math.ceil((4 - (max - min)) / 2));
      min = Math.max(0, max - 4);
      max = Math.max(max, min + 4);
    }
    const step = max - min > 10 ? 2 : 1;
    return { min, max, ticks: range(Math.ceil(min / step) * step, max, step), guides: [] };
  }

  const api = {
    HABITS, TARGET_HOURS, METRICS,
    monthKey, dateKey, daysInMonth, shiftMonth, monthLabel, isValidDateKey,
    parseTime, formatClock, durationFromTimes, parseDuration, formatHours, parseQuality,
    circularMeanMinutes, isEmptyEntry, updateEntry, setTimes, setNap, napHours, withNaps,
    timeToPosition, positionToMinutes, stepMinutes, toggleHabit, sanitizeEntry, sanitizeData,
    monthEntries, monthsWithData, summarizeMonth, axisFor,
    dayLabel, linearFit, insightPoints, rollingSeries,
  };

  root.SleepCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
