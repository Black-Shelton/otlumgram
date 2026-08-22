require('dotenv').config();
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'otlumgram-secret-2024';

app.use(express.json({ limit: '10mb' }));

// Serve ONLY these client files — never the whole project root. The old
// version used express.static(__dirname), which let anyone download
// server.js, database.js, 001_initial.sql and .env straight from the URL.
// Serve ONLY these client files — never the whole project root
const PUBLIC_FILES = {
    '/style.css': 'style.css',
    '/script.js': 'script.js',
    '/sw.js': 'sw.js',
    '/manifest.json': 'manifest.json',
    '/offline.html': 'offline.html',
    '/icon-192.png': 'icon-192.png',
    '/icon-512.png': 'icon-512.png'
};
app.use((req, res, next) => {
    const file = PUBLIC_FILES[req.path];
    if (file) {
        return res.sendFile(path.join(__dirname, file));
    }
    next();
});

// Init DB on startup
db.migrate().then(() => db.initDevUser()).catch(console.error);

// ========== MIDDLEWARE ==========
function auth(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Unauthorized' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch { return res.status(401).json({ error: 'Invalid token' }); }
}

function requireAdmin(req, res, next) {
    if (!req.user?.isAdmin && !req.user?.isDev) return res.status(403).json({ error: 'Admin required' });
    next();
}

function requireDev(req, res, next) {
    if (!req.user?.isDev) return res.status(403).json({ error: 'Dev required' });
    next();
}

function canWrite(user) {
    if (user.isDev) return true;
    if (user.isBanned || user.isScam) return false;
    return true;
}

function rowToUser(row) {
    if (!row) return null;
    // NOTE: password hash is intentionally NOT included here — it must
    // never be sent to the client, even hashed.
    return {
        id: row.id, username: row.username,
        fullname: row.fullname, email: row.email, phone: row.phone,
        avatar: row.avatar, avatarData: row.avatar_data,
        premiumNick: row.premium_nick, isPremium: !!row.is_premium,
        isAdmin: !!row.is_admin, isDev: !!row.is_dev,
        isBanned: !!row.is_banned, isScam: !!row.is_scam,
        banReason: row.ban_reason, banDate: row.ban_date,
        banExpiry: row.ban_expiry, bannedBy: row.banned_by,
        bannedByRole: row.banned_by_role, createdAt: row.created_at
    };
}

function getUserTag(user) {
    if (!user) return { class: 'tag-member', text: '💠 Участник' };
    if (user.isBanned) return { class: 'tag-banned', text: '⛔️ Забанен' };
    if (user.isScam) return { class: 'tag-scam', text: '🚫 Скам' };
    if (user.isPremium) return { class: 'tag-premium', text: '⭐️ Премиум' };
    if (user.isAdmin) return { class: 'tag-admin', text: '⚡️ Админ' };
    if (user.isDev) return { class: 'tag-creator', text: '🔱 Создатель' };
    return { class: 'tag-member', text: '💠 Участник' };
}

async function logAction(userId, action, type = 'general') {
    await db.run('INSERT INTO logs (user_id, action, type) VALUES (?, ?, ?)', [userId || null, action, type]);
}

// ========== AUTH ==========
app.post('/api/auth/register', async (req, res) => {
    const { fullname, username, password, email, phone } = req.body;
    if (!username || !password || !phone) return res.status(400).json({ error: 'Заполните обязательные поля' });

    const countRow = await db.get('SELECT COUNT(*) as c FROM users');
    if (countRow.c >= 100) return res.status(400).json({ error: 'Лимит аккаунтов на сервере' });

    const exists = await db.get('SELECT 1 FROM users WHERE username = ?', [username]);
    if (exists) return res.status(400).json({ error: 'Пользователь существует' });

    const hash = bcrypt.hashSync(password, 10);
    const result = await db.runGetLastId(
        'INSERT INTO users (username, password, fullname, email, phone) VALUES (?, ?, ?, ?, ?)',
        [username, hash, fullname || username, email || '', phone]
    );
    await db.run('INSERT INTO user_balances (user_id, balance) VALUES (?, 0)', [result.lastID]);
    await logAction(result.lastID, 'register');
    res.json({ success: true });
});

app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const row = await db.get('SELECT * FROM users WHERE username = ?', [username]);
    if (!row || !bcrypt.compareSync(password, row.password)) return res.status(401).json({ error: 'Неверный логин или пароль' });
    if (row.is_banned) return res.status(403).json({ error: 'banned', user: rowToUser(row) });

    const token = jwt.sign({ id: row.id, username: row.username, isAdmin: !!row.is_admin, isDev: !!row.is_dev }, JWT_SECRET, { expiresIn: '7d' });
    await logAction(row.id, 'login');
    res.json({ token, user: rowToUser(row) });
});

app.get('/api/auth/me', auth, async (req, res) => {
    const row = await db.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ user: rowToUser(row) });
});

