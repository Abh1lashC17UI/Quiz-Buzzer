/**
 * team.js — Team Client
 *
 * Automatically adapts between:
 *   - JEOPARDY: First-buzz-wins buzzer (no timer)
 *   - COUNTDOWN QUIZ: Timed question with answer submission & timestamp confirmation
 */

'use strict';

// ── Read credentials stored by the join page ────────────────────────────────
const gameCode    = sessionStorage.getItem('trivia_gameCode');
const teamNumber  = parseInt(sessionStorage.getItem('trivia_teamNumber') || '0', 10);
let   sessionToken = sessionStorage.getItem('trivia_sessionToken') || null;

if (!gameCode || ![1, 2, 3].includes(teamNumber)) {
  window.location.href = '/join';
}

// ── DOM refs ────────────────────────────────────────────────────────────────
const connBanner    = document.getElementById('conn-banner');
const connText      = document.getElementById('conn-text');
const teamNameEl    = document.getElementById('team-name');
const statusMsg     = document.getElementById('status-msg');
const buzzBtn       = document.getElementById('buzz-btn');
const subStatus     = document.getElementById('sub-status');
const timerSection  = document.getElementById('team-timer-section');
const teamTimerNum  = document.getElementById('team-timer-number');
const teamTimerFill = document.getElementById('team-timer-fill');

teamNameEl.textContent = `Team ${teamNumber}`;

// ── State ────────────────────────────────────────────────────────────────────
let ws             = null;
let joined         = false;
let reconnectDelay = 1000;

// Timer RAF
let timerRafId     = null;
let lastTimerState = null;

// ── WebSocket ───────────────────────────────────────────────────────────────
function connect() {
  const wsUrl = `ws://${location.host}`;
  ws = new WebSocket(wsUrl);

  ws.addEventListener('open', () => {
    setConnBanner('connected', '● Connected');
    reconnectDelay = 1000;

    const joinMsg = { type: 'JOIN', gameCode, teamNumber };
    if (sessionToken) joinMsg.sessionToken = sessionToken;
    send(joinMsg);
  });

  ws.addEventListener('message', (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch { return; }
    handleMessage(msg);
  });

  ws.addEventListener('close', () => {
    joined = false;
    setConnBanner('reconnecting', '⟳ Reconnecting…');
    setDisabledUI('Reconnecting…');
    cancelTimerRaf();
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 8000);
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
    case 'JOIN_OK':
      joined = true;
      sessionToken = msg.sessionToken;
      sessionStorage.setItem('trivia_sessionToken', sessionToken);
      break;

    case 'JOIN_ERROR':
      handleJoinError(msg.reason);
      break;

    case 'GAME_STATE':
      if (joined) applyGameState(msg);
      break;

    case 'KICKED':
      sessionStorage.removeItem('trivia_sessionToken');
      sessionStorage.removeItem('trivia_gameCode');
      sessionStorage.removeItem('trivia_teamNumber');
      window.location.href = '/join?kicked=1';
      break;

    case 'ERROR':
      console.warn('Server error:', msg.reason);
      break;
  }
}

// ── State rendering ─────────────────────────────────────────────────────────
function applyGameState(msg) {
  const format = msg.format;

  if (format === 'JEOPARDY') {
    timerSection.classList.add('hidden');
    cancelTimerRaf();
    applyJeopardyState(msg);
  } else if (format === 'COUNTDOWN_QUIZ') {
    timerSection.classList.remove('hidden');
    applyCountdownState(msg);
  } else {
    // Unset
    timerSection.classList.add('hidden');
    cancelTimerRaf();
    statusMsg.textContent = 'WAITING FOR HOST TO SELECT QUIZ';
    statusMsg.className = 'team-status-msg';
    subStatus.textContent = 'BUZZER DISABLED';
    buzzBtn.className = 'buzz-btn';
    buzzBtn.disabled = true;
    buzzBtn.textContent = 'WAIT';
  }
}

// ── JEOPARDY TEAM LOGIC ─────────────────────────────────────────────────────
function applyJeopardyState(msg) {
  const state  = msg.state;
  const winner = msg.winner;

  buzzBtn.className = 'buzz-btn';
  buzzBtn.disabled  = true;
  buzzBtn.textContent = 'BUZZ!';

  if (state === 'ARMED') {
    statusMsg.textContent  = '🎯 BUZZ NOW!';
    statusMsg.className    = 'team-status-msg';
    subStatus.textContent  = 'BUZZER ACTIVE';
    buzzBtn.classList.add('armed');
    buzzBtn.disabled = false;
  } else if (state === 'LOCKED' && winner === teamNumber) {
    statusMsg.textContent  = '🏆 YOU BUZZED FIRST!';
    statusMsg.className    = 'team-status-msg self-win';
    subStatus.textContent  = 'BUZZER LOCKED';
  } else if (state === 'LOCKED' && winner && winner !== teamNumber) {
    statusMsg.textContent  = `TEAM ${winner} BUZZED FIRST`;
    statusMsg.className    = 'team-status-msg winner-msg';
    subStatus.textContent  = 'BUZZER LOCKED';
  } else {
    statusMsg.textContent  = 'WAITING FOR HOST';
    statusMsg.className    = 'team-status-msg';
    subStatus.textContent  = 'BUZZER DISABLED';
  }
}

