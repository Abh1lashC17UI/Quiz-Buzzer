/**
 * gameState.test.js
 *
 * Automated tests for the Buzzer Platform and its two distinct game formats:
 *   - JEOPARDY
 *   - COUNTDOWN QUIZ
 *
 * Run with: node tests/gameState.test.js
 */

'use strict';

const {
  GameState,
  VALID_TEAMS,
  VALID_FORMATS,
  TIMER_MIN_MS,
  TIMER_MAX_MS,
  TIMER_DEFAULT_MS,
} = require('../src/gameState');
const { JeopardyFormat }      = require('../src/formats/jeopardy');
const { CountdownQuizFormat } = require('../src/formats/countdownQuiz');
const { AuthStore }           = require('../src/authentication');

// ── Test harness ─────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}
function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(msg || `Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}
function assertNotEqual(a, b, msg) {
  if (a === b) throw new Error(msg || `Expected values to differ, both are ${JSON.stringify(a)}`);
}
function assertApprox(a, b, tolerance, msg) {
  if (Math.abs(a - b) > tolerance) {
    throw new Error(msg || `Expected ${a} ≈ ${b} (±${tolerance})`);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Section 1: Pure Jeopardy Format Engine (Unit Tests)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Section 1: Jeopardy Format Engine ─────────────────────\n');

test('Jeopardy: initial state is LOCKED with no winner', () => {
  const j = new JeopardyFormat();
  assertEqual(j.state, 'LOCKED');
  assertEqual(j.winner, null);
  assertEqual(j.winnerTimestamp, null);
});

test('Jeopardy: ARM transitions LOCKED → ARMED', () => {
  const j = new JeopardyFormat();
  const r = j.arm();
  assert(r.ok);
  assertEqual(j.state, 'ARMED');
});

test('Jeopardy: double ARM fails', () => {
  const j = new JeopardyFormat();
  j.arm();
  const r = j.arm();
  assert(!r.ok);
  assertEqual(j.state, 'ARMED');
});

test('Jeopardy: buzz while LOCKED is rejected', () => {
  const j = new JeopardyFormat();
  const r = j.buzz(1);
  assert(!r.ok);
  assertEqual(j.winner, null);
  assertEqual(j.state, 'LOCKED');
});

test('Jeopardy: first buzz while ARMED wins and locks out others', () => {
  const j = new JeopardyFormat();
  j.arm();
  const r1 = j.buzz(2, 1000);
  assert(r1.ok);
  assertEqual(r1.winner, 2);
  assertEqual(j.state, 'LOCKED');
  assertEqual(j.winner, 2);
  assertEqual(j.winnerTimestamp, 1000);

  // Subsequent buzzes rejected
  const r2 = j.buzz(1, 1050);
  const r3 = j.buzz(3, 1100);
  assert(!r2.ok);
  assert(!r3.ok);
  assertEqual(j.winner, 2);
});

test('Jeopardy: RESET clears winner and returns to LOCKED', () => {
  const j = new JeopardyFormat();
  j.arm();
  j.buzz(1);
  j.reset();
  assertEqual(j.state, 'LOCKED');
  assertEqual(j.winner, null);
  assertEqual(j.winnerTimestamp, null);
});

test('Jeopardy snapshot contains state, winner, winnerTimestamp and NO timer fields', () => {
  const j = new JeopardyFormat();
  j.arm();
  j.buzz(3);
  const snap = j.snapshot();
  assertEqual(snap.state, 'LOCKED');
  assertEqual(snap.winner, 3);
  assert('winnerTimestamp' in snap);
  assert(!('timer' in snap), 'Jeopardy snapshot must NOT contain timer');
  assert(!('answerEvents' in snap), 'Jeopardy snapshot must NOT contain answerEvents');
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 2: Pure Countdown Quiz Format Engine (Unit Tests)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Section 2: Countdown Quiz Format Engine ───────────────\n');

test('Countdown Quiz: initial timer state is IDLE, default 30s', () => {
  const c = new CountdownQuizFormat();
  assertEqual(c.timer.state, 'IDLE');
  assertEqual(c.timer.durationMs, TIMER_DEFAULT_MS);
  assertEqual(c.answerEvents.length, 0);
  assertEqual(c.answeredTeams.size, 0);
});

test('Countdown Quiz: duration validation', () => {
  const c = new CountdownQuizFormat();
  assert(c.setDuration(15000).ok);
  assertEqual(c.durationMs, 15000);
  assertEqual(c.timer.durationMs, 15000);

  assert(c.setDuration(TIMER_MIN_MS).ok);
  assert(c.setDuration(TIMER_MAX_MS).ok);

  assert(!c.setDuration(0).ok);
  assert(!c.setDuration(-5000).ok);
  assert(!c.setDuration(NaN).ok);
  assert(!c.setDuration(Infinity).ok);
  assert(!c.setDuration('banana').ok);
});

test('Countdown Quiz: startQuestion sets RUNNING, startedAt, endsAt', () => {
  const c = new CountdownQuizFormat();
  c.setDuration(20000);
  const before = Date.now();
  const r = c.startQuestion();
  const after = Date.now();

  assert(r.ok);
  assertEqual(c.timer.state, 'RUNNING');
  assert(c.timer.startedAt >= before && c.timer.startedAt <= after);
  assertApprox(c.timer.endsAt, c.timer.startedAt + 20000, 5);
  assertEqual(r.endsAt, c.timer.endsAt);
});

test('Countdown Quiz: MULTIPLE teams can submit answers during countdown', () => {
  const c = new CountdownQuizFormat();
  c.setDuration(30000);
  c.startQuestion();

  const t1 = c.timer.startedAt + 4200;  // 4.2s
  const t2 = c.timer.startedAt + 8700;  // 8.7s
  const t3 = c.timer.startedAt + 17400; // 17.4s

  const r1 = c.submitAnswer(1, t1);
  const r2 = c.submitAnswer(2, t2);
  const r3 = c.submitAnswer(3, t3);

  assert(r1.ok, 'Team 1 answer should be accepted');
  assert(r2.ok, 'Team 2 answer should be accepted (unlike Jeopardy, not locked out)');
  assert(r3.ok, 'Team 3 answer should be accepted (all teams can answer)');

  assertEqual(c.answerEvents.length, 3);
  assertEqual(c.answerEvents[0].team, 1);
  assertEqual(c.answerEvents[0].elapsedMs, 4200);
  assertEqual(c.answerEvents[1].team, 2);
  assertEqual(c.answerEvents[1].elapsedMs, 8700);
  assertEqual(c.answerEvents[2].team, 3);
  assertEqual(c.answerEvents[2].elapsedMs, 17400);
});

test('Countdown Quiz: ONE answer per team per question', () => {
  const c = new CountdownQuizFormat();
  c.startQuestion();

  const r1 = c.submitAnswer(1, c.timer.startedAt + 2000);
  assert(r1.ok);

  // Second submission by Team 1 rejected
  const r2 = c.submitAnswer(1, c.timer.startedAt + 5000);
  assert(!r2.ok, 'Duplicate submission by Team 1 must be rejected');
  assertEqual(c.answerEvents.length, 1);

  // Other teams still accepted
  const r3 = c.submitAnswer(2, c.timer.startedAt + 6000);
  assert(r3.ok);
  assertEqual(c.answerEvents.length, 2);
});

test('Countdown Quiz: answers after endsAt rejected (race condition at expiration)', () => {
  const c = new CountdownQuizFormat();
  c.startQuestion();

  const lateTs = c.timer.endsAt + 1; // 1ms after deadline
  const r = c.submitAnswer(1, lateTs);
  assert(!r.ok, 'Late answer must be rejected by server timestamp');
  assertEqual(c.answerEvents.length, 0);
});

test('Countdown Quiz: answers at or before endsAt accepted', () => {
  const c = new CountdownQuizFormat();
  c.startQuestion();

  const validTs = c.timer.endsAt;
  const r = c.submitAnswer(1, validTs);
  assert(r.ok, 'Answer at exact deadline accepted');
});

test('Countdown Quiz: expiration sets state EXPIRED and rejects subsequent answers', () => {
  const c = new CountdownQuizFormat();
  c.startQuestion();
  c.expire();
  assertEqual(c.timer.state, 'EXPIRED');

  const r = c.submitAnswer(1, Date.now());
  assert(!r.ok, 'Answer while EXPIRED must be rejected');
});

test('Countdown Quiz: reset clears timer, answerEvents, answeredTeams, but preserves duration', () => {
  const c = new CountdownQuizFormat();
  c.setDuration(45000);
  c.startQuestion();
  c.submitAnswer(1, c.timer.startedAt + 3000);
  assertEqual(c.answerEvents.length, 1);

  c.reset();
  assertEqual(c.timer.state, 'IDLE');
  assertEqual(c.timer.durationMs, 45000, 'Duration preserved');
  assertEqual(c.timer.startedAt, null);
  assertEqual(c.timer.endsAt, null);
  assertEqual(c.answerEvents.length, 0);
  assertEqual(c.answeredTeams.size, 0);
});

test('Countdown Quiz: snapshot contains timer, answerEvents, answeredTeams, NO Jeopardy winner', () => {
  const c = new CountdownQuizFormat();
  c.startQuestion();
  c.submitAnswer(2, c.timer.startedAt + 5000);
  const snap = c.snapshot();

  assert('timer' in snap);
  assert('answerEvents' in snap);
  assert('answeredTeams' in snap);
  assertEqual(snap.answerEvents.length, 1);
  assert(!('winner' in snap), 'Countdown Quiz snapshot must NOT contain Jeopardy winner');
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 3: Shared Buzzer Platform (GameState)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Section 3: Shared Platform & Format Separation ───────\n');

test('GameState defaults to JEOPARDY when instantiated with no args', () => {
  const gs = new GameState();
  assertEqual(gs.format, 'JEOPARDY');
  assertEqual(gs.state, 'LOCKED');
  assertEqual(gs.winner, null);
});

test('GameState instantiated with null format waits for host selection', () => {
  const gs = new GameState(null);
  assertEqual(gs.format, null);
  assertEqual(gs.activeFormat, null);
  const snap = gs.snapshot();
  assertEqual(snap.format, null);
});

test('selectFormat binds session to chosen format', () => {
  const gs = new GameState(null);
  assert(gs.selectFormat('JEOPARDY').ok);
  assertEqual(gs.format, 'JEOPARDY');

  const gs2 = new GameState(null);
  assert(gs2.selectFormat('COUNTDOWN_QUIZ').ok);
  assertEqual(gs2.format, 'COUNTDOWN_QUIZ');
});

test('selectFormat rejects invalid format', () => {
  const gs = new GameState(null);
  assert(!gs.selectFormat('UNKNOWN').ok);
  assert(!gs.selectFormat('PLACEHOLDER_3').ok, 'Placeholder 3 is not implemented');
});

test('In Jeopardy mode: timer commands are rejected', () => {
  const gs = new GameState('JEOPARDY');
  assert(!gs.setTimerDuration(15000).ok);
  assert(!gs.startTimer().ok);
  assert(!gs.expireTimer().ok);
  assert(!gs.resetTimer().ok);
  assert(!gs.submitAnswer(1).ok);
});

test('In Countdown Quiz mode: arm command is rejected', () => {
  const gs = new GameState('COUNTDOWN_QUIZ');
  assert(!gs.arm().ok, 'ARM should be rejected in Countdown Quiz mode');
});

test('Team management is shared across both formats', () => {
  const gsJ = new GameState('JEOPARDY');
  assert(gsJ.joinTeam(1, 'conn-1').ok);
  assertEqual(gsJ.teams[1], 'conn-1');
  assertEqual(gsJ.teamForConnection('conn-1'), 1);

  const gsC = new GameState('COUNTDOWN_QUIZ');
  assert(gsC.joinTeam(2, 'conn-2').ok);
  assertEqual(gsC.teams[2], 'conn-2');
  assertEqual(gsC.teamForConnection('conn-2'), 2);
});

test('Question number stepper is shared across both formats', () => {
  const gs = new GameState('JEOPARDY');
  assertEqual(gs.questionNumber, 1);
  assert(gs.setQuestionNumber(5).ok);
  assertEqual(gs.questionNumber, 5);
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 4: Full Jeopardy Regression Test
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Section 4: Full Jeopardy Regression ───────────────────\n');

test('[Jeopardy Regression] Full cycle: Arm → Buzz → Winner → Reset → Re-arm', () => {
  const gs = new GameState('JEOPARDY');
  assertEqual(gs.state, 'LOCKED');

  // Arm
  assert(gs.arm().ok);
  assertEqual(gs.state, 'ARMED');

  // Buzz
  const r = gs.buzz(1);
  assert(r.ok);
  assertEqual(r.winner, 1);
  assertEqual(gs.state, 'LOCKED');
  assertEqual(gs.winner, 1);

  // Locked out
  assert(!gs.buzz(2).ok);
  assertEqual(gs.winner, 1);

  // Reset
  assert(gs.resetGame().ok);
  assertEqual(gs.state, 'LOCKED');
  assertEqual(gs.winner, null);

  // Re-arm
  assert(gs.arm().ok);
  assertEqual(gs.state, 'ARMED');
  assert(gs.buzz(3).ok);
  assertEqual(gs.winner, 3);
});

test('[Jeopardy Regression] Snapshot contains no timer or answerEvents', () => {
  const gs = new GameState('JEOPARDY');
  gs.arm();
  gs.buzz(2);
  const snap = gs.snapshot();
  assertEqual(snap.format, 'JEOPARDY');
  assertEqual(snap.state, 'LOCKED');
  assertEqual(snap.winner, 2);
  assert(!('timer' in snap));
  assert(!('answerEvents' in snap));
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 5: Full Countdown Quiz Integration Test
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Section 5: Full Countdown Quiz Integration ───────────\n');

test('[Countdown Quiz] Host sets 30s, starts, all 3 teams submit answers', () => {
  const gs = new GameState('COUNTDOWN_QUIZ');
  assert(gs.setTimerDuration(30000).ok);

  const startRes = gs.startTimer();
  assert(startRes.ok);

  const t1 = gs.activeFormat.timer.startedAt + 3500;
  const t2 = gs.activeFormat.timer.startedAt + 9200;
  const t3 = gs.activeFormat.timer.startedAt + 18400;

  assert(gs.buzz(1, t1).ok, 'Team 1 answered');
  assert(gs.buzz(2, t2).ok, 'Team 2 answered');
  assert(gs.buzz(3, t3).ok, 'Team 3 answered');

  const snap = gs.snapshot();
  assertEqual(snap.format, 'COUNTDOWN_QUIZ');
  assertEqual(snap.timer.state, 'RUNNING');
  assertEqual(snap.answerEvents.length, 3);
  assertEqual(snap.answerEvents[0].elapsedMs, 3500);
  assertEqual(snap.answerEvents[1].elapsedMs, 9200);
  assertEqual(snap.answerEvents[2].elapsedMs, 18400);

  // Expiration
  assert(gs.expireTimer().ok);
  assertEqual(gs.snapshot().timer.state, 'EXPIRED');

  // Reset
  assert(gs.resetTimer().ok);
  const resetSnap = gs.snapshot();
  assertEqual(resetSnap.timer.state, 'IDLE');
  assertEqual(resetSnap.answerEvents.length, 0);
  assertEqual(resetSnap.timer.durationMs, 30000);
});

// ══════════════════════════════════════════════════════════════════════════════
// Section 6: Security & Authentication (AuthStore)
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n── Section 6: Security & Authentication ─────────────────\n');

test('Game code is 6 uppercase chars', () => {
  const auth = new AuthStore();
  assert(/^[A-Z0-9]{6}$/.test(auth.gameCode));
});

test('Host token is 64 hex chars', () => {
  const auth = new AuthStore();
  assert(/^[0-9a-f]{64}$/.test(auth.hostToken));
});

test('Display token is distinct from host token and game code', () => {
  const auth = new AuthStore();
  assertNotEqual(auth.displayToken, auth.hostToken);
  assertNotEqual(auth.displayToken, auth.gameCode);
  assert(auth.validateDisplayToken(auth.displayToken));
  assert(!auth.validateHostToken(auth.displayToken));
});

test('Team sessions work and can be resolved and cleared', () => {
  const auth = new AuthStore();
  const tok = auth.createTeamSession(2);
  assertEqual(auth.resolveTeamSession(tok), 2);
  auth.clearTeamSessions(2);
  assertEqual(auth.resolveTeamSession(tok), null);
});

// ══════════════════════════════════════════════════════════════════════════════
// Results
// ══════════════════════════════════════════════════════════════════════════════
console.log(`\n${'─'.repeat(50)}`);
console.log(`  Results: ${passed} passed, ${failed} failed`);
console.log(`${'─'.repeat(50)}\n`);

if (failed > 0) {
  process.exit(1);
}
