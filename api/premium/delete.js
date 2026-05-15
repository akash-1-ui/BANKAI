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
      'SELECT pin, password_hash, password_salt FROM premium_accounts WHERE pin = $1',
      [pin]
    );
    const account = result.rows[0];

    if (!account) {
      send(res, 401, { error: 'Account not found.' });
      return;
    }

    const passwordMatches = await verifyPassword(password, account.password_salt, account.password_hash);
    if (!passwordMatches) {
      send(res, 401, { error: 'Password is incorrect. Cannot delete account.' });
      return;
    }

    await getPool().query('DELETE FROM premium_accounts WHERE pin = $1', [pin]);
    send(res, 200, { success: true, message: 'Account successfully deleted.' });
  } catch (error) {
    console.error('Account deletion failed:', error.message);
    send(res, 500, { error: 'Unable to delete account. Please try again.' });
  }
};
