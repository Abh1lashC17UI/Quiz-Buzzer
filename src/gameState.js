/**
 * gameState.js
 *
 * Authoritative Buzzer Platform state manager.
 * Hosts two distinct game format engines:
 *   - JEOPARDY: first-to-buzz, lockout, winner announcements
 *   - COUNTDOWN_QUIZ: authoritative countdown timer, multiple answer submissions, answer timeline
 *
 * Shared infrastructure:
 *   - Game format selection and session binding
 *   - Question number tracking
 *   - Team connection slots (Team 1, 2, 3)
 *   - Public snapshot broadcasting
 */

'use strict';

const { JeopardyFormat } = require('./formats/jeopardy');
const {
  CountdownQuizFormat,
  TIMER_MIN_MS,
  TIMER_MAX_MS,
  TIMER_DEFAULT_MS,
} = require('./formats/countdownQuiz');

const VALID_FORMATS = ['JEOPARDY', 'COUNTDOWN_QUIZ', 'PLACEHOLDER_3'];
const VALID_TEAMS = [1, 2, 3];

class GameState {
  /**
   * @param {string|null} [initialFormat='JEOPARDY'] - Default 'JEOPARDY' for test backward-compatibility;
   *                                                   pass null for live server requiring host selection.
   */
  constructor(initialFormat = 'JEOPARDY') {
    this.questionNumber = 1;
    this.teams = { 1: null, 2: null, 3: null };
    this.format = null;
    this.activeFormat = null;

    if (initialFormat) {
      this.selectFormat(initialFormat);
    }
  }

  // ──────────────────────────────────────────────
  // Format Selection
  // ──────────────────────────────────────────────

  selectFormat(formatName) {
    if (!VALID_FORMATS.includes(formatName)) {
      return { ok: false, error: `Invalid format: ${formatName}` };
    }
    if (formatName === 'PLACEHOLDER_3') {
      return { ok: false, error: 'Format 3 is not yet implemented' };
    }

    this.format = formatName;
    if (formatName === 'JEOPARDY') {
      this.activeFormat = new JeopardyFormat();
    } else if (formatName === 'COUNTDOWN_QUIZ') {
      this.activeFormat = new CountdownQuizFormat();
    }
    return { ok: true, format: this.format };
  }

  setFormat(formatName) {
    return this.selectFormat(formatName);
  }

  // ──────────────────────────────────────────────
  // Shared: Question number
  // ──────────────────────────────────────────────

  setQuestionNumber(n) {
    const num = parseInt(n, 10);
    if (!Number.isInteger(num) || num < 1 || num > 999) {
      return { ok: false, error: `Invalid question number: ${n}` };
    }
    this.questionNumber = num;
    // When moving question, reset current format's round state
    if (this.activeFormat) {
      this.activeFormat.reset();
    }
    return { ok: true };
  }

  // ──────────────────────────────────────────────
  // Shared: Team connection management
  // ──────────────────────────────────────────────

  joinTeam(teamNumber, connectionId) {
    if (!VALID_TEAMS.includes(teamNumber)) {
      return { ok: false, error: `Invalid team number: ${teamNumber}` };
    }
    if (this.teams[teamNumber] !== null) {
      return { ok: false, error: 'TEAM_OCCUPIED' };
    }
    this.teams[teamNumber] = connectionId;
    return { ok: true };
  }

  leaveTeam(teamNumber) {
    if (VALID_TEAMS.includes(teamNumber)) {
      this.teams[teamNumber] = null;
    }
  }

  teamForConnection(connectionId) {
    for (const t of VALID_TEAMS) {
      if (this.teams[t] === connectionId) return t;
    }
    return null;
  }

  kickTeam(teamNumber) {
    if (VALID_TEAMS.includes(teamNumber)) {
      this.teams[teamNumber] = null;
    }
  }

  // ──────────────────────────────────────────────
  // Format delegation: Jeopardy
  // ──────────────────────────────────────────────

