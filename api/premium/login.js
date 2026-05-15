const {
  ensureDatabase,
  getPool,
  methodNotAllowed,
  normalizePIN,
  readBody,
  send,
  verifyPassword
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

    if (!pin || !password) {
      send(res, 400, { error: 'PIN and password are required.' });
      return;
    }

    const result = await getPool().query(
      'SELECT pin, password_hash, password_salt, payment_status FROM premium_accounts WHERE pin = $1',
      [pin]
    );
    const account = result.rows[0];

    if (!account) {
      send(res, 401, { error: 'No account found for this PIN.' });
      return;
    }

    const passwordMatches = await verifyPassword(password, account.password_salt, account.password_hash);
    if (!passwordMatches) {
      send(res, 401, { error: 'Password does not match.' });
      return;
    }

    send(res, 200, {
      success: true,
      pin: account.pin,
      paymentStatus: account.payment_status
    });
  } catch (error) {
    console.error('Premium login failed:', error.message);
    send(res, 500, { error: 'Unable to verify account. Please try again.' });
  }
};
