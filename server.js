const express = require('express');
const sqlite3 = require('sqlite3').verbose();
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
const RAZORPAY_AMOUNT_PAISE = 5000;
const RAZORPAY_CURRENCY = 'INR';
const RAZORPAY_DISPLAY_NAME = process.env.RAZORPAY_DISPLAY_NAME || 'Micromize';
const pendingRazorpayOrders = new Map();

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

function getRazorpayConfig() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;

  if (!keyId || !keySecret) {
    return null;
  }

  return { keyId, keySecret };
}

function prunePendingRazorpayOrders() {
  const expiryMs = 30 * 60 * 1000;
  const now = Date.now();

  for (const [orderId, order] of pendingRazorpayOrders.entries()) {
    if (now - order.createdAt > expiryMs) {
      pendingRazorpayOrders.delete(orderId);
    }
  }
}

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

// Create a Razorpay order for premium access.
app.post('/api/razorpay/order', async (req, res) => {
  const razorpay = getRazorpayConfig();

  if (!razorpay) {
    return res.status(500).json({
      error: 'Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET before taking payments.'
    });
  }

  prunePendingRazorpayOrders();

  const userPin = String(req.body?.pin || '').trim().toUpperCase();
  const receipt = `premium_${Date.now()}`;
  const authToken = Buffer.from(`${razorpay.keyId}:${razorpay.keySecret}`).toString('base64');

  try {
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: RAZORPAY_AMOUNT_PAISE,
        currency: RAZORPAY_CURRENCY,
        receipt,
        notes: {
          pin: userPin,
          plan: 'Lifetime Unlimited Access'
        }
      })
    });

    const order = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: order.error?.description || 'Unable to create Razorpay order.'
      });
    }

    pendingRazorpayOrders.set(order.id, {
      amount: order.amount,
      currency: order.currency,
      pin: userPin,
      createdAt: Date.now()
    });

    res.json({
      id: order.id,
      amount: order.amount,
      currency: order.currency,
      key: razorpay.keyId,
      displayName: RAZORPAY_DISPLAY_NAME
    });
  } catch (error) {
    res.status(500).json({ error: 'Unable to connect to Razorpay. Please try again.' });
  }
});

// Verify Razorpay Checkout's signature before granting access.
app.post('/api/razorpay/verify', (req, res) => {
  const razorpay = getRazorpayConfig();

  if (!razorpay) {
    return res.status(500).json({ error: 'Razorpay is not configured.' });
  }

  const {
    razorpay_order_id: orderId,
    razorpay_payment_id: paymentId,
    razorpay_signature: signature
  } = req.body || {};

  if (!orderId || !paymentId || !signature) {
    return res.status(400).json({ error: 'Missing Razorpay payment verification fields.' });
  }

  const pendingOrder = pendingRazorpayOrders.get(orderId);

  if (!pendingOrder) {
    return res.status(400).json({ error: 'Payment order expired or was not created by this server.' });
  }

  const expectedSignature = crypto
    .createHmac('sha256', razorpay.keySecret)
    .update(`${orderId}|${paymentId}`)
    .digest('hex');

  if (expectedSignature !== signature) {
    return res.status(400).json({ error: 'Payment signature verification failed.' });
  }

  pendingRazorpayOrders.delete(orderId);
  res.json({ success: true });
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

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(`Database: ${dbPath}`);
});
