const fs = require('fs');
const path = require('path');
const { USERS_FILE_PATH } = require('./config');

const LAST_RESET_KEY = '__lastResetAt__';

function ensureDir() {
  fs.mkdirSync(path.dirname(USERS_FILE_PATH), { recursive: true });
}

function loadRaw() {
  if (!fs.existsSync(USERS_FILE_PATH)) return { users: {}, [LAST_RESET_KEY]: null };
  try {
    const data = JSON.parse(fs.readFileSync(USERS_FILE_PATH, 'utf8'));
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      // New format with metadata is identified by the presence of the metadata key
      if (data[LAST_RESET_KEY] !== undefined && data.users && typeof data.users === 'object') {
        return { users: migrateUsers(data.users), [LAST_RESET_KEY]: data[LAST_RESET_KEY] || null };
      }
      // Old format: plain { name: { password, createdAt } }
      return { users: migrateUsers(data), [LAST_RESET_KEY]: null };
    }
  } catch {
    // fall through
  }
  return { users: {}, [LAST_RESET_KEY]: null };
}

function saveRaw(users, lastResetAt) {
  ensureDir();
  const payload = { users, [LAST_RESET_KEY]: lastResetAt };
  fs.writeFileSync(USERS_FILE_PATH, JSON.stringify(payload, null, 2), 'utf8');
}

function migrateUsers(users) {
  const result = {};
  for (const [name, user] of Object.entries(users)) {
    if (!user || typeof user !== 'object') continue;
    result[name] = {
      password: user.password || '',
      reputation: typeof user.reputation === 'number' ? user.reputation : 0,
      createdAt: user.createdAt || new Date().toISOString()
    };
  }
  return result;
}

function getByteLength(str) {
  return Buffer.byteLength(str, 'utf8');
}

function validateName(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return { error: '请输入昵称' };
  if (getByteLength(trimmed) > 10) return { error: '昵称不能超过 10 个字节' };
  return { name: trimmed };
}

function validatePassword(password) {
  if (!password) return { error: '请输入密码' };
  if (!/^\d{6}$/.test(password)) return { error: '密码必须是 6 位数字' };
  return { password };
}

function register(name, password) {
  const nameCheck = validateName(name);
  if (nameCheck.error) return { error: nameCheck.error };

  const pwdCheck = validatePassword(password);
  if (pwdCheck.error) return { error: pwdCheck.error };

  const { users, [LAST_RESET_KEY]: lastResetAt } = loadRaw();
  if (users[nameCheck.name]) return { error: '该昵称已被注册' };

  users[nameCheck.name] = {
    password: pwdCheck.password,
    reputation: 0,
    createdAt: new Date().toISOString()
  };
  saveRaw(users, lastResetAt);

  return { success: true, name: nameCheck.name, reputation: 0 };
}

function login(name, password) {
  const nameCheck = validateName(name);
  if (nameCheck.error) return { error: nameCheck.error };

  const pwdCheck = validatePassword(password);
  if (pwdCheck.error) return { error: pwdCheck.error };

  const { users } = loadRaw();
  const user = users[nameCheck.name];
  if (!user) return { error: '账号不存在' };
  if (user.password !== pwdCheck.password) return { error: '密码错误' };

  return { success: true, name: nameCheck.name, reputation: user.reputation };
}

function getReputation(name) {
  const { users } = loadRaw();
  const user = users[name];
  return typeof user?.reputation === 'number' ? Math.max(0, user.reputation) : 0;
}

function applyReputationChanges(changes) {
  if (!changes || changes.length === 0) return {};
  const { users, [LAST_RESET_KEY]: lastResetAt } = loadRaw();
  const result = {};
  for (const { name, delta } of changes) {
    const user = users[name];
    if (!user) continue;
    user.reputation = Math.max(0, (user.reputation || 0) + delta);
    result[name] = user.reputation;
  }
  saveRaw(users, lastResetAt);
  return result;
}

function getReputationRanking(viewerName) {
  const { users } = loadRaw();
  const all = Object.entries(users)
    .map(([name, user], index) => ({
      name,
      reputation: Math.max(0, user.reputation || 0),
      originalIndex: index
    }))
    .sort((a, b) => {
      if (b.reputation !== a.reputation) return b.reputation - a.reputation;
      return a.originalIndex - b.originalIndex;
    });

  const ranking = all.map((entry, idx) => ({
    rank: idx + 1,
    name: entry.name,
    reputation: entry.reputation
  }));

  const viewerEntry = ranking.find(r => r.name === viewerName);
  const viewerRank = viewerEntry ? viewerEntry.rank : null;

  return { ranking, viewerRank };
}

// 转换为北京时间（UTC+8）的日期，不依赖服务器时区设置
function toBeijingDate(d) {
  const offsetMs = (d.getTimezoneOffset() + 480) * 60 * 1000;
  const beijing = new Date(d.getTime() + offsetMs);
  return new Date(beijing.getFullYear(), beijing.getMonth(), beijing.getDate());
}

function getBeijingToday() {
  return toBeijingDate(new Date());
}

function getLastResetDate(lastResetAt) {
  if (!lastResetAt) return null;
  const d = new Date(lastResetAt);
  if (isNaN(d.getTime())) return null;
  return toBeijingDate(d);
}

function resetAllReputationIfNeeded() {
  const { users, [LAST_RESET_KEY]: lastResetAt } = loadRaw();
  const today = getBeijingToday();
  const lastResetDate = getLastResetDate(lastResetAt);

  if (!lastResetDate || lastResetDate.getTime() < today.getTime()) {
    for (const user of Object.values(users)) {
      user.reputation = 0;
    }
    const now = new Date().toISOString();
    saveRaw(users, now);
    console.log('[reputation] Daily reset applied at', now, '(Beijing)');
    return true;
  }
  return false;
}

function getMsUntilNextReset() {
  const now = new Date();
  const offsetMs = (now.getTimezoneOffset() + 480) * 60 * 1000;
  const beijingNow = new Date(now.getTime() + offsetMs);
  const beijingNext = new Date(beijingNow.getFullYear(), beijingNow.getMonth(), beijingNow.getDate() + 1);
  return beijingNext.getTime() - offsetMs - now.getTime();
}

function scheduleDailyReset() {
  const delay = getMsUntilNextReset();
  console.log(`[reputation] Next daily reset scheduled in ${Math.round(delay / 1000)}s`);

  setTimeout(() => {
    resetAllReputationIfNeeded();
    scheduleDailyReset();
  }, delay);
}

module.exports = {
  register,
  login,
  getReputation,
  applyReputationChanges,
  getReputationRanking,
  resetAllReputationIfNeeded,
  scheduleDailyReset
};
