import { test } from "node:test";
import assert from "node:assert/strict";
import knex from "knex";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const migration = require("../../db/knex_migrations/2026-11-05-0000-incident-management");

test("incident migration preserves legacy content and timestamps, and cleans up related records", async () => {
    const db = knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
    try {
        await db.raw("PRAGMA foreign_keys = ON");
        await db.schema.createTable("incident", (table) => {
            table.increments("id");
            table.text("content");
            table.datetime("created_date");
            table.integer("status_page_id");
        });
        for (const name of ["monitor", "status_page"]) {
            await db.schema.createTable(name, (table) => table.increments("id"));
            await db(name).insert({ id: 1 });
        }
        const original = { id: 1, content: "Legacy incident", created_date: "2025-01-02 03:04:05", status_page_id: 1 };
        await db("incident").insert(original);
        await migration.up(db);
        const progress = await db("incident_update").first();
        assert.equal(progress.content, original.content);
        assert.equal(progress.created_date, original.created_date);
        assert.equal(progress.last_updated_date, null);
        assert.deepEqual(await db("incident_status_page").first(), { incident_id: 1, status_page_id: 1 });
        await db("incident_monitor").insert({ incident_id: 1, monitor_id: 1, override_status: 3 });
        await assert.rejects(db("incident_monitor").insert({ incident_id: 1, monitor_id: 999, override_status: 0 }));
        await db("monitor").where("id", 1).delete();
        assert.equal((await db("incident_monitor")).length, 0);
        await db("status_page").where("id", 1).delete();
        assert.equal((await db("incident_status_page")).length, 0);
        assert.equal((await db("incident_update")).length, 1);
        await migration.down(db);
        assert.deepEqual(await db("incident").first(), original);
        assert.equal(await db.schema.hasTable("incident_update"), false);
    } finally {
        await db.destroy();
    }
});
