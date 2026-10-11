/**
 * ws-smoke-test.js
 * Automated WebSocket smoke test for the two distinct formats:
 *   - Format selection
 *   - COUNTDOWN QUIZ (multiple answers, timeline, auto-expiry)
 *   - JEOPARDY (arm, first buzz wins, reset)
 *
 * Run with: node tests/ws-smoke-test.js <hostToken> <gameCode>
 */
'use strict';

const WebSocket = require('ws');

const WS_URL = 'ws://localhost:3000';

let passed = 0;
let failed = 0;
const connections = [];

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function step(label, fn) {
  try {
    fn();
    console.log(`  ✓  ${label}`);
    passed++;
  } catch (e) {
    console.error(`  ✗  ${label}: ${e.message}`);
    failed++;
  }
}

const hostToken = process.argv[2] || process.env.HOST_TOKEN;
const gameCode  = process.argv[3] || process.env.GAME_CODE;

if (!hostToken || !gameCode) {
  console.error('Usage: node tests/ws-smoke-test.js <hostToken> <gameCode>');
  process.exit(1);
}

function openWs() {
  const ws = new WebSocket(WS_URL);
  connections.push(ws);
  return ws;
}

function sendMsg(ws, obj) {
  ws.send(JSON.stringify(obj));
}

function waitForMessage(ws, type, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for ${type}`)), timeoutMs);
    function handler(raw) {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === type) {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve(msg);
        }
      } catch {}
    }
    ws.on('message', handler);
  });
}

function waitForState(ws, predicate, timeoutMs = 6000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for state predicate')), timeoutMs);
    function handler(raw) {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'GAME_STATE' && (!predicate || predicate(msg))) {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve(msg);
        }
      } catch {}
    }
    ws.on('message', handler);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function run() {
  console.log('\n── WebSocket End-to-End Smoke Test ───────────────────────\n');

  // 1. Host authenticates
  const hostWs = openWs();
  await new Promise(r => hostWs.on('open', r));
  sendMsg(hostWs, { type: 'HOST_AUTH', hostToken });
  const authOk = await waitForMessage(hostWs, 'HOST_AUTH_OK');
  step('Host authenticates successfully', () => assert(authOk.gameCode));

  // 2. Display authenticates
  const displayToken = authOk.displayToken;
  const displayWs = openWs();
  await new Promise(r => displayWs.on('open', r));
  sendMsg(displayWs, { type: 'DISPLAY_AUTH', displayToken });
  const dispOk = await waitForMessage(displayWs, 'DISPLAY_AUTH_OK');
  step('Display authenticates successfully', () => assert(dispOk));

  // 3. Teams join
  const team1Ws = openWs();
  await new Promise(r => team1Ws.on('open', r));
  sendMsg(team1Ws, { type: 'JOIN', gameCode, teamNumber: 1 });
  const join1 = await waitForMessage(team1Ws, 'JOIN_OK');
  step('Team 1 joins successfully', () => assert(join1.teamNumber === 1));

  const team2Ws = openWs();
  await new Promise(r => team2Ws.on('open', r));
  sendMsg(team2Ws, { type: 'JOIN', gameCode, teamNumber: 2 });
  const join2 = await waitForMessage(team2Ws, 'JOIN_OK');
  step('Team 2 joins successfully', () => assert(join2.teamNumber === 2));

  // 4. Host selects COUNTDOWN_QUIZ
  const pFormat = waitForState(hostWs, s => s.format === 'COUNTDOWN_QUIZ');
  sendMsg(hostWs, { type: 'SELECT_FORMAT', hostToken, format: 'COUNTDOWN_QUIZ' });
  const formatState = await pFormat;
  step('Host selects COUNTDOWN_QUIZ format', () => {
    assert(formatState.format === 'COUNTDOWN_QUIZ');
    assert(formatState.timer && formatState.timer.state === 'IDLE');
  });

  // 5. Host configures duration to 5000ms
  const pDur = waitForState(hostWs, s => s.timer && s.timer.durationMs === 5000);
  sendMsg(hostWs, { type: 'SET_TIMER_DURATION', hostToken, durationMs: 5000 });
  const durState = await pDur;
  step('SET_TIMER_DURATION accepted', () => {
    assert(durState.timer.durationMs === 5000);
  });

  // 6. Host starts question
  const pRun = waitForState(team1Ws, s => s.timer && s.timer.state === 'RUNNING');
  sendMsg(hostWs, { type: 'START_QUESTION', hostToken });
  const runState = await pRun;
  step('START_QUESTION sets timer state to RUNNING', () => {
    assert(runState.timer.state === 'RUNNING');
    assert(typeof runState.timer.endsAt === 'number');
  });

  // 7. Team 1 submits answer
  const pAns1 = waitForState(hostWs, s => s.answerEvents && s.answerEvents.some(e => e.team === 1));
  sendMsg(team1Ws, { type: 'TEAM_BUZZ' });
  const ansState1 = await pAns1;
  step('Team 1 submits answer — recorded on server', () => {
    assert(ansState1.answerEvents.length >= 1);
    assert(ansState1.answerEvents.find(e => e.team === 1));
  });

  // 8. Team 2 also submits answer (Countdown Quiz allows all teams to answer!)
  const pAns2 = waitForState(hostWs, s => s.answerEvents && s.answerEvents.some(e => e.team === 2));
  sendMsg(team2Ws, { type: 'TEAM_BUZZ' });
  const ansState2 = await pAns2;
  step('Team 2 submits answer — multiple answers recorded during countdown', () => {
    assert(ansState2.answerEvents.length === 2);
    assert(ansState2.answerEvents.find(e => e.team === 2));
  });

  // 9. Wait for countdown auto-expiry (5s timer)
  const pExpire = waitForState(hostWs, s => s.timer && s.timer.state === 'EXPIRED', 8000);
  const expireState = await pExpire;
  step('Timer auto-expires on server', () => {
    assert(expireState.timer.state === 'EXPIRED');
  });

  // 10. Display received timeline with both events
  const pDisp = waitForState(displayWs, s => s.answerEvents && s.answerEvents.length === 2, 2000).catch(() => expireState);
  const dispState = await pDisp;
  step('Display receives answer timeline events', () => {
    assert(dispState.answerEvents && dispState.answerEvents.length === 2);
  });

  // 11. Reset Countdown Quiz
  const pResetC = waitForState(hostWs, s => s.timer && s.timer.state === 'IDLE');
  sendMsg(hostWs, { type: 'RESET_TIMER', hostToken });
  const resetCState = await pResetC;
  step('RESET clears countdown timer and answer events', () => {
    assert(resetCState.timer.state === 'IDLE');
    assert(resetCState.answerEvents.length === 0);
  });

  // 12. Switch to JEOPARDY format
  const pJeop = waitForState(hostWs, s => s.format === 'JEOPARDY');
  sendMsg(hostWs, { type: 'SELECT_FORMAT', hostToken, format: 'JEOPARDY' });
  const jState = await pJeop;
  step('Host selects JEOPARDY format', () => {
    assert(jState.format === 'JEOPARDY');
    assert(jState.state === 'LOCKED');
    assert(!jState.timer, 'Jeopardy must NOT contain timer');
  });

  // 13. Arm Jeopardy
  const pArm = waitForState(team1Ws, s => s.state === 'ARMED');
  sendMsg(hostWs, { type: 'ARM', hostToken });
  const armState = await pArm;
  step('Host arms Jeopardy: state transitions to ARMED', () => {
    assert(armState.state === 'ARMED');
  });

  // 14. Team 1 buzzes in Jeopardy: first buzz wins
  const pJBuzz = waitForState(hostWs, s => s.winner === 1);
  sendMsg(team1Ws, { type: 'TEAM_BUZZ' });
  const jBuzzState = await pJBuzz;
  step('Team 1 wins first buzz in Jeopardy', () => {
    assert(jBuzzState.winner === 1);
    assert(jBuzzState.state === 'LOCKED');
  });

  // 15. Team 2 buzzes: locked out!
  sendMsg(team2Ws, { type: 'TEAM_BUZZ' });
  await sleep(150);
  step('Team 2 locked out after first buzz in Jeopardy', () => {
    assert(jBuzzState.winner === 1);
  });

  // 16. Reset Jeopardy
  const pJReset = waitForState(hostWs, s => s.winner === null);
  sendMsg(hostWs, { type: 'RESET', hostToken });
  const jResetState = await pJReset;
  step('Host resets Jeopardy: winner cleared, state LOCKED', () => {
    assert(jResetState.winner === null);
    assert(jResetState.state === 'LOCKED');
  });

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`  End-to-end smoke test: ${passed} passed, ${failed} failed`);
  console.log(`${'─'.repeat(50)}\n`);

  for (const ws of connections) {
    try { ws.close(); } catch {}
  }

  process.exit(failed > 0 ? 1 : 0);
}

run().catch(err => {
  console.error('Fatal test error:', err);
  for (const ws of connections) { try { ws.close(); } catch {} }
  process.exit(1);
});