// ── COUNTDOWN QUIZ TEAM LOGIC ───────────────────────────────────────────────
function applyCountdownState(msg) {
  const timer = msg.timer || { durationMs: 30000, startedAt: null, endsAt: null, state: 'IDLE' };
  const events = msg.answerEvents || [];
  const myEvent = events.find(e => e.team === teamNumber);

  applyTimerBar(timer);

  buzzBtn.className = 'buzz-btn';

  if (timer.state === 'RUNNING') {
    if (myEvent) {
      statusMsg.textContent = '✓ ANSWER RECORDED';
      statusMsg.className = 'team-status-msg submitted-msg';
      subStatus.textContent = `Recorded at ${(myEvent.elapsedMs / 1000).toFixed(1)}s — Waiting for time…`;
      buzzBtn.textContent = 'ANSWER SUBMITTED';
      buzzBtn.classList.add('submitted');
      buzzBtn.disabled = true;
    } else {
      statusMsg.textContent = '🎯 SUBMIT YOUR ANSWER!';
      statusMsg.className = 'team-status-msg';
      subStatus.textContent = 'QUESTION ACTIVE';
      buzzBtn.textContent = 'ANSWER!';
      buzzBtn.classList.add('armed');
      buzzBtn.disabled = false;
    }
  } else if (timer.state === 'EXPIRED') {
    if (myEvent) {
      statusMsg.textContent = `✓ ANSWER RECORDED (${(myEvent.elapsedMs / 1000).toFixed(1)}s)`;
      statusMsg.className = 'team-status-msg self-win';
      subStatus.textContent = 'TIME UP';
      buzzBtn.textContent = 'TIME UP';
      buzzBtn.disabled = true;
    } else {
      statusMsg.textContent = '⏰ TIME UP';
      statusMsg.className = 'team-status-msg winner-msg';
      subStatus.textContent = 'NO ANSWER SUBMITTED';
      buzzBtn.textContent = 'TIME UP';
      buzzBtn.disabled = true;
    }
  } else {
    // IDLE
    statusMsg.textContent = 'WAITING FOR QUESTION';
    statusMsg.className = 'team-status-msg';
    subStatus.textContent = 'BUZZER DISABLED';
    buzzBtn.textContent = 'WAIT';
    buzzBtn.disabled = true;
  }
}

function applyTimerBar(timer) {
  if (lastTimerState !== timer.state) {
    cancelTimerRaf();
    lastTimerState = timer.state;
  }

  if (timer.state === 'IDLE') {
    teamTimerNum.textContent  = '–';
    teamTimerNum.className    = 'team-timer-number';
    teamTimerFill.style.width = '100%';
    teamTimerFill.className   = 'team-timer-bar-fill';
    return;
  }

  if (timer.state === 'EXPIRED') {
    cancelTimerRaf();
    teamTimerNum.textContent  = '0';
    teamTimerNum.className    = 'team-timer-number time-up';
    teamTimerFill.style.width = '0%';
    teamTimerFill.className   = 'team-timer-bar-fill time-up';
    return;
  }

  function tick() {
    const now       = Date.now();
    const remaining = Math.max(0, timer.endsAt - now);
    const pct       = (remaining / timer.durationMs) * 100;
    const secs      = Math.ceil(remaining / 1000);

    teamTimerNum.textContent  = secs;
    teamTimerFill.style.width = `${pct}%`;

    if (remaining <= 0) {
      teamTimerNum.textContent  = '0';
      teamTimerNum.className    = 'team-timer-number time-up';
      teamTimerFill.className   = 'team-timer-bar-fill time-up';
      teamTimerFill.style.width = '0%';
      return;
    }

    const isLow = remaining <= 10000;
    teamTimerNum.className  = 'team-timer-number'  + (isLow ? ' low-time' : '');
    teamTimerFill.className = 'team-timer-bar-fill' + (isLow ? ' low-time' : '');
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

function setDisabledUI(message) {
  statusMsg.textContent  = message;
  statusMsg.className    = 'team-status-msg';
  subStatus.textContent  = 'BUZZER DISABLED';
  buzzBtn.className      = 'buzz-btn';
  buzzBtn.disabled       = true;
}

function handleJoinError(reason) {
  switch (reason) {
    case 'INVALID_CODE':
      sessionStorage.removeItem('trivia_gameCode');
      alert('Invalid game code. Please check with your host and try again.');
      window.location.href = '/join';
      break;
    case 'TEAM_OCCUPIED':
      alert(`Team ${teamNumber} is already occupied. Please choose a different team.`);
      window.location.href = '/join';
      break;
    default:
      alert(`Could not join: ${reason}`);
      window.location.href = '/join';
  }
}

// ── Buzz / Submit Answer ────────────────────────────────────────────────────
buzzBtn.addEventListener('click', () => {
  if (!buzzBtn.disabled && joined) {
    send({ type: 'TEAM_BUZZ' });
    buzzBtn.disabled = true;
    buzzBtn.classList.remove('armed');
    subStatus.textContent = 'Submitting…';
  }
});

function setConnBanner(cls, text) {
  connBanner.className = `conn-banner ${cls}`;
  connText.textContent = text;
}

// ── Start ────────────────────────────────────────────────────────────────────
connect();
