/**
 * host.js — Host Control Panel Client
 *
 * Architecture:
 *   1. Initial Launch: If no format selected yet, renders Choose Quiz Type view:
 *      - JEOPARDY
 *      - COUNTDOWN QUIZ
 *      - FORMAT 3 (placeholder)
 *   2. Once format is chosen:
 *      - JEOPARDY: Renders pure Jeopardy host controls (ARM, RESET, Stepper, Winner)
 *      - COUNTDOWN QUIZ: Renders Countdown Quiz host controls (Presets, START, RESET, Timeline)
 */

'use strict';

// ── Read host token from URL ────────────────────────────────────────────────
const params    = new URLSearchParams(window.location.search);
const hostToken = params.get('token');

if (!hostToken) {
  document.body.innerHTML =
    '<div style="padding:2rem;color:#f85149;font-family:monospace;font-size:1.2rem;">' +
    '<h2>Missing host token</h2>' +
    '<p>Open the URL printed in the server console. It looks like:</p>' +
    '<code>http://&lt;ip&gt;:3000/host?token=&lt;token&gt;</code>' +
    '</div>';
  throw new Error('No host token in URL');
}

// ── DOM refs ────────────────────────────────────────────────────────────────
const connBanner          = document.getElementById('conn-banner');
const connText            = document.getElementById('conn-text');

// Views
const viewSelectFormat    = document.getElementById('view-select-format');
const viewHostJeopardy    = document.getElementById('view-host-jeopardy');
const viewHostCountdown   = document.getElementById('view-host-countdown');

// Format selection buttons
const btnSelectJeopardy   = document.getElementById('btn-select-jeopardy');
const btnSelectCountdown  = document.getElementById('btn-select-countdown');
const btnSelectFormat3    = document.getElementById('btn-select-format3');
const placeholderOverlay  = document.getElementById('placeholder-overlay');
const btnClosePlaceholder = document.getElementById('btn-close-placeholder');

// Jeopardy View DOM
const jGameCode           = document.getElementById('j-game-code');
const jQuestionDisplay    = document.getElementById('j-question-display');
const jStateDisplay       = document.getElementById('j-state-display');
const jWinnerBox          = document.getElementById('j-winner-box');
const jWinnerText         = document.getElementById('j-winnerText');
const jBtnArm             = document.getElementById('j-btn-arm');
const jBtnReset           = document.getElementById('j-btn-reset');
const jBtnQMinus          = document.getElementById('j-btn-q-minus');
const jBtnQPlus           = document.getElementById('j-btn-q-plus');
const jBtnAudience        = document.getElementById('j-btn-audience');
const jBtnCopyAudience    = document.getElementById('j-btn-copy-audience');
const jEventLog           = document.getElementById('j-event-log');

// Countdown Quiz View DOM
const cGameCode           = document.getElementById('c-game-code');
const cQuestionDisplay    = document.getElementById('c-question-display');
const cBtnQMinus          = document.getElementById('c-btn-q-minus');
const cBtnQPlus           = document.getElementById('c-btn-q-plus');
const cDurationPresets    = document.getElementById('c-duration-presets');
const cTimerNumber        = document.getElementById('c-timer-number');
const cTimerFill          = document.getElementById('c-timer-fill');
const cTimerStateEl       = document.getElementById('c-timer-state');
const cBtnStart           = document.getElementById('c-btn-start');
const cBtnReset           = document.getElementById('c-btn-reset');
const cBtnAudience        = document.getElementById('c-btn-audience');
const cBtnCopyAudience    = document.getElementById('c-btn-copy-audience');
const cTimelineEvents     = document.getElementById('c-timeline-events');
const cRailPlayed         = document.getElementById('c-rail-played');
const cTickStart          = document.getElementById('c-tick-start');
const cEventLog           = document.getElementById('c-event-log');

// ── State ────────────────────────────────────────────────────────────────────
let ws             = null;
let reconnectDelay = 1000;
let authenticated  = false;
let displayToken   = null;
let currentGameCode = '——————';

// Timer RAF loop
let timerRafId     = null;
let lastTimerState = null;

// ── WebSocket ───────────────────────────────────────────────────────────────
function connect() {
  const wsUrl = `ws://${location.host}`;
  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    setConnBanner('connected', '● Connected');
    reconnectDelay = 1000;
    send({ type: 'HOST_AUTH', hostToken });
  });

  ws.addEventListener('message', (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    handleMessage(msg);
  });

  ws.addEventListener('close', () => {
    authenticated = false;
    setConnBanner('reconnecting', '⟳ Reconnecting…');
    cancelTimerRaf();
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 10000);
  });

  ws.addEventListener('error', () => {});
}

