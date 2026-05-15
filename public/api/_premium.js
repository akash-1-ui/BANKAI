const { Pool } = require('pg');
const crypto = require('crypto');

const PIN_RANGES = [
  { start: '23XZ1A0501', end: '23XZ1A0526' },
  { start: '24XZ5A0501', end: '24XZ5A0517' }
];

let pool;
let readyPromise;

function getPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not configured.');
  }

  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
  }

  return pool;
}

function ensureDatabase() {
  if (!readyPromise) {
    readyPromise = getPool().query(`
      CREATE TABLE IF NOT EXISTS premium_accounts (
        pin TEXT PRIMARY KEY,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        payment_status TEXT NOT NULL DEFAULT 'paused',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
  }

  return readyPromise;
}

function normalizePIN(pin) {
  return String(pin || '').trim().toUpperCase();
}

function isValidPIN(pin) {
  const normalized = normalizePIN(pin);
  return normalized.length === 10 && PIN_RANGES.some(range => normalized >= range.start && normalized <= range.end);
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(String(password), salt, 120000, 64, 'sha512', (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({ salt, hash: derivedKey.toString('hex') });
    });
  });
}

async function verifyPassword(password, salt, expectedHash) {
  const { hash } = await hashPassword(password, salt);
  const actual = Buffer.from(hash, 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function methodNotAllowed(res) {
  send(res, 405, { error: 'Method not allowed.' });
}

module.exports = {
  ensureDatabase,
  getPool,
  hashPassword,
  isValidPIN,
  methodNotAllowed,
  normalizePIN,
  readBody,
  send,
  verifyPassword
};
