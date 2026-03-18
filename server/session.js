/**
 * In-memory session for optional Hyper-V credentials (localhost only).
 */

let session = null;

function setSession({ username, password, computerName }) {
  if (!username || !password) {
    session = null;
    return;
  }
  session = {
    username: String(username).trim(),
    password: String(password),
    computerName: (computerName && String(computerName).trim()) || ''
  };
}

function clearSession() {
  session = null;
}

function getSession() {
  return session;
}

function getSessionPublic() {
  if (!session) return { configured: false };
  const u = session.username;
  const masked = u.length <= 2 ? '**' : u.slice(0, 2) + '***';
  return {
    configured: true,
    username: masked,
    computerName: session.computerName || '(local)'
  };
}

function snapshotSession() {
  if (!session) return null;
  return {
    username: session.username,
    password: session.password,
    computerName: session.computerName
  };
}

function restoreSession(snap) {
  if (snap && snap.username && snap.password) {
    session = { ...snap };
  } else {
    session = null;
  }
}

module.exports = {
  setSession,
  clearSession,
  getSession,
  getSessionPublic,
  snapshotSession,
  restoreSession
};