function send(obj) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// ── Message handling ────────────────────────────────────────────────────────
function handleMessage(msg) {
  switch (msg.type) {
    case 'HOST_AUTH_OK':
      authenticated = true;
      currentGameCode = msg.gameCode || '——————';
      displayToken = msg.displayToken || null;
      logEvent('conn', `Host authenticated. Game code: ${currentGameCode}`);
      break;

    case 'HOST_AUTH_ERROR':
      logEvent('error', `Auth error: ${msg.reason}`);
      break;

    case 'GAME_STATE':
      applyGameState(msg);
      break;

    case 'ERROR':
      logEvent('error', `Server error: ${msg.reason}`);
      break;
  }
}

// ── View Switching & State Application ──────────────────────────────────────
function applyGameState(msg) {
  const format = msg.format;

  // View routing:
  if (!format) {
    // Unset format -> Show Choose Quiz Type screen
    viewSelectFormat.classList.remove('hidden');
    viewHostJeopardy.classList.add('hidden');
    viewHostCountdown.classList.add('hidden');
    cancelTimerRaf();
    return;
  }

  viewSelectFormat.classList.add('hidden');

  if (format === 'JEOPARDY') {
    viewHostJeopardy.classList.remove('hidden');
    viewHostCountdown.classList.add('hidden');
    cancelTimerRaf();
    applyJeopardyState(msg);
  } else if (format === 'COUNTDOWN_QUIZ') {
    viewHostJeopardy.classList.add('hidden');
    viewHostCountdown.classList.remove('hidden');
    applyCountdownState(msg);
  }
}

// ── JEOPARDY VIEW ───────────────────────────────────────────────────────────
function applyJeopardyState(msg) {
  jGameCode.textContent = currentGameCode;

  // Question number
  if (typeof msg.questionNumber === 'number') {
    jQuestionDisplay.textContent = msg.questionNumber;
    jBtnQMinus.disabled = !authenticated || msg.questionNumber <= 1;
    jBtnQPlus.disabled  = !authenticated || msg.questionNumber >= 999;
  }

  // State badge
  const s = msg.state || 'LOCKED';
  jStateDisplay.textContent = s;
  jStateDisplay.className = 'state-value ' + (s === 'ARMED' ? 'state-armed' : 'state-locked');

  // Winner banner
  if (msg.winner) {
    jWinnerBox.classList.remove('hidden');
    jWinnerText.textContent = `🏆 TEAM ${msg.winner} BUZZED FIRST!`;
    logEvent('buzz', `Team ${msg.winner} buzzed first!`);
  } else {
    jWinnerBox.classList.add('hidden');
  }

  // Team connection rows
  for (let t = 1; t <= 3; t++) {
    const connected = msg.teams && msg.teams[t];
    const dot   = document.getElementById(`j-dot-${t}`);
    const label = document.getElementById(`j-label-${t}`);
    const kick  = document.querySelector(`#view-host-jeopardy .kick-btn[data-team="${t}"]`);
    const row   = document.getElementById(`j-team-row-${t}`);

    if (dot) dot.className = 'dot ' + (connected ? 'connected-dot' : 'disconnected-dot');
    if (label) {
      label.textContent = connected ? 'CONNECTED' : 'DISCONNECTED';
      label.className = 'conn-label' + (connected ? ' connected' : '');
    }
    if (kick) kick.disabled = !connected || !authenticated;
    if (row) row.classList.toggle('winner-row', msg.winner === t);
  }

  // Buttons
  if (authenticated) {
    jBtnArm.disabled   = (s === 'ARMED');
    jBtnReset.disabled = false;
    jBtnAudience.disabled     = !displayToken;
    jBtnCopyAudience.disabled = !displayToken;
  }
}

