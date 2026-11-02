import { after, before, beforeEach, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import dayjs from "dayjs";
import { UP, DOWN, PENDING, MAINTENANCE } from "../../src/util";

const require = createRequire(import.meta.url);
const knex = require("knex");
const { R } = require("redbean-node");
const { getStatusPageHeartbeatBuckets } = require("../../server/status-page-heartbeat");
const Database = require("../../server/database");
const originalConfig = Database.dbConfig;
const now = dayjs.utc("2026-11-02T06:00:00.125Z");
const format = "YYYY-MM-DD HH:mm:ss.SSS";

before(async () => {
    R.setup(knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true }));
    await R.exec(
        "CREATE TABLE heartbeat (id INTEGER PRIMARY KEY, monitor_id INTEGER, time TEXT, status INTEGER, important INTEGER DEFAULT 0)"
    );
    await R.exec("CREATE INDEX heartbeat_monitor_time ON heartbeat(monitor_id, time)");
    await R.exec("CREATE TABLE monitor (id INTEGER PRIMARY KEY, config TEXT)");
    Database.dbConfig = { type: "sqlite" };
});

beforeEach(async () => {
    await R.exec("DELETE FROM heartbeat");
    await R.exec("DELETE FROM monitor");
});

after(async () => {
    await R.knex.destroy();
    Database.dbConfig = originalConfig;
});

/**
 * Insert one retained check at a precise time.
 * @param status Check status
 * @param time Check timestamp
 * @param monitorID Monitor id
 * @returns Insertion result
 */
async function check(status: number, time: dayjs.Dayjs, monitorID = 1) {
    return R.knex("heartbeat").insert({ monitor_id: monitorID, time: time.format(format), status });
}

describe("public heartbeat SQL aggregation", () => {
    test("includes every check, isolates monitors, and retains empty intervals", async () => {
        const start = now.subtract(100, "minutes");
        await check(UP, start);
        await check(UP, start.add(59_999, "milliseconds"));
        await check(DOWN, start.add(1, "minute"));
        await check(PENDING, start.add(2, "minutes"));
        await check(UP, start.add(2, "minutes").add(1, "second"));
        await check(MAINTENANCE, start.add(3, "minutes"));
        await check(PENDING, start.add(4, "minutes"));
        await check(DOWN, start.add(6, "minutes"));
        for (let i = 1; i <= 101; i++) {
            await check(UP, start.add(6, "minutes").add(i, "milliseconds"));
        }
        await check(DOWN, start, 2);
        await check(DOWN, start.subtract(1, "millisecond"));
        await check(DOWN, now);
        await check(UP, now.subtract(1, "millisecond"));

        const buckets = await getStatusPageHeartbeatBuckets(1, 100, now);
        assert.equal(buckets.length, 100);
        assert.equal(buckets[0].time, start.format(format));
        assert.equal(buckets[0].endTime, start.add(1, "minute").format(format));
        assert.equal(buckets[0].upCount, 2);
        assert.equal(buckets[0].status, UP);
        assert.equal(buckets[1].status, DOWN);
        assert.equal(buckets[2].status, PENDING);
        assert.equal(buckets[3].status, MAINTENANCE);
        assert.equal(buckets[4].status, DOWN);
        assert.equal(buckets[5].status, null);
        assert.equal(buckets[6].status, PENDING);
        assert.equal(buckets[6].upCount, 101);
        assert.equal(buckets[6].downCount, 1);
        assert.equal(buckets.at(-1).status, UP);
        assert.equal(buckets.at(-1).endTime, now.format(format));
    });

    test("places subsecond boundaries correctly in a short window", async () => {
        const start = now.subtract(1, "minute");
        await check(UP, start.add(599, "milliseconds"));
        await check(DOWN, start.add(600, "milliseconds"));

        const buckets = await getStatusPageHeartbeatBuckets(1, 1, now);
        assert.equal(buckets[0].status, UP);
        assert.equal(buckets[1].status, DOWN);
        assert.equal(
            buckets.reduce((sum, bucket) => sum + bucket.upCount + bucket.downCount, 0),
            2
        );
    });

    test("returns a complete empty window for a monitor without history", async () => {
        const buckets = await getStatusPageHeartbeatBuckets(1, 4320, now);
        assert.equal(buckets.length, 100);
        assert.equal(buckets[0].time, now.subtract(3, "days").format(format));
        assert.equal(buckets.at(-1).endTime, now.format(format));
        assert.ok(buckets.every((bucket) => bucket.status === null));
    });

    test("handles historical timestamps without fractional seconds at window boundaries", async () => {
        const end = now.startOf("second");
        const start = end.subtract(100, "minutes");
        await R.knex("heartbeat").insert([
            { monitor_id: 1, time: start.format("YYYY-MM-DD HH:mm:ss"), status: UP },
            { monitor_id: 1, time: end.format("YYYY-MM-DD HH:mm:ss"), status: DOWN },
        ]);
        const buckets = await getStatusPageHeartbeatBuckets(1, 100, end);
        assert.equal(buckets[0].status, UP);
        assert.equal(buckets.at(-1).status, null);
    });
});

test("cleanup retains the configured window independently for each monitor", async () => {
    await R.knex("monitor").insert([
        { id: 1, config: JSON.stringify({ statusPageHeartbeatWindow: 4321 }) },
        { id: 2, config: "{}" },
    ]);
    const liveNow = dayjs.utc();
    for (const monitorID of [1, 2]) {
        await check(UP, liveNow.subtract(4, "days"), monitorID);
        await check(UP, liveNow.subtract(3, "days"), monitorID);
        await check(UP, liveNow.subtract(2, "days"), monitorID);
        for (let i = 0; i < 101; i++) {
            await check(UP, liveNow.subtract(i, "seconds"), monitorID);
        }
    }

    await Database.clearHeartbeatData();

    assert.equal(await R.getCell("SELECT COUNT(*) FROM heartbeat WHERE monitor_id = 1"), 103);
    assert.equal(await R.getCell("SELECT COUNT(*) FROM heartbeat WHERE monitor_id = 2"), 101);
});
