// SVG chart drawing. Layout follows the paper chart: square graph-paper cells, quality
// scores along the top, hours in the middle and habit marks in rows underneath.
(function (root) {
  'use strict';

  const Core = root.SleepCore;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const CELL = 28;
  const LEFT = 104;
  const MONTH_RIGHT = 14;
  const COMPARE_RIGHT = 62;
  const COMPARE_HEIGHT = 300;
  const MAX_DAYS = 31;

  function svgEl(tag, attrs, ...children) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs || {})) node.setAttribute(key, value);
    for (const child of children) node.append(child);
    return node;
  }

  function text(x, y, value, className, extra) {
    return svgEl('text', { x, y, class: className, ...extra }, String(value));
  }

  function hLine(x1, x2, y, className) {
    return svgEl('line', { x1, x2, y1: y, y2: y, class: className });
  }

  function vLine(x, y1, y2, className) {
    return svgEl('line', { x1: x, x2: x, y1, y2, class: className });
  }

  const dayX = (day) => LEFT + (day - 0.5) * CELL;

  // One tooltip element is shared by both charts. Everything goes in via textContent.
  function showTooltip(event, heading, rows) {
    const tip = document.getElementById('tooltip');
    tip.replaceChildren();
    const head = document.createElement('div');
    head.className = 'tip-head';
    head.textContent = heading;
    tip.append(head);
    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'tip-row';
      if (row.color) {
        const key = document.createElement('span');
        key.className = 'line-key';
        key.style.background = row.color;
        line.append(key);
      }
      const value = document.createElement('strong');
      value.textContent = row.value;
      const label = document.createElement('span');
      label.textContent = row.label;
      line.append(value, label);
      tip.append(line);
    }
    tip.hidden = false;
    const box = tip.getBoundingClientRect();
    const x = event.clientX + 16 + box.width > window.innerWidth
      ? event.clientX - box.width - 16 : event.clientX + 16;
    const y = Math.min(event.clientY + 16, window.innerHeight - box.height - 8);
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  }

  function hideTooltip() {
    document.getElementById('tooltip').hidden = true;
  }

  // Snaps the pointer to the nearest day and reports it. Returns the day under a pointer
  // event so click handlers can share the same hit-testing.
  function dayFromEvent(svg, event, days) {
    const box = svg.getBoundingClientRect();
    const scale = svg.viewBox.baseVal.width / box.width;
    const x = (event.clientX - box.left) * scale;
    if (x < LEFT) return null;
    const day = Math.floor((x - LEFT) / CELL) + 1;
    return day >= 1 && day <= days ? day : null;
  }

  function attachCrosshair(svg, crosshair, days, onDay) {
    svg.addEventListener('pointermove', (event) => {
      const day = dayFromEvent(svg, event, days);
      if (day === null) {
        crosshair.style.display = 'none';
        onDay(null, event);
        return;
      }
      crosshair.style.display = '';
      crosshair.setAttribute('x1', dayX(day));
      crosshair.setAttribute('x2', dayX(day));
      onDay(day, event);
    });
    svg.addEventListener('pointerleave', (event) => {
      crosshair.style.display = 'none';
      onDay(null, event);
    });
  }

  // Lines break across unlogged days rather than implying a value that was never recorded.
  function linePath(points) {
    let path = '';
    let open = false;
    for (const point of points) {
      if (point === null) {
        open = false;
      } else {
        path += `${open ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`;
        open = true;
      }
    }
    return path;
  }

  function isolated(points, index) {
    return points[index] !== null && !points[index - 1] && !points[index + 1];
  }

  function drawDayLabels(group, days, y, today) {
    for (let day = 1; day <= days; day += 1) {
      group.append(text(dayX(day), y, day, day === today ? 'tick tick-today' : 'tick', { 'text-anchor': 'middle' }));
    }
  }

  function buildMonthChart({ ym, entries, today, hoursLabel, onDayClick, onHabitToggle }) {
    const days = entries.length;
    const metric = Core.METRICS.duration;
    const values = entries.map(metric.value);
    const axis = Core.axisFor('duration', values);

    const plotWidth = days * CELL;
    const right = LEFT + plotWidth;
    const plotTop = CELL;
    const plotBottom = plotTop + (axis.max - axis.min) * CELL;
    const habitsTop = plotBottom + CELL * 1.5;
    const height = habitsTop + Core.HABITS.length * CELL + 2;
    const yFor = (v) => plotTop + (axis.max - v) * CELL;

    const svg = svgEl('svg', {
      viewBox: `0 0 ${right + MONTH_RIGHT} ${height}`,
      role: 'img',
      class: 'chart',
      'aria-label': `Sleep hours, sleep quality and habits for each day of ${Core.monthLabel(ym)}. The table below lists every value.`,
    });

    // Graph paper.
    const grid = svgEl('g', {});
    for (let i = 0; i <= days; i += 1) {
      grid.append(vLine(LEFT + i * CELL, 0, plotBottom, 'grid'));
      grid.append(vLine(LEFT + i * CELL, habitsTop, habitsTop + Core.HABITS.length * CELL, 'grid'));
    }
    for (let v = axis.min; v <= axis.max; v += 1) grid.append(hLine(LEFT, right, yFor(v), 'grid'));
    grid.append(hLine(LEFT, right, 0, 'grid'));
    for (let i = 0; i <= Core.HABITS.length; i += 1) {
      grid.append(hLine(LEFT, right, habitsTop + i * CELL, 'grid'));
    }
    svg.append(grid);

    // Sleep quality row along the top.
    const quality = svgEl('g', {});
    quality.append(text(LEFT - 10, plotTop - 9, 'sleep quality', 'row-label', { 'text-anchor': 'end' }));
    entries.forEach((entry, i) => {
      if (entry && entry.quality !== undefined) {
        quality.append(text(dayX(i + 1), plotTop - 9, entry.quality, 'quality', { 'text-anchor': 'middle' }));
      }
    });
    svg.append(quality);

    // Axes.
    const axes = svgEl('g', {});
    axes.append(vLine(LEFT, plotTop, plotBottom, 'axis'));
    axes.append(hLine(LEFT, right, plotBottom, 'axis'));
    for (const tick of axis.ticks) {
      axes.append(text(LEFT - 8, yFor(tick) + 4, metric.tick(tick), 'tick', { 'text-anchor': 'end' }));
    }
    const midY = (plotTop + plotBottom) / 2;
    axes.append(text(LEFT - 46, midY, hoursLabel, 'row-label', {
      'text-anchor': 'middle',
      transform: `rotate(-90 ${LEFT - 46} ${midY})`,
    }));
    drawDayLabels(axes, days, plotBottom + 18, today);
    svg.append(axes);

    // Target range.
    for (const guide of axis.guides) svg.append(hLine(LEFT, right, yFor(guide), 'guide'));

    // Sleep line.
    const points = values.map((v, i) => (v === null ? null : { x: dayX(i + 1), y: yFor(v) }));
    svg.append(svgEl('path', { d: linePath(points), class: 'series-line', style: 'stroke: var(--ink-line)' }));
    for (const point of points) {
      if (point) {
        svg.append(svgEl('circle', { cx: point.x, cy: point.y, r: 4, class: 'dot', style: 'fill: var(--ink-line)' }));
      }
    }

    // Habit rows, in the same order as the paper chart.
    Core.HABITS.forEach((habit, row) => {
      const y = habitsTop + row * CELL;
      svg.append(text(LEFT - 10, y + 18, habit, 'row-label', { 'text-anchor': 'end' }));
      for (let day = 1; day <= days; day += 1) {
        const x = LEFT + (day - 1) * CELL;
        const on = (entries[day - 1]?.habits || []).includes(habit);
        const cell = svgEl('g', { class: 'habit-cell', 'data-habit': habit, 'data-day': day });
        cell.append(svgEl('rect', { x, y, width: CELL, height: CELL, class: 'habit-hit' }));
        if (on) {
          const inset = 8;
          cell.append(svgEl('path', {
            d: `M${x + inset} ${y + inset}L${x + CELL - inset} ${y + CELL - inset}M${x + CELL - inset} ${y + inset}L${x + inset} ${y + CELL - inset}`,
            class: 'habit-x',
          }));
        }
        svg.append(cell);
      }
    });

    const crosshair = vLine(0, plotTop, plotBottom, 'crosshair');
    crosshair.style.display = 'none';
    svg.append(crosshair);

    attachCrosshair(svg, crosshair, days, (day, event) => {
      if (day === null) {
        hideTooltip();
        return;
      }
      const entry = entries[day - 1];
      const heading = `${Core.monthLabel(ym, true).split(' ')[0]} ${day}`;
      const rows = [];
      if (entry?.duration !== undefined) rows.push({ value: Core.formatHours(entry.duration), label: 'asleep' });
      if (entry?.nightDuration !== undefined) {
        rows.push({ value: Core.formatHours(entry.duration - entry.nightDuration), label: `nap, ${entry.napStart}–${entry.napWake}` });
      }
      if (entry?.quality !== undefined) rows.push({ value: entry.quality, label: 'quality' });
      if (entry?.start) rows.push({ value: entry.start, label: 'sleep start' });
      if (entry?.wake) rows.push({ value: entry.wake, label: 'wake' });
      if (entry?.habits?.length) rows.push({ value: entry.habits.join(', '), label: '' });
      if (rows.length === 0) rows.push({ value: 'No entry', label: 'click to add' });
      showTooltip(event, heading, rows);
    });

    svg.addEventListener('click', (event) => {
      const cell = event.target.closest('[data-habit]');
      if (cell) {
        onHabitToggle(Number(cell.dataset.day), cell.dataset.habit);
        return;
      }
      const day = dayFromEvent(svg, event, days);
      if (day !== null) onDayClick(day);
    });

    return svg;
  }

  // series: [{ label, shortLabel, color, values: [number|null per day of that month] }]
  function buildCompareChart({ metricKey, series, axisLabel }) {
    const metric = Core.METRICS[metricKey];
    const axis = Core.axisFor(metricKey, series.flatMap((s) => s.values));
    const right = LEFT + MAX_DAYS * CELL;
    const plotTop = 12;
    const plotBottom = plotTop + COMPARE_HEIGHT;
    const height = plotBottom + 30;
    const yFor = (v) => plotBottom - ((v - axis.min) / (axis.max - axis.min)) * COMPARE_HEIGHT;

    const svg = svgEl('svg', {
      viewBox: `0 0 ${right + COMPARE_RIGHT} ${height}`,
      role: 'img',
      class: 'chart',
      'aria-label': `${metric.label} by day of the month for ${series.map((s) => s.label).join(', ')}. The table below lists every value.`,
    });

    for (let i = 0; i <= MAX_DAYS; i += 1) svg.append(vLine(LEFT + i * CELL, plotTop, plotBottom, 'grid'));
    for (const tick of axis.ticks) {
      svg.append(hLine(LEFT, right, yFor(tick), 'grid'));
      svg.append(text(LEFT - 8, yFor(tick) + 4, metric.tick(tick), 'tick', { 'text-anchor': 'end' }));
    }
    svg.append(vLine(LEFT, plotTop, plotBottom, 'axis'));
    svg.append(hLine(LEFT, right, plotBottom, 'axis'));
    drawDayLabels(svg, MAX_DAYS, plotBottom + 18, null);
    const midY = (plotTop + plotBottom) / 2;
    svg.append(text(30, midY, axisLabel, 'row-label', {
      'text-anchor': 'middle',
      transform: `rotate(-90 30 ${midY})`,
    }));
    for (const guide of axis.guides) svg.append(hLine(LEFT, right, yFor(guide), 'guide'));

    const allPoints = series.map((s) => s.values.map((v, i) => (v === null ? null : { x: dayX(i + 1), y: yFor(v) })));

    series.forEach((s, index) => {
      const points = allPoints[index];
      svg.append(svgEl('path', { d: linePath(points), class: 'series-line', style: `stroke: ${s.color}` }));
      points.forEach((point, i) => {
        if (point && isolated(points, i)) {
          svg.append(svgEl('circle', { cx: point.x, cy: point.y, r: 4, class: 'dot', style: `fill: ${s.color}` }));
        }
      });
    });

    // End dots and direct labels. Labels that would collide are left to the legend.
    const ends = series.map((s, index) => {
      const points = allPoints[index];
      for (let i = points.length - 1; i >= 0; i -= 1) {
        if (points[i]) return { ...points[i], label: s.shortLabel, color: s.color };
      }
      return null;
    }).filter(Boolean);
    for (const end of ends) {
      svg.append(svgEl('circle', { cx: end.x, cy: end.y, r: 4, class: 'dot', style: `fill: ${end.color}` }));
    }
    if (series.length <= 4) {
      ends.forEach((end, i) => {
        const clash = ends.some((other, j) => j !== i &&
          Math.abs(other.y - end.y) < 15 && Math.abs(other.x - end.x) < 56);
        if (!clash) svg.append(text(end.x + 9, end.y + 4, end.label, 'direct-label'));
      });
    }

    const crosshair = vLine(0, plotTop, plotBottom, 'crosshair');
    crosshair.style.display = 'none';
    svg.append(crosshair);
    const hoverDots = svgEl('g', {});
    svg.append(hoverDots);

    attachCrosshair(svg, crosshair, MAX_DAYS, (day, event) => {
      hoverDots.replaceChildren();
      if (day === null) {
        hideTooltip();
        return;
      }
      const rows = series.map((s, index) => {
        const value = s.values[day - 1];
        const point = allPoints[index][day - 1];
        if (point) {
          hoverDots.append(svgEl('circle', { cx: point.x, cy: point.y, r: 4, class: 'dot', style: `fill: ${s.color}` }));
        }
        return { value: value === null || value === undefined ? '–' : metric.format(value), label: s.label, color: s.color };
      });
      showTooltip(event, `Day ${day}`, rows);
    });

    return svg;
  }

  // --- Insights. ---

  function pointerInViewBox(svg, event) {
    const box = svg.getBoundingClientRect();
    const scale = svg.viewBox.baseVal.width / box.width;
    return { x: (event.clientX - box.left) * scale, y: (event.clientY - box.top) * scale };
  }

  // xAxis / yAxis: { min, max, ticks, format, title }. points: { x, y, heading, rows }.
  function buildScatterChart({ points, xAxis, yAxis, fit, label }) {
    const WIDTH = 480;
    const HEIGHT = 330;
    const PLOT = { left: 56, right: WIDTH - 16, top: 12, bottom: HEIGHT - 50 };
    const xFor = (v) => PLOT.left + ((v - xAxis.min) / (xAxis.max - xAxis.min)) * (PLOT.right - PLOT.left);
    const yFor = (v) => PLOT.bottom - ((v - yAxis.min) / (yAxis.max - yAxis.min)) * (PLOT.bottom - PLOT.top);

    const svg = svgEl('svg', { viewBox: `0 0 ${WIDTH} ${HEIGHT}`, role: 'img', class: 'chart chart-compact', 'aria-label': label });

    for (const tick of yAxis.ticks) {
      svg.append(hLine(PLOT.left, PLOT.right, yFor(tick), 'grid'));
      svg.append(text(PLOT.left - 8, yFor(tick) + 4, yAxis.format(tick), 'tick', { 'text-anchor': 'end' }));
    }
    for (const tick of xAxis.ticks) {
      svg.append(vLine(xFor(tick), PLOT.top, PLOT.bottom, 'grid'));
      svg.append(text(xFor(tick), PLOT.bottom + 18, xAxis.format(tick), 'tick', { 'text-anchor': 'middle' }));
    }
    svg.append(vLine(PLOT.left, PLOT.top, PLOT.bottom, 'axis'));
    svg.append(hLine(PLOT.left, PLOT.right, PLOT.bottom, 'axis'));
    svg.append(text((PLOT.left + PLOT.right) / 2, HEIGHT - 8, xAxis.title, 'row-label', { 'text-anchor': 'middle' }));
    const midY = (PLOT.top + PLOT.bottom) / 2;
    svg.append(text(14, midY, yAxis.title, 'row-label', { 'text-anchor': 'middle', transform: `rotate(-90 14 ${midY})` }));

    const placed = points.map((point) => ({ ...point, px: xFor(point.x), py: yFor(point.y) }));
    for (const point of placed) {
      svg.append(svgEl('circle', { cx: point.px, cy: point.py, r: 4, class: 'dot scatter-dot' }));
    }

    // The trend line only spans the logged range, so it never implies data beyond it.
    if (fit) {
      const xs = points.map((p) => p.x);
      const from = Math.min(...xs);
      const to = Math.max(...xs);
      const clampY = (v) => Math.min(yAxis.max, Math.max(yAxis.min, v));
      svg.append(svgEl('line', {
        x1: xFor(from),
        x2: xFor(to),
        y1: yFor(clampY(fit.intercept + fit.slope * from)),
        y2: yFor(clampY(fit.intercept + fit.slope * to)),
        class: 'trend-line',
      }));
    }

    const highlight = svgEl('circle', { r: 6, class: 'dot scatter-highlight' });
    highlight.style.display = 'none';
    svg.append(highlight);

    const clear = () => {
      highlight.style.display = 'none';
      hideTooltip();
    };
    svg.addEventListener('pointermove', (event) => {
      const pointer = pointerInViewBox(svg, event);
      const distance = (p) => Math.hypot(p.px - pointer.x, p.py - pointer.y);
      let nearest = null;
      for (const point of placed) {
        if (!nearest || distance(point) < distance(nearest)) nearest = point;
      }
      if (!nearest || distance(nearest) > 24) {
        clear();
        return;
      }
      highlight.style.display = '';
      highlight.setAttribute('cx', nearest.px);
      highlight.setAttribute('cy', nearest.py);
      // Nights with identical values sit on one dot, so name them all.
      const same = placed.filter((p) => p.px === nearest.px && p.py === nearest.py);
      const heading = same.slice(0, 4).map((p) => p.heading).join(', ') + (same.length > 4 ? ` +${same.length - 4} more` : '');
      showTooltip(event, heading, nearest.rows);
    });
    svg.addEventListener('pointerleave', clear);

    return svg;
  }

  function roundedRange(values, step, floorAt, ceilAt) {
    const low = Math.floor(Math.min(...values) / step) * step;
    const high = Math.ceil(Math.max(...values) / step) * step;
    return { min: Math.max(floorAt, low === high ? low - step : low), max: Math.min(ceilAt, low === high ? high + step : high) };
  }

  function ticksBetween(min, max, step) {
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max; v += step) ticks.push(v);
    return ticks;
  }

  // series: output of Core.rollingSeries. Three measures have three different scales, so each
  // gets its own panel, sharing one date axis and one crosshair.
  function buildRollingChart({ series, hoursLabel }) {
    const WIDTH = LEFT + MAX_DAYS * CELL + MONTH_RIGHT;
    const PANEL_HEIGHT = 110;
    const PANEL_GAP = 34;
    const right = WIDTH - MONTH_RIGHT;
    const xFor = (i) => (series.length === 1
      ? (LEFT + right) / 2
      : LEFT + (i / (series.length - 1)) * (right - LEFT));

    const has = (field) => series.map((s) => s[field]).filter((v) => v !== null);
    const hours = has('hours');
    const quality = has('quality');
    const variation = has('startVariation');
    const hoursRange = hours.length
      ? roundedRange([...hours, ...Core.TARGET_HOURS], 1, 0, 48) : { min: 5, max: 10 };
    const qualityRange = quality.length ? roundedRange(quality, 10, 0, 100) : { min: 50, max: 100 };
    const variationMax = variation.length ? Math.max(30, Math.ceil(Math.max(...variation) / 30) * 30) : 60;

    const panels = [
      {
        field: 'hours',
        title: `${hoursLabel}, 7-day average`,
        ...hoursRange,
        ticks: ticksBetween(hoursRange.min, hoursRange.max, 1),
        guides: Core.TARGET_HOURS,
        format: Core.formatHours,
        tooltip: 'avg sleep',
      },
      {
        field: 'quality',
        title: 'sleep quality, 7-day average',
        ...qualityRange,
        ticks: ticksBetween(qualityRange.min, qualityRange.max, 10),
        guides: [],
        format: (v) => String(Math.round(v)),
        tooltip: 'avg quality',
      },
      {
        field: 'startVariation',
        title: 'sleep start variation, minutes (lower is steadier)',
        min: 0,
        max: variationMax,
        ticks: ticksBetween(0, variationMax, variationMax > 120 ? 60 : 30),
        guides: [],
        format: (v) => `${Math.round(v)} min`,
        tooltip: 'start variation',
      },
    ];

    const top = 22;
    const bottom = top + panels.length * PANEL_HEIGHT + (panels.length - 1) * PANEL_GAP;
    const svg = svgEl('svg', {
      viewBox: `0 0 ${WIDTH} ${bottom + 28}`,
      role: 'img',
      class: 'chart',
      'aria-label': '7-day rolling averages of sleep hours and quality, and sleep start variation, across all logged days. The table below lists every value.',
    });

    const monthStarts = series.map((s, i) => ({ s, i })).filter(({ s, i }) => i === 0 || s.date.endsWith('-01'));
    panels.forEach((panel, index) => {
      const panelTop = top + index * (PANEL_HEIGHT + PANEL_GAP);
      const panelBottom = panelTop + PANEL_HEIGHT;
      const yFor = (v) => panelBottom - ((v - panel.min) / (panel.max - panel.min)) * PANEL_HEIGHT;

      svg.append(text(LEFT, panelTop - 8, panel.title, 'row-label'));
      for (const tick of panel.ticks) {
        svg.append(hLine(LEFT, right, yFor(tick), 'grid'));
        svg.append(text(LEFT - 8, yFor(tick) + 4, tick, 'tick', { 'text-anchor': 'end' }));
      }
      for (const { i } of monthStarts) svg.append(vLine(xFor(i), panelTop, panelBottom, 'grid'));
      svg.append(vLine(LEFT, panelTop, panelBottom, 'axis'));
      svg.append(hLine(LEFT, right, panelBottom, 'axis'));
      for (const guide of panel.guides) {
        if (guide >= panel.min && guide <= panel.max) svg.append(hLine(LEFT, right, yFor(guide), 'guide'));
      }

      const points = series.map((s, i) => (s[panel.field] === null ? null : { x: xFor(i), y: yFor(s[panel.field]) }));
      svg.append(svgEl('path', { d: linePath(points), class: 'series-line', style: 'stroke: var(--ink-line)' }));
      points.forEach((point, i) => {
        const isEnd = point && !points.slice(i + 1).some(Boolean);
        if (point && (isolated(points, i) || isEnd)) {
          svg.append(svgEl('circle', { cx: point.x, cy: point.y, r: 4, class: 'dot', style: 'fill: var(--ink-line)' }));
        }
      });
    });

    monthStarts.forEach(({ s, i }, position) => {
      // Skip the first label if the next month starts too close for both to fit.
      const next = monthStarts[position + 1];
      if (next && xFor(next.i) - xFor(i) < 62) return;
      const [year, month] = s.date.split('-');
      svg.append(text(xFor(i), bottom + 20, Core.monthLabel(`${year}-${month}`, true), 'tick', {
        'text-anchor': i === 0 ? 'start' : 'middle',
      }));
    });

    const crosshair = vLine(0, top, bottom, 'crosshair');
    crosshair.style.display = 'none';
    svg.append(crosshair);

    const clear = () => {
      crosshair.style.display = 'none';
      hideTooltip();
    };
    svg.addEventListener('pointermove', (event) => {
      const { x } = pointerInViewBox(svg, event);
      if (x < LEFT - 8 || x > right + 8) {
        clear();
        return;
      }
      const ratio = series.length === 1 ? 0 : (x - LEFT) / (right - LEFT);
      const index = Math.min(series.length - 1, Math.max(0, Math.round(ratio * (series.length - 1))));
      const point = series[index];
      crosshair.style.display = '';
      crosshair.setAttribute('x1', xFor(index));
      crosshair.setAttribute('x2', xFor(index));
      showTooltip(event, Core.dayLabel(point.date), panels.map((panel) => ({
        value: point[panel.field] === null ? '–' : panel.format(point[panel.field]),
        label: panel.tooltip,
      })));
    });
    svg.addEventListener('pointerleave', clear);

    return svg;
  }

  root.SleepCharts = {
    buildMonthChart, buildCompareChart, buildScatterChart, buildRollingChart, roundedRange, ticksBetween, hideTooltip,
  };
})(globalThis);