// ── COUNTDOWN QUIZ VIEW ─────────────────────────────────────────────────────
function applyCountdownState(msg) {
  cGameCode.textContent = currentGameCode;

  // Question number
  if (typeof msg.questionNumber === 'number') {
    cQuestionDisplay.textContent = msg.questionNumber;
    cBtnQMinus.disabled = !authenticated || msg.questionNumber <= 1;
    cBtnQPlus.disabled  = !authenticated || msg.questionNumber >= 999;
  }

  const timer = msg.timer || { durationMs: 30000, startedAt: null, endsAt: null, state: 'IDLE' };
  const events = msg.answerEvents || [];
  const answeredSet = new Set(msg.answeredTeams || []);

  // Timer rendering
  applyCountdownTimer(timer);

  // Timeline rendering
  renderCountdownTimeline(timer, events);

  // Team connection & answer status rows
  for (let t = 1; t <= 3; t++) {
    const connected = msg.teams && msg.teams[t];
    const dot       = document.getElementById(`c-dot-${t}`);
    const label     = document.getElementById(`c-label-${t}`);
    const answered  = document.getElementById(`c-answered-${t}`);
    const kick      = document.querySelector(`#view-host-countdown .kick-btn[data-team="${t}"]`);

    if (dot) dot.className = 'dot ' + (connected ? 'connected-dot' : 'disconnected-dot');
    if (label) {
      label.textContent = connected ? 'CONNECTED' : 'DISCONNECTED';
      label.className = 'conn-label' + (connected ? ' connected' : '');
    }

    if (answered) {
      const teamEvent = events.find(e => e.team === t);
      if (teamEvent) {
        answered.textContent = `ANSWERED (${(teamEvent.elapsedMs / 1000).toFixed(1)}s)`;
        answered.style.color = 'var(--green)';
      } else if (answeredSet.has(t)) {
        answered.textContent = 'ANSWERED';
        answered.style.color = 'var(--green)';
      } else {
        answered.textContent = timer.state === 'RUNNING' ? 'WAITING' : '—';
        answered.style.color = 'var(--text-muted)';
      }
    }

    if (kick) kick.disabled = !connected || !authenticated;
  }

  // Button states
  if (authenticated) {
    cBtnStart.disabled = (timer.state === 'RUNNING');
    cBtnReset.disabled = false;
    cBtnAudience.disabled     = !displayToken;
    cBtnCopyAudience.disabled = !displayToken;
  }
}

function applyCountdownTimer(timer) {
  if (lastTimerState !== timer.state) {
    cancelTimerRaf();
    lastTimerState = timer.state;
  }

  if (timer.state === 'IDLE') {
    const secs = Math.round(timer.durationMs / 1000);
    cTimerNumber.textContent = secs;
    cTimerNumber.className   = 'host-timer-number';
    cTimerFill.style.width   = '100%';
    cTimerFill.className     = 'timer-progress-fill';
    cTimerStateEl.textContent = 'IDLE';
    cTimerStateEl.className   = 'audience-timer-state';
    cTickStart.textContent    = formatSecs(timer.durationMs / 1000);
    return;
  }

  if (timer.state === 'EXPIRED') {
    cancelTimerRaf();
    cTimerNumber.textContent  = 'TIME UP';
    cTimerNumber.className    = 'host-timer-number time-up';
    cTimerFill.style.width    = '0%';
    cTimerFill.className      = 'timer-progress-fill time-up';
    cTimerStateEl.textContent = 'TIME UP';
    cTimerStateEl.className   = 'audience-timer-state expired';
    return;
  }

  // RUNNING
  cTimerStateEl.textContent = 'RUNNING';
  cTimerStateEl.className   = 'audience-timer-state running';
  cTickStart.textContent    = formatSecs(timer.durationMs / 1000);

  function tick() {
    const now       = Date.now();
    const remaining = Math.max(0, timer.endsAt - now);
    const pct       = (remaining / timer.durationMs) * 100;
    const secs      = Math.ceil(remaining / 1000);

    cTimerNumber.textContent = secs;
    cTimerFill.style.width   = `${pct}%`;

    if (remaining <= 0) {
      cTimerNumber.textContent = 'TIME UP';
      cTimerNumber.className   = 'host-timer-number time-up';
      cTimerFill.style.width   = '0%';
      cTimerFill.className     = 'timer-progress-fill time-up';
      return;
    }

    const isLow = remaining <= 10000;
    cTimerNumber.className = 'host-timer-number' + (isLow ? ' low-time' : '');
    cTimerFill.className   = 'timer-progress-fill' + (isLow ? ' low-time' : '');
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
  cTickStart.textContent = formatSecs(durationMs / 1000);

  // Update played overlay
  if (timer.state === 'RUNNING' && timer.startedAt && timer.endsAt) {
    const elapsed = Date.now() - timer.startedAt;
    const pct     = Math.min(100, (elapsed / durationMs) * 100);
    cRailPlayed.style.width = `${pct}%`;
  } else if (timer.state === 'EXPIRED') {
    cRailPlayed.style.width = '100%';
  } else {
    cRailPlayed.style.width = '0%';
  }

  cTimelineEvents.innerHTML = '';
  if (!events || events.length === 0) return;

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
        `<span class="tl-team">Team ${ev.team}</span>` +
        `<span class="tl-time">${elSec}s</span>` +
      `</div>` +
      `<div class="timeline-dot"></div>`;

    cTimelineEvents.appendChild(el);
  });
}

// ── Format Selection Events ──────────────────────────────────────────────────
btnSelectJeopardy.addEventListener('click', () => {
  send({ type: 'SELECT_FORMAT', hostToken, format: 'JEOPARDY' });
  logEvent('conn', 'Host selected format: JEOPARDY');
});

