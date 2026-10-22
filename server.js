'use strict';

/**
 * МАЙСТЕР — майлар мен тағамтану туралы білім сайысы.
 * Толығымен тәуелсіз Node.js сервері: сыртқы кітапханалар жоқ.
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const questions = require('./data/questions');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'maister.db');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const COOKIE = 'mai_s';
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const SOLO_LIMIT_MS = 30000;
const DAILY_LIMIT_MS = 20000;
const SOLO_QUESTIONS = 20;
const DAILY_QUESTIONS = 8;
const DUEL_LIMIT_MS = 15000;
const DUEL_QUESTIONS = 8;
const AVATARS = ['olive', 'avocado', 'fish', 'walnut', 'leaf', 'drop'];
const MAX_BODY = 64 * 1024;

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_FILE);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 4000;

  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nickname TEXT NOT NULL,
    nick_lower TEXT NOT NULL UNIQUE,
    pass_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    avatar TEXT NOT NULL DEFAULT 'olive',
    xp INTEGER NOT NULL DEFAULT 0,
    games INTEGER NOT NULL DEFAULT 0,
    wins INTEGER NOT NULL DEFAULT 0,
    losses INTEGER NOT NULL DEFAULT 0,
    draws INTEGER NOT NULL DEFAULT 0,
    best_solo INTEGER NOT NULL DEFAULT 0,
    solo_games INTEGER NOT NULL DEFAULT 0,
    duel_games INTEGER NOT NULL DEFAULT 0,
    total_correct INTEGER NOT NULL DEFAULT 0,
    total_answered INTEGER NOT NULL DEFAULT 0,
    daily_date TEXT,
    daily_score INTEGER NOT NULL DEFAULT 0,
    daily_correct INTEGER NOT NULL DEFAULT 0,
    daily_total INTEGER NOT NULL DEFAULT 0,
    daily_ms INTEGER NOT NULL DEFAULT 0,
    streak INTEGER NOT NULL DEFAULT 0,
    best_streak INTEGER NOT NULL DEFAULT 0,
    last_play_date TEXT,
    created_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    last_seen INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS solo_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode TEXT NOT NULL,
    score INTEGER NOT NULL,
    correct INTEGER NOT NULL,
    total INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_solo_user ON solo_runs(user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL,
    p1_id INTEGER NOT NULL REFERENCES users(id),
    p2_id INTEGER NOT NULL REFERENCES users(id),
    p1_score INTEGER NOT NULL,
    p2_score INTEGER NOT NULL,
    p1_correct INTEGER NOT NULL,
    p2_correct INTEGER NOT NULL,
    winner_id INTEGER,
    total INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_matches_p1 ON matches(p1_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_matches_p2 ON matches(p2_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS daily_plays (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    score INTEGER NOT NULL,
    correct INTEGER NOT NULL,
    total INTEGER NOT NULL,
    ms INTEGER NOT NULL,
    PRIMARY KEY (user_id, date)
  );
`);

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const now = () => Date.now();
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Азия/Алматы уақыты бойынша күн кілті (UTC+5, жазғы уақыт жоқ). */
function dayKey(t = Date.now()) {
  return new Date(t + 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function dayStart(key = dayKey()) {
  return new Date(`${key}T00:00:00+05:00`).getTime();
}
function yesterdayKey() {
  return dayKey(Date.now() - 24 * 60 * 60 * 1000);
}

function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Әртүрлі санаттарды кезектестіріп сұрақ таңдау. */
function pickQuestions(count, seedText) {
  const rng = mulberry32(hash32(String(seedText)));
  const byCat = new Map();
  for (const q of questions) {
    if (!byCat.has(q.cat)) byCat.set(q.cat, []);
    byCat.get(q.cat).push(q);
  }
  const cats = shuffle([...byCat.keys()], rng);
  const pools = new Map(cats.map((c) => [c, shuffle(byCat.get(c), rng)]));
  const picked = [];
  let guard = 0;
  while (picked.length < count && guard++ < 200) {
    let added = false;
    for (const c of cats) {
      if (picked.length >= count) break;
      const pool = pools.get(c);
      if (pool.length) {
        picked.push(pool.pop());
        added = true;
      }
    }
    if (!added) break;
  }
  return picked;
}

function sanitizeQuestion(q) {
  return { id: q.id, cat: q.cat, diff: q.diff, q: q.q, options: q.options };
}

function levelInfo(xp) {
  const safe = Math.max(0, Number(xp) || 0);
  const level = Math.floor(Math.sqrt(safe / 100)) + 1;
  const base = (level - 1) ** 2 * 100;
  const next = level ** 2 * 100;
  return { level, into: safe - base, need: next - base };
}

/* ------------------------------------------------------------------ */
/* Presence, rate limiting, stats cache                                */
/* ------------------------------------------------------------------ */

const presence = new Map();
const rateBuckets = new Map();
const ONLINE_WINDOW = 2 * 60 * 1000;

function touchPresence(uid) {
  presence.set(Number(uid), now());
  if (presence.size > 5000) {
    const cutoff = now() - 10 * 60 * 1000;
    for (const [id, t] of presence) if (t < cutoff) presence.delete(id);
  }
}
function isOnline(uid) {
  const t = presence.get(Number(uid));
  return Boolean(t && now() - t < ONLINE_WINDOW);
}
function onlineCount() {
  const cutoff = now() - ONLINE_WINDOW;
  let n = 0;
  for (const t of presence.values()) if (t >= cutoff) n++;
  return n;
}

function clientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}
function hitRate(key, max, windowMs) {
  const t = now();
  const arr = rateBuckets.get(key) || [];
  const recent = [];
  for (const x of arr) if (t - x < windowMs) recent.push(x);
  recent.push(t);
  rateBuckets.set(key, recent);
  return recent.length > max;
}

let statsCache = { at: 0, data: null };
function getStats() {
  if (statsCache.data && now() - statsCache.at < 5000) return statsCache.data;
  const players = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const today = dayKey();
  const dailyPlayers = db
    .prepare("SELECT COUNT(*) AS c FROM daily_plays WHERE date = ?")
    .get(today).c;
  const gamesToday =
    db.prepare('SELECT COUNT(*) AS c FROM solo_runs WHERE created_at >= ?').get(dayStart(today)).c +
    db.prepare('SELECT COUNT(*) AS c FROM matches WHERE created_at >= ?').get(dayStart(today)).c;
  const data = {
    online: onlineCount(),
    players,
    gamesToday,
    dailyPlayers,
    questions: questions.length,
  };
  statsCache = { at: now(), data };
  return data;
}

/* ------------------------------------------------------------------ */
/* Users / sessions                                                    */
/* ------------------------------------------------------------------ */

const DUMMY_SALT = crypto.randomBytes(16).toString('hex');
const DUMMY_HASH = crypto.scryptSync('not-a-real-password', DUMMY_SALT, 64);

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function safeEqualHex(a, b) {
  try {
    const ba = Buffer.from(a, 'hex');
    const bb = Buffer.from(b, 'hex');
    if (ba.length !== bb.length) return false;
    return crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

function rawUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}
function rawUserByNick(nick) {
  return db.prepare('SELECT * FROM users WHERE nick_lower = ?').get(String(nick).toLowerCase());
}

const NICK_RE = /^(?=.*\p{L})[\p{L}\p{N}_]{3,16}$/u;

function publicUser(row) {
  if (!row) return null;
  const li = levelInfo(row.xp);
  return {
    id: row.id,
    nickname: row.nickname,
    avatar: row.avatar,
    xp: row.xp,
    level: li.level,
    xpInto: li.into,
    xpNeed: li.need,
    games: row.games,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    winRate: row.games ? Math.round((row.wins / row.games) * 100) : 0,
    bestSolo: row.best_solo,
    soloGames: row.solo_games,
    duelGames: row.duel_games,
    totalCorrect: row.total_correct,
    totalAnswered: row.total_answered,
    accuracy: row.total_answered
      ? Math.round((row.total_correct / row.total_answered) * 100)
      : 0,
    streak: row.streak,
    bestStreak: row.best_streak,
    dailyDate: row.daily_date,
    dailyScore: row.daily_score,
    dailyCorrect: row.daily_correct,
    dailyTotal: row.daily_total,
    dailyDone: row.daily_date === dayKey(),
    createdAt: row.created_at,
    online: isOnline(row.id),
  };
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

function setSessionCookie(req, res, token, maxAgeSec) {
  const secure = String(req.headers['x-forwarded-proto'] || '').includes('https');
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function createSession(req, res, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = sha256(token);
  const t = now();
  db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)'
  ).run(tokenHash, userId, t, t + SESSION_MS, t);
  db.prepare(
    'DELETE FROM sessions WHERE user_id = ? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT 10)'
  ).run(userId, userId);
  setSessionCookie(req, res, token, Math.floor(SESSION_MS / 1000));
  return tokenHash;
}

function currentSession(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token || token.length > 200) return null;
  const tokenHash = sha256(token);
  const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash);
  if (!row) return null;
  if (row.expires_at < now()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
    return null;
  }
  const user = rawUser(row.user_id);
  if (!user) return null;
  touchPresence(user.id);
  if (now() - row.last_seen > 60 * 1000) {
    const t = now();
    db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(t, tokenHash);
    db.prepare('UPDATE users SET last_seen = ? WHERE id = ?').run(t, user.id);
  }
  return { user, tokenHash };
}

