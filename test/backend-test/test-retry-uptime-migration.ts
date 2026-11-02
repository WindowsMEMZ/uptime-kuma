import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import dayjs from "dayjs";
import { UP, DOWN, PENDING } from "../../src/util";

const require = createRequire(import.meta.url);
const createKnex = require("knex");
const migration = require("../../db/knex_migrations/2026-11-02-0010-exclude-retries-from-uptime");

test("uptime migration removes retained retry attempts using their aggregation time", async (t) => {
    const knex = createKnex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true });
    t.after(async () => knex.destroy());
    await knex.schema.createTable("heartbeat", (table) => {
        table.increments("id");
        table.integer("monitor_id");
        table.integer("status");
        table.integer("retries");
        table.text("time");
        table.text("end_time");
    });
    const start = dayjs.utc("2026-11-01 23:59:59.900");
    const end = start.add(200, "milliseconds");
    const format = "YYYY-MM-DD HH:mm:ss.SSS";
    const fields = { time: start.format(format), end_time: end.format(format) };
    await knex("heartbeat").insert([
        { ...fields, monitor_id: 1, status: PENDING, retries: 1 },
        { ...fields, monitor_id: 1, status: PENDING, retries: 2 },
        { ...fields, monitor_id: 1, status: PENDING, retries: 1, end_time: null },
        { ...fields, monitor_id: 1, status: PENDING, retries: 0 },
        { ...fields, monitor_id: 1, status: PENDING, retries: null },
        { ...fields, monitor_id: 1, status: DOWN, retries: 3 },
        { ...fields, monitor_id: 1, status: UP, retries: 0 },
        { ...fields, monitor_id: 2, status: PENDING, retries: 1 },
        { ...fields, monitor_id: 2, status: PENDING, retries: 2 },
    ]);
    for (const [table, unit] of [
        ["stat_minutely", "minute"],
        ["stat_hourly", "hour"],
        ["stat_daily", "day"],
    ] as const) {
        await knex.schema.createTable(table, (schema) => {
            schema.integer("monitor_id");
            schema.integer("timestamp");
            schema.integer("up");
            schema.integer("down");
            schema.float("ping");
            schema.text("extras");
        });
        const stats = { up: 10, down: 5, ping: 123, extras: '{"maintenance":2}' };
        await knex(table).insert([
            { ...stats, monitor_id: 1, timestamp: start.startOf(unit).unix() },
            { ...stats, monitor_id: 1, timestamp: end.startOf(unit).unix() },
            { ...stats, monitor_id: 2, timestamp: end.startOf(unit).unix(), down: 1 },
            { ...stats, monitor_id: 3, timestamp: end.startOf(unit).unix() },
        ]);
    }

    await migration.up(knex);

    for (const table of ["stat_minutely", "stat_hourly", "stat_daily"]) {
        const rows = await knex(table).orderBy("monitor_id").orderBy("timestamp");
        assert.deepEqual(
            rows.map((row) => row.down),
            [4, 3, 0, 5]
        );
        assert.ok(rows.every((row) => row.up === 10 && row.ping === 123 && row.extras === '{"maintenance":2}'));
    }
    assert.equal((await knex("heartbeat").count({ total: "id" }).first()).total, 9);
});