  arm() {
    if (!this.activeFormat || this.format !== 'JEOPARDY') {
      return { ok: false, error: 'ARM is only available in Jeopardy mode' };
    }
    return this.activeFormat.arm();
  }

  buzz(teamNumber, serverTimestamp) {
    if (!VALID_TEAMS.includes(teamNumber)) {
      return { ok: false, error: `Invalid team number: ${teamNumber}` };
    }
    if (!this.activeFormat) {
      return { ok: false, error: 'No quiz format selected' };
    }

    if (this.format === 'JEOPARDY') {
      return this.activeFormat.buzz(teamNumber, serverTimestamp);
    }
    if (this.format === 'COUNTDOWN_QUIZ') {
      return this.activeFormat.submitAnswer(teamNumber, serverTimestamp);
    }
    return { ok: false, error: 'Unsupported format' };
  }

  resetGame() {
    if (this.activeFormat) {
      return this.activeFormat.reset();
    }
    return { ok: true };
  }

  // Backwards-compatible getter proxies for Jeopardy
  get state() {
    return (this.activeFormat && this.activeFormat.state) || 'LOCKED';
  }
  set state(val) {
    if (this.activeFormat) this.activeFormat.state = val;
  }
  get winner() {
    return (this.activeFormat && this.activeFormat.winner) ?? null;
  }
  set winner(val) {
    if (this.activeFormat) this.activeFormat.winner = val;
  }
  get winnerTimestamp() {
    return (this.activeFormat && this.activeFormat.winnerTimestamp) ?? null;
  }
  set winnerTimestamp(val) {
    if (this.activeFormat) this.activeFormat.winnerTimestamp = val;
  }

  // ──────────────────────────────────────────────
  // Format delegation: Countdown Quiz
  // ──────────────────────────────────────────────

  setTimerDuration(ms) {
    if (!this.activeFormat || this.format !== 'COUNTDOWN_QUIZ') {
      return { ok: false, error: 'Timer is only available in Countdown Quiz mode' };
    }
    return this.activeFormat.setDuration(ms);
  }

  startTimer() {
    if (!this.activeFormat || this.format !== 'COUNTDOWN_QUIZ') {
      return { ok: false, error: 'Start question is only available in Countdown Quiz mode' };
    }
    return this.activeFormat.startQuestion();
  }

  submitAnswer(teamNumber, serverTimestamp) {
    if (!this.activeFormat || this.format !== 'COUNTDOWN_QUIZ') {
      return { ok: false, error: 'Submit answer is only available in Countdown Quiz mode' };
    }
    return this.activeFormat.submitAnswer(teamNumber, serverTimestamp);
  }

  expireTimer() {
    if (!this.activeFormat || this.format !== 'COUNTDOWN_QUIZ') {
      return { ok: false, error: 'Timer expiration is only available in Countdown Quiz mode' };
    }
    return this.activeFormat.expire();
  }

  resetTimer() {
    if (!this.activeFormat || this.format !== 'COUNTDOWN_QUIZ') {
      return { ok: false, error: 'Timer reset is only available in Countdown Quiz mode' };
    }
    return this.activeFormat.reset();
  }

  // Backwards-compatible getter proxies for Countdown Quiz
  get timer() {
    return this.activeFormat?.timer || null;
  }
  get answerEvents() {
    return this.activeFormat?.answerEvents || [];
  }

  // ──────────────────────────────────────────────
  // Snapshot (public broadcast)
  // ──────────────────────────────────────────────

  snapshot() {
    const base = {
      format: this.format,
      questionNumber: this.questionNumber,
      teams: {
        1: this.teams[1] !== null,
        2: this.teams[2] !== null,
        3: this.teams[3] !== null,
      },
    };

    if (this.activeFormat) {
      return {
        ...base,
        ...this.activeFormat.snapshot(),
      };
    }

    return base;
  }
}

module.exports = {
  GameState,
  VALID_TEAMS,
  VALID_FORMATS,
  TIMER_MIN_MS,
  TIMER_MAX_MS,
  TIMER_DEFAULT_MS,
};
