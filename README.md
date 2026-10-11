# Trivia Night Buzzer

A local-network trivia buzzer system. The host runs the server on their laptop; players join on their phones over Wi-Fi.

**No internet required after first-time setup. No cloud, no accounts, no external services.**

---

## Quick Start (Windows)

1. Install [Node.js LTS](https://nodejs.org) if you haven't already.
2. Double-click **`start-trivia.bat`** in this folder.
3. The terminal will show:
   - Local IP addresses to share with players
   - The **Game Code** (e.g. `PHU7B5`) — show this on screen
   - The **Host URL** — open this on the host laptop
   - The **Audience URL** — open this on the projector/TV screen
   - The **Embed URL** — paste this into your quiz website
4. Players open `http://192.168.x.x:3000` on their phones and choose a format, then enter the game code.

---

## Manual Start (any OS)

```bash
npm install          # first time only — needs internet
npm start            # starts the server; no internet needed
npm test             # run all automated tests
```

---

## Network Setup

### Step 1 — Create a Wi-Fi hotspot on the host laptop

**Windows 10/11:**
1. Open **Settings → Network & Internet → Mobile Hotspot**
2. Turn on **Share my Internet connection**
3. Note the SSID and password shown there
4. Tell your players to connect their phones to that Wi-Fi network

### Step 2 — Find the host laptop's local IP address

**Windows:**
```
ipconfig
```
Look for the line **IPv4 Address** under the **Wi-Fi** or **Local Area Connection** adapter.
Example: `192.168.137.1`

**macOS:**
```
ipconfig getifaddr en0
```

**Linux:**
```
ip addr show
```

### Step 3 — Share the address

Tell players to open `http://192.168.x.x:3000` (replace with your IP) in their phone browsers.

---

## Firewall Note (Windows)

When you first run the server, Windows Firewall may show a popup asking whether to allow Node.js through the firewall. **Click "Allow"** (Private networks is sufficient).

---

## How to Play

### 1. Host Chooses Quiz Type
When the host opens the **Host URL** (`http://<ip>:3000/host?token=<hostToken>`), they choose:
- **JEOPARDY**: Classic first-to-buzz game. First team to buzz wins; others are locked out.
- **COUNTDOWN QUIZ**: Timed countdown questions with answer timeline. All teams can submit their answers during the countdown.
- **FORMAT 3**: Placeholder for future game formats.

---

### If Playing JEOPARDY
- **Host**:
  1. Shows the **Game Code** to players.
  2. Sets question number with `−` / `+`.
  3. Clicks **ARM** when ready for buzzes.
  4. First team to buzz wins; their name flashes on screen.
  5. Clicks **RESET** to clear and return to LOCKED.
- **Teams**:
  1. Connect to Wi-Fi and open `http://<ip>:3000`.
  2. Enter the Game Code and pick their team.
  3. When host arms, the big button pulses green. First buzz wins!
- **Audience / Embed**:
  Shows Question number, state (LOCKED / ARMED), and the winning team banner. NO timer, NO timeline.

---

### If Playing COUNTDOWN QUIZ
- **Host**:
  1. Shows the **Game Code** to players.
  2. Selects question duration (presets: 10s, 15s, 20s, 30s, 45s, 60s, 90s, 120s). Default: 30s.
  3. Clicks **START QUESTION**. The countdown begins!
  4. Views team answer submissions live as they arrive.
  5. The **Answer Timeline** plots each team's answer position (`elapsed / duration * 100%`) with elapsed seconds.
  6. At zero seconds, state becomes **TIME UP** and no further answers are accepted.
  7. Clicks **RESET QUESTION** to prepare the next question.
- **Teams**:
  1. Watch the countdown timer bar on their phones.
  2. Tap **[ ANSWER / BUZZ ]** when they know the answer.
  3. Once submitted, displays: `✓ ANSWER RECORDED (X.Xs)`. Button disables.
  4. Other teams can still submit their answers until time expires!
- **Audience / Embed**:
  Shows Question number, large numerical countdown, progress bar, and the **Answer Timeline** with colored markers and answer times for all participating teams.

---

## Project Structure

```
trivia-night/
│
├── server.js                  ← Express & WebSocket entry point
├── package.json
├── start-trivia.bat           ← Windows launcher
│
├── src/
│   ├── gameState.js           ← Buzzer platform manager (delegates to format engines)
│   ├── authentication.js      ← Game code, host token, display token, team sessions
│   ├── websocket.js           ← Message routing & client roles
│   └── formats/
│       ├── jeopardy.js        ← Pure Jeopardy format engine (first buzz wins)
│       └── countdownQuiz.js   ← Pure Countdown Quiz format engine (timer, timeline)
│
├── public/
│   ├── index.html             ← Format list landing page
│   ├── join.html              ← Team join page (game code + team picker)
│   ├── host.html              ← Host dashboard (quiz type selector + distinct format views)
│   ├── team.html              ← Team interface (adapts to selected format)
│   ├── audience.html          ← Audience display (adapts to selected format)
│   ├── embed.html             ← Embeddable iframe version (adapts to selected format)
│   ├── css/style.css          ← Responsive styles & animations
│   └── js/
│       ├── host.js            ← Host controller
│       ├── team.js            ← Team controller
│       └── audience.js        ← Audience / embed display controller
│
└── tests/
    ├── gameState.test.js      ← Automated unit & regression test suite
    └── ws-smoke-test.js       ← End-to-end WebSocket integration smoke test
```

---

## Architecture

### Three credential types

| Credential | Length | Purpose |
|-----------|--------|---------|
| **Game Code** | 6 chars (e.g. `PHU7B5`) | Players must enter this to join. Prevents accidental gate-crashers. |
| **Host Token** | 64-char hex | Included in every host WebSocket command. Team/audience clients never receive it. |
| **Display Token** | 32-char hex | Embedded in audience/embed URLs. Grants read-only access. Cannot issue host commands. |

### Session roles (server-side)

| Role | Can buzz? | Can ARM/RESET/KICK? | Can receive state? |
|------|-----------|---------------------|-------------------|
| `unknown` | ✗ | ✗ | ✓ (initial) |
| `team` | ✓ | ✗ | ✓ |
| `host` | ✗ | ✓ | ✓ |
| `display` | ✗ | ✗ | ✓ |

The server assigns these roles after authentication. Clients cannot self-report a role.

### Game State Machine

```
LOCKED
  │
  │  HOST_ARM  (SET_QUESTION and SET_FORMAT can happen at any time)
  ▼
ARMED
  │
  │  First TEAM_BUZZ received
  ▼
LOCKED + winner recorded
  │
  │  HOST_RESET
  ▼
LOCKED (winner cleared, question/format unchanged)
```

### Public state broadcast

Every state change broadcasts this to all connections:

```json
{
  "type": "GAME_STATE",
  "format": "JEOPARDY",
  "questionNumber": 17,
  "state": "LOCKED",
  "winner": 2,
  "winnerTimestamp": 1700000000000,
  "teams": { "1": true, "2": true, "3": false }
}
```

No host tokens or session secrets are included.

### Race condition

Node.js processes WebSocket messages sequentially. When two teams buzz simultaneously, the first packet in the event queue wins. The second is processed while state is already `LOCKED` and silently rejected.

---

## WebSocket Message Reference

### Client → Server

```jsonc
// Team join
{ "type": "JOIN", "gameCode": "PHU7B5", "teamNumber": 1 }
{ "type": "JOIN", "gameCode": "PHU7B5", "teamNumber": 1, "sessionToken": "..." }

// Team buzz
{ "type": "TEAM_BUZZ" }

// Host authentication (once, on connect)
{ "type": "HOST_AUTH", "hostToken": "..." }

// Host commands (hostToken required every time)
{ "type": "ARM",          "hostToken": "..." }
{ "type": "RESET",        "hostToken": "..." }
{ "type": "KICK",         "hostToken": "...", "teamNumber": 2 }
{ "type": "SET_QUESTION", "hostToken": "...", "questionNumber": 17 }
{ "type": "SET_FORMAT",   "hostToken": "...", "format": "JEOPARDY" }

// Display authentication (audience/embed pages)
{ "type": "DISPLAY_AUTH", "displayToken": "..." }
```

### Server → Client

```jsonc
{ "type": "GAME_STATE", "format": "JEOPARDY", "questionNumber": 17,
  "state": "LOCKED", "winner": null, "winnerTimestamp": null,
  "teams": { "1": true, "2": false, "3": false } }

{ "type": "JOIN_OK",          "teamNumber": 1, "sessionToken": "..." }
{ "type": "JOIN_ERROR",       "reason": "INVALID_CODE" }
{ "type": "HOST_AUTH_OK",     "gameCode": "...", "displayToken": "..." }
{ "type": "HOST_AUTH_ERROR",  "reason": "..." }
{ "type": "DISPLAY_AUTH_OK" }
{ "type": "DISPLAY_AUTH_ERROR", "reason": "..." }
{ "type": "KICKED" }
{ "type": "ERROR", "reason": "..." }
```

---

## Game Formats

| Format ID | Status | Description |
|-----------|--------|-------------|
| `JEOPARDY` | ✅ Working | Classic first-buzz-wins game |
| `PLACEHOLDER_1` | 🚧 Coming soon | Reserved for future format |
| `PLACEHOLDER_2` | 🚧 Coming soon | Reserved for future format |

To add a new format: add its ID to `VALID_FORMATS` in `src/gameState.js`, add a button in `public/index.html`, and implement its specific logic. The core buzzer infrastructure doesn't need to change.

---

## Routes

| URL | Purpose | iframe-safe? |
|-----|---------|-------------|
| `/` | Format selector | No (X-Frame-Options: DENY) |
| `/join` | Team join page | No |
| `/host?token=…` | Host control panel | No |
| `/team` | Team buzzer | No |
| `/audience/<token>` | Read-only audience display | No |
| `/embed/<token>` | Embeddable audience display | ✅ Yes |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Phones can't reach the server | Check Windows Firewall; ensure phones are on the **same** Wi-Fi hotspot |
| "Invalid game code" | Check you typed it correctly; code resets each server restart |
| "Team occupied" | Someone else already joined as that team; pick a different one or ask host to kick |
| Host page shows "Missing host token" | Use the full URL printed in the terminal, not just `/host` |
| Audience page shows "Invalid display token" | Use the audience URL from the terminal, not a hand-typed one |
| Iframe is blocked | Ensure the parent page is HTTP (not HTTPS) — mixed-content blocking applies |
| Server crash | Restart with `start-trivia.bat`; game resets cleanly |
