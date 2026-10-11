/**
 * jeopardy.js
 *
 * Game format engine: JEOPARDY
 *
 * Rules:
 *   - States: LOCKED, ARMED
 *   - Host arms question: LOCKED → ARMED
 *   - First team to buzz wins: ARMED → LOCKED, records winner and timestamp
 *   - All other buzzes are locked out / rejected
 *   - Host reset: clears winner, returns to LOCKED
 *   - Does NOT have timer countdown, expiration, or answer timeline.
 */

'use strict';

class JeopardyFormat {
  constructor() {
    this.reset();
  }

  reset() {
    this.state = 'LOCKED';          // 'LOCKED' | 'ARMED'
    this.winner = null;             // null | 1 | 2 | 3
    this.winnerTimestamp = null;
    return { ok: true };
  }

  arm() {
    if (this.state !== 'LOCKED') {
      return { ok: false, error: `Cannot ARM: current state is ${this.state}` };
    }
    this.state = 'ARMED';
    this.winner = null;
    this.winnerTimestamp = null;
    return { ok: true };
  }

  buzz(teamNumber, serverTimestamp) {
    if (this.state !== 'ARMED') {
      return { ok: false, error: `Buzz ignored: state is ${this.state}` };
    }
    this.state = 'LOCKED';
    this.winner = teamNumber;
    this.winnerTimestamp = typeof serverTimestamp === 'number' ? serverTimestamp : Date.now();
    return { ok: true, winner: teamNumber };
  }

  snapshot() {
    return {
      state: this.state,
      winner: this.winner,
      winnerTimestamp: this.winnerTimestamp,
    };
  }
}

module.exports = { JeopardyFormat };