btnSelectCountdown.addEventListener('click', () => {
  send({ type: 'SELECT_FORMAT', hostToken, format: 'COUNTDOWN_QUIZ' });
  logEvent('conn', 'Host selected format: COUNTDOWN QUIZ');
});

btnSelectFormat3.addEventListener('click', () => {
  placeholderOverlay.classList.remove('hidden');
});

btnClosePlaceholder.addEventListener('click', () => {
  placeholderOverlay.classList.add('hidden');
});

// ── Jeopardy Host Buttons ────────────────────────────────────────────────────
jBtnArm.addEventListener('click', () => {
  send({ type: 'ARM', hostToken });
  logEvent('arm', 'Host armed Jeopardy buzzer');
});

jBtnReset.addEventListener('click', () => {
  send({ type: 'RESET', hostToken });
  logEvent('reset', 'Host reset Jeopardy question');
});

jBtnQMinus.addEventListener('click', () => {
  const current = parseInt(jQuestionDisplay.textContent, 10);
  if (current > 1) {
    send({ type: 'SET_QUESTION', hostToken, questionNumber: current - 1 });
  }
});

jBtnQPlus.addEventListener('click', () => {
  const current = parseInt(jQuestionDisplay.textContent, 10);
  if (current < 999) {
    send({ type: 'SET_QUESTION', hostToken, questionNumber: current + 1 });
  }
});

jBtnAudience.addEventListener('click', openAudience);
jBtnCopyAudience.addEventListener('click', copyAudience);

// ── Countdown Quiz Host Buttons ──────────────────────────────────────────────
cBtnStart.addEventListener('click', () => {
  send({ type: 'START_QUESTION', hostToken });
  logEvent('arm', 'Host started Countdown Quiz question');
});

cBtnReset.addEventListener('click', () => {
  send({ type: 'RESET_TIMER', hostToken });
  logEvent('reset', 'Host reset Countdown Quiz question');
});

cBtnQMinus.addEventListener('click', () => {
  const current = parseInt(cQuestionDisplay.textContent, 10);
  if (current > 1) {
    send({ type: 'SET_QUESTION', hostToken, questionNumber: current - 1 });
  }
});

cBtnQPlus.addEventListener('click', () => {
  const current = parseInt(cQuestionDisplay.textContent, 10);
  if (current < 999) {
    send({ type: 'SET_QUESTION', hostToken, questionNumber: current + 1 });
  }
});

cDurationPresets.addEventListener('click', (e) => {
  const pill = e.target.closest('.duration-pill');
  if (!pill || !authenticated) return;
  const ms = parseInt(pill.dataset.ms, 10);
  if (!ms) return;

  cDurationPresets.querySelectorAll('.duration-pill').forEach(p => p.classList.remove('active'));
  pill.classList.add('active');

  send({ type: 'SET_TIMER_DURATION', hostToken, durationMs: ms });
  logEvent('conn', `Countdown duration set to ${ms / 1000}s`);
});

cBtnAudience.addEventListener('click', openAudience);
cBtnCopyAudience.addEventListener('click', copyAudience);

// ── Kick buttons ─────────────────────────────────────────────────────────────
document.querySelectorAll('.kick-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const t = parseInt(btn.dataset.team, 10);
    send({ type: 'KICK', hostToken, teamNumber: t });
    logEvent('reset', `Host kicked Team ${t}`);
  });
});

// ── Shared Helpers ───────────────────────────────────────────────────────────
function openAudience() {
  if (displayToken) {
    const url = `${location.protocol}//${location.host}/audience/${displayToken}`;
    window.open(url, '_blank', 'noopener');
  }
}

function copyAudience(e) {
  if (displayToken) {
    const url = `${location.protocol}//${location.host}/audience/${displayToken}`;
    const btn = e.currentTarget;
    navigator.clipboard.writeText(url).then(() => {
      const orig = btn.textContent;
      btn.textContent = '✓ COPIED!';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    }).catch(() => {
      prompt('Copy audience link:', url);
    });
  }
}

function setConnBanner(cls, text) {
  connBanner.className = `conn-banner ${cls}`;
  connText.textContent = text;
}

function logEvent(cls, text) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  const entry = document.createElement('div');
  entry.className = 'log-entry';
  entry.innerHTML =
    `<span class="log-time">[${hh}:${mm}:${ss}]</span>` +
    `<span class="log-${cls}">${text}</span>`;

  [jEventLog, cEventLog].forEach(el => {
    if (el) {
      el.prepend(entry.cloneNode(true));
      while (el.children.length > 100) el.lastChild.remove();
    }
  });
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