function authUser(req) {
  const s = currentSession(req);
  return s ? s.user : null;
}

function bumpStreak(userId) {
  const u = rawUser(userId);
  if (!u) return 0;
  const today = dayKey();
  if (u.last_play_date === today) return u.streak;
  const next = u.last_play_date === yesterdayKey() ? u.streak + 1 : 1;
  db.prepare(
    'UPDATE users SET streak = ?, best_streak = ?, last_play_date = ? WHERE id = ?'
  ).run(next, Math.max(next, u.best_streak), today, userId);
  return next;
}

/* ------------------------------------------------------------------ */
/* Achievements                                                        */
/* ------------------------------------------------------------------ */

function achievementsFor(userId) {
  const u = rawUser(userId);
  if (!u) return [];
  const perfect = db
    .prepare('SELECT COUNT(*) AS c FROM solo_runs WHERE user_id = ? AND total > 0 AND correct = total')
    .get(userId).c;
  const accuracy = u.total_answered ? u.total_correct / u.total_answered : 0;
  const defs = [
    {
      id: 'first',
      name: 'Алғашқы қадам',
      desc: 'Бірінші ойынды аяқта',
      icon: 'seed',
      value: u.games,
      goal: 1,
    },
    {
      id: 'perfect',
      name: 'Мінсіз раунд',
      desc: 'Бір ойында барлық сұраққа дұрыс жауап бер',
      icon: 'target',
      value: perfect,
      goal: 1,
    },
    {
      id: 'daily3',
      name: 'Күнделікті ырғақ',
      desc: '3 күн қатарынан ойна',
      icon: 'flame',
      value: u.best_streak,
      goal: 3,
    },
    {
      id: 'daily7',
      name: 'Апталық серпін',
      desc: '7 күн қатарынан ойна',
      icon: 'calendar',
      value: u.best_streak,
      goal: 7,
    },
    {
      id: 'duel1',
      name: 'Алғашқы жеңіс',
      desc: 'Онлайн дүэлде бір рет жеңіске жет',
      icon: 'sword',
      value: u.wins,
      goal: 1,
    },
    {
      id: 'duel10',
      name: 'Арена шебері',
      desc: 'Онлайн дүэлде 10 жеңіске жет',
      icon: 'trophy',
      value: u.wins,
      goal: 10,
    },
    {
      id: 'xp500',
      name: 'Білім қоры',
      desc: '500 XP жина',
      icon: 'book',
      value: u.xp,
      goal: 500,
    },
    {
      id: 'xp2000',
      name: 'Май сарапшысы',
      desc: '2000 XP жина',
      icon: 'star',
      value: u.xp,
      goal: 2000,
    },
    {
      id: 'accuracy',
      name: 'Дәлдік досы',
      desc: 'Кемінде 50 сұрақта 80% дәлдік көрсет',
      icon: 'target',
      value: u.total_answered >= 50 ? Math.round(accuracy * 100) : 0,
      goal: 80,
    },
    {
      id: 'games25',
      name: 'Тұрақты қатысушы',
      desc: '25 ойын аяқта',
      icon: 'medal',
      value: u.games,
      goal: 25,
    },
  ];
  return defs.map((d) => ({
    ...d,
    value: Math.min(d.value, d.goal),
    earned: d.value >= d.goal,
  }));
}

function earnedIds(userId) {
  return new Set(achievementsFor(userId).filter((a) => a.earned).map((a) => a.id));
}

function newAchievements(userId, beforeIds) {
  return achievementsFor(userId).filter((a) => a.earned && !beforeIds.has(a.id));
}

/* ------------------------------------------------------------------ */
/* Activity / profile                                                  */
/* ------------------------------------------------------------------ */

function recentActivity(userId) {
  const solos = db
    .prepare('SELECT * FROM solo_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 10')
    .all(userId)
    .map((r) => ({
      type: r.mode === 'daily' ? 'daily' : 'solo',
      score: r.score,
      correct: r.correct,
      total: r.total,
      durationMs: r.duration_ms,
      createdAt: r.created_at,
    }));
  const matches = db
    .prepare(
      `SELECT m.*, u1.nickname AS p1_name, u1.avatar AS p1_avatar,
              u2.nickname AS p2_name, u2.avatar AS p2_avatar
         FROM matches m
         JOIN users u1 ON u1.id = m.p1_id
         JOIN users u2 ON u2.id = m.p2_id
        WHERE m.p1_id = ? OR m.p2_id = ?
        ORDER BY m.created_at DESC LIMIT 10`
    )
    .all(userId, userId)
    .map((m) => {
      const isP1 = m.p1_id === userId;
      return {
        type: 'duel',
        result: m.winner_id == null ? 'draw' : m.winner_id === userId ? 'win' : 'loss',
        score: isP1 ? m.p1_score : m.p2_score,
        opponentScore: isP1 ? m.p2_score : m.p1_score,
        opponent: {
          nickname: isP1 ? m.p2_name : m.p1_name,
          avatar: isP1 ? m.p2_avatar : m.p1_avatar,
        },
        correct: isP1 ? m.p1_correct : m.p2_correct,
        total: m.total,
        createdAt: m.created_at,
      };
    });
  return [...solos, ...matches].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
}

function dailyWeek(userId) {
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const key = dayKey(Date.now() - i * 24 * 60 * 60 * 1000);
    days.push({ date: key, played: false, score: 0 });
  }
  const start = days[0].date;
  const rows = db
    .prepare('SELECT date, score FROM daily_plays WHERE user_id = ? AND date >= ?')
    .all(userId, start);
  const map = new Map(rows.map((r) => [r.date, r.score]));
  for (const d of days) {
    if (map.has(d.date)) {
      d.played = true;
      d.score = map.get(d.date);
    }
  }
  return days;
}

