const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Define loadEnvFiles before using it
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
// In-memory fallback storage
const inMemoryStore = {
  premiumAccounts: new Map(),
  data: []
};

let pgPool = null;
let databaseAvailable = false;

// Initialize database connection
if (DATABASE_URL) {
  pgPool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public', { dotfiles: 'deny' }));

// API Routes

let databaseReadyPromise;

async function initializePostgres() {
  if (!pgPool) {
    console.warn('DATABASE_URL is not set. Using in-memory storage.');
    databaseAvailable = false;
    return;
  }

  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS data (
        id BIGSERIAL PRIMARY KEY,
        col1 TEXT,
        col2 TEXT,
        col3 TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

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
    
    databaseAvailable = true;
    console.log('✓ Database connected successfully');
  } catch (error) {
    console.error('⚠️  Database connection failed:', error.message);
    console.log('Falling back to in-memory storage...');
    databaseAvailable = false;
    pgPool = null;
  }
}

function ensureDatabaseReady() {
  if (!databaseReadyPromise) {
    databaseReadyPromise = initializePostgres();
  }

  return databaseReadyPromise;
}



function normalizePIN(pin) {
  return String(pin || '').trim().toUpperCase();
}

function isValidPIN(pin) {
  const normalized = normalizePIN(pin);

  if (normalized.length !== 10) return false;

  return PIN_RANGES.some(range => normalized >= range.start && normalized <= range.end);
}

function requireDatabase(res) {
  // Always allow requests - use database if available, otherwise use in-memory storage
  return true;
}

app.use('/api', async (req, res, next) => {
  try {
    await ensureDatabaseReady();
    next();
  } catch (error) {
    // Don't block requests even if database fails
    console.error('Database error:', error.message);
    next();
  }
});

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
  if (!requireDatabase(res)) return;

  await ensureDatabaseReady();

  const pin = normalizePIN(req.body?.pin);
  const password = String(req.body?.password || '');

  if (!isValidPIN(pin)) {
    return res.status(400).json({ error: 'Invalid or unauthorized PIN.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  try {
    // Check if PIN already exists
    let existing = null;
    
    if (databaseAvailable && pgPool) {
      const result = await pgPool.query('SELECT pin FROM premium_accounts WHERE pin = $1', [pin]);
      existing = result.rowCount > 0;
    } else {
      existing = inMemoryStore.premiumAccounts.has(pin);
    }

    if (existing) {
      return res.status(409).json({ error: 'This PIN already has an account.' });
    }

    const { hash, salt } = await hashPassword(password);

    // Save to database or in-memory
    if (databaseAvailable && pgPool) {
      await pgPool.query(
        `INSERT INTO premium_accounts (pin, password_hash, password_salt, payment_status)
         VALUES ($1, $2, $3, $4)`,
        [pin, hash, salt, 'paused']
      );
    } else {
      inMemoryStore.premiumAccounts.set(pin, {
        pin,
        password_hash: hash,
        password_salt: salt,
        payment_status: 'paused',
        created_at: new Date()
      });
    }

    console.log(`✓ Premium account created for PIN: ${pin} (using ${databaseAvailable ? 'database' : 'in-memory'})`);
    res.json({ success: true, pin });
  } catch (error) {
    console.error('Premium register failed:', error.message);
    res.status(500).json({ error: 'Unable to create account. Please try again.' });
  }
});

app.post('/api/premium/login', async (req, res) => {
  if (!requireDatabase(res)) return;

  await ensureDatabaseReady();

  const pin = normalizePIN(req.body?.pin);
  const password = String(req.body?.password || '');

  if (!pin || !password) {
    return res.status(400).json({ error: 'PIN and password are required.' });
  }

  try {
    let account = null;
    
    if (databaseAvailable && pgPool) {
      const result = await pgPool.query(
        'SELECT pin, password_hash, password_salt, payment_status FROM premium_accounts WHERE pin = $1',
        [pin]
      );
      account = result.rows[0] || null;
    } else {
      account = inMemoryStore.premiumAccounts.get(pin) || null;
    }

    if (!account) {
      return res.status(401).json({ error: 'No account found for this PIN.' });
    }

    const passwordMatches = await verifyPassword(password, account.password_salt, account.password_hash);

    if (!passwordMatches) {
      return res.status(401).json({ error: 'Password does not match.' });
    }

    console.log(`✓ Premium login successful for PIN: ${pin}`);
    res.json({
      success: true,
      pin: account.pin,
      paymentStatus: account.payment_status
    });
  } catch (error) {
    console.error('Premium login failed:', error.message);
    res.status(500).json({ error: 'Unable to verify account. Please try again.' });
  }
});

// DELETE premium account
app.post('/api/premium/delete', async (req, res) => {
  if (!requireDatabase(res)) return;

  await ensureDatabaseReady();

  const pin = normalizePIN(req.body?.pin);
  const password = String(req.body?.password || '');

  if (!pin || !password) {
    return res.status(400).json({ error: 'PIN and password are required.' });
  }

  try {
    let account = null;
    
    if (databaseAvailable && pgPool) {
      const result = await pgPool.query(
        'SELECT pin, password_hash, password_salt FROM premium_accounts WHERE pin = $1',
        [pin]
      );
      account = result.rows[0] || null;
    } else {
      account = inMemoryStore.premiumAccounts.get(pin) || null;
    }

    if (!account) {
      return res.status(401).json({ error: 'Account not found.' });
    }

    // Verify password before deletion
    const passwordMatches = await verifyPassword(password, account.password_salt, account.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Password is incorrect. Cannot delete account.' });
    }

    // Delete the account
    if (databaseAvailable && pgPool) {
      await pgPool.query('DELETE FROM premium_accounts WHERE pin = $1', [pin]);
    } else {
      inMemoryStore.premiumAccounts.delete(pin);
    }

    console.log(`🗑️  Premium account deleted for PIN: ${pin}`);
    res.json({ success: true, message: 'Account successfully deleted.' });
  } catch (error) {
    console.error('Account deletion failed:', error.message);
    res.status(500).json({ error: 'Unable to delete account. Please try again.' });
  }
});

// GET all data
app.get('/api/data', async (req, res) => {
  if (!requireDatabase(res)) return;

  await ensureDatabaseReady();

  try {
    const result = await pgPool.query('SELECT * FROM data ORDER BY id DESC');
    res.json(result.rows);
  } catch (error) {
    console.error('Data fetch failed:', error);
    res.status(500).json({ error: 'Unable to fetch data. Please try again.' });
  }
});

// POST new data (array of {col1, col2, col3})
app.post('/api/data', async (req, res) => {
  if (!requireDatabase(res)) return;

  await ensureDatabaseReady();

  const { data } = req.body; // expect array of objects
  
  if (!Array.isArray(data) || data.length === 0) {
    return res.status(400).json({ error: 'Data must be non-empty array' });
  }

  const client = await pgPool.connect();

  try {
    await client.query('BEGIN');

    for (const row of data) {
      await client.query(
        'INSERT INTO data (col1, col2, col3) VALUES ($1, $2, $3)',
        [row.col1 || '', row.col2 || '', row.col3 || '']
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, inserted: data.length });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Data insert failed:', error);
    res.status(500).json({ error: 'Unable to save data. Please try again.' });
  } finally {
    client.release();
  }
});



// DELETE all data (for testing)
app.delete('/api/data', async (req, res) => {
  if (!requireDatabase(res)) return;

  await ensureDatabaseReady();

  try {
    await pgPool.query('DELETE FROM data');
    res.json({ success: true });
  } catch (error) {
    console.error('Data delete failed:', error);
    res.status(500).json({ error: 'Unable to delete data. Please try again.' });
  }
});

if (require.main === module) {
  ensureDatabaseReady()
    .then(() => {
      app.listen(port, () => {
        console.log(`\n🚀 Server running at http://localhost:${port}`);
        console.log(`📊 Storage: ${databaseAvailable ? '✓ PostgreSQL/Neon' : '💾 In-Memory (local development)'}\n`);
      });
    })
    .catch(error => {
      // Don't exit on error, just log it
      console.error('⚠️  Error during startup:', error.message);
      app.listen(port, () => {
        console.log(`\n🚀 Server running at http://localhost:${port}`);
        console.log(`📊 Storage: 💾 In-Memory (fallback mode)\n`);
      });
    });
}

module.exports = app;
