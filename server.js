const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const path = require('path');

const app = express();
const port = 3000;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

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

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log(`Database: ${dbPath}`);
});
