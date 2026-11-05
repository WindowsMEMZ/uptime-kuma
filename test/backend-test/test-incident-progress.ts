import { after, before, beforeEach, test, mock } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import dayjs from "dayjs";

const require = createRequire(import.meta.url);
const { R } = require("redbean-node");
const knex = require("knex");
const incidents = require("../../server/incident-service");
const { UptimeKumaServer } = require("../../server/uptime-kuma-server");
const previousServer = UptimeKumaServer.instance;
const baseMigration = require("../../db/knex_migrations/2026-11-05-0000-incident-management");
const labelMigration = require("../../db/knex_migrations/2026-11-05-0001-incident-progress-labels");

before(async () => {
    R.setup(knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true }));
    await R.knex.raw("PRAGMA foreign_keys = ON");
    for (const name of ["monitor", "status_page"]) {
        await R.knex.schema.createTable(name, (table) => table.increments("id"));
        await R.knex(name).insert({ id: 1 });
    }
    await R.knex.schema.createTable("incident", (table) => {
        table.increments("id");
        table.string("title");
        table.text("content");
        table.string("style").defaultTo("warning");
        table.boolean("active").defaultTo(true);
        table.boolean("pin").defaultTo(true);
        table.datetime("created_date");
        table.datetime("last_updated_date");
        table.integer("status_page_id");
    });
    await baseMigration.up(R.knex);
    await R.knex("incident").insert({
        id: 1,
        active: 0,
        content: "Legacy resolution",
        created_date: "2026-01-01 00:00:00",
        last_updated_date: "2026-01-02 00:00:00",
    });
    await R.knex("incident_update").insert({
        incident_id: 1,
        content: "Legacy resolution",
        created_date: "2026-01-01 00:00:00",
    });
    await labelMigration.up(R.knex);
    assert.equal((await R.knex("incident_update").first()).label, "resolved");
    assert.equal((await R.knex("incident").first()).resolved_date, "2026-01-02 00:00:00");
    await labelMigration.down(R.knex);
    assert.equal(await R.knex.schema.hasColumn("incident_update", "label"), false);
    await labelMigration.up(R.knex);
    UptimeKumaServer.instance = {
        io: { to: () => ({ emit() {} }) },
        monitorList: { 1: { requestImmediateCheck: mock.fn() } },
    };
});

beforeEach(async () => {
    await R.knex("incident").delete();
});

after(async () => {
    mock.timers.reset();
    await R.knex.destroy();
    UptimeKumaServer.instance = previousServer;
});

test("the newest progress determines resolution and releases or restores monitor overrides", async () => {
    const id = await incidents.save({
        title: "Network",
        content: "Started",
        monitors: [{ id: 1, overrideStatus: 0 }],
        statusPageIDs: [1],
    });
    assert.equal((await incidents.serialize(await R.knex("incident")))[0].label, "updated");
    assert.equal(await incidents.monitorOverride(1), 0);
    await incidents.saveUpdate(id, null, "Restored", "resolved");
    let incident = await R.knex("incident").where("id", id).first();
    assert.equal(incident.active, 0);
    assert.ok(incident.resolved_date);
    assert.equal(await incidents.monitorOverride(1), null);
    const resolvedEntry = await R.knex("incident_update").where({ incident_id: id, label: "resolved" }).first();
    await incidents.saveUpdate(id, null, "Checking again", "monitoring");
    assert.equal(await incidents.monitorOverride(1), 0);
    await incidents.saveUpdate(id, resolvedEntry.id, "Corrected old resolution");
    incident = await R.knex("incident").where("id", id).first();
    assert.equal(incident.active, 1);
    assert.equal(incident.resolved_date, null);
    await incidents.saveUpdate(id, null, "Finally restored", "resolved");
    const resolvedDate = (await R.knex("incident").where("id", id).first()).resolved_date;
    await incidents.saveUpdate(id, resolvedEntry.id, "Another description correction");
    assert.equal((await R.knex("incident").where("id", id).first()).resolved_date, resolvedDate);
    await incidents.saveUpdate(id, null, "A new update");
    assert.equal((await R.knex("incident").where("id", id).first()).active, 1);
    assert.equal(await incidents.monitorOverride(1), 0);
    await assert.rejects(incidents.saveUpdate(id, null, "Invalid", "unknown"), /Invalid incident label/);
});

test("resolved incidents expire at exactly 72 hours while admin history and active incidents remain", async () => {
    const now = Date.now();
    const cutoff = now - 3 * 86400000;
    const format = (time) => R.isoDateTimeMillis(dayjs.utc(time));
    await R.knex("incident").insert([
        { id: 1, status_page_id: 1, active: 0, resolved_date: format(cutoff), created_date: format(cutoff) },
        { id: 2, status_page_id: 1, active: 0, resolved_date: format(cutoff + 1), created_date: format(cutoff) },
        { id: 3, status_page_id: 1, active: 1, resolved_date: null, created_date: format(cutoff) },
    ]);
    assert.deepEqual(
        (await incidents.visibleForPage(1, now).orderBy("id")).map((row) => row.id),
        [2, 3]
    );
    mock.timers.enable({ apis: ["Date"], now });
    const revision = await incidents.publicRevision(1);
    mock.timers.tick(1);
    assert.notEqual(await incidents.publicRevision(1), revision);
    assert.deepEqual(
        (await incidents.activeForPage(1)).map((row) => row.id),
        [3]
    );
    assert.equal((await R.knex("incident")).length, 3);
    mock.timers.reset();
});

test("an incident created with resolved progress is visible during its retention and never forces a status", async () => {
    const id = await incidents.save({
        title: "Restored",
        content: "All working",
        label: "resolved",
        monitors: [{ id: 1, overrideStatus: 0 }],
        statusPageIDs: [1],
    });
    assert.equal(await incidents.monitorOverride(1), null);
    const visible = await incidents.activeForPage(1);
    assert.equal(visible[0].id, id);
    assert.equal(visible[0].active, false);
    assert.equal(visible[0].updates[0].label, "resolved");
});