function userRank(userId, board = 'xp') {
  const u = rawUser(userId);
  if (!u) return null;
  if (board === 'daily') {
    if (u.daily_date !== dayKey()) return null;
    return (
      db
        .prepare(
          'SELECT COUNT(*) AS c FROM users WHERE daily_date = ? AND (daily_score > ? OR (daily_score = ? AND daily_ms < ?))'
        )
        .get(u.daily_date, u.daily_score, u.daily_score, u.daily_ms).c + 1
    );
  }
  if (board === 'solo') {
    return db.prepare('SELECT COUNT(*) AS c FROM users WHERE best_solo > ?').get(u.best_solo).c + 1;
  }
  return db.prepare('SELECT COUNT(*) AS c FROM users WHERE xp > ?').get(u.xp).c + 1;
}

function leaderRow(row, rank) {
  const li = levelInfo(row.xp);
  return {
    rank,
    id: row.id,
    nickname: row.nickname,
    avatar: row.avatar,
    level: li.level,
    xp: row.xp,
    wins: row.wins,
    games: row.games,
    bestSolo: row.best_solo,
    dailyScore: row.daily_score,
    streak: row.streak,
    online: isOnline(row.id),
  };
}

/* ------------------------------------------------------------------ */
/* Solo / daily runs                                                   */
/* ------------------------------------------------------------------ */

const runs = new Map();

function cleanupRuns() {
  const cutoff = now() - 60 * 60 * 1000;
  for (const [id, run] of runs) if (run.startedAt < cutoff) runs.delete(id);
}

function finalizeSolo(run) {
  const user = rawUser(run.userId);
  const before = earnedIds(run.userId);
  const durationMs = now() - run.startedAt;
  run.total = run.items.length;
  const perfect = run.correct === run.total;
  const baseXp =
    run.mode === 'daily'
      ? 12 + run.correct * 8 + (perfect ? 40 : 0) + 20
      : 10 + run.correct * 5 + (perfect ? 30 : 0);
  const xpEarned = Math.max(5, baseXp);
  const t = now();

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare(
      `UPDATE users SET
         xp = xp + ?, games = games + 1, solo_games = solo_games + 1,
         best_solo = MAX(best_solo, ?),
         total_correct = total_correct + ?, total_answered = total_answered + ?
       WHERE id = ?`
    ).run(xpEarned, run.score, run.correct, run.total, run.userId);
    if (run.mode === 'daily') {
      const today = dayKey();
      db.prepare(
        `UPDATE users SET daily_date = ?, daily_score = ?, daily_correct = ?, daily_total = ?, daily_ms = ?
         WHERE id = ?`
      ).run(today, run.score, run.correct, run.total, durationMs, run.userId);
      db.prepare(
        'INSERT OR REPLACE INTO daily_plays (user_id, date, score, correct, total, ms) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(run.userId, today, run.score, run.correct, run.total, durationMs);
    }
    db.prepare(
      'INSERT INTO solo_runs (user_id, mode, score, correct, total, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(run.userId, run.mode, run.score, run.correct, run.total, durationMs, t);
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {}
    throw err;
  }

  bumpStreak(run.userId);
  const fresh = rawUser(run.userId);
  const newly = newAchievements(run.userId, before);

  const categoryMap = new Map();
  run.items.forEach((q, i) => {
    const ans = run.answers[i];
    const entry = categoryMap.get(q.cat) || { cat: q.cat, correct: 0, total: 0 };
    entry.total++;
    if (ans && ans.correct) entry.correct++;
    categoryMap.set(q.cat, entry);
  });

  return {
    runId: run.id,
    mode: run.mode,
    score: run.score,
    correct: run.correct,
    total: run.total,
    bestStreak: run.bestStreak,
    accuracy: run.total ? Math.round((run.correct / run.total) * 100) : 0,
    durationMs,
    xpEarned,
    perfect,
    previousLevel: levelInfo(user.xp).level,
    newLevel: levelInfo(fresh.xp).level,
    newAchievements: newly,
    categories: [...categoryMap.values()],
    user: publicUser(fresh),
  };
}

/* ------------------------------------------------------------------ */
/* Rooms / realtime duels                                              */
/* ------------------------------------------------------------------ */

const rooms = new Map();
const userRoom = new Map();
const quickQueue = [];
let roomSeq = 0;

function makeCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = '';
    for (let i = 0; i < 6; i++) code += alphabet[crypto.randomInt(alphabet.length)];
  } while (rooms.has(code));
  return code;
}

function playerSnapshot(user) {
  return {
    id: user.id,
    nickname: user.nickname,
    avatar: user.avatar,
    level: levelInfo(user.xp).level,
    xp: user.xp,
  };
}

function activeRoomFor(uid) {
  const code = userRoom.get(uid);
  if (!code) return null;
  const room = rooms.get(code);
  if (!room) {
    userRoom.delete(uid);
    return null;
  }
  return room;
}

function roomPlayerIds(room) {
  return [room.hostId, room.guestId].filter((x) => x != null);
}

function isRoomMember(room, uid) {
  return room.hostId === uid || room.guestId === uid;
}

function clearRoomTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer);
    room.timer = null;
  }
}

function clearDisconnectTimer(room, uid) {
  const t = room.disconnectTimers.get(uid);
  if (t) {
    clearTimeout(t);
    room.disconnectTimers.delete(uid);
  }
}

function connected(room, uid) {
  for (const res of room.clients) if (res._uid === uid) return true;
  return false;
}

function roomView(room) {
  const players = [];
  if (room.hostId) {
    players.push({
      ...room.host,
      score: room.scores[room.hostId] || 0,
      correct: room.correct[room.hostId] || 0,
      streak: room.streaks[room.hostId] || 0,
      answered: Boolean(room.answers[room.hostId]),
      connected: connected(room, room.hostId) || isOnline(room.hostId),
      isHost: true,
    });
  }
  if (room.guestId) {
    players.push({
      ...room.guest,
      score: room.scores[room.guestId] || 0,
      correct: room.correct[room.guestId] || 0,
      streak: room.streaks[room.guestId] || 0,
      answered: Boolean(room.answers[room.guestId]),
      connected: connected(room, room.guestId) || isOnline(room.guestId),
      isHost: false,
    });
  }
  const view = {
    code: room.code,
    status: room.status,
    phase: room.phase,
    index: Math.min(room.qIndex + 1, room.total),
    total: room.total,
    players,
    hostId: room.hostId,
    guestId: room.guestId,
    createdAt: room.createdAt,
    remainingMs: room.deadline ? Math.max(0, room.deadline - now()) : 0,
    countdownMs: room.countdownEndsAt ? Math.max(0, room.countdownEndsAt - now()) : 0,
    limitMs: DUEL_LIMIT_MS,
    rematchVotes: [...room.rematchVotes],
  };
  if (room.status === 'playing' || room.status === 'finished') {
    const q = room.items[room.qIndex];
    if (q && room.phase !== 'finished') {
      view.question = sanitizeQuestion(q);
      view.deadline = room.deadline;
    }
    if (room.phase === 'reveal' || room.status === 'finished') {
      if (q) view.reveal = { answerIndex: q.a, fact: q.fact, answers: room.answers };
    }
  }
  if (room.status === 'finished') {
    view.result = {
      winnerId: room.winnerId,
      reason: room.endReason,
      rewards: room.rewards || {},
      newAchievements: room.newlyByUser || {},
      rematchVotes: [...room.rematchVotes],
      total: room.total,
    };
  }
  return view;
}

function broadcast(room) {
  const data = JSON.stringify(roomView(room));
  const frame = `event: state\ndata: ${data}\n\n`;
  for (const res of [...room.clients]) {
    try {
      res.write(frame);
    } catch {
      room.clients.delete(res);
    }
  }
}