// ========== USERS ==========
app.get('/api/users', auth, async (req, res) => {
    const rows = await db.query('SELECT id, username, fullname, avatar, is_premium, is_admin, is_dev, is_banned, is_scam FROM users');
    res.json({ users: rows.map(rowToUser) });
});

app.get('/api/users/search', auth, async (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    const rows = await db.query(
        'SELECT id, username, fullname, avatar, is_premium, is_admin, is_dev, is_banned, is_scam FROM users WHERE LOWER(username) LIKE ? OR LOWER(fullname) LIKE ?',
        [`%${q}%`, `%${q}%`]
    );
    res.json({ users: rows.map(rowToUser) });
});

app.get('/api/users/:id', auth, async (req, res) => {
    const row = await db.get('SELECT id, username, fullname, avatar, is_premium, is_admin, is_dev, is_banned, is_scam FROM users WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ user: rowToUser(row) });
});

app.put('/api/users/me', auth, async (req, res) => {
    const { fullname, username, avatar, avatarData, premiumNick } = req.body;
    await db.run('UPDATE users SET fullname = ?, username = ?, avatar = ?, avatar_data = ?, premium_nick = ? WHERE id = ?',
        [fullname || '', username || '', avatar || '👤', avatarData || null, premiumNick || null, req.user.id]);
    res.json({ success: true });
});

// ========== BALANCE ==========
app.get('/api/balance', auth, async (req, res) => {
    const row = await db.get('SELECT balance FROM user_balances WHERE user_id = ?', [req.user.id]);
    res.json({ balance: row?.balance || 0 });
});

// ========== BLACKLIST ==========
app.get('/api/blacklist', auth, async (req, res) => {
    const rows = await db.query(
        'SELECT u.id, u.username, u.fullname, u.avatar FROM blacklist b JOIN users u ON b.blocked_user_id = u.id WHERE b.user_id = ?',
        [req.user.id]
    );
    res.json({ list: rows.map(rowToUser) });
});

app.post('/api/blacklist/:id', auth, async (req, res) => {
    const targetId = parseInt(req.params.id);
    if (targetId === req.user.id) return res.status(400).json({ error: 'Нельзя добавить себя' });
    await db.run('INSERT OR IGNORE INTO blacklist (user_id, blocked_user_id) VALUES (?, ?)', [req.user.id, targetId]);
    res.json({ success: true });
});

app.delete('/api/blacklist/:id', auth, async (req, res) => {
    await db.run('DELETE FROM blacklist WHERE user_id = ? AND blocked_user_id = ?', [req.user.id, req.params.id]);
    res.json({ success: true });
});

async function isBlacklisted(userId, targetId) {
    const row = await db.get('SELECT 1 FROM blacklist WHERE user_id = ? AND blocked_user_id = ?', [userId, targetId]);
    return !!row;
}

// ========== NEWS ==========
app.get('/api/news', auth, async (req, res) => {
    const rows = await db.query('SELECT * FROM news ORDER BY id DESC');
    res.json({ news: rows });
});

app.post('/api/news', auth, requireAdmin, async (req, res) => {
    const { title, text } = req.body;
    if (!title || !text) return res.status(400).json({ error: 'Заполните поля' });
    await db.run('INSERT INTO news (title, text, date) VALUES (?, ?, ?)', [title, text, new Date().toLocaleDateString()]);
    res.json({ success: true });
});

// ========== OFFICIAL ==========
app.get('/api/official', auth, async (req, res) => {
    const rows = await db.query(`SELECT o.*, u.username as author_username, u.fullname as author_fullname, u.avatar as author_avatar,
        u.is_premium, u.is_admin, u.is_dev, u.is_banned, u.is_scam FROM official_messages o
        LEFT JOIN users u ON o.author_id = u.id ORDER BY o.id DESC`);
    res.json({ messages: rows });
});

app.post('/api/official', auth, requireDev, async (req, res) => {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Пустое сообщение' });
    await db.run('INSERT INTO official_messages (author_id, text) VALUES (?, ?)', [req.user.id, text]);
    res.json({ success: true });
});

// ========== CHANNELS ==========
app.get('/api/channels', auth, async (req, res) => {
    const rows = await db.query(`SELECT c.*, u.username as owner_username, u.fullname as owner_fullname,
        u.avatar as owner_avatar, u.is_premium, u.is_admin, u.is_dev, u.is_banned, u.is_scam,
        (SELECT COUNT(*) FROM channel_subscribers WHERE channel_id = c.id) as subscribers_count
        FROM channels c JOIN users u ON c.owner_id = u.id ORDER BY c.id DESC`);
    res.json({ channels: rows });
});

app.post('/api/channels', auth, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Бан/скам' });
    const { name, avatar, customLink } = req.body;
    if (!name) return res.status(400).json({ error: 'Название обязательно' });

    const link = customLink ? customLink.toLowerCase().replace(/[^a-z0-9_]/g, '_') : name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now();
    const exists = await db.get('SELECT 1 FROM channels WHERE link = ?', [link]);
    if (exists) return res.status(400).json({ error: 'Ссылка занята' });

    const result = await db.runGetLastId(
        'INSERT INTO channels (name, link, owner_id, avatar) VALUES (?, ?, ?, ?)',
        [name, link, req.user.id, avatar || '📢']
    );
    await db.run('INSERT INTO channel_subscribers (channel_id, user_id) VALUES (?, ?)', [result.lastID, req.user.id]);
    await db.run('INSERT INTO channel_links (link, channel_id) VALUES (?, ?)', [link, result.lastID]);
    res.json({ success: true, id: result.lastID });
});

