require('dotenv').config();
const fs = require('fs');
const path = require('path');

let db = null;
let isTurso = false;

function initDb() {
    if (db) return db;

    // Turso (Vercel / production)
    if (process.env.TURSO_DATABASE_URL) {
        const { createClient } = require('@libsql/client');
        db = createClient({
            url: process.env.TURSO_DATABASE_URL,
            authToken: process.env.TURSO_AUTH_TOKEN || '',
        });
        isTurso = true;
        console.log('[DB] Turso connected');
        return db;
    }

    // Local SQLite fallback
    try {
        const Database = require('better-sqlite3');
        const dbPath = process.env.DB_PATH || './otlumgram.db';
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        isTurso = false;
        console.log('[DB] SQLite local:', dbPath);
        return db;
    } catch (e) {
        console.error('[DB] better-sqlite3 not available. Install it for local dev: npm install better-sqlite3');
        throw e;
    }
}

async function exec(sql) {
    const d = initDb();
    if (isTurso) {
        // Turso: split by semicolon, skip empty
        const parts = sql.split(';').map(s => s.trim()).filter(Boolean);
        for (const part of parts) {
            await d.execute(part);
        }
    } else {
        d.exec(sql);
    }
}

async function query(sql, args = []) {
    const d = initDb();
    if (isTurso) {
        const res = await d.execute({ sql, args });
        return res.rows;
    }
    return d.prepare(sql).all(...args);
}

async function run(sql, args = []) {
    const d = initDb();
    if (isTurso) {
        await d.execute({ sql, args });
        return { lastID: 0, changes: 0 }; // Turso не возвращает lastID в том же формате
    }
    return d.prepare(sql).run(...args);
}

async function get(sql, args = []) {
    const rows = await query(sql, args);
    return rows[0] || null;
}

async function runGetLastId(sql, args = []) {
    const d = initDb();
    if (isTurso) {
        const res = await d.execute({ sql, args });
        // Turso возвращает lastInsertRowid в meta, но не всегда
        return { lastID: Number(res.lastInsertRowid) || 0 };
    }
    const info = d.prepare(sql).run(...args);
    return { lastID: info.lastInsertRowid };
}

async function migrate() {
    const migrationFile = path.join(__dirname, '001_initial.sql');
    if (!fs.existsSync(migrationFile)) {
        console.log('[MIGRATE] No migration file found');
        return;
    }

    // Create migrations table
    await exec(`CREATE TABLE IF NOT EXISTS migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    const sql = fs.readFileSync(migrationFile, 'utf-8');
    const name = '001_initial.sql';

    const exists = await get(`SELECT 1 FROM migrations WHERE name = ?`, [name]);
    if (exists) {
        console.log('[MIGRATE] Already up to date');
        return;
    }

    await exec(sql);
    await run(`INSERT INTO migrations (name) VALUES (?)`, [name]);
    console.log('[MIGRATE] Applied:', name);
}

async function initDevUser() {
    const bcrypt = require('bcryptjs');
    const hashed = bcrypt.hashSync('OtlumDev123', 10);
    await run(`UPDATE users SET password = ? WHERE username = 'OtlumDev' AND password = '$2a$10$DevHashPlaceholder'`, [hashed]);
}

module.exports = { initDb, exec, query, run, get, runGetLastId, migrate, initDevUser };
