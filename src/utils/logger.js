const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function logFilePath() {
  const dir = path.join(process.cwd(), 'logs');
  ensureDir(dir);
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return path.join(dir, `sync-${yyyy}-${mm}-${dd}.log`);
}

function write(level, msg, meta) {
  const ts = new Date().toISOString();
  let line = `[${ts}] [${level}] ${msg}`;
  if (meta !== undefined) {
    try {
      line += ' ' + (typeof meta === 'string' ? meta : JSON.stringify(meta));
    } catch {
      // ignore serialization errors
    }
  }
  try {
    fs.appendFileSync(logFilePath(), line + '\n', 'utf8');
  } catch (e) {
    // fallback to console
    // eslint-disable-next-line no-console
    console.error('Logger write failed:', e.message);
  }
}

module.exports = {
  info: (msg, meta) => write('INFO', msg, meta),
  warn: (msg, meta) => write('WARN', msg, meta),
  error: (msg, meta) => write('ERROR', msg, meta),
  debug: (msg, meta) => write('DEBUG', msg, meta),
};