app.get('/api/channels/:id', auth, async (req, res) => {
    const channel = await db.get(`SELECT c.*, u.username as owner_username, u.fullname as owner_fullname,
        u.avatar as owner_avatar, u.is_premium, u.is_admin, u.is_dev, u.is_banned, u.is_scam
        FROM channels c JOIN users u ON c.owner_id = u.id WHERE c.id = ?`, [req.params.id]);
    if (!channel) return res.status(404).json({ error: 'Not found' });
    const subs = await db.query('SELECT user_id FROM channel_subscribers WHERE channel_id = ?', [req.params.id]);
    const isSubscribed = subs.some(s => s.user_id === req.user.id);
    res.json({ channel: { ...channel, subscribers: subs.map(s => s.user_id), isSubscribed } });
});

app.post('/api/channels/:id/subscribe', auth, async (req, res) => {
    const ch = await db.get('SELECT * FROM channels WHERE id = ?', [req.params.id]);
    if (!ch) return res.status(404).json({ error: 'Not found' });
    const countRow = await db.get('SELECT COUNT(*) as c FROM channel_subscribers WHERE channel_id = ?', [req.params.id]);
    if (countRow.c >= ch.max_subscribers) return res.status(400).json({ error: 'Лимит подписчиков' });
    await db.run('INSERT OR IGNORE INTO channel_subscribers (channel_id, user_id) VALUES (?, ?)', [req.params.id, req.user.id]);
    res.json({ success: true });
});

app.delete('/api/channels/:id/subscribe', auth, async (req, res) => {
    await db.run('DELETE FROM channel_subscribers WHERE channel_id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ success: true });
});

app.get('/api/channels/:id/messages', auth, async (req, res) => {
    const rows = await db.query(`SELECT m.*, u.username, u.fullname, u.avatar, u.is_premium, u.is_admin, u.is_dev, u.is_banned, u.is_scam
        FROM messages m JOIN users u ON m.user_id = u.id
        WHERE m.target_type = 'channel' AND m.target_id = ? ORDER BY m.id ASC`, [req.params.id]);

    const msgIds = rows.map(r => r.id);
    let reactions = {};
    if (msgIds.length) {
        const placeholders = msgIds.map(() => '?').join(',');
        const rrows = await db.query(`SELECT r.*, u.username as reactor_name FROM reactions r 
            JOIN users u ON r.user_id = u.id WHERE r.message_id IN (${placeholders})`, msgIds);
        for (const r of rrows) {
            if (!reactions[r.message_id]) reactions[r.message_id] = {};
            if (!reactions[r.message_id][r.emoji]) reactions[r.message_id][r.emoji] = [];
            reactions[r.message_id][r.emoji].push(r.reactor_name);
        }
    }
    res.json({ messages: rows.map(r => ({ ...r, reactions: reactions[r.id] || {} })) });
});

app.post('/api/channels/:id/messages', auth, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Бан/скам' });
    const ch = await db.get('SELECT * FROM channels WHERE id = ?', [req.params.id]);
    if (!ch) return res.status(404).json({ error: 'Not found' });
    if (ch.owner_id !== req.user.id) return res.status(403).json({ error: 'Только создатель может писать' });
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Пустое сообщение' });
    const result = await db.runGetLastId('INSERT INTO messages (target_type, target_id, user_id, text) VALUES (?, ?, ?, ?)',
        ['channel', req.params.id, req.user.id, text]);
    res.json({ success: true, id: result.lastID });
});

// ========== GROUPS ==========
app.get('/api/groups', auth, async (req, res) => {
    const rows = await db.query(`SELECT g.*, u.username as owner_username, u.fullname as owner_fullname,
        u.avatar as owner_avatar, u.is_premium, u.is_admin, u.is_dev, u.is_banned, u.is_scam,
        (SELECT COUNT(*) FROM group_members WHERE group_id = g.id) as members_count
        FROM groups_table g JOIN users u ON g.owner_id = u.id ORDER BY g.id DESC`);
    res.json({ groups: rows });
});

app.post('/api/groups', auth, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Бан/скам' });
    const { name, avatar } = req.body;
    if (!name) return res.status(400).json({ error: 'Название обязательно' });
    const result = await db.runGetLastId('INSERT INTO groups_table (name, owner_id, avatar) VALUES (?, ?, ?)',
        [name, req.user.id, avatar || '👥']);
    await db.run('INSERT INTO group_members (group_id, user_id) VALUES (?, ?)', [result.lastID, req.user.id]);
    res.json({ success: true, id: result.lastID });
});

