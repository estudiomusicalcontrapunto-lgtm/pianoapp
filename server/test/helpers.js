// Points the app at a throwaway SQLite file. Require this before any model.
const fs = require('fs');
const os = require('os');
const path = require('path');

const storage = path.join(os.tmpdir(), `pianoapp-test-${process.pid}-${Date.now()}.sqlite`);
const uploads = path.join(os.tmpdir(), `pianoapp-test-uploads-${process.pid}-${Date.now()}`);
process.env.DB_STORAGE = storage;
process.env.UPLOADS_DIR = uploads;
process.env.JWT_SECRET = 'clave-de-sesiones-solo-para-las-pruebas-0123456789';
process.env.MAINTENANCE_ON_LOGIN = 'false';
delete process.env.DB_HOST;

const { runMigrations } = require('../db/migrator');
const models = require('../models');

const setupDatabase = async () => {
    await runMigrations();
    return models;
};

const teardownDatabase = async () => {
    await models.sequelize.close();
    fs.rmSync(storage, { force: true });
    fs.rmSync(uploads, { recursive: true, force: true });
};

// Starts the Express app on a random port; returns { baseUrl, close }
const startServer = async () => {
    const app = require('../app');
    const server = await new Promise(resolve => {
        const s = app.listen(0, () => resolve(s));
    });
    return {
        baseUrl: `http://127.0.0.1:${server.address().port}/api`,
        close: () => new Promise(resolve => server.close(resolve)),
    };
};

const request = async (baseUrl, method, url, { token, body } = {}) => {
    const res = await fetch(`${baseUrl}${url}`, {
        method,
        headers: {
            'Content-Type': 'application/json',
            ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
};

// Multipart upload of one file field
const upload = async (baseUrl, url, { token, field, filename, type, content }) => {
    const form = new FormData();
    form.append(field, new Blob([content], { type }), filename);
    const res = await fetch(`${baseUrl}${url}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
};

module.exports = { setupDatabase, teardownDatabase, startServer, request, upload, uploads };
