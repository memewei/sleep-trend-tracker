// Page behaviour: state, saving to the server, and wiring the entry table and charts together.
(function () {
  'use strict';

  const Core = window.SleepCore;
  const Charts = window.SleepCharts;
  const TimeTrack = window.SleepTimeTrack;
  // Where earlier versions kept data in the browser. Only read to move it into the CSV.
  const LEGACY_STORAGE_KEY = 'sleep-tracker.v1';
  const API = '/api/entries';
  const RETRY_MS = 5000;
  const MAX_COMPARE = 6;
  const INCLUDE_NAPS_KEY = 'sleep-tracker.include-naps';
  const ROLLING_DAYS = 7;
  const ROLLING_MIN_NIGHTS = 4;
  const NAP_OPTIONS = {
    labels: { start: 'Nap start', wake: 'Nap end' },
    defaults: { start: '13:00', wake: '14:00' },
    clearLabel: 'Clear nap times',
  };
  const $ =(id) => document.getElementById(id);

  const now = new Date();
  const todayKey = Core.dateKey(Core.monthKey(now.getFullYear(), now.getMonth()), now.getDate());

  const state = {
    data: { version: 1, entries: {} },
    view: 'month',
    ym: todayKey.slice(0, 7),
    metric: 'duration',
    // Month -> colour slot. A month keeps its colour while it stays selected.
    compare: new Map(),
    compareTouched: false,
    file: 'the CSV file',
    includeNaps: false,
  };

  // The data every chart and average reads. Saving always uses state.data itself.
  const analysisData = () => Core.withNaps(state.data, state.includeNaps);
  const hoursLabel = () => (state.includeNaps ? 'sleep + nap hours' : 'sleep hours');

  function loadNapPreference() {
    try {
      state.includeNaps = localStorage.getItem(INCLUDE_NAPS_KEY) === 'true';
    } catch { /* Without storage the switch just starts off each time. */ }
    $('include-naps').checked = state.includeNaps;
  }

  function saveNapPreference() {
    try {
      localStorage.setItem(INCLUDE_NAPS_KEY, String(state.includeNaps));
    } catch { /* Only a convenience, so nothing to report. */ }
  }

  // --- Loading and saving. ---

  function showNotice(message, isError) {
    const notice = $('notice');
    notice.textContent = message;
    notice.hidden = !message;
    notice.classList.toggle('notice-error', Boolean(isError));
  }

  function setSaveStatus(message, isError) {
    const status = $('save-status');
    status.textContent = message;
    status.classList.toggle('save-error', Boolean(isError));
  }

  async function sendChanges(entries) {
    const response = await fetch(API, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `The server replied with error ${response.status}.`);
    }
  }

  // Without a trustworthy copy of the data, editing would only mislead, so lock the page.
  function blockEditing(message) {
    showNotice(message, true);
    setSaveStatus('Not connected', true);
    document.querySelector('main').inert = true;
    $('import').disabled = true;
    $('export').disabled = true;
  }

  function readLegacyData() {
    try {
      const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw === null) return null;
      const parsed = Core.sanitizeData(JSON.parse(raw));
      return parsed.count > 0 ? { raw, ...parsed } : null;
    } catch {
      return null;
    }
  }

  // A directly opened page has its own browser storage that the server's address can't
  // read, so Export is the only way to carry entries made there across to the CSV.
  function offerLegacyExportFromFile() {
    if (window.location.protocol !== 'file:') return;
    const legacy = readLegacyData();
    if (!legacy) return;
    state.data = legacy.data;
    $('export').disabled = false;
    showNotice(`This page has ${legacy.count} earlier ${legacy.count === 1 ? 'day' : 'days'} saved in the browser. Use Export to save them, run "npm start", open http://localhost:4173 and use Import there.`, true);
  }

  async function load() {
    let response;
    try {
      response = await fetch(API);
    } catch {
      blockEditing('Can\'t reach the tracker server, so your data can\'t be loaded or saved. Run "npm start", then open http://localhost:4173.');
      offerLegacyExportFromFile();
      return;
    }
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.entries) {
      blockEditing(`${body.error || 'The server didn\'t return your data.'} Fix the file, then reload this page.`);
      return;
    }
    state.data = { version: 1, entries: body.entries };
    state.file = body.file;
    setSaveStatus(`Autosaves to ${state.file}`);
    await moveBrowserDataToCsv();
  }

  // One-time move for anyone who logged nights before the CSV existed. It only runs while
  // the CSV is empty, and the browser copy is kept until the server has confirmed the save.
  async function moveBrowserDataToCsv() {
    if (Object.keys(state.data.entries).length > 0) return;
    const legacy = readLegacyData();
    if (!legacy) return;
    try {
      await sendChanges(legacy.data.entries);
    } catch (error) {
      showNotice(`Your earlier entries are still in this browser but could not be moved to ${state.file}. ${error.message}`, true);
      return;
    }
    state.data = legacy.data;
    localStorage.setItem(`${LEGACY_STORAGE_KEY}.moved-to-csv`, legacy.raw);
    localStorage.removeItem(LEGACY_STORAGE_KEY);
    showNotice(`Moved ${legacy.count} ${legacy.count === 1 ? 'day' : 'days'} from this browser into ${state.file}.`, false);
  }

  // Changes wait here until the server confirms them. Edits made during a save, or while
  // the server is unreachable, are combined and sent together, and the latest edit wins.
  const save = { pending: {}, inFlight: false, failing: false, retryTimer: null };

  function hasUnsavedChanges() {
    return save.inFlight || Object.keys(save.pending).length > 0;
  }

  async function flushSaves() {
    clearTimeout(save.retryTimer);
    if (save.inFlight || Object.keys(save.pending).length === 0) return;
    const batch = save.pending;
    save.pending = {};
    save.inFlight = true;
    setSaveStatus('Saving…');
    try {
      await sendChanges(batch);
      setSaveStatus(`Saved to ${state.file}`);
      if (save.failing) showNotice('', false);
      save.failing = false;
    } catch (error) {
      save.pending = { ...batch, ...save.pending };
      save.failing = true;
      setSaveStatus('Not saved, retrying…', true);
      const reason = error instanceof TypeError ? 'Can\'t reach the tracker server. Is "npm start" still running?' : error.message;
      showNotice(`Your latest changes aren't in ${state.file} yet. Keep this page open and they'll save once this is fixed. ${reason}`, true);
      save.retryTimer = setTimeout(flushSaves, RETRY_MS);
      return;
    } finally {
      save.inFlight = false;
    }
    flushSaves();
  }

  function queueSave(changes) {
    Object.assign(save.pending, changes);
    flushSaves();
  }

  function setEntry(date, entry) {
    const isEmpty = Core.isEmptyEntry(entry);
    if (isEmpty) delete state.data.entries[date];
    else state.data.entries[date] = entry;
    queueSave({ [date]: isEmpty ? null : entry });
  }

  // --- Small DOM helpers. ---

  function el(tag, props, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props || {});
    node.append(...children);
    return node;
  }

  const clockOrDash = (minutes) => (minutes === null ? '–' : Core.formatClock(minutes));
  const hoursOrDash = (hours) => (hours === null ? '–' : Core.formatHours(hours));
  const numberOrDash = (n) => (n === null ? '–' : String(Math.round(n)));

  function targetText(summary) {
    return summary.nightsWithDuration ? `${summary.nightsInTarget} of ${summary.nightsWithDuration}` : '–';
  }

  // --- Month view. ---

  function renderTiles() {
    const s = Core.summarizeMonth(analysisData(), state.ym);
    const tiles = [
      [state.includeNaps ? 'Average sleep + naps' : 'Average sleep', hoursOrDash(s.avgDuration)],
      ['Average quality', numberOrDash(s.avgQuality)],
      ['Average sleep start', clockOrDash(s.avgStart)],
      ['Average wake', clockOrDash(s.avgWake)],
      ['Nights in 7–9 h', targetText(s)],
    ];
    $('tiles').replaceChildren(...tiles.map(([label, value]) => el('div', { className: 'tile' },
      el('div', { className: 'tile-label', textContent: label }),
      el('div', { className: 'tile-value', textContent: value }))));
  }

  function renderMonthChart() {
    Charts.hideTooltip();
    const chart = Charts.buildMonthChart({
      ym: state.ym,
      entries: Core.monthEntries(analysisData(), state.ym),
      today: todayKey.slice(0, 7) === state.ym ? Number(todayKey.slice(8)) : null,
      hoursLabel: hoursLabel(),
      onDayClick: focusDay,
      onHabitToggle: (day, habit) => {
        const date = Core.dateKey(state.ym, day);
        setEntry(date, Core.toggleHabit(state.data.entries[date], habit));
        refreshMonth(date);
      },
    });
    $('month-chart').replaceChildren(chart);
  }

  function focusDay(day) {
    const row = $('entry-body').querySelector(`tr[data-date="${Core.dateKey(state.ym, day)}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const fields = [...row.querySelectorAll('[role=slider], input.num')];
    const isUnset = (field) => (field.matches('input') ? !field.value : field.getAttribute('aria-valuetext') === 'not set');
    (fields.find(isUnset) || fields[0]).focus({ preventScroll: true });
  }

  function showNapHours(row, hours) {
    row.napHoursCell.textContent = hours === null ? '–' : Core.formatHours(hours);
  }

  function buildNapRow(date, niceDate, row) {
    row.napTrack = TimeTrack.createTimeTrack({
      dayLabel: niceDate,
      options: NAP_OPTIONS,
      onPreview: (start, wake) => showNapHours(row, Core.durationFromTimes(start, wake)),
      onCommit: (start, wake) => {
        setEntry(date, Core.setNap(state.data.entries[date], start, wake));
        refreshMonth(date);
      },
    });
    row.napHoursCell = el('td', { className: 'nap-hours' });
    const napRow = el('tr', { className: 'nap-row' },
      el('th', { scope: 'row', textContent: 'nap' }),
      el('td', { className: 'time-col' }, row.napTrack.track),
      el('td', { className: 'time-values' }, row.napTrack.readout, row.napTrack.clearButton),
      row.napHoursCell,
      el('td', { colSpan: 5 }));
    napRow.hidden = !state.includeNaps;
    if (date === todayKey) napRow.classList.add('is-today');
    return napRow;
  }

  function syncRow(date) {
    const row = $('entry-body').querySelector(`tr[data-date="${date}"]`);
    if (!row) return;
    const entry = state.data.entries[date] || {};
    row.timeTrack.setTimes(entry.start, entry.wake);
    row.napTrack.setTimes(entry.napStart, entry.napWake);
    showNapHours(row, Core.napHours(entry));
    for (const input of row.querySelectorAll('input')) {
      const { field, habit } = input.dataset;
      if (habit) {
        input.checked = (entry.habits || []).includes(habit);
      } else if (!input.hasAttribute('aria-invalid')) {
        input.value = entry[field] === undefined ? '' : String(entry[field]);
      }
    }
  }

  function refreshMonth(date) {
    renderTiles();
    renderMonthChart();
    syncRow(date);
  }

  function commitField(input) {
    const row = input.closest('tr');
    const date = row.dataset.date;
    const result = Core.updateEntry(state.data.entries[date], input.dataset.field, input.value);
    if (result.error) {
      input.setAttribute('aria-invalid', 'true');
      $('entry-status').textContent = `${result.error} That value was not saved.`;
      return;
    }
    input.removeAttribute('aria-invalid');
    if (!$('entry-body').querySelector('[aria-invalid]')) $('entry-status').textContent = '';
    setEntry(date, result.entry);
    refreshMonth(date);
  }

  function renderEntryTable() {
    const [year, month] = state.ym.split('-').map(Number);
    const rows = [];
    const napRows = [];
    for (let day = 1; day <= Core.daysInMonth(state.ym); day += 1) {
      const date = Core.dateKey(state.ym, day);
      const niceDate = `${Core.monthLabel(state.ym, true).split(' ')[0]} ${day}`;
      const weekday = new Date(year, month - 1, day).toLocaleDateString(undefined, { weekday: 'short' });
      const row = el('tr');
      row.dataset.date = date;
      if (date === todayKey) row.className = 'is-today';
      row.append(el('th', { scope: 'row' }, el('span', { className: 'day-num', textContent: day }), ` ${weekday}`));

      const field = (name, label, props) => {
        const input = el('input', { ...props, ariaLabel: `${label}, ${niceDate}` });
        input.dataset.field = name;
        row.append(el('td', {}, input));
      };
      row.timeTrack = TimeTrack.createTimeTrack({
        dayLabel: niceDate,
        onPreview: (start, wake) => {
          const hours = row.querySelector('[data-field=duration]');
          if (hours.hasAttribute('aria-invalid')) return;
          const { duration } = Core.setTimes(state.data.entries[date], start, wake);
          hours.value = duration === undefined ? '' : String(duration);
        },
        onCommit: (start, wake) => {
          setEntry(date, Core.setTimes(state.data.entries[date], start, wake));
          refreshMonth(date);
        },
      });
      row.append(
        el('td', { className: 'time-col' }, row.timeTrack.track),
        el('td', { className: 'time-values' }, row.timeTrack.readout, row.timeTrack.clearButton),
      );

      field('duration', 'Sleep hours', { type: 'text', inputMode: 'decimal', placeholder: 'auto', className: 'num' });
      field('quality', 'Sleep quality', { type: 'text', inputMode: 'numeric', placeholder: '1–100', className: 'num' });

      for (const habit of Core.HABITS) {
        const box = el('input', { type: 'checkbox', ariaLabel: `${habit}, ${niceDate}` });
        box.dataset.habit = habit;
        row.append(el('td', { className: 'check' }, box));
      }
      rows.push(row);
      napRows.push(buildNapRow(date, niceDate, row));
    }
    $('entry-body').replaceChildren(...rows.flatMap((row, i) => [row, napRows[i]]));
    $('nap-note').hidden = !state.includeNaps;
    for (const row of rows) syncRow(row.dataset.date);
    $('entry-status').textContent = '';
  }

  function renderMonthView() {
    $('month-title').textContent = Core.monthLabel(state.ym);
    $('this-month').disabled = state.ym === todayKey.slice(0, 7);
    renderTiles();
    renderMonthChart();
    renderEntryTable();
  }

  // --- Compare view. ---

  function reconcileCompare(available) {
    for (const ym of [...state.compare.keys()]) {
      if (!available.includes(ym)) state.compare.delete(ym);
    }
    if (!state.compareTouched && state.compare.size === 0) {
      available.slice(0, 2).forEach(addToCompare);
    }
  }

  function addToCompare(ym) {
    const used = new Set(state.compare.values());
    let slot = 1;
    while (used.has(slot)) slot += 1;
    state.compare.set(ym, slot);
  }

  function renderMonthPicker(available) {
    const atLimit = state.compare.size >= MAX_COMPARE;
    $('compare-months').replaceChildren(...available.map((ym) => {
      const selected = state.compare.has(ym);
      const box = el('input', { type: 'checkbox', checked: selected, disabled: !selected && atLimit });
      box.addEventListener('change', () => {
        state.compareTouched = true;
        if (box.checked) addToCompare(ym);
        else state.compare.delete(ym);
        renderCompareView();
      });
      const swatch = el('span', { className: 'line-key' });
      if (selected) swatch.style.background = `var(--series-${state.compare.get(ym)})`;
      return el('label', { className: selected ? 'chip is-on' : 'chip' }, box, swatch, Core.monthLabel(ym, true));
    }));
    $('compare-limit').hidden = !atLimit;
  }

  function selectedSeries() {
    const metric = Core.METRICS[state.metric];
    return [...state.compare.keys()].sort().reverse().map((ym) => ({
      ym,
      label: Core.monthLabel(ym, true),
      shortLabel: Core.monthLabel(ym, true).split(' ')[0],
      color: `var(--series-${state.compare.get(ym)})`,
      values: Core.monthEntries(analysisData(), ym).map(metric.value),
    }));
  }

  function renderSummaryTable(series) {
    const cells = series.map(({ ym, label, color }) => {
      const s = Core.summarizeMonth(analysisData(), ym);
      const key = el('span', { className: 'line-key' });
      key.style.background = color;
      return el('tr', {},
        el('th', { scope: 'row' }, key, label),
        ...[
          String(s.nights), hoursOrDash(s.avgDuration), numberOrDash(s.avgQuality),
          clockOrDash(s.avgStart), clockOrDash(s.avgWake), targetText(s),
          ...Core.HABITS.map((h) => String(s.habits[h])),
        ].map((value) => el('td', { textContent: value })));
    });
    $('summary-body').replaceChildren(...cells);
  }

  function renderDailyTable(series) {
    const metric = Core.METRICS[state.metric];
    $('daily-head').replaceChildren(el('tr', {},
      el('th', { scope: 'col', textContent: 'Day' }),
      ...series.map((s) => el('th', { scope: 'col', textContent: s.label }))));
    const rows = [];
    for (let day = 1; day <= 31; day += 1) {
      rows.push(el('tr', {},
        el('th', { scope: 'row', textContent: day }),
        ...series.map((s) => {
          const value = s.values[day - 1];
          return el('td', { textContent: value === null || value === undefined ? '–' : metric.format(value) });
        })));
    }
    $('daily-body').replaceChildren(...rows);
  }

  function renderCompareView() {
    Charts.hideTooltip();
    const available = Core.monthsWithData(state.data);
    reconcileCompare(available);
    $('compare-empty').hidden = available.length > 0;
    $('compare-controls').hidden = available.length === 0;
    renderMonthPicker(available);

    const series = selectedSeries();
    $('compare-results').hidden = series.length === 0;
    $('compare-pick').hidden = !(available.length > 0 && series.length === 0);
    if (series.length === 0) return;

    $('compare-guide').hidden = state.metric !== 'duration';
    $('legend').replaceChildren(...series.map((s) => {
      const key = el('span', { className: 'line-key' });
      key.style.background = s.color;
      return el('span', { className: 'legend-item' }, key, s.label);
    }));
    $('compare-chart').replaceChildren(Charts.buildCompareChart({
      metricKey: state.metric,
      series,
      axisLabel: state.metric === 'duration' ? hoursLabel() : Core.METRICS[state.metric].label.toLowerCase(),
    }));
    renderSummaryTable(series);
    renderDailyTable(series);
  }

  // --- Insights view. ---

  function strengthWord(r) {
    const size = Math.abs(r);
    if (size >= 0.5) return 'strong';
    if (size >= 0.3) return 'moderate';
    return 'weak';
  }

  function trendCaption(fit, unitPhrase) {
    if (!fit) return 'There isn\'t enough variety in these nights to draw a trend yet.';
    const change = `${fit.slope >= 0 ? '+' : '−'}${Math.abs(fit.slope).toFixed(1)}`;
    return `Across ${fit.n} nights, ${unitPhrase} goes with about ${change} quality points. This is a ${strengthWord(fit.r)} link (r = ${fit.r.toFixed(2).replace('-', '−')}).`;
  }

  function qualityAxis(values) {
    const { min, max } = Charts.roundedRange(values, 10, 0, 100);
    return { min, max, ticks: Charts.ticksBetween(min, max, max - min > 50 ? 20 : 10), format: String, title: 'sleep quality' };
  }

  function nightRows(point) {
    return [
      { value: point.hours === null ? '–' : Core.formatHours(point.hours), label: 'asleep' },
      { value: point.quality === null ? '–' : point.quality, label: 'quality' },
      { value: point.start === null ? '–' : Core.METRICS.bedtime.format(point.start), label: 'sleep start' },
    ];
  }

  function renderScatter({ points, xField, xAxis, unitPhrase, chartId, captionId, label }) {
    const usable = points.filter((p) => p[xField] !== null && p.quality !== null);
    const hasEnough = usable.length >= 3;
    $(chartId).hidden = !hasEnough;
    if (!hasEnough) {
      $(captionId).textContent = 'Log at least 3 nights with these values to see this chart.';
      return;
    }
    const xy = usable.map((p) => ({ x: p[xField], y: p.quality }));
    const fit = Core.linearFit(xy);
    $(captionId).textContent = trendCaption(fit, unitPhrase);
    $(chartId).replaceChildren(Charts.buildScatterChart({
      points: usable.map((p) => ({
        x: p[xField], y: p.quality, heading: Core.dayLabel(p.date), rows: nightRows(p),
      })),
      xAxis: xAxis(xy.map((p) => p.x)),
      yAxis: qualityAxis(xy.map((p) => p.y)),
      fit,
      label,
    }));
  }

  function renderInsightsTable(series) {
    const metric = Core.METRICS.bedtime;
    const dash = (value, format) => (value === null || value === undefined ? '–' : format(value));
    const rounded = (v) => String(Math.round(v));
    $('insights-body').replaceChildren(...[...series].reverse().map((point) => {
      const night = point.night || {};
      return el('tr', {},
        el('th', { scope: 'row', textContent: point.date }),
        ...[
          dash(night.hours, Core.formatHours), dash(night.quality, String), dash(night.start, metric.format),
          dash(point.hours, Core.formatHours), dash(point.quality, rounded),
          dash(point.startVariation, (v) => `${Math.round(v)} min`),
        ].map((value) => el('td', { textContent: value })));
    }));
    $('insights-hours-head').textContent = state.includeNaps ? 'Sleep + naps' : 'Sleep';
  }

  function renderInsightsView() {
    Charts.hideTooltip();
    const data = analysisData();
    const points = Core.insightPoints(data);
    $('insights-empty').hidden = points.length > 0;
    $('insights-results').hidden = points.length === 0;
    if (points.length === 0) return;

    renderScatter({
      points,
      xField: 'hours',
      chartId: 'scatter-hours',
      captionId: 'scatter-hours-caption',
      unitPhrase: 'each extra hour',
      label: `Scatter plot of ${hoursLabel()} against sleep quality, one dot per night. The table below lists every value.`,
      xAxis: (values) => {
        const { min, max } = Charts.roundedRange(values, 1, 0, 48);
        return { min, max, ticks: Charts.ticksBetween(min, max, max - min > 12 ? 2 : 1), format: String, title: hoursLabel() };
      },
    });
    renderScatter({
      points,
      xField: 'start',
      chartId: 'scatter-start',
      captionId: 'scatter-start-caption',
      unitPhrase: 'each hour later',
      label: 'Scatter plot of sleep start time against sleep quality, one dot per night. The table below lists every value.',
      xAxis: (values) => {
        const axis = Core.axisFor('bedtime', values);
        return { min: axis.min, max: axis.max, ticks: axis.ticks, format: Core.METRICS.bedtime.tick, title: 'sleep start time' };
      },
    });

    const series = Core.rollingSeries(data, ROLLING_DAYS, ROLLING_MIN_NIGHTS);
    $('rolling-chart').replaceChildren(Charts.buildRollingChart({ series, hoursLabel: hoursLabel() }));
    renderInsightsTable(series);
  }

  // --- Top-level rendering. ---

  function render() {
    for (const view of ['month', 'compare', 'insights']) {
      $(`${view}-view`).hidden = state.view !== view;
      $(`tab-${view}`).setAttribute('aria-pressed', String(state.view === view));
    }
    if (state.view === 'month') renderMonthView();
    else if (state.view === 'compare') renderCompareView();
    else renderInsightsView();
  }

  // --- Backup. ---

  function exportData() {
    const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
    const link = el('a', { href: URL.createObjectURL(blob), download: `sleep-tracker-${todayKey}.json` });
    link.click();
    URL.revokeObjectURL(link.href);
  }

  async function importData(file) {
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      showNotice(`${file.name} is not a valid JSON file. Nothing was imported.`, true);
      return;
    }
    const { data, count, skipped, valid } = Core.sanitizeData(parsed);
    if (!valid || count === 0) {
      showNotice(`${file.name} has no usable sleep entries. Nothing was imported.`, true);
      return;
    }
    const overwrites = Object.keys(data.entries).filter((key) => state.data.entries[key]).length;
    const prompt = `Import ${count} ${count === 1 ? 'day' : 'days'} from ${file.name}?` +
      (overwrites ? ` This replaces ${overwrites} existing ${overwrites === 1 ? 'day' : 'days'}.` : '');
    if (!window.confirm(prompt)) return;
    Object.assign(state.data.entries, data.entries);
    showNotice(`Imported ${count} ${count === 1 ? 'day' : 'days'}.` +
      (skipped ? ` Skipped ${skipped} invalid ${skipped === 1 ? 'entry' : 'entries'}.` : ''), false);
    queueSave(data.entries);
    render();
  }

  // --- Wiring. ---

  function wire() {
    $('tab-month').addEventListener('click', () => { state.view = 'month'; render(); });
    $('tab-compare').addEventListener('click', () => { state.view = 'compare'; render(); });
    $('tab-insights').addEventListener('click', () => { state.view = 'insights'; render(); });
    $('include-naps').addEventListener('change', (event) => {
      state.includeNaps = event.target.checked;
      saveNapPreference();
      render();
    });
    $('prev-month').addEventListener('click', () => { state.ym = Core.shiftMonth(state.ym, -1); render(); });
    $('next-month').addEventListener('click', () => { state.ym = Core.shiftMonth(state.ym, 1); render(); });
    $('this-month').addEventListener('click', () => { state.ym = todayKey.slice(0, 7); render(); });

    $('entry-body').addEventListener('change', (event) => {
      const input = event.target;
      const date = input.closest('tr').dataset.date;
      if (input.dataset.habit) {
        setEntry(date, Core.toggleHabit(state.data.entries[date], input.dataset.habit));
        refreshMonth(date);
      } else {
        commitField(input);
      }
    });

    $('metric').addEventListener('change', (event) => {
      state.metric = event.target.value;
      renderCompareView();
    });

    $('export').addEventListener('click', exportData);
    $('import').addEventListener('click', () => $('import-file').click());
    $('import-file').addEventListener('change', async (event) => {
      const [file] = event.target.files;
      event.target.value = '';
      if (file) await importData(file);
    });

    window.addEventListener('beforeunload', (event) => {
      if (hasUnsavedChanges()) event.preventDefault();
    });
  }

  loadNapPreference();
  wire();
  load().finally(render);
})();