function endUserStreams(room, uid) {
  for (const res of [...room.clients]) {
    if (res._uid === uid) {
      try {
        res.end();
      } catch {}
      room.clients.delete(res);
    }
  }
}

function resetRoomMatch(room) {
  room.status = 'countdown';
  room.phase = 'countdown';
  room.qIndex = 0;
  room.scores = {};
  room.correct = {};
  room.streaks = {};
  room.answers = {};
  room.rematchVotes.clear();
  room.winnerId = null;
  room.endReason = null;
  room.rewards = null;
  room.newlyByUser = {};
  room.finishedAt = null;
  room.items = pickQuestions(DUEL_QUESTIONS, `${room.code}:${crypto.randomUUID()}`);
  room.total = room.items.length;
  room.countdownEndsAt = now() + 3500;
  clearRoomTimer(room);
  room.timer = setTimeout(() => beginRoomPlay(room), 3500);
  if (room.timer.unref) room.timer.unref();
  broadcast(room);
}

function beginCountdown(room) {
  if (room.status !== 'waiting' || !room.guestId) return;
  room.status = 'countdown';
  room.phase = 'countdown';
  room.countdownEndsAt = now() + 3500;
  clearRoomTimer(room);
  room.timer = setTimeout(() => beginRoomPlay(room), 3500);
  if (room.timer.unref) room.timer.unref();
  broadcast(room);
}

function beginRoomPlay(room) {
  if (room.status !== 'countdown') return;
  room.status = 'playing';
  room.qIndex = 0;
  room.scores = {};
  room.correct = {};
  room.streaks = {};
  room.answers = {};
  for (const id of roomPlayerIds(room)) {
    room.scores[id] = 0;
    room.correct[id] = 0;
    room.streaks[id] = 0;
  }
  setRoomQuestion(room);
}

function setRoomQuestion(room) {
  clearRoomTimer(room);
  room.phase = 'question';
  room.answers = {};
  room.questionStartedAt = now();
  room.deadline = room.questionStartedAt + DUEL_LIMIT_MS;
  broadcast(room);
  room.timer = setTimeout(() => revealRoom(room, 'timeout'), DUEL_LIMIT_MS);
  if (room.timer.unref) room.timer.unref();
}

function revealRoom(room, trigger = 'both') {
  if (room.status !== 'playing' || room.phase !== 'question') return;
  clearRoomTimer(room);
  const q = room.items[room.qIndex];
  for (const id of roomPlayerIds(room)) {
    if (!room.answers[id]) {
      room.answers[id] = { choice: null, correct: false, points: 0, ms: DUEL_LIMIT_MS };
      room.streaks[id] = 0;
    }
  }
  room.phase = 'reveal';
  room.revealAt = now();
  broadcast(room);
  room.timer = setTimeout(() => advanceRoom(room), 5000);
  if (room.timer.unref) room.timer.unref();
}

function advanceRoom(room) {
  if (room.status !== 'playing' || room.phase !== 'reveal') return;
  if (room.qIndex + 1 >= room.total) {
    finishRoom(room, 'score', null);
    return;
  }
  room.qIndex++;
  setRoomQuestion(room);
}

