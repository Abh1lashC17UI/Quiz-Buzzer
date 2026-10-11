/**
 * countdownQuiz.js
 *
 * Game format engine: COUNTDOWN QUIZ
 *
 * Rules:
 *   - Configurable server-authoritative countdown timer (5s – 600s, default 30s)
 *   - States: IDLE, RUNNING, EXPIRED
 *   - Host starts question: timer begins counting down from startedAt to endsAt
 *   - Multiple team answer submissions: ALL teams can submit answers during the countdown
 *   - One submitted answer per team per question
 *   - Accurate server-recorded timestamps (elapsedMs from question start)
 *   - Server checks serverTimestamp <= endsAt; late submissions rejected
 *   - Expiration: at zero, state becomes EXPIRED, no more answers accepted
 *   - Reset: returns timer to IDLE, clears answer events, preserves durationMs
 */

'use strict';

const TIMER_MIN_MS     =   5_000;  // 5 seconds
const TIMER_MAX_MS     = 600_000;  // 10 minutes
const TIMER_DEFAULT_MS =  30_000;  // 30 seconds

class CountdownQuizFormat {
  constructor() {
    this.durationMs = TIMER_DEFAULT_MS;
    this.reset();
  }

  reset() {
    this.timer = {
      durationMs: this.durationMs,
      startedAt: null,
      endsAt: null,
      state: 'IDLE',   // 'IDLE' | 'RUNNING' | 'EXPIRED'
    };
    this.answerEvents = [];
    this.answeredTeams = new Set();
    return { ok: true };
  }

  setDuration(ms) {
    const val = Number(ms);
    if (!Number.isFinite(val) || val < TIMER_MIN_MS || val > TIMER_MAX_MS) {
      return {
        ok: false,
        error: `Invalid timer duration: ${ms}. Must be between ${TIMER_MIN_MS} and ${TIMER_MAX_MS} ms.`,
      };
    }
    this.durationMs = Math.round(val);
    this.timer.durationMs = this.durationMs;
    return { ok: true };
  }

  startQuestion() {
    if (this.timer.state === 'RUNNING') {
      return { ok: false, error: 'Question is already running' };
    }

    const now = Date.now();
    this.timer.startedAt = now;
    this.timer.endsAt = now + this.durationMs;
    this.timer.state = 'RUNNING';

    // Clear previous question's answers
    this.answerEvents = [];
    this.answeredTeams.clear();

    return { ok: true, endsAt: this.timer.endsAt };
  }

  submitAnswer(teamNumber, serverTimestamp) {
    const ts = typeof serverTimestamp === 'number' ? serverTimestamp : Date.now();

    if (this.timer.state !== 'RUNNING') {
      return { ok: false, error: `Answer ignored: timer is ${this.timer.state}` };
    }

    // Server-authoritative expiration check
    if (ts > this.timer.endsAt) {
      return { ok: false, error: 'Answer rejected: timer expired' };
    }

    // One answer per team per question
    if (this.answeredTeams.has(teamNumber)) {
      return { ok: false, error: `Team ${teamNumber} has already answered this question` };
    }

    this.answeredTeams.add(teamNumber);

    const elapsedMs = Math.max(0, ts - this.timer.startedAt);
    const remainingMs = Math.max(0, this.timer.endsAt - ts);

    const event = {
      team: teamNumber,
      serverTimestamp: ts,
      elapsedMs,
      remainingMs,
      accepted: true,
    };

    this.answerEvents.push(event);

    return { ok: true, event };
  }

  expire() {
    if (this.timer.state !== 'RUNNING') {
      return { ok: false, error: `Timer is not RUNNING (state: ${this.timer.state})` };
    }
    this.timer.state = 'EXPIRED';
    return { ok: true };
  }

  snapshot() {
    return {
      timer: {
        durationMs: this.timer.durationMs,
        startedAt: this.timer.startedAt,
        endsAt: this.timer.endsAt,
        state: this.timer.state,
      },
      answerEvents: this.answerEvents.map(e => ({ ...e })),
      answeredTeams: Array.from(this.answeredTeams),
    };
  }
}

module.exports = {
  CountdownQuizFormat,
  TIMER_MIN_MS,
  TIMER_MAX_MS,
  TIMER_DEFAULT_MS,
};