app.get('/api/groups/:id', auth, async (req, res) => {
    const group = await db.get(`SELECT g.*, u.username as owner_username, u.fullname as owner_fullname,
        u.avatar as owner_avatar, u.is_premium, u.is_admin, u.is_dev, u.is_banned, u.is_scam
        FROM groups_table g JOIN users u ON g.owner_id = u.id WHERE g.id = ?`, [req.params.id]);
    if (!group) return res.status(404).json({ error: 'Not found' });
    const members = await db.query('SELECT user_id FROM group_members WHERE group_id = ?', [req.params.id]);
    res.json({ group: { ...group, members: members.map(m => m.user_id), isMember: members.some(m => m.user_id === req.user.id) } });
});

app.post('/api/groups/:id/join', auth, async (req, res) => {
    await db.run('INSERT OR IGNORE INTO group_members (group_id, user_id) VALUES (?, ?)', [req.params.id, req.user.id]);
    res.json({ success: true });
});

app.delete('/api/groups/:id/leave', auth, async (req, res) => {
    const group = await db.get('SELECT owner_id FROM groups_table WHERE id = ?', [req.params.id]);
    if (group?.owner_id === req.user.id) return res.status(400).json({ error: 'Создатель не может покинуть' });
    await db.run('DELETE FROM group_members WHERE group_id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ success: true });
});

app.get('/api/groups/:id/messages', auth, async (req, res) => {
    const rows = await db.query(`SELECT m.*, u.username, u.fullname, u.avatar, u.is_premium, u.is_admin, u.is_dev, u.is_banned, u.is_scam
        FROM messages m JOIN users u ON m.user_id = u.id
        WHERE m.target_type = 'group' AND m.target_id = ? ORDER BY m.id ASC`, [req.params.id]);
    const msgIds = rows.map(r => r.id);
    let reactions = {};
    if (msgIds.length) {
        const placeholders = msgIds.map(() => '?').join(',');
        const rrows = await db.query(`SELECT r.*, u.username as reactor_name FROM reactions r 
            JOIN users u ON r.user_id = u.id WHERE r.message_id IN (${placeholders})`, msgIds);
        for (const r of rrows) {
            if (!reactions[r.message_id]) reactions[r.message_id] = {};
            if (!reactions[r.message_id][r.emoji]) reactions[r.message_id][r.emoji] = [];
            reactions[r.message_id][r.emoji].push(r.reactor_name);
        }
    }
    res.json({ messages: rows.map(r => ({ ...r, reactions: reactions[r.id] || {} })) });
});

app.post('/api/groups/:id/messages', auth, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Бан/скам' });
    const member = await db.get('SELECT 1 FROM group_members WHERE group_id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!member) return res.status(403).json({ error: 'Вы не в группе' });
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Пустое сообщение' });
    const result = await db.runGetLastId('INSERT INTO messages (target_type, target_id, user_id, text) VALUES (?, ?, ?, ?)',
        ['group', req.params.id, req.user.id, text]);
    res.json({ success: true, id: result.lastID });
});

// ========== CHATS ==========
app.get('/api/chats', auth, async (req, res) => {
    const rows = await db.query(`SELECT c.*, u.username as owner_username, u.fullname as owner_fullname,
        u.avatar as owner_avatar, u.is_premium, u.is_admin, u.is_dev, u.is_banned, u.is_scam,
        (SELECT COUNT(*) FROM chat_members WHERE chat_id = c.id) as members_count
        FROM chats c JOIN users u ON c.owner_id = u.id ORDER BY c.id DESC`);
    res.json({ chats: rows });
});

app.post('/api/chats', auth, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Бан/скам' });
    const { name, avatar } = req.body;
    if (!name) return res.status(400).json({ error: 'Название обязательно' });
    const result = await db.runGetLastId('INSERT INTO chats (name, owner_id, avatar) VALUES (?, ?, ?)',
        [name, req.user.id, avatar || '💬']);
    await db.run('INSERT INTO chat_members (chat_id, user_id) VALUES (?, ?)', [result.lastID, req.user.id]);
    res.json({ success: true, id: result.lastID });
});

app.get('/api/chats/:id', auth, async (req, res) => {
    const chat = await db.get(`SELECT c.*, u.username as owner_username, u.fullname as owner_fullname,
        u.avatar as owner_avatar, u.is_premium, u.is_admin, u.is_dev, u.is_banned, u.is_scam
        FROM chats c JOIN users u ON c.owner_id = u.id WHERE c.id = ?`, [req.params.id]);
    if (!chat) return res.status(404).json({ error: 'Not found' });
    const members = await db.query('SELECT user_id FROM chat_members WHERE chat_id = ?', [req.params.id]);
    res.json({ chat: { ...chat, members: members.map(m => m.user_id), isMember: members.some(m => m.user_id === req.user.id) } });
});

