/**
 * authentication.js
 *
 * Manages three kinds of secrets generated fresh each server start:
 *
 *   GAME CODE     – 6-char alphanumeric shown on host screen.
 *                   Every team browser must enter this to join.
 *
 *   HOST TOKEN    – 64-char hex. Included in every host WebSocket command.
 *                   Team/audience clients never receive this.
 *
 *   DISPLAY TOKEN – 32-char hex. Embedded in audience/embed URLs.
 *                   Grants read-only access to public game state.
 *                   Cannot be used to issue host commands.
 *                   Safe to embed in a URL shared with projector/screen.
 *
 * No passwords are persisted. Server restart regenerates all secrets.
 */

'use strict';

const crypto = require('crypto');

// ──────────────────────────────────────────────────────────────
// Game code  (shown on projector / host screen)
// ──────────────────────────────────────────────────────────────

const GAME_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
const GAME_CODE_LENGTH = 6;

function generateGameCode() {
  let code = '';
  const bytes = crypto.randomBytes(GAME_CODE_LENGTH);
  for (let i = 0; i < GAME_CODE_LENGTH; i++) {
    code += GAME_CODE_CHARS[bytes[i] % GAME_CODE_CHARS.length];
  }
  return code;
}

// ──────────────────────────────────────────────────────────────
// Host token  (never shown to teams)
// ──────────────────────────────────────────────────────────────

function generateHostToken() {
  return crypto.randomBytes(32).toString('hex'); // 64-char hex string
}

// ──────────────────────────────────────────────────────────────
// Session tokens for team connections
// (allows reconnection with the same team identity)
// ──────────────────────────────────────────────────────────────

function generateSessionToken() {
  return crypto.randomBytes(16).toString('hex'); // 32-char hex string
}

// ──────────────────────────────────────────────────────────────
// Auth store
// ──────────────────────────────────────────────────────────────

class AuthStore {
  constructor() {
    this.gameCode     = generateGameCode();
    this.hostToken    = generateHostToken();
    this.displayToken = generateSessionToken(); // 32-char hex, read-only access

    // Map: sessionToken → teamNumber
    // Allows a phone that reconnects with a stored token to reclaim its team.
    this.teamSessions = new Map();
  }

  /**
   * Is this the correct game code?
   * Comparison is case-insensitive and ignores spaces.
   */
  validateGameCode(code) {
    if (typeof code !== 'string') return false;
    return code.trim().toUpperCase() === this.gameCode;
  }

  /**
   * Is this the correct host token?
   */
  validateHostToken(token) {
    if (typeof token !== 'string') return false;
    // Constant-time comparison to avoid timing attacks (minor but free).
    const a = Buffer.from(token);
    const b = Buffer.from(this.hostToken);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  /**
   * Is this the correct display token?
   * Display tokens grant read-only access to the audience/embed pages.
   * They are NEVER accepted as host tokens.
   */
  validateDisplayToken(token) {
    if (typeof token !== 'string') return false;
    const a = Buffer.from(token);
    const b = Buffer.from(this.displayToken);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  }

  /**
   * Create a new session token for a team.
   * @param {number} teamNumber
   * @returns {string} session token
   */
  createTeamSession(teamNumber) {
    const token = generateSessionToken();
    this.teamSessions.set(token, teamNumber);
    return token;
  }

  /**
   * Look up which team number belongs to a session token.
   * @returns {number|null}
   */
  resolveTeamSession(token) {
    if (typeof token !== 'string') return null;
    return this.teamSessions.get(token) ?? null;
  }

  /**
   * Remove all sessions for a given team (e.g. after kick).
   */
  clearTeamSessions(teamNumber) {
    for (const [token, t] of this.teamSessions) {
      if (t === teamNumber) this.teamSessions.delete(token);
    }
  }
}

module.exports = { AuthStore };
