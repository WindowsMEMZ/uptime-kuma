import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import express from "express";
import type { AddressInfo } from "node:net";

const require = createRequire(import.meta.url);
const { auth } = require("../../server/better-auth");
const { createBetterAuthRouter } = require("../../server/routers/better-auth-router");
const Database = require("../../server/database");
const TestDB = require("../mock-testdb");
const { R } = require("redbean-node");

test("authentication database initialization", async (t) => {
    const dataDir = "./data/test-better-auth-initialization";
    const testDb = new TestDB(dataDir);

    t.before(async () => {
        fs.rmSync(dataDir, { recursive: true, force: true });
        Database.initDataDir({ "data-dir": dataDir });
        Database.dbConfig = { type: "sqlite" };
        Database.writeDBConfig(Database.dbConfig);
        await Database.connect(true);
        // Finish any authentication check started by connect before the schema is migrated.
        if (Database.authSQLite) {
            try {
                const context = await auth().$context;
                await context.checkSchema?.();
            } catch {}
        }
        await Database.patch();
    });
    t.after(async () => testDb.destroy());

    await t.test("accepts authentication requests after a delayed schema migration", async () => {
        const columns = await R.knex("better_auth_twoFactor").columnInfo();
        assert.ok(columns.failedVerificationCount);
        assert.ok(columns.lockedUntil);
        const response = await auth().handler(new Request("http://localhost:3000/api/auth/ok"));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { ok: true });
    });

    await t.test("adds lockout fields without replacing existing two-factor secrets", async () => {
        const migration = require("../../db/knex_migrations/2026-11-02-0000-better-auth-2fa-lockout");
        await migration.down(R.knex);
        const userId = "two-factor-migration-user";
        await R.knex("better_auth_user").insert({
            id: userId,
            name: "Migration User",
            email: "migration@example.com",
            emailVerified: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
        const existing = {
            id: "existing-two-factor",
            userId,
            secret: "existing-encrypted-secret",
            backupCodes: "existing-encrypted-backup-codes",
            verified: 1,
        };
        await R.knex("better_auth_twoFactor").insert(existing);
        await migration.up(R.knex);
        const row = await R.knex("better_auth_twoFactor").where({ id: existing.id }).first();
        assert.deepEqual(row, { ...existing, failedVerificationCount: 0, lockedUntil: null });
    });

    await t.test("returns an HTTP error when the authentication handler rejects", async (t) => {
        const failure = new Error("Authentication unavailable");
        t.mock.method(auth(), "handler", async () => {
            throw failure;
        });
        const app = express();
        app.use(await createBetterAuthRouter());
        app.use((error: Error, request: express.Request, response: express.Response, next: express.NextFunction) => {
            void next;
            assert.equal(error, failure);
            response.status(500).json({ error: "Authentication unavailable" });
        });
        const server = app.listen(0, "127.0.0.1");
        await new Promise<void>((resolve) => server.once("listening", resolve));
        t.after(async () => {
            server.closeAllConnections();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        });

        const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/auth/ok`, {
            signal: AbortSignal.timeout(3000),
        });
        assert.equal(response.status, 500);
        assert.deepEqual(await response.json(), { error: "Authentication unavailable" });
    });
});