app.post('/api/chats/:id/join', auth, async (req, res) => {
    await db.run('INSERT OR IGNORE INTO chat_members (chat_id, user_id) VALUES (?, ?)', [req.params.id, req.user.id]);
    res.json({ success: true });
});

app.delete('/api/chats/:id/leave', auth, async (req, res) => {
    const chat = await db.get('SELECT owner_id FROM chats WHERE id = ?', [req.params.id]);
    if (chat?.owner_id === req.user.id) return res.status(400).json({ error: 'Создатель не может покинуть' });
    await db.run('DELETE FROM chat_members WHERE chat_id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ success: true });
});

app.get('/api/chats/:id/messages', auth, async (req, res) => {
    const rows = await db.query(`SELECT m.*, u.username, u.fullname, u.avatar, u.is_premium, u.is_admin, u.is_dev, u.is_banned, u.is_scam
        FROM messages m JOIN users u ON m.user_id = u.id
        WHERE m.target_type = 'chat' AND m.target_id = ? ORDER BY m.id ASC`, [req.params.id]);
    const msgIds = rows.map(r => r.id);
    let reactions = {};
    if (msgIds.length) {
        const placeholders = msgIds.map(() => '?').join(',');
        const rrows = await db.query(`SELECT r.*, u.username as reactor_name FROM reactions r 
            JOIN users u ON r.user_id = u.id WHERE r.message_id IN (${placeholders})`, msgIds);
        for (const r of rrows) {
            if (!reactions[r.message_id]) reactions[r.message_id] = {};
            if (!reactions[r.message_id][r.emoji]) reactions[r.message_id][r.emoji] = [];
            reactions[r.message_id][r.emoji].push(r.reactor_name);
        }
    }
    res.json({ messages: rows.map(r => ({ ...r, reactions: reactions[r.id] || {} })) });
});

app.post('/api/chats/:id/messages', auth, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Бан/скам' });
    const member = await db.get('SELECT 1 FROM chat_members WHERE chat_id = ? AND user_id = ?', [req.params.id, req.user.id]);
    if (!member) return res.status(403).json({ error: 'Вы не в чате' });
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Пустое сообщение' });
    const result = await db.runGetLastId('INSERT INTO messages (target_type, target_id, user_id, text) VALUES (?, ?, ?, ?)',
        ['chat', req.params.id, req.user.id, text]);
    res.json({ success: true, id: result.lastID });
});

// ========== REACTIONS ==========
app.post('/api/messages/:id/react', auth, async (req, res) => {
    const { emoji } = req.body;
    if (!emoji) return res.status(400).json({ error: 'No emoji' });
    await db.run('INSERT OR IGNORE INTO reactions (message_id, user_id, emoji) VALUES (?, ?, ?)', [req.params.id, req.user.id, emoji]);
    res.json({ success: true });
});

// ========== PRIVATE MESSAGES ==========
app.get('/api/pm', auth, async (req, res) => {
    const rows = await db.query(`SELECT DISTINCT 
        CASE WHEN from_user_id = ? THEN to_user_id ELSE from_user_id END as peer_id
        FROM private_messages WHERE from_user_id = ? OR to_user_id = ?`, [req.user.id, req.user.id, req.user.id]);
    const peers = [];
    for (const r of rows) {
        const u = await db.get('SELECT id, username, fullname, avatar, is_premium, is_admin, is_dev, is_banned, is_scam FROM users WHERE id = ?', [r.peer_id]);
        if (!u) continue;
        const last = await db.get(`SELECT * FROM private_messages 
            WHERE (from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?)
            ORDER BY id DESC LIMIT 1`, [req.user.id, r.peer_id, r.peer_id, req.user.id]);
        peers.push({ user: rowToUser(u), lastMessage: last });
    }
    peers.sort((a, b) => (b.lastMessage?.id || 0) - (a.lastMessage?.id || 0));
    res.json({ chats: peers });
});

app.get('/api/pm/:userId', auth, async (req, res) => {
    const targetId = parseInt(req.params.userId);
    if (await isBlacklisted(req.user.id, targetId)) return res.status(403).json({ error: 'Вы в ЧС у пользователя' });
    if (await isBlacklisted(targetId, req.user.id)) return res.status(403).json({ error: 'Пользователь в вашем ЧС' });
    const rows = await db.query(`SELECT pm.*, fu.username as from_username, fu.fullname as from_fullname, fu.avatar as from_avatar,
        fu.is_premium as from_is_premium, fu.is_admin as from_is_admin, fu.is_dev as from_is_dev, fu.is_banned as from_is_banned, fu.is_scam as from_is_scam,
        tu.username as to_username, tu.fullname as to_fullname, tu.avatar as to_avatar
        FROM private_messages pm
        JOIN users fu ON pm.from_user_id = fu.id
        JOIN users tu ON pm.to_user_id = tu.id
        WHERE (pm.from_user_id = ? AND pm.to_user_id = ?) OR (pm.from_user_id = ? AND pm.to_user_id = ?)
        ORDER BY pm.id ASC`, [req.user.id, targetId, targetId, req.user.id]);
    await db.run('UPDATE private_messages SET read = 1 WHERE to_user_id = ? AND from_user_id = ?', [req.user.id, targetId]);
    res.json({ messages: rows });
});