function finishRoom(room, reason, winnerId) {
  if (room.status === 'finished') return;
  clearRoomTimer(room);
  for (const id of roomPlayerIds(room)) clearDisconnectTimer(room, id);

  room.status = 'finished';
  room.phase = 'finished';
  room.endReason = reason;
  room.finishedAt = now();

  const ids = roomPlayerIds(room);
  const p1 = room.hostId;
  const p2 = room.guestId;
  let winner = winnerId ?? null;

  if (reason !== 'forfeit') {
    if (room.scores[p1] > room.scores[p2]) winner = p1;
    else if (room.scores[p2] > room.scores[p1]) winner = p2;
    else winner = null;
  }

  room.winnerId = winner;
  const rewards = {};
  const before = new Map();
  for (const id of ids) before.set(id, earnedIds(id));

  db.exec('BEGIN IMMEDIATE');
  try {
    for (const id of ids) {
      const other = id === p1 ? p2 : p1;
      const won = winner === id;
      const draw = winner == null && reason !== 'forfeit';
      const opponentForfeit = reason === 'forfeit' && won;
      const base = opponentForfeit ? 50 : won ? 70 : draw ? 40 : 25;
      const xp = base + (room.correct[id] || 0) * 2;
      rewards[id] = xp;
      db.prepare(
        `UPDATE users SET
           xp = xp + ?, games = games + 1, duel_games = duel_games + 1,
           wins = wins + ?, losses = losses + ?, draws = draws + ?,
           total_correct = total_correct + ?, total_answered = total_answered + ?
         WHERE id = ?`
      ).run(
        xp,
        won ? 1 : 0,
        reason === 'forfeit' && !won ? 1 : !won && !draw ? 1 : 0,
        draw ? 1 : 0,
        room.correct[id] || 0,
        room.total,
        id
      );
    }
    if (p2 != null) {
      db.prepare(
        `INSERT INTO matches
          (code, p1_id, p2_id, p1_score, p2_score, p1_correct, p2_correct, winner_id, total, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        room.code,
        p1,
        p2,
        room.scores[p1] || 0,
        room.scores[p2] || 0,
        room.correct[p1] || 0,
        room.correct[p2] || 0,
        winner,
        room.total,
        now()
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {}
    console.error('finishRoom db error', err);
  }

  for (const id of ids) {
    bumpStreak(id);
    room.newlyByUser[id] = newAchievements(id, before.get(id) || new Set());
  }
  room.rewards = rewards;
  room.rematchVotes.clear();
  broadcast(room);
}

function createRoom(hostUser, guestUser = null) {
  const code = makeCode();
  const room = {
    code,
    hostId: hostUser.id,
    guestId: guestUser ? guestUser.id : null,
    host: playerSnapshot(hostUser),
    guest: guestUser ? playerSnapshot(guestUser) : null,
    status: 'waiting',
    phase: 'idle',
    items: pickQuestions(DUEL_QUESTIONS, `${code}:${crypto.randomUUID()}`),
    total: DUEL_QUESTIONS,
    qIndex: 0,
    scores: {},
    correct: {},
    streaks: {},
    answers: {},
    questionStartedAt: null,
    deadline: null,
    countdownEndsAt: null,
    timer: null,
    clients: new Set(),
    disconnectTimers: new Map(),
    rematchVotes: new Set(),
    rewards: null,
    newlyByUser: {},
    winnerId: null,
    endReason: null,
    createdAt: now(),
    finishedAt: null,
  };
  rooms.set(code, room);
  userRoom.set(hostUser.id, code);
  if (guestUser) userRoom.set(guestUser.id, code);
  roomSeq++;
  return room;
}

function removeFromQueue(uid) {
  for (let i = quickQueue.length - 1; i >= 0; i--) {
    if (quickQueue[i].uid === uid) quickQueue.splice(i, 1);
  }
}

function pruneQueue() {
  const cutoff = now() - 60 * 1000;
  for (let i = quickQueue.length - 1; i >= 0; i--) {
    const q = quickQueue[i];
    if (q.at < cutoff || !isOnline(q.uid) || !rawUser(q.uid)) quickQueue.splice(i, 1);
  }
}

function deleteRoom(room) {
  clearRoomTimer(room);
  for (const id of roomPlayerIds(room)) {
    clearDisconnectTimer(room, id);
    if (userRoom.get(id) === room.code) userRoom.delete(id);
    removeFromQueue(id);
  }
  for (const res of [...room.clients]) {
    try {
      res.end();
    } catch {}
  }
  room.clients.clear();
  rooms.delete(room.code);
}

function leaveRoom(uid, room, explicit = true) {
  if (!room) return;
  const isHost = room.hostId === uid;
  const isGuest = room.guestId === uid;
  if (!isHost && !isGuest) return;

  if (room.status === 'waiting') {
    if (isGuest) {
      room.guestId = null;
      room.guest = null;
      userRoom.delete(uid);
      endUserStreams(room, uid);
      broadcast(room);
      return;
    }
    if (isHost) {
      if (room.guestId) {
        room.hostId = room.guestId;
        room.host = room.guest;
        room.guestId = null;
        room.guest = null;
        userRoom.delete(uid);
        endUserStreams(room, uid);
        broadcast(room);
        return;
      }
      deleteRoom(room);
      return;
    }
  }

  if (room.status === 'countdown' || room.status === 'playing') {
    const otherId = isHost ? room.guestId : room.hostId;
    endUserStreams(room, uid);
    if (explicit && otherId) {
      finishRoom(room, 'forfeit', otherId);
    }
    userRoom.delete(uid);
    if (!roomPlayerIds(room).some((id) => userRoom.get(id) === room.code)) deleteRoom(room);
    return;
  }

  if (room.status === 'finished') {
    endUserStreams(room, uid);
    userRoom.delete(uid);
    if (!roomPlayerIds(room).some((id) => userRoom.get(id) === room.code)) deleteRoom(room);
  }
}

/* ------------------------------------------------------------------ */
/* HTTP utilities                                                      */
/* ------------------------------------------------------------------ */

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; font-src 'self'; connect-src 'self'; manifest-src 'self'",
};

function sendJson(res, status, payload, extraHeaders = {}) {
  if (res.headersSent) {
    try {
      res.end();
    } catch {}
    return;
  }
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...SECURITY_HEADERS,
    ...extraHeaders,
  });
  res.end(body);
}

function fail(res, status, message, code) {
  sendJson(res, status, { error: message, code: code || undefined });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    if (!type.toLowerCase().includes('application/json')) {
      const err = new Error('Тек JSON сұраныстары қабылданады');
      err.status = 415;
      reject(err);
      return;
    }
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        tooLarge = true;
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (tooLarge) {
        const err = new Error('Сұраныс тым үлкен');
        err.status = 413;
        reject(err);
        return;
      }
      if (!size) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        const err = new Error('JSON форматы дұрыс емес');
        err.status = 400;
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return u.host === req.headers.host;
  } catch {
    return false;
  }
}

function requireAuth(req, res) {
  const user = authUser(req);
  if (!user) {
    fail(res, 401, 'Аккаунтқа кіру қажет', 'AUTH');
    return null;
  }
  return user;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.json', '.svg', '.webmanifest', '.txt']);

async function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  if (rel.includes('\0')) {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (rel.split('/').some((s) => s.startsWith('.') && s !== '')) {
    res.writeHead(404).end('Not found');
    return;
  }
  let file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) && file !== path.join(PUBLIC_DIR, 'index.html')) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  let stat;
  try {
    stat = await fsp.stat(file);
    if (stat.isDirectory()) {
      file = path.join(file, 'index.html');
      stat = await fsp.stat(file);
    }
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS }).end(
      'Бет табылмады'
    );
    return;
  }

  const ext = path.extname(file).toLowerCase();
  const etag = `W/"${stat.size}-${Math.floor(stat.mtimeMs)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ETag: etag, ...SECURITY_HEADERS });
    res.end();
    return;
  }

  let data = await fsp.readFile(file);
  const headers = {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': ext === '.html' ? 'no-cache' : 'no-cache',
    ETag: etag,
    ...SECURITY_HEADERS,
  };
  if (COMPRESSIBLE.has(ext) && data.length > 1024 && String(req.headers['accept-encoding'] || '').includes('gzip')) {
    data = zlib.gzipSync(data, { level: 6 });
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  }
  headers['Content-Length'] = data.length;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') res.end();
  else res.end(data);
}

/* ------------------------------------------------------------------ */
/* API routing                                                         */
/* ------------------------------------------------------------------ */

async function handleApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method || 'GET';

  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    if (!sameOrigin(req)) {
      fail(res, 403, 'Сұраныс көзі расталмады');
      return;
    }
  }

  // --- auth ---
  if (pathname === '/api/auth/register' && method === 'POST') {
    if (hitRate(`reg:${clientIp(req)}`, 6, 60 * 60 * 1000)) {
      fail(res, 429, 'Тым көп тіркелу әрекеті. Кейінірек қайталаңыз.');
      return;
    }
    const body = await readBody(req);
    const nickname = String(body.nickname || '').trim();
    const password = String(body.password || '');
    const avatar = AVATARS.includes(body.avatar) ? body.avatar : 'olive';
    if (!/^(?=.*\p{L})[\p{L}\p{N}_]{3,16}$/u.test(nickname)) {
      fail(res, 400, 'Лақап ат 3–16 таңбадан тұрып, әріптерден, сандардан немесе _ белгісінен құралуы керек');
      return;
    }
    if (password.length < 8 || password.length > 128) {
      fail(res, 400, 'Құпия сөз кемінде 8 таңбадан тұруы керек');
      return;
    }
    if (rawUserByNick(nickname)) {
      fail(res, 409, 'Бұл лақап ат бос емес', 'NICK_TAKEN');
      return;
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const passHash = hashPassword(password, salt);
    const t = now();
    let info;
    try {
      info = db
        .prepare(
          `INSERT INTO users (nickname, nick_lower, pass_hash, salt, avatar, created_at, last_seen)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(nickname, nickname.toLowerCase(), passHash, salt, avatar, t, t);
    } catch (err) {
      if (String(err.message || '').includes('UNIQUE')) {
        fail(res, 409, 'Бұл лақап ат бос емес', 'NICK_TAKEN');
        return;
      }
      throw err;
    }
    const user = rawUser(Number(info.lastInsertRowid));
    createSession(req, res, user.id);
    sendJson(res, 201, { user: publicUser(user) });
    return;
  }

  if (pathname === '/api/auth/lookup' && method === 'GET') {
    if (hitRate(`lookup:${clientIp(req)}`, 120, 10 * 60 * 1000)) {
      fail(res, 429, 'Тым көп тексеру. Сәл күте тұрыңыз.');
      return;
    }
    const nickname = String(url.searchParams.get('nickname') || '').trim();
    if (!NICK_RE.test(nickname)) {
      sendJson(res, 200, { valid: false, exists: false, avatar: null });
      return;
    }
    const row = rawUserByNick(nickname);
    sendJson(res, 200, {
      valid: true,
      exists: Boolean(row),
      avatar: row ? row.avatar : null,
    });
    return;
  }

  if (pathname === '/api/auth/enter' && method === 'POST') {
    if (hitRate(`enter:${clientIp(req)}`, 40, 10 * 60 * 1000)) {
      fail(res, 429, 'Тым көп кіру әрекеті. 10 минуттан кейін қайталаңыз.');
      return;
    }
    const body = await readBody(req);
    const nickname = String(body.nickname || '').trim();
    if (!NICK_RE.test(nickname)) {
      fail(
        res,
        400,
        'Лақап ат 3–16 таңбадан тұрып, кемінде бір әріп болуы керек. Тек әріп, сан және _ рұқсат етілген',
        'BAD_NICKNAME'
      );
      return;
    }
    let row = rawUserByNick(nickname);
    let created = false;
    if (!row) {
      const avatar = AVATARS.includes(body.avatar) ? body.avatar : 'olive';
      const salt = crypto.randomBytes(16).toString('hex');
      const passHash = hashPassword(crypto.randomBytes(32).toString('hex'), salt);
      const t = now();
      try {
        const info = db
          .prepare(
            `INSERT INTO users (nickname, nick_lower, pass_hash, salt, avatar, created_at, last_seen)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(nickname, nickname.toLowerCase(), passHash, salt, avatar, t, t);
        row = rawUser(Number(info.lastInsertRowid));
        created = true;
      } catch (err) {
        if (!String(err.message || '').includes('UNIQUE')) throw err;
        row = rawUserByNick(nickname);
        if (!row) throw err;
      }
    }
    createSession(req, res, row.id);
    sendJson(res, created ? 201 : 200, { user: publicUser(row), created });
    return;
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    if (hitRate(`login:${clientIp(req)}`, 20, 10 * 60 * 1000)) {
      fail(res, 429, 'Тым көп кіру әрекеті. 10 минуттан кейін қайталаңыз.');
      return;
    }
    const body = await readBody(req);
    const nickname = String(body.nickname || '').trim();
    const password = String(body.password || '');
    const row = rawUserByNick(nickname);
    let ok = false;
    if (row) {
      const hash = hashPassword(password, row.salt);
      ok = safeEqualHex(hash, row.pass_hash);
    } else {
      crypto.scryptSync(password, DUMMY_SALT, 64);
      safeEqualHex(DUMMY_HASH.toString('hex'), DUMMY_HASH.toString('hex'));
    }
    if (!ok) {
      fail(res, 401, 'Лақап ат немесе құпия сөз дұрыс емес', 'BAD_LOGIN');
      return;
    }
    createSession(req, res, row.id);
    sendJson(res, 200, { user: publicUser(row) });
    return;
  }

  if (pathname === '/api/auth/logout' && method === 'POST') {
    const s = currentSession(req);
    if (s) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(s.tokenHash);
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return;
  }

  // --- public stats ---
  if (pathname === '/api/stats' && method === 'GET') {
    sendJson(res, 200, getStats());
    return;
  }

  // --- me ---
  if (pathname === '/api/me' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    let room = null;
    const r = activeRoomFor(user.id);
    if (r && r.status !== 'finished') room = r.code;
    sendJson(res, 200, {
      user: publicUser(user),
      achievements: achievementsFor(user.id),
      activeRoom: room,
    });
    return;
  }

  if (pathname === '/api/me' && method === 'PATCH') {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = await readBody(req);
    if (!AVATARS.includes(body.avatar)) {
      fail(res, 400, 'Аватар дұрыс таңдалмаған');
      return;
    }
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(body.avatar, user.id);
    sendJson(res, 200, { user: publicUser(rawUser(user.id)) });
    return;
  }

  if (pathname === '/api/me/password' && method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = await readBody(req);
    const current = String(body.current || '');
    const next = String(body.next || '');
    if (!safeEqualHex(hashPassword(current, user.salt), user.pass_hash)) {
      fail(res, 400, 'Ағымдағы құпия сөз дұрыс емес');
      return;
    }
    if (next.length < 8 || next.length > 128) {
      fail(res, 400, 'Жаңа құпия сөз кемінде 8 таңбадан тұруы керек');
      return;
    }
    if (next === current) {
      fail(res, 400, 'Жаңа құпия сөз бұрынғысынан өзгеше болуы керек');
      return;
    }
    const salt = crypto.randomBytes(16).toString('hex');
    const passHash = hashPassword(next, salt);
    db.prepare('UPDATE users SET salt = ?, pass_hash = ? WHERE id = ?').run(salt, passHash, user.id);
    const s = currentSession(req);
    if (s) {
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?').run(
        user.id,
        s.tokenHash
      );
    }
    sendJson(res, 200, { ok: true });
    return;
  }

  // --- profile ---
  if (pathname === '/api/profile' && method === 'GET') {
    const me = requireAuth(req, res);
    if (!me) return;
    const nick = url.searchParams.get('nick');
    const target = nick ? rawUserByNick(nick) : me;
    if (!target) {
      fail(res, 404, 'Пайдаланушы табылмады', 'NOT_FOUND');
      return;
    }
    sendJson(res, 200, {
      user: publicUser(target),
      achievements: achievementsFor(target.id),
      recent: recentActivity(target.id),
      dailyWeek: dailyWeek(target.id),
      rank: userRank(target.id, 'xp'),
      isSelf: target.id === me.id,
    });
    return;
  }

  // --- leaderboard ---
  if (pathname === '/api/leaderboard' && method === 'GET') {
    const me = requireAuth(req, res);
    if (!me) return;
    const board = url.searchParams.get('board') || 'xp';
    let rows = [];
    let myRank = null;
    if (board === 'daily') {
      const today = dayKey();
      rows = db
        .prepare(
          'SELECT * FROM users WHERE daily_date = ? ORDER BY daily_score DESC, daily_ms ASC LIMIT 50'
        )
        .all(today)
        .map((r, i) => leaderRow(r, i + 1));
      myRank = userRank(me.id, 'daily');
    } else if (board === 'solo') {
      rows = db
        .prepare('SELECT * FROM users ORDER BY best_solo DESC, xp DESC LIMIT 50')
        .all()
        .map((r, i) => leaderRow(r, i + 1));
      myRank = userRank(me.id, 'solo');
    } else {
      rows = db
        .prepare('SELECT * FROM users ORDER BY xp DESC, wins DESC, best_solo DESC LIMIT 50')
        .all()
        .map((r, i) => leaderRow(r, i + 1));
      myRank = userRank(me.id, 'xp');
    }
    sendJson(res, 200, { board, rows, myRank, me: leaderRow(me, myRank || 0) });
    return;
  }

  // --- solo / daily ---
  if (pathname === '/api/solo/start' && method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = await readBody(req);
    const mode = body.mode === 'daily' ? 'daily' : 'solo';
    cleanupRuns();
    if (mode === 'daily') {
      const today = dayKey();
      const lock = db
        .prepare(
          `UPDATE users SET daily_date = ?, daily_score = 0, daily_correct = 0, daily_total = 0, daily_ms = 0
           WHERE id = ? AND (daily_date IS NULL OR daily_date <> ?)`
        )
        .run(today, user.id, today);
      if (lock.changes === 0) {
        const fresh = rawUser(user.id);
        fail(res, 409, 'Бүгінгі күнделікті сынақты өтіп қойдыңыз', 'DAILY_DONE');
        return;
      }
    }
    const seed =
      mode === 'daily'
        ? `daily:${dayKey()}:v1`
        : `solo:${user.id}:${crypto.randomUUID()}`;
    const limitMs = mode === 'daily' ? DAILY_LIMIT_MS : SOLO_LIMIT_MS;
    const items = pickQuestions(
      mode === 'daily' ? DAILY_QUESTIONS : SOLO_QUESTIONS,
      seed
    );
    const run = {
      id: crypto.randomUUID(),
      userId: user.id,
      mode,
      items,
      total: items.length,
      index: 0,
      score: 0,
      correct: 0,
      streak: 0,
      bestStreak: 0,
      answers: [],
      answered: false,
      done: false,
      startedAt: now(),
      qStartedAt: now(),
      limitMs,
    };
    runs.set(run.id, run);
    sendJson(res, 201, {
      runId: run.id,
      mode,
      index: 0,
      total: items.length,
      limitMs,
      question: sanitizeQuestion(items[0]),
      startedAt: now(),
    });
    return;
  }

  if (pathname === '/api/solo/answer' && method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = await readBody(req);
    const run = runs.get(String(body.runId || ''));
    if (!run || run.userId !== user.id) {
      fail(res, 404, 'Ойын сессиясы табылмады', 'NO_RUN');
      return;
    }
    if (run.done) {
      fail(res, 409, 'Бұл ойын аяқталған', 'DONE');
      return;
    }
    if (run.answered) {
      fail(res, 409, 'Бұл сұраққа жауап берілді', 'ANSWERED');
      return;
    }
    if (Number(body.index) !== run.index) {
      fail(res, 409, 'Ойын күйі синхрондалмады. Бетті жаңартыңыз', 'OUT_OF_SYNC');
      return;
    }
    const q = run.items[run.index];
    const elapsed = Math.max(0, now() - run.qStartedAt);
    let choice = Number.isInteger(body.choice) && body.choice >= 0 && body.choice < q.options.length
      ? body.choice
      : null;
    if (elapsed > run.limitMs + 1500) choice = null;
    const correct = choice != null && choice === q.a;
    const speed = correct ? Math.round(50 * Math.max(0, 1 - Math.min(elapsed, run.limitMs) / run.limitMs)) : 0;
    const streakBonus = correct ? Math.min(run.streak, 5) * 10 : 0;
    const points = correct ? 100 + speed + streakBonus : 0;
    if (correct) {
      run.streak++;
      run.bestStreak = Math.max(run.bestStreak, run.streak);
      run.correct++;
    } else {
      run.streak = 0;
    }
    run.score += points;
    run.answers[run.index] = {
      qid: q.id,
      choice,
      correct,
      points,
      ms: Math.min(elapsed, run.limitMs),
      timedOut: choice == null,
    };
    run.answered = true;
    const isLast = run.index === run.items.length - 1;
    if (isLast) {
      run.done = true;
      const summary = finalizeSolo(run);
      runs.delete(run.id);
      sendJson(res, 200, {
        correct,
        correctIndex: q.a,
        choice,
        fact: q.fact,
        points,
        score: run.score,
        streak: run.streak,
        index: run.index,
        timedOut: choice == null,
        finished: true,
        summary,
      });
      return;
    }
    sendJson(res, 200, {
      correct,
      correctIndex: q.a,
      choice,
      fact: q.fact,
      points,
      score: run.score,
      streak: run.streak,
      index: run.index,
      timedOut: choice == null,
      finished: false,
    });
    return;
  }

  if (pathname === '/api/solo/next' && method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = await readBody(req);
    const run = runs.get(String(body.runId || ''));
    if (!run || run.userId !== user.id || run.done) {
      fail(res, 404, 'Ойын сессиясы табылмады', 'NO_RUN');
      return;
    }
    if (!run.answered) {
      fail(res, 409, 'Алдымен ағымдағы сұраққа жауап беріңіз', 'NOT_ANSWERED');
      return;
    }
    run.answered = false;
    run.index++;
    if (run.index >= run.items.length) {
      fail(res, 409, 'Ойын аяқталды', 'DONE');
      return;
    }
    run.qStartedAt = now();
    const q = run.items[run.index];
    sendJson(res, 200, {
      index: run.index,
      total: run.items.length,
      limitMs: run.limitMs,
      question: sanitizeQuestion(q),
      startedAt: now(),
    });
    return;
  }

  // --- rooms ---
  if (pathname === '/api/rooms' && method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    await readBody(req);
    const existing = activeRoomFor(user.id);
    if (existing && existing.status !== 'finished') {
      fail(res, 409, 'Сіз қазірдің өзінде бөлмедесіз', 'IN_ROOM');
      return;
    }
    if (existing) {
      userRoom.delete(user.id);
    }
    removeFromQueue(user.id);
    const room = createRoom(user, null);
    sendJson(res, 201, { code: room.code, room: roomView(room) });
    return;
  }

  if (pathname === '/api/rooms/quick' && method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    await readBody(req);
    const existing = activeRoomFor(user.id);
    if (existing && existing.status !== 'finished') {
      sendJson(res, 200, { code: existing.code, queued: false });
      return;
    }
    if (existing) userRoom.delete(user.id);
    removeFromQueue(user.id);
    pruneQueue();
    const opponent = quickQueue.find((x) => x.uid !== user.id && rawUser(x.uid) && isOnline(x.uid));
    if (opponent) {
      removeFromQueue(opponent.uid);
      const other = rawUser(opponent.uid);
      if (!other) {
        quickQueue.push({ uid: user.id, at: now() });
        sendJson(res, 200, { queued: true });
        return;
      }
      const room = createRoom(other, user);
      beginCountdown(room);
      sendJson(res, 200, { code: room.code, queued: false, matched: true });
      return;
    }
    quickQueue.push({ uid: user.id, at: now() });
    sendJson(res, 200, { queued: true, position: quickQueue.length });
    return;
  }

  if (pathname === '/api/rooms/quick/status' && method === 'GET') {
    const user = requireAuth(req, res);
    if (!user) return;
    const room = activeRoomFor(user.id);
    if (room && room.status !== 'finished') {
      removeFromQueue(user.id);
      sendJson(res, 200, { queued: false, code: room.code });
      return;
    }
    const entry = quickQueue.find((x) => x.uid === user.id);
    if (!entry) {
      sendJson(res, 200, { queued: false, timeout: true });
      return;
    }
    if (now() - entry.at > 60 * 1000) {
      removeFromQueue(user.id);
      sendJson(res, 200, { queued: false, timeout: true });
      return;
    }
    sendJson(res, 200, { queued: true, waitedMs: now() - entry.at });
    return;
  }

  if (pathname === '/api/rooms/quick/cancel' && method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    await readBody(req);
    removeFromQueue(user.id);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === '/api/rooms/join' && method === 'POST') {
    const user = requireAuth(req, res);
    if (!user) return;
    const body = await readBody(req);
    const code = String(body.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,8}$/.test(code)) {
      fail(res, 400, 'Бөлме коды 6 таңбадан тұруы керек', 'BAD_CODE');
      return;
    }
    const room = rooms.get(code);
    if (!room) {
      fail(res, 404, 'Мұндай бөлме табылмады. Кодты тексеріңіз', 'NO_ROOM');
      return;
    }
    if (isRoomMember(room, user.id)) {
      sendJson(res, 200, { code: room.code, room: roomView(room) });
      return;
    }
    const existing = activeRoomFor(user.id);
    if (existing && existing.status !== 'finished') {
      fail(res, 409, 'Алдымен ағымдағы бөлмеден шығыңыз', 'IN_ROOM');
      return;
    }
    if (existing) userRoom.delete(user.id);
    if (room.status !== 'waiting') {
      fail(res, 409, 'Бұл бөлмеде ойын басталып кеткен', 'STARTED');
      return;
    }
    if (room.guestId) {
      fail(res, 409, 'Бөлме толы. Басқа кодты пайдаланыңыз', 'FULL');
      return;
    }
    removeFromQueue(user.id);
    room.guestId = user.id;
    room.guest = playerSnapshot(user);
    userRoom.set(user.id, room.code);
    broadcast(room);
    sendJson(res, 200, { code: room.code, room: roomView(room) });
    return;
  }

  // /api/rooms/:code — get / start / answer / leave / rematch / events
  const roomMatch = pathname.match(/^\/api\/rooms\/([A-Za-z0-9]{4,8})(\/(start|answer|leave|rematch|events))?$/);
  if (roomMatch) {
    const code = roomMatch[1].toUpperCase();
    const action = roomMatch[3] || null;
    const room = rooms.get(code);
    const user = requireAuth(req, res);
    if (!user) return;
    if (!room) {
      fail(res, 404, 'Бөлме табылмады', 'NO_ROOM');
      return;
    }
    if (!isRoomMember(room, user.id)) {
      fail(res, 403, 'Бұл бөлмеге кіруге рұқсат жоқ', 'NOT_MEMBER');
      return;
    }
    if (!action && method === 'GET') {
      sendJson(res, 200, { room: roomView(room) });
      return;
    }
    if (action === 'events' && method === 'GET') {
      clearDisconnectTimer(room, user.id);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        ...SECURITY_HEADERS,
      });
      res.write('retry: 3000\n\n');
      res._uid = user.id;
      room.clients.add(res);
      touchPresence(user.id);
      const frame = `event: state\ndata: ${JSON.stringify(roomView(room))}\n\n`;
      try {
        res.write(frame);
      } catch {}
      broadcast(room);
      req.on('close', () => {
        room.clients.delete(res);
        for (const r of room.clients) if (r._uid === user.id) return;
        if (room.status === 'countdown' || room.status === 'playing') {
          clearDisconnectTimer(room, user.id);
          const timer = setTimeout(() => {
            const otherId = room.hostId === user.id ? room.guestId : room.hostId;
            if (!connected(room, user.id) && otherId && (room.status === 'countdown' || room.status === 'playing')) {
              finishRoom(room, 'forfeit', otherId);
            }
          }, 20000);
          if (timer.unref) timer.unref();
          room.disconnectTimers.set(user.id, timer);
          broadcast(room);
        }
      });
      return;
    }
    if (action === 'start' && method === 'POST') {
      await readBody(req);
      if (user.id !== room.hostId) {
        fail(res, 403, 'Тек бөлме иесі ойынды бастай алады', 'NOT_HOST');
        return;
      }
      if (!room.guestId) {
        fail(res, 409, 'Қарсылас күтілуде', 'NO_OPPONENT');
        return;
      }
      if (room.status !== 'waiting') {
        fail(res, 409, 'Ойын басталып кеткен', 'STARTED');
        return;
      }
      beginCountdown(room);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (action === 'answer' && method === 'POST') {
      const body = await readBody(req);
      if (room.status !== 'playing' || room.phase !== 'question') {
        fail(res, 409, 'Қазір жауап беру мүмкін емес', 'NOT_ACCEPTING');
        return;
      }
      if (room.answers[user.id]) {
        fail(res, 409, 'Бұл сұраққа әлдеқашан жауап бердіңіз', 'ANSWERED');
        return;
      }
      if (Number(body.index) !== room.qIndex) {
        fail(res, 409, 'Сұрақ синхрондалмады', 'OUT_OF_SYNC');
        return;
      }
      const choice = Number(body.choice);
      if (!Number.isInteger(choice) || choice < 0 || choice > 3) {
        fail(res, 400, 'Жауап нөмірі дұрыс емес');
        return;
      }
      if (now() > room.deadline + 250) {
        fail(res, 409, 'Уақыт бітті', 'TIMEOUT');
        return;
      }
      const q = room.items[room.qIndex];
      const elapsed = Math.max(0, now() - room.questionStartedAt);
      const correct = choice === q.a;
      const speed = correct
        ? Math.round(50 * Math.max(0, 1 - Math.min(elapsed, DUEL_LIMIT_MS) / DUEL_LIMIT_MS))
        : 0;
      const streakBonus = correct ? Math.min(room.streaks[user.id] || 0, 5) * 10 : 0;
      const points = correct ? 100 + speed + streakBonus : 0;
      room.answers[user.id] = {
        choice,
        correct,
        points,
        ms: Math.min(elapsed, DUEL_LIMIT_MS),
      };
      room.scores[user.id] = (room.scores[user.id] || 0) + points;
      if (correct) {
        room.correct[user.id] = (room.correct[user.id] || 0) + 1;
        room.streaks[user.id] = (room.streaks[user.id] || 0) + 1;
      } else {
        room.streaks[user.id] = 0;
      }
      const ids = roomPlayerIds(room);
      const allAnswered = ids.every((id) => room.answers[id]);
      if (allAnswered) {
        clearRoomTimer(room);
        revealRoom(room, 'both');
      } else {
        broadcast(room);
      }
      sendJson(res, 200, { ok: true, revealed: allAnswered });
      return;
    }
    if (action === 'leave' && method === 'POST') {
      await readBody(req);
      leaveRoom(user.id, room, true);
      sendJson(res, 200, { ok: true });
      return;
    }
    if (action === 'rematch' && method === 'POST') {
      await readBody(req);
      if (room.status !== 'finished') {
        fail(res, 409, 'Матч әлі аяқталған жоқ', 'NOT_FINISHED');
        return;
      }
      if (!room.hostId || !room.guestId) {
        fail(res, 409, 'Қарсылас бөлмеден шықты', 'NO_OPPONENT');
        return;
      }
      room.rematchVotes.add(user.id);
      const ids = roomPlayerIds(room);
      if (ids.every((id) => room.rematchVotes.has(id))) {
        for (const id of ids) {
          const u = rawUser(id);
          if (!u) continue;
          if (room.hostId === id) room.host = playerSnapshot(u);
          else room.guest = playerSnapshot(u);
        }
        resetRoomMatch(room);
      } else {
        broadcast(room);
      }
      sendJson(res, 200, { ok: true, rematchVotes: [...room.rematchVotes] });
      return;
    }
    fail(res, 405, 'Әдіс қолдау көрсетілмейді');
    return;
  }

  fail(res, 404, 'API маршруты табылмады');
}

