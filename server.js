const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

loadEnvFiles([
  path.join(__dirname, '.env'),
  path.join(__dirname, 'public', '.env')
]);

const app = express();
const port = Number(process.env.PORT) || 3000;
const DATABASE_URL = process.env.DATABASE_URL;
const PIN_RANGES = [
  { start: '23XZ1A0501', end: '23XZ1A0526' },
  { start: '24XZ5A0501', end: '24XZ5A0517' }
];
const pgPool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    })
  : null;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public', { dotfiles: 'deny' }));

// Database setup
const dbPath = path.join(__dirname, 'database.db');
const db = new sqlite3.Database(dbPath);

// Initialize table
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    col1 TEXT,
    col2 TEXT,
    col3 TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// API Routes

async function initializePostgres() {
  if (!pgPool) {
    console.warn('DATABASE_URL is not set. Premium account database APIs are disabled.');
    return;
  }

  await pgPool.query(`
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

function loadEnvFiles(envPaths) {
  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) {
      continue;
    }

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }

      const match = trimmed.match(/^([\w.-]+)\s*=\s*(.*)$/);

      if (!match) {
        continue;
      }

      const [, key, rawValue] = match;

      if (process.env[key] !== undefined) {
        continue;
      }

      let value = rawValue.trim();
      const isQuoted = (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"));

      if (isQuoted) {
        value = value.slice(1, -1);
      }

      process.env[key] = value;
    }
  }
}



function normalizePIN(pin) {
  return String(pin || '').trim().toUpperCase();
}

function isValidPIN(pin) {
  const normalized = normalizePIN(pin);

  if (normalized.length !== 10) return false;

  return PIN_RANGES.some(range => normalized >= range.start && normalized <= range.end);
}

function requirePremiumDatabase(res) {
  if (!pgPool) {
    res.status(503).json({ error: 'Premium account database is not configured.' });
    return false;
  }

  return true;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(String(password), salt, 120000, 64, 'sha512', (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve({
        salt,
        hash: derivedKey.toString('hex')
      });
    });
  });
}

async function verifyPassword(password, salt, expectedHash) {
  const { hash } = await hashPassword(password, salt);
  const actual = Buffer.from(hash, 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

app.post('/api/premium/register', async (req, res) => {
  if (!requirePremiumDatabase(res)) return;

  const pin = normalizePIN(req.body?.pin);
  const password = String(req.body?.password || '');

  if (!isValidPIN(pin)) {
    return res.status(400).json({ error: 'Invalid or unauthorized PIN.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  try {
    const existing = await pgPool.query('SELECT pin FROM premium_accounts WHERE pin = $1', [pin]);

    if (existing.rowCount > 0) {
      return res.status(409).json({ error: 'This PIN already has an account.' });
    }

    const { hash, salt } = await hashPassword(password);

    await pgPool.query(
      `INSERT INTO premium_accounts (pin, password_hash, password_salt, payment_status)
       VALUES ($1, $2, $3, $4)`,
      [pin, hash, salt, 'paused']
    );

    res.json({ success: true, pin });
  } catch (error) {
    console.error('Premium register failed:', error);
    res.status(500).json({ error: 'Unable to create account. Please try again.' });
  }
});

app.post('/api/premium/login', async (req, res) => {
  if (!requirePremiumDatabase(res)) return;

  const pin = normalizePIN(req.body?.pin);
  const password = String(req.body?.password || '');

  if (!pin || !password) {
    return res.status(400).json({ error: 'PIN and password are required.' });
  }

  try {
    const result = await pgPool.query(
      'SELECT pin, password_hash, password_salt, payment_status FROM premium_accounts WHERE pin = $1',
      [pin]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ error: 'No account found for this PIN.' });
    }

    const account = result.rows[0];
    const passwordMatches = await verifyPassword(password, account.password_salt, account.password_hash);

    if (!passwordMatches) {
      return res.status(401).json({ error: 'Password does not match.' });
    }

    res.json({
      success: true,
      pin: account.pin,
      paymentStatus: account.payment_status
    });
  } catch (error) {
    console.error('Premium login failed:', error);
    res.status(500).json({ error: 'Unable to verify account. Please try again.' });
  }
});

// GET all data
app.get('/api/data', (req, res) => {
  db.all('SELECT * FROM data ORDER BY id DESC', (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// POST new data (array of {col1, col2, col3})
app.post('/api/data', (req, res) => {
  const { data } = req.body; // expect array of objects
  
  if (!Array.isArray(data) || data.length === 0) {
    return res.status(400).json({ error: 'Data must be non-empty array' });
  }

  const stmt = db.prepare('INSERT INTO data (col1, col2, col3) VALUES (?, ?, ?)');
  
  db.serialize(() => {
    db.run('BEGIN TRANSACTION');
    
    let inserted = 0;
    data.forEach(row => {
      stmt.run(row.col1 || '', row.col2 || '', row.col3 || '');
      inserted++;
    });
    
    stmt.finalize(() => {
      db.run('COMMIT', (err) => {
        if (err) {
          db.run('ROLLBACK');
          res.status(500).json({ error: err.message });
        } else {
          res.json({ success: true, inserted: inserted });
        }
      });
    });
  });
});



// DELETE all data (for testing)
app.delete('/api/data', (req, res) => {
  db.run('DELETE FROM data', (err) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ success: true });
    }
  });
});

initializePostgres()
  .then(() => {
    app.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
      console.log(`SQLite database: ${dbPath}`);
      console.log(`Premium database: ${pgPool ? 'PostgreSQL / Neon' : 'disabled'}`);
    });
  })
  .catch(error => {
    console.error('Failed to initialize premium database:', error);
    process.exit(1);
  });