app.post('/api/pm/:userId', auth, async (req, res) => {
    if (!canWrite(req.user)) return res.status(403).json({ error: 'Бан/скам' });
    const targetId = parseInt(req.params.userId);
    if (await isBlacklisted(req.user.id, targetId)) return res.status(403).json({ error: 'Вы в ЧС у пользователя' });
    if (await isBlacklisted(targetId, req.user.id)) return res.status(403).json({ error: 'Пользователь в вашем ЧС' });
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'Пустое сообщение' });
    const result = await db.runGetLastId('INSERT INTO private_messages (from_user_id, to_user_id, text) VALUES (?, ?, ?)',
        [req.user.id, targetId, text]);
    res.json({ success: true, id: result.lastID });
});

// ========== LEADERBOARD ==========
app.get('/api/leaderboard', auth, async (req, res) => {
    const rows = await db.query(`SELECT u.id, u.username, u.fullname, u.avatar, u.is_premium, u.is_admin, u.is_dev, u.is_banned, u.is_scam, b.balance
        FROM user_balances b JOIN users u ON b.user_id = u.id ORDER BY b.balance DESC LIMIT 20`);
    res.json({ leaderboard: rows.map(r => ({ user: rowToUser(r), balance: r.balance })) });
});

// ========== SHOP / GIFTS ==========
const GIFTS = [
    { id: 1, name: "🌹 Роза", price: 50, emoji: "🌹" },
    { id: 2, name: "🎂 Торт", price: 100, emoji: "🎂" },
    { id: 3, name: "💎 Алмаз", price: 500, emoji: "💎" },
    { id: 4, name: "🐱 Котик", price: 150, emoji: "🐱" },
    { id: 5, name: "🐶 Собака", price: 150, emoji: "🐶" },
    { id: 6, name: "🎈 Шарик", price: 75, emoji: "🎈" },
    { id: 7, name: "⭐️ Звезда", price: 100, emoji: "⭐️" },
    { id: 8, name: "❤️ Сердце", price: 50, emoji: "❤️" },
    { id: 9, name: "🎁 Подарок", price: 200, emoji: "🎁" },
    { id: 10, name: "🏆 Кубок", price: 500, emoji: "🏆" },
    { id: 11, name: "👑 Корона", price: 1000, emoji: "👑" },
    { id: 12, name: "🚀 Ракета", price: 400, emoji: "🚀" }
];

app.get('/api/shop/gifts', auth, (req, res) => {
    res.json({ gifts: GIFTS });
});

app.post('/api/shop/buy', auth, async (req, res) => {
    const { giftId } = req.body;
    const gift = GIFTS.find(g => g.id === giftId);
    if (!gift) return res.status(404).json({ error: 'Подарок не найден' });
    const bal = await db.get('SELECT balance FROM user_balances WHERE user_id = ?', [req.user.id]);
    if (!bal || bal.balance < gift.price) return res.status(400).json({ error: `Нужно ${gift.price} 🪙` });
    await db.run('UPDATE user_balances SET balance = balance - ? WHERE user_id = ?', [gift.price, req.user.id]);
    await db.run('INSERT INTO user_gifts (user_id, gift_id, name, emoji) VALUES (?, ?, ?, ?)',
        [req.user.id, gift.id, gift.name, gift.emoji]);
    res.json({ success: true });
});

app.get('/api/shop/my-gifts', auth, async (req, res) => {
    const rows = await db.query('SELECT * FROM user_gifts WHERE user_id = ? ORDER BY id DESC', [req.user.id]);
    res.json({ gifts: rows });
});

app.post('/api/premium/buy', auth, async (req, res) => {
    const user = await db.get('SELECT is_premium FROM users WHERE id = ?', [req.user.id]);
    if (user.is_premium) return res.status(400).json({ error: 'Уже премиум' });
    const bal = await db.get('SELECT balance FROM user_balances WHERE user_id = ?', [req.user.id]);
    if (!bal || bal.balance < 500) return res.status(400).json({ error: 'Нужно 500 🪙' });
    await db.run('UPDATE user_balances SET balance = balance - 500 WHERE user_id = ?', [req.user.id]);
    await db.run('UPDATE users SET is_premium = 1 WHERE id = ?', [req.user.id]);
    res.json({ success: true });
});

// ========== ADMIN ==========
app.get('/api/admin/users', auth, requireAdmin, async (req, res) => {
    const rows = await db.query(`SELECT u.*, COALESCE(b.balance, 0) as balance
        FROM users u LEFT JOIN user_balances b ON b.user_id = u.id ORDER BY u.id DESC`);
    res.json({ users: rows.map(r => ({ ...rowToUser(r), balance: r.balance })) });
});