/* ------------------------------------------------------------------ */
/* Server                                                              */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host || 'localhost';
    const url = new URL(req.url || '/', `http://${host}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
      res.end('Әдіс қолдау көрсетілмейді');
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (err) {
    console.error('request error:', err);
    if (!res.headersSent) {
      const status = err && err.status ? err.status : 500;
      sendJson(res, status, {
        error: status === 500 ? 'Серверде қате кетті. Қайталап көріңіз.' : err.message,
      });
    } else {
      try {
        res.end();
      } catch {}
    }
  }
});

// SSE heartbeat + presence refresh
const heartbeat = setInterval(() => {
  for (const room of rooms.values()) {
    for (const res of [...room.clients]) {
      try {
        res.write(': ping\n\n');
        if (res._uid) touchPresence(res._uid);
      } catch {
        room.clients.delete(res);
      }
    }
  }
}, 20000);
heartbeat.unref();

const janitor = setInterval(() => {
  cleanupRuns();
  pruneQueue();
  const t = now();
  for (const room of [...rooms.values()]) {
    if (room.status === 'finished' && room.finishedAt && t - room.finishedAt > 30 * 60 * 1000) {
      deleteRoom(room);
    } else if (room.status === 'waiting' && t - room.createdAt > 2 * 60 * 60 * 1000) {
      deleteRoom(room);
    }
  }
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(t);
  for (const [key, arr] of rateBuckets) {
    if (!arr.length || t - arr[arr.length - 1] > 60 * 60 * 1000) rateBuckets.delete(key);
  }
}, 60000);
janitor.unref();

db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now());

server.listen(PORT, HOST, () => {
  const nets = os.networkInterfaces();
  const lan = [];
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family === 'IPv4' && !net.internal) lan.push(net.address);
    }
  }
  console.log('');
  console.log('  МАЙСТЕР — майлар мен тағамтану сайысы');
  console.log(`  Жергілікті: http://localhost:${PORT}`);
  for (const ip of lan) console.log(`  Желі:       http://${ip}:${PORT}`);
  console.log(`  Сұрақтар:   ${questions.length}`);
  console.log('');
});

function shutdown() {
  console.log('\nСервер жабылуда…');
  server.close(() => {
    try {
      db.close();
    } catch {}
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
