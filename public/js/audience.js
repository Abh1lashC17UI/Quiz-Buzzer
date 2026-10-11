/**
 * audience.js
 *
 * Shared JavaScript for /audience/<token> and /embed/<token>.
 *
 * Distinct format presentations:
 *   - JEOPARDY: Question, ARMED/LOCKED state, Winner banner (NO timer, NO timeline)
 *   - COUNTDOWN QUIZ: Question, large countdown timer, progress bar, and Answer Timeline
 */

'use strict';

// ── Extract display token from URL path ──────────────────────────────────────
const pathParts    = window.location.pathname.split('/').filter(Boolean);
const displayToken = pathParts[pathParts.length - 1] || '';

if (!displayToken) {
  document.body.innerHTML =
    '<p style="color:#f85149;padding:2rem;font-family:monospace;">Missing display token in URL.</p>';
  throw new Error('No display token');
}

// ── DOM refs ─────────────────────────────────────────────────────────────────
const connDot         = document.getElementById('conn-dot');
const formatEl        = document.getElementById('audience-format');
const questionEl      = document.getElementById('audience-question');
const stateEl         = document.getElementById('audience-state');
const winnerEl        = document.getElementById('audience-winner');

// Timer DOM
const timerSection    = document.getElementById('audience-timer-section');
const timerNumberEl   = document.getElementById('audience-timer-number');
const timerFillEl     = document.getElementById('audience-timer-fill');
const timerStateEl    = document.getElementById('audience-timer-state');

// Timeline DOM
const timelineSection = document.getElementById('audience-timeline-section');
const timelineEvents  = document.getElementById('audience-timeline-events');
const railPlayed      = document.getElementById('audience-rail-played');
const tickStart       = document.getElementById('audience-tick-start');

// ── Timer RAF ────────────────────────────────────────────────────────────────
let timerRafId     = null;
let lastTimerState = null;

// ── WebSocket ─────────────────────────────────────────────────────────────────
let ws             = null;
let reconnectDelay = 1000;

function connect() {
  const wsUrl = `ws://${location.host}`;
  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    setConnDot('connected');
    reconnectDelay = 1000;
    ws.send(JSON.stringify({ type: 'DISPLAY_AUTH', displayToken }));
  });

  ws.addEventListener('message', (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    handleMessage(msg);
  });

  ws.addEventListener('close', () => {
    setConnDot('disconnected');
    cancelTimerRaf();
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 8000);
  });

  ws.addEventListener('error', () => {});
}

// ── Message handling ─────────────────────────────────────────────────────────
function handleMessage(msg) {
  switch (msg.type) {
    case 'DISPLAY_AUTH_OK':
      break;

    case 'DISPLAY_AUTH_ERROR':
      stateEl.textContent = 'INVALID DISPLAY TOKEN';
      stateEl.className   = 'audience-state state-locked-aud';
      break;

    case 'GAME_STATE':
      applyState(msg);
      break;

    default:
      break;
  }
}

// ── Render state ─────────────────────────────────────────────────────────────
function applyState(msg) {
  const format = msg.format;

  // Question number
  const qNum = typeof msg.questionNumber === 'number' ? msg.questionNumber : 1;
  questionEl.textContent = `QUESTION ${qNum}`;

  if (format === 'JEOPARDY') {
    formatEl.textContent = 'JEOPARDY';
    timerSection.classList.add('hidden');
    timelineSection.style.display = 'none';
    cancelTimerRaf();
    applyJeopardyDisplay(msg);
  } else if (format === 'COUNTDOWN_QUIZ') {
    formatEl.textContent = 'COUNTDOWN QUIZ';
    timerSection.classList.remove('hidden');
    timelineSection.style.display = '';
    stateEl.textContent = '';
    winnerEl.className = 'audience-winner hidden';
    winnerEl.textContent = '';
    applyCountdownDisplay(msg);
  } else {
    // Unset format
    formatEl.textContent = '';
    questionEl.textContent = 'TRIVIA NIGHT';
    timerSection.classList.add('hidden');
    timelineSection.style.display = 'none';
    cancelTimerRaf();
    stateEl.textContent = 'WAITING FOR HOST';
    stateEl.className = 'audience-state state-locked-aud';
    winnerEl.className = 'audience-winner hidden';
    winnerEl.textContent = '';
  }
}

// ── JEOPARDY DISPLAY ────────────────────────────────────────────────────────
function applyJeopardyDisplay(msg) {
  const state  = msg.state || 'LOCKED';
  const winner = msg.winner;

  if (winner) {
    stateEl.textContent  = '';
    stateEl.className    = 'audience-state state-winner-aud';
    winnerEl.textContent = `TEAM ${winner} BUZZED FIRST`;
    winnerEl.className   = 'audience-winner';
  } else if (state === 'ARMED') {
    stateEl.textContent  = 'ARMED';
    stateEl.className    = 'audience-state state-armed-aud';
    winnerEl.className   = 'audience-winner hidden';
    winnerEl.textContent = '';
  } else {
    stateEl.textContent  = 'LOCKED';
    stateEl.className    = 'audience-state state-locked-aud';
    winnerEl.className   = 'audience-winner hidden';
    winnerEl.textContent = '';
  }
}