app.get('/api/admin/devices', auth, requireDev, async (req, res) => {
    res.json({ devices: [] });
});

app.get('/api/admin/logs', auth, requireAdmin, async (req, res) => {
    const rows = await db.query(`SELECT l.*, u.username FROM logs l LEFT JOIN users u ON l.user_id = u.id ORDER BY l.id DESC LIMIT 500`);
    res.json({ logs: rows });
});

app.delete('/api/admin/logs', auth, requireAdmin, async (req, res) => {
    await db.run("DELETE FROM logs WHERE type = 'general'");
    res.json({ success: true });
});

app.get('/api/admin/ban-logs', auth, requireAdmin, async (req, res) => {
    const rows = await db.query(`SELECT l.*, u.username FROM logs l LEFT JOIN users u ON l.user_id = u.id WHERE l.type = 'ban' ORDER BY l.id DESC LIMIT 500`);
    res.json({ logs: rows });
});

app.delete('/api/admin/ban-logs', auth, requireAdmin, async (req, res) => {
    await db.run("DELETE FROM logs WHERE type = 'ban'");
    res.json({ success: true });
});

app.get('/api/admin/channels', auth, requireAdmin, async (req, res) => {
    const rows = await db.query('SELECT * FROM channels');
    res.json({ channels: rows });
});

app.delete('/api/admin/channels/:id', auth, requireAdmin, async (req, res) => {
    await db.run('DELETE FROM channels WHERE id = ?', [req.params.id]);
    res.json({ success: true });
});

app.get('/api/admin/groups', auth, requireAdmin, async (req, res) => {
    const rows = await db.query('SELECT * FROM groups_table');
    res.json({ groups: rows });
});

app.delete('/api/admin/groups/:id', auth, requireAdmin, async (req, res) => {
    await db.run('DELETE FROM groups_table WHERE id = ?', [req.params.id]);
    res.json({ success: true });
});

app.get('/api/admin/chats', auth, requireAdmin, async (req, res) => {
    const rows = await db.query('SELECT * FROM chats');
    res.json({ chats: rows });
});

app.delete('/api/admin/chats/:id', auth, requireAdmin, async (req, res) => {
    await db.run('DELETE FROM chats WHERE id = ?', [req.params.id]);
    res.json({ success: true });
});

app.post('/api/admin/ban', auth, requireAdmin, async (req, res) => {
    const { userId, days, reason } = req.body;
    const target = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!target || target.is_dev) return res.status(400).json({ error: 'Нельзя' });
    const expiry = days ? new Date(Date.now() + days * 86400000).toLocaleDateString() : 'Навсегда';
    await db.run(`UPDATE users SET is_banned = 1, ban_reason = ?, ban_date = ?, ban_expiry = ?, banned_by = ?, banned_by_role = ? WHERE id = ?`,
        [reason || 'Нарушение правил', new Date().toLocaleDateString(), expiry,
         req.user.username, req.user.isDev ? 'Разработчик' : 'Администратор', userId]);
    await logAction(req.user.id, `ban ${target.username} ${days ? days + 'd' : 'perma'}: ${reason}`, 'ban');
    res.json({ success: true });
});

app.post('/api/admin/unban', auth, requireAdmin, async (req, res) => {
    const { userId } = req.body;
    const target = await db.get('SELECT username FROM users WHERE id = ?', [userId]);
    await db.run(`UPDATE users SET is_banned = 0, ban_reason = NULL, ban_date = NULL, ban_expiry = NULL, banned_by = NULL, banned_by_role = NULL WHERE id = ?`, [userId]);
    if (target) await logAction(req.user.id, `unban ${target.username}`, 'ban');
    res.json({ success: true });
});

app.post('/api/admin/scam', auth, requireAdmin, async (req, res) => {
    const { userId } = req.body;
    const target = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
    if (!target || target.is_dev || target.is_admin) return res.status(400).json({ error: 'Нельзя' });
    await db.run('UPDATE users SET is_scam = 1 WHERE id = ?', [userId]);
    await logAction(req.user.id, `scam ${target.username}`, 'ban');
    res.json({ success: true });
});

app.delete('/api/admin/scam', auth, requireAdmin, async (req, res) => {
    const { userId } = req.body;
    await db.run('UPDATE users SET is_scam = 0 WHERE id = ?', [userId]);
    res.json({ success: true });
});

app.post('/api/admin/admin', auth, requireDev, async (req, res) => {
    const { userId } = req.body;
    await db.run('UPDATE users SET is_admin = 1 WHERE id = ?', [userId]);
    res.json({ success: true });
});

app.delete('/api/admin/admin', auth, requireDev, async (req, res) => {
    const { userId } = req.body;
    await db.run('UPDATE users SET is_admin = 0 WHERE id = ?', [userId]);
    res.json({ success: true });
});

