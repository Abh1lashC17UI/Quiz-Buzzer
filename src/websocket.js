/**
 * websocket.js
 *
 * Handles all WebSocket connections and message routing for the Buzzer Platform.
 *
 * Client Roles:
 *   'unknown' – just connected
 *   'team'    – joined as Team 1/2/3
 *   'host'    – authenticated with hostToken
 *   'display' – authenticated with displayToken (read-only)
 *
 * Message Protocol:
 *   Shared commands:
 *     HOST_AUTH, DISPLAY_AUTH, JOIN, KICK, SET_QUESTION, SELECT_FORMAT
 *   Jeopardy commands:
 *     ARM, RESET, TEAM_BUZZ
 *   Countdown Quiz commands:
 *     SET_TIMER_DURATION, START_TIMER, RESET_TIMER, TEAM_BUZZ / SUBMIT_ANSWER
 */

'use strict';

const { v4: uuidv4 } = require('uuid');

/**
 * @param {import('ws').Server} wss
 * @param {import('./gameState').GameState} gameState
 * @param {import('./authentication').AuthStore} auth
 */
function attachWebSocket(wss, gameState, auth) {
  // Map: connectionId → { ws, role, teamNumber }
  const connections = new Map();

  // Server-side expiry timeout handle for Countdown Quiz
  let expiryTimeout = null;

  function send(ws, obj) {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(obj));
    }
  }

  function broadcastState() {
    const msg = JSON.stringify({ type: 'GAME_STATE', ...gameState.snapshot() });
    for (const { ws } of connections.values()) {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    }
  }

  function cancelExpiryTimeout() {
    if (expiryTimeout !== null) {
      clearTimeout(expiryTimeout);
      expiryTimeout = null;
    }
  }

  function scheduleExpiry(endsAt) {
    cancelExpiryTimeout();
    const delay = Math.max(0, endsAt - Date.now());
    expiryTimeout = setTimeout(() => {
      expiryTimeout = null;
      const result = gameState.expireTimer();
      if (result.ok) {
        broadcastState();
      }
    }, delay);
  }

  wss.on('connection', (ws) => {
    const connectionId = uuidv4();
    connections.set(connectionId, { ws, role: 'unknown', teamNumber: null });

    // Send current game state immediately
    send(ws, { type: 'GAME_STATE', ...gameState.snapshot() });

    ws.on('message', (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw);
      } catch {
        send(ws, { type: 'ERROR', reason: 'Invalid JSON' });
        return;
      }

      if (typeof msg !== 'object' || msg === null || typeof msg.type !== 'string') {
        send(ws, { type: 'ERROR', reason: 'Malformed message' });
        return;
      }

      const conn = connections.get(connectionId);

      switch (msg.type) {
        // ── Host Authentication ──────────────────────────────────────────────
        case 'HOST_AUTH': {
          if (!auth.validateHostToken(msg.hostToken)) {
            send(ws, { type: 'HOST_AUTH_ERROR', reason: 'Invalid host token' });
            return;
          }
          conn.role = 'host';
          send(ws, {
            type: 'HOST_AUTH_OK',
            gameCode: auth.gameCode,
            displayToken: auth.displayToken,
          });
          send(ws, { type: 'GAME_STATE', ...gameState.snapshot() });
          break;
        }

        // ── Display Authentication ───────────────────────────────────────────
        case 'DISPLAY_AUTH': {
          if (!auth.validateDisplayToken(msg.displayToken)) {
            send(ws, { type: 'DISPLAY_AUTH_ERROR', reason: 'Invalid display token' });
            return;
          }
          conn.role = 'display';
          send(ws, { type: 'DISPLAY_AUTH_OK' });
          send(ws, { type: 'GAME_STATE', ...gameState.snapshot() });
          break;
        }

        // ── Host Commands (all require valid hostToken) ──────────────────────
        case 'SELECT_FORMAT':
        case 'SET_FORMAT':
        case 'ARM':
        case 'RESET':
        case 'RESET_TIMER':
        case 'KICK':
        case 'SET_QUESTION':
        case 'SET_TIMER_DURATION':
        case 'START_TIMER':
        case 'START_QUESTION': {
          if (!auth.validateHostToken(msg.hostToken)) {
            send(ws, { type: 'ERROR', reason: 'Unauthorized: invalid host token' });
            return;
          }

          if (msg.type === 'SELECT_FORMAT' || msg.type === 'SET_FORMAT') {
            cancelExpiryTimeout();
            const result = gameState.selectFormat(msg.format);
            if (!result.ok) {
              send(ws, { type: 'ERROR', reason: result.error });
              return;
            }
            broadcastState();
          } else if (msg.type === 'ARM') {
            const result = gameState.arm();
            if (!result.ok) {
              send(ws, { type: 'ERROR', reason: result.error });
              return;
            }
            broadcastState();
          } else if (msg.type === 'RESET' || msg.type === 'RESET_TIMER') {
            cancelExpiryTimeout();
            gameState.resetGame();
            broadcastState();
          } else if (msg.type === 'KICK') {
            const teamNum = parseInt(msg.teamNumber, 10);
            if (![1, 2, 3].includes(teamNum)) {
              send(ws, { type: 'ERROR', reason: 'Invalid team number for KICK' });
              return;
            }
            const targetConnId = gameState.teams[teamNum];
            if (targetConnId && connections.has(targetConnId)) {
              send(connections.get(targetConnId).ws, { type: 'KICKED' });
            }
            gameState.kickTeam(teamNum);
            auth.clearTeamSessions(teamNum);
            broadcastState();
          } else if (msg.type === 'SET_QUESTION') {
            cancelExpiryTimeout();
            const result = gameState.setQuestionNumber(msg.questionNumber);
            if (!result.ok) {
              send(ws, { type: 'ERROR', reason: result.error });
              return;
            }
            broadcastState();
          } else if (msg.type === 'SET_TIMER_DURATION') {
            const result = gameState.setTimerDuration(msg.durationMs);
            if (!result.ok) {
              send(ws, { type: 'ERROR', reason: result.error });
              return;
            }
            broadcastState();
          } else if (msg.type === 'START_TIMER' || msg.type === 'START_QUESTION') {
            const result = gameState.startTimer();
            if (!result.ok) {
              send(ws, { type: 'ERROR', reason: result.error });
              return;
            }
            scheduleExpiry(result.endsAt);
            broadcastState();
          }
          break;
        }

        // ── Team Join ────────────────────────────────────────────────────────
        case 'JOIN': {
          if (!auth.validateGameCode(msg.gameCode)) {
            send(ws, { type: 'JOIN_ERROR', reason: 'INVALID_CODE' });
            return;
          }

          const teamNum = parseInt(msg.teamNumber, 10);
          if (![1, 2, 3].includes(teamNum)) {
            send(ws, { type: 'JOIN_ERROR', reason: 'INVALID_TEAM' });
            return;
          }

          // Check for reconnect via session token
          if (typeof msg.sessionToken === 'string') {
            const savedTeam = auth.resolveTeamSession(msg.sessionToken);
            if (savedTeam === teamNum && gameState.teams[teamNum] === null) {
              gameState.teams[teamNum] = connectionId;
              conn.role = 'team';
              conn.teamNumber = teamNum;
              send(ws, { type: 'JOIN_OK', teamNumber: teamNum, sessionToken: msg.sessionToken });
              broadcastState();
              return;
            }
          }

          // Fresh join
          const result = gameState.joinTeam(teamNum, connectionId);
          if (!result.ok) {
            send(ws, { type: 'JOIN_ERROR', reason: result.error });
            return;
          }

          const sessionToken = auth.createTeamSession(teamNum);
          conn.role = 'team';
          conn.teamNumber = teamNum;
          send(ws, { type: 'JOIN_OK', teamNumber: teamNum, sessionToken });
          broadcastState();
          break;
        }

        // ── Team Buzz / Submit Answer ────────────────────────────────────────
        case 'TEAM_BUZZ':
        case 'SUBMIT_ANSWER': {
          if (conn.role !== 'team' || conn.teamNumber === null) {
            send(ws, { type: 'ERROR', reason: 'Not joined as a team' });
            return;
          }

          const serverTimestamp = Date.now();

          if (gameState.format === 'JEOPARDY') {
            const result = gameState.buzz(conn.teamNumber, serverTimestamp);
            if (result.ok) {
              broadcastState();
            }
          } else if (gameState.format === 'COUNTDOWN_QUIZ') {
            const result = gameState.submitAnswer(conn.teamNumber, serverTimestamp);
            if (result.ok) {
              broadcastState();
            }
          }
          break;
        }

        default: {
          send(ws, { type: 'ERROR', reason: `Unknown message type: ${msg.type}` });
        }
      }
    });

    ws.on('close', () => {
      const conn = connections.get(connectionId);
      if (conn && conn.role === 'team' && conn.teamNumber !== null) {
        if (gameState.teams[conn.teamNumber] === connectionId) {
          gameState.leaveTeam(conn.teamNumber);
          broadcastState();
        }
      }
      connections.delete(connectionId);
    });

    ws.on('error', (err) => {
      console.error(`[WS] Connection ${connectionId} error:`, err.message);
    });
  });
}

module.exports = { attachWebSocket };