// ── COUNTDOWN QUIZ DISPLAY ──────────────────────────────────────────────────
function applyCountdownDisplay(msg) {
  const timer = msg.timer || { durationMs: 30000, startedAt: null, endsAt: null, state: 'IDLE' };
  applyCountdownTimer(timer);
  renderCountdownTimeline(timer, msg.answerEvents || []);
}

function applyCountdownTimer(timer) {
  if (lastTimerState !== timer.state) {
    cancelTimerRaf();
    lastTimerState = timer.state;
  }

  if (timer.state === 'IDLE') {
    const secs = Math.round(timer.durationMs / 1000);
    timerNumberEl.textContent = secs;
    timerNumberEl.className   = 'audience-timer-number';
    timerFillEl.style.width   = '100%';
    timerFillEl.className     = 'audience-timer-bar-fill';
    timerStateEl.textContent  = 'IDLE';
    timerStateEl.className    = 'audience-timer-state';
    if (tickStart) tickStart.textContent = formatSecs(secs);
    return;
  }

  if (timer.state === 'EXPIRED') {
    cancelTimerRaf();
    timerNumberEl.textContent = '0';
    timerNumberEl.className   = 'audience-timer-number time-up';
    timerFillEl.style.width   = '0%';
    timerFillEl.className     = 'audience-timer-bar-fill time-up';
    timerStateEl.textContent  = 'TIME UP';
    timerStateEl.className    = 'audience-timer-state expired';
    if (tickStart) tickStart.textContent = formatSecs(timer.durationMs / 1000);
    return;
  }

  timerStateEl.textContent = 'RUNNING';
  timerStateEl.className   = 'audience-timer-state running';
  if (tickStart) tickStart.textContent = formatSecs(timer.durationMs / 1000);

  function tick() {
    const now       = Date.now();
    const remaining = Math.max(0, timer.endsAt - now);
    const pct       = (remaining / timer.durationMs) * 100;
    const secs      = Math.ceil(remaining / 1000);

    timerNumberEl.textContent = secs;
    timerFillEl.style.width   = `${pct}%`;

    if (remaining <= 0) {
      timerNumberEl.textContent = '0';
      timerNumberEl.className   = 'audience-timer-number time-up';
      timerFillEl.className     = 'audience-timer-bar-fill time-up';
      timerFillEl.style.width   = '0%';
      return;
    }

    const isLow = remaining <= 10000;
    timerNumberEl.className = 'audience-timer-number' + (isLow ? ' low-time' : '');
    timerFillEl.className   = 'audience-timer-bar-fill' + (isLow ? ' low-time' : '');
    timerRafId = requestAnimationFrame(tick);
  }

  if (timerRafId === null) {
    timerRafId = requestAnimationFrame(tick);
  }
}

function cancelTimerRaf() {
  if (timerRafId !== null) {
    cancelAnimationFrame(timerRafId);
    timerRafId = null;
  }
}

function renderCountdownTimeline(timer, events) {
  const durationMs = timer.durationMs || 30000;

  if (timer.state === 'RUNNING' && timer.startedAt && timer.endsAt) {
    const elapsed = Date.now() - timer.startedAt;
    const pct     = Math.min(100, (elapsed / durationMs) * 100);
    if (railPlayed) railPlayed.style.width = `${pct}%`;
  } else if (timer.state === 'EXPIRED') {
    if (railPlayed) railPlayed.style.width = '100%';
  } else {
    if (railPlayed) railPlayed.style.width = '0%';
  }

  if (timelineEvents) timelineEvents.innerHTML = '';
  if (!events || events.length === 0 || !timelineEvents) return;

  const sorted = [...events].sort((a, b) => a.elapsedMs - b.elapsedMs);
  const positions = sorted.map(e => (e.elapsedMs / durationMs) * 100);

  const stackClass = new Array(sorted.length).fill('');
  for (let i = 1; i < positions.length; i++) {
    if (Math.abs(positions[i] - positions[i - 1]) < 8) {
      const prev = stackClass[i - 1];
      stackClass[i] = prev === '' ? 'stack-1' : 'stack-2';
    }
  }

  sorted.forEach((ev, idx) => {
    const pct   = Math.min(100, Math.max(0, positions[idx]));
    const elSec = (ev.elapsedMs / 1000).toFixed(1);
    const cls   = stackClass[idx] ? ` ${stackClass[idx]}` : '';

    const el = document.createElement('div');
    el.className = `timeline-event${cls}`;
    el.setAttribute('data-team', ev.team);
    el.style.left = `${pct}%`;

    el.innerHTML =
      `<div class="timeline-label">` +
        `<span class="tl-team">TEAM ${ev.team}</span>` +
        `<span class="tl-time">${elSec}s</span>` +
      `</div>` +
      `<div class="timeline-dot"></div>`;

    timelineEvents.appendChild(el);
  });
}

function setConnDot(state) {
  connDot.className = 'audience-conn-dot ' +
    (state === 'connected' ? 'connected-dot' : 'disconnected-dot');
}

function formatSecs(totalSecs) {
  const s = Math.round(totalSecs);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r === 0 ? `${m}m` : `${m}m${r}s`;
}

// ── Start ────────────────────────────────────────────────────────────────────
connect();
