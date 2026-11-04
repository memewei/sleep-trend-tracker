// A draggable noon-to-noon bar for choosing sleep start and wake times.
(function (root) {
  'use strict';

  const Core = root.SleepCore;
  // A pixel on the bar is about 4 minutes, so dragging needs a coarser grid than the keys.
  const DRAG_SNAP_MINUTES = 15;
  const KEY_STEP_MINUTES = 5;
  const BIG_STEP_MINUTES = 30;
  const DRAW_THRESHOLD_PX = 3;
  const NIGHT_OPTIONS = {
    labels: { start: 'Sleep start', wake: 'Wake time' },
    // Where the first arrow key press lands on an empty bar.
    defaults: { start: '23:00', wake: '07:00' },
    clearLabel: 'Clear sleep times',
  };

  function div(className) {
    const node = document.createElement('div');
    node.className = className;
    return node;
  }

  function createTimeTrack({ dayLabel, onPreview, onCommit, options = NIGHT_OPTIONS }) {
    const { labels, defaults, clearLabel } = options;
    const times = { start: undefined, wake: undefined };
    let drag = null;

    const track = div('time-track');
    const rail = div('time-rail');
    const fills = [div('time-fill'), div('time-fill')];
    const hint = div('time-hint');
    hint.textContent = 'drag to set';

    const handles = {
      start: div('time-handle time-handle-start'),
      wake: div('time-handle time-handle-wake'),
    };
    for (const [name, handle] of Object.entries(handles)) {
      handle.dataset.time = name;
      handle.tabIndex = 0;
      handle.setAttribute('role', 'slider');
      handle.setAttribute('aria-label', `${labels[name]}, ${dayLabel}`);
      handle.setAttribute('aria-orientation', 'horizontal');
      handle.setAttribute('aria-valuemin', '0');
      handle.setAttribute('aria-valuemax', '1435');
    }
    track.append(rail, ...fills, hint, handles.start, handles.wake);

    const readout = div('time-readout');
    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'time-clear';
    clearButton.textContent = '×';
    clearButton.setAttribute('aria-label', `${clearLabel}, ${dayLabel}`);

    function placeFill(fill, from, to) {
      fill.hidden = to <= from;
      fill.style.left = `${from * 100}%`;
      fill.style.width = `${(to - from) * 100}%`;
    }

    function render() {
      const positions = {};
      for (const [name, handle] of Object.entries(handles)) {
        const value = times[name];
        const position = Core.timeToPosition(Core.parseTime(value === undefined ? defaults[name] : value));
        positions[name] = position;
        handle.style.left = `${position * 100}%`;
        handle.classList.toggle('is-unset', value === undefined);
        handle.setAttribute('aria-valuenow', String(Math.round(position * 1440)));
        handle.setAttribute('aria-valuetext', value === undefined ? 'not set' : value);
      }

      // A night that crosses the noon edge of the bar is drawn in two pieces.
      if (times.start !== undefined && times.wake !== undefined && times.start !== times.wake) {
        if (positions.start < positions.wake) {
          placeFill(fills[0], positions.start, positions.wake);
          placeFill(fills[1], 0, 0);
        } else {
          placeFill(fills[0], positions.start, 1);
          placeFill(fills[1], 0, positions.wake);
        }
      } else {
        placeFill(fills[0], 0, 0);
        placeFill(fills[1], 0, 0);
      }

      const isEmpty = times.start === undefined && times.wake === undefined;
      track.classList.toggle('is-empty', isEmpty);
      readout.textContent = `${times.start ?? '–'} → ${times.wake ?? '–'}`;
      clearButton.style.visibility = isEmpty ? 'hidden' : 'visible';
    }

    function setValues(start, wake) {
      times.start = start;
      times.wake = wake;
      render();
    }

    function positionFromEvent(event) {
      const box = track.getBoundingClientRect();
      return (event.clientX - box.left) / box.width;
    }

    const timeAt = (position) => Core.formatClock(Core.positionToMinutes(position, DRAG_SNAP_MINUTES));

    function beginDrag(event, mode, details) {
      event.preventDefault();
      track.setPointerCapture(event.pointerId);
      drag = {
        mode,
        pointerId: event.pointerId,
        startX: event.clientX,
        original: { ...times },
        ...details,
      };
    }

    track.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || drag) return;
      const pressed = event.target.closest('.time-handle');

      if (pressed) {
        const name = pressed.dataset.time;
        // Dragging from where the dot was grabbed, so a press alone never changes the time.
        const offset = Core.timeToPosition(Core.parseTime(times[name])) - positionFromEvent(event);
        beginDrag(event, 'handle', { name, offset });
        pressed.focus({ preventScroll: true });
        return;
      }

      // A filled bar only responds to its dots, so a stray click can't change a saved time.
      if (times.start !== undefined && times.wake !== undefined) return;

      const position = positionFromEvent(event);
      if (times.start === undefined && times.wake === undefined) {
        beginDrag(event, 'draw', { anchor: position });
        times.start = timeAt(position);
        handles.start.focus({ preventScroll: true });
      } else {
        const name = times.start === undefined ? 'start' : 'wake';
        beginDrag(event, 'handle', { name, offset: 0 });
        times[name] = timeAt(position);
        handles[name].focus({ preventScroll: true });
      }
      render();
      onPreview(times.start, times.wake);
    });

    track.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const position = positionFromEvent(event);
      if (drag.mode === 'handle') {
        times[drag.name] = timeAt(position + drag.offset);
      } else if (Math.abs(event.clientX - drag.startX) >= DRAW_THRESHOLD_PX) {
        // Drawing right to left still means the earlier point is when sleep started.
        times.start = timeAt(Math.min(drag.anchor, position));
        times.wake = timeAt(Math.max(drag.anchor, position));
      }
      render();
      onPreview(times.start, times.wake);
    });

    function finishDrag() {
      const { original } = drag;
      drag = null;
      if (original.start !== times.start || original.wake !== times.wake) {
        onCommit(times.start, times.wake);
      }
    }

    function cancelDrag() {
      const { original } = drag;
      drag = null;
      setValues(original.start, original.wake);
      onPreview(times.start, times.wake);
    }

    track.addEventListener('pointerup', (event) => {
      if (drag && event.pointerId === drag.pointerId) finishDrag();
    });
    // The browser cancels a touch drag when it turns out to be a page scroll.
    track.addEventListener('pointercancel', (event) => {
      if (drag && event.pointerId === drag.pointerId) cancelDrag();
    });

    function changeByKeyboard(name, value) {
      times[name] = value;
      render();
      onCommit(times.start, times.wake);
    }

    track.addEventListener('keydown', (event) => {
      const name = event.target.dataset.time;
      if (!name) return;

      if (event.key === 'Escape') {
        if (drag) {
          track.releasePointerCapture(drag.pointerId);
          cancelDrag();
        }
        return;
      }
      if (drag) return;

      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        if (times[name] !== undefined) changeByKeyboard(name, undefined);
        return;
      }

      const moves = {
        ArrowRight: [1, KEY_STEP_MINUTES],
        ArrowUp: [1, KEY_STEP_MINUTES],
        ArrowLeft: [-1, KEY_STEP_MINUTES],
        ArrowDown: [-1, KEY_STEP_MINUTES],
        PageUp: [1, BIG_STEP_MINUTES],
        PageDown: [-1, BIG_STEP_MINUTES],
      };
      const move = moves[event.key];
      if (!move) return;
      event.preventDefault();
      if (times[name] === undefined) {
        changeByKeyboard(name, defaults[name]);
      } else {
        const step = event.shiftKey ? BIG_STEP_MINUTES : move[1];
        changeByKeyboard(name, Core.formatClock(Core.stepMinutes(Core.parseTime(times[name]), move[0], step)));
      }
    });

    clearButton.addEventListener('click', () => {
      setValues(undefined, undefined);
      handles.start.focus({ preventScroll: true });
      onCommit(undefined, undefined);
    });

    render();

    return {
      track,
      readout,
      clearButton,
      setTimes(start, wake) {
        if (!drag) setValues(start, wake);
      },
    };
  }

  root.SleepTimeTrack = { createTimeTrack };
})(globalThis);
