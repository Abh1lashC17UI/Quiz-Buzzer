/**
 * server.js
 *
 * Entry point for the Trivia Night Buzzer server.
 *
 * Routes:
 *   /                       → format selector (index.html)
 *   /join                   → team join page
 *   /host?token=<hostToken> → host control panel
 *   /team                   → team buzzer page
 *   /audience/<displayToken>→ read-only audience display
 *   /embed/<displayToken>   → embeddable iframe version (no X-Frame-Options)
 *   /api/health             → server health check
 *
 * Usage:
 *   node server.js
 *   PORT=3000 node server.js
 */

'use strict';

const http    = require('http');
const path    = require('path');
const os      = require('os');
const express = require('express');
const { WebSocketServer } = require('ws');

const { GameState }       = require('./src/gameState');
const { AuthStore }       = require('./src/authentication');
const { attachWebSocket } = require('./src/websocket');

// ── Configuration ─────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '3000', 10);

// ── App bootstrap ─────────────────────────────────────────────────────────────

const app       = express();
const gameState = new GameState(null);
const auth      = new AuthStore();

// ── Security headers (applied globally) ──────────────────────────────────────
// X-Frame-Options: DENY prevents all pages from being iframed by default.
// We selectively override this on the /embed route below.
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// Serve static files from ./public
app.use(express.static(path.join(__dirname, 'public')));

// ── HTTP routes ───────────────────────────────────────────────────────────────

// Format selector (new landing page)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Team join page
app.get('/join', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'join.html'));
});

// Host control panel — token delivered in URL, never in page source
app.get('/host', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'host.html'));
});

// Team buzzer
app.get('/team', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'team.html'));
});

// ── Audience display ──────────────────────────────────────────────────────────
// The display token is validated here at HTTP level so a wrong URL gets a 403
// rather than a broken page. The page also validates via WebSocket (DISPLAY_AUTH).
app.get('/audience/:token', (req, res) => {
  if (!auth.validateDisplayToken(req.params.token)) {
    return res.status(403).send('Invalid display token.');
  }
  // X-Frame-Options DENY is already set globally — audience page not embeddable
  res.sendFile(path.join(__dirname, 'public', 'audience.html'));
});

// ── Embed version ─────────────────────────────────────────────────────────────
// Same content as audience but:
//   - X-Frame-Options is removed (allows iframe embedding)
//   - Content-Security-Policy frame-ancestors is set to '*' for local network use
// Only this specific route is iframe-friendly; all other routes remain protected.
app.get('/embed/:token', (req, res) => {
  if (!auth.validateDisplayToken(req.params.token)) {
    return res.status(403).send('Invalid display token.');
  }
  // Override the global X-Frame-Options header to allow iframe embedding
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  res.sendFile(path.join(__dirname, 'public', 'embed.html'));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

// ── HTTP + WS server ──────────────────────────────────────────────────────────

const server = http.createServer(app);
const wss    = new WebSocketServer({ server });

attachWebSocket(wss, gameState, auth);

// ── Startup ───────────────────────────────────────────────────────────────────

server.listen(PORT, '0.0.0.0', () => {
  const localIPs = getLocalIPs();
  const ip = localIPs[0] || 'localhost';

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║          TRIVIA NIGHT BUZZER — SERVER READY          ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`  PORT       : ${PORT}`);
  console.log('');
  console.log('  LOCAL ADDRESSES (share one with your team):');
  if (localIPs.length === 0) {
    console.log(`    http://localhost:${PORT}`);
  } else {
    for (const addr of localIPs) {
      console.log(`    http://${addr}:${PORT}`);
    }
  }
  console.log('');
  console.log('┌──────────────────────────────────────────────────────┐');
  console.log(`│  GAME CODE  :  ${auth.gameCode.padEnd(36)}  │`);
  console.log('│  (Show this to your players so they can join)        │');
  console.log('└──────────────────────────────────────────────────────┘');
  console.log('');
  console.log('┌──────────────────────────────────────────────────────┐');
  console.log('│  HOST URL   (open this on the HOST laptop):          │');
  console.log(`│  http://${ip}:${PORT}/host?token=${auth.hostToken}  │`);
  console.log('│  (Never share this URL with players!)                │');
  console.log('└──────────────────────────────────────────────────────┘');
  console.log('');
  console.log('┌──────────────────────────────────────────────────────┐');
  console.log('│  AUDIENCE DISPLAY (safe to project on screen):       │');
  console.log(`│  http://${ip}:${PORT}/audience/${auth.displayToken}  │`);
  console.log('│  EMBED URL (for iframe on quiz website):             │');
  console.log(`│  http://${ip}:${PORT}/embed/${auth.displayToken}    │`);
  console.log('└──────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  Press Ctrl+C to stop the server.');
  console.log('');
});

// ── Utility: local IP detection ───────────────────────────────────────────────

function getLocalIPs() {
  const result = [];
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        result.push(iface.address);
      }
    }
  }
  return result;
}

// ── Graceful shutdown ─────────────────────────────────────────────────────────

process.on('SIGTERM', () => {
  console.log('\nServer shutting down…');
  server.close(() => process.exit(0));
});