app.post('/api/admin/premium', auth, requireDev, async (req, res) => {
    const { userId } = req.body;
    await db.run('UPDATE users SET is_premium = 1 WHERE id = ?', [userId]);
    res.json({ success: true });
});

app.delete('/api/admin/premium', auth, requireDev, async (req, res) => {
    const { userId } = req.body;
    await db.run('UPDATE users SET is_premium = 0, premium_nick = NULL WHERE id = ?', [userId]);
    res.json({ success: true });
});

app.post('/api/admin/add-coins', auth, requireDev, async (req, res) => {
    const { userId, amount } = req.body;
    await db.run('INSERT INTO user_balances (user_id, balance) VALUES (?, 0) ON CONFLICT(user_id) DO NOTHING', [userId]);
    await db.run('UPDATE user_balances SET balance = balance + ? WHERE user_id = ?', [amount, userId]);
    res.json({ success: true });
});

// ========== COMPLAINTS ==========
app.get('/api/admin/complaints', auth, requireAdmin, async (req, res) => {
    const rows = await db.query(`SELECT c.*, fu.username as from_username, tu.username as target_username 
        FROM complaints c JOIN users fu ON c.from_user_id = fu.id 
        JOIN users tu ON c.target_user_id = tu.id WHERE c.status = 'pending' ORDER BY c.id DESC`);
    res.json({ complaints: rows });
});

app.post('/api/admin/complaints/:id/resolve', auth, requireAdmin, async (req, res) => {
    const { action } = req.body;
    const complaint = await db.get('SELECT * FROM complaints WHERE id = ?', [req.params.id]);
    if (!complaint) return res.status(404).json({ error: 'Not found' });
    const target = await db.get('SELECT * FROM users WHERE id = ?', [complaint.target_user_id]);
    if (action === 'scam' && target && !target.is_dev) {
        await db.run('UPDATE users SET is_scam = 1 WHERE id = ?', [target.id]);
    } else if (action === 'ban' && target && !target.is_dev) {
        await db.run(`UPDATE users SET is_banned = 1, ban_reason = ?, ban_date = ?, ban_expiry = ?, banned_by = ?, banned_by_role = ? WHERE id = ?`,
            [complaint.reason, new Date().toLocaleDateString(), 'Навсегда', req.user.username, 'Администратор', target.id]);
        await logAction(req.user.id, `ban ${target.username} via complaint`, 'ban');
    }
    await db.run("UPDATE complaints SET status = 'resolved' WHERE id = ?", [req.params.id]);
    res.json({ success: true });
});

app.post('/api/complaints', auth, async (req, res) => {
    const { targetUserId, reason } = req.body;
    if (!targetUserId || !reason) return res.status(400).json({ error: 'Заполните поля' });
    await db.run('INSERT INTO complaints (from_user_id, target_user_id, reason) VALUES (?, ?, ?)',
        [req.user.id, targetUserId, reason]);
    res.json({ success: true });
});

// ========== HELP / NOTES ==========
app.post('/api/help', auth, async (req, res) => {
    const { question } = req.body;
    if (!question) return res.status(400).json({ error: 'Пустой вопрос' });
    await db.run('INSERT INTO help_questions (from_user_id, question) VALUES (?, ?)', [req.user.id, question]);
    res.json({ success: true });
});

app.get('/api/notes', auth, async (req, res) => {
    const row = await db.get('SELECT notes FROM user_notes WHERE user_id = ?', [req.user.id]);
    res.json({ notes: row?.notes || '' });
});

app.post('/api/notes', auth, async (req, res) => {
    const { notes } = req.body;
    await db.run('INSERT INTO user_notes (user_id, notes) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET notes = ?',
        [req.user.id, notes || '', notes || '']);
    res.json({ success: true });
});

// ========== FAVORITES ==========
app.get('/api/favorites', auth, async (req, res) => {
    const rows = await db.query('SELECT * FROM favorites WHERE user_id = ?', [req.user.id]);
    res.json({ favorites: rows });
});

// ========== SEARCH ==========
app.get('/api/search', auth, async (req, res) => {
    const q = (req.query.q || '').toLowerCase();
    const channels = await db.query("SELECT * FROM channels WHERE LOWER(name) LIKE ?", [`%${q}%`]);
    const groups = await db.query("SELECT * FROM groups_table WHERE LOWER(name) LIKE ?", [`%${q}%`]);
    const chats = await db.query("SELECT * FROM chats WHERE LOWER(name) LIKE ?", [`%${q}%`]);
    res.json({ channels, groups, chats });
});

// ========== DASHBOARD ==========
app.get('/api/dashboard', auth, async (req, res) => {
    const myChannels = await db.query('SELECT * FROM channels WHERE owner_id = ?', [req.user.id]);
    const bal = await db.get('SELECT balance FROM user_balances WHERE user_id = ?', [req.user.id]);
    res.json({ channels: myChannels, balance: bal?.balance || 0 });
});

// ========== FALLBACK ==========
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`[OtlumGram] Server running on port ${PORT}`);
});
