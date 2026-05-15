const {
  ensureDatabase,
  getPool,
  hashPassword,
  isValidPIN,
  methodNotAllowed,
  normalizePIN,
  readBody,
  send
} = require('../_premium');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    methodNotAllowed(res);
    return;
  }

  try {
    await ensureDatabase();

    const body = await readBody(req);
    const pin = normalizePIN(body.pin);
    const password = String(body.password || '');

    if (!isValidPIN(pin)) {
      send(res, 400, { error: 'Invalid or unauthorized PIN.' });
      return;
    }

    if (password.length < 6) {
      send(res, 400, { error: 'Password must be at least 6 characters.' });
      return;
    }

    const existing = await getPool().query('SELECT pin FROM premium_accounts WHERE pin = $1', [pin]);
    if (existing.rowCount > 0) {
      send(res, 409, { error: 'This PIN already has an account.' });
      return;
    }

    const { hash, salt } = await hashPassword(password);

    await getPool().query(
      `INSERT INTO premium_accounts (pin, password_hash, password_salt, payment_status)
       VALUES ($1, $2, $3, $4)`,
      [pin, hash, salt, 'paused']
    );

    send(res, 200, { success: true, pin });
  } catch (error) {
    console.error('Premium register failed:', error.message);
    send(res, 500, { error: 'Unable to create account. Please try again.' });
  }
};
