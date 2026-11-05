import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { R } = require("redbean-node");
const knex = require("knex");
const migration = require("../../db/knex_migrations/2026-11-06-0000-account-permissions");
const { getPermissions, authorize } = require("../../server/permissions");
const accounts = require("../../server/account-service");

before(async () => {
    R.setup(knex({ client: "better-sqlite3", connection: { filename: ":memory:" }, useNullAsDefault: true }));
    await R.knex.raw("PRAGMA foreign_keys = ON");
    await R.knex.schema.createTable("better_auth_user", (table) => {
        table.string("id").primary();
        table.string("username").unique();
        table.string("role");
        table.boolean("banned");
        table.boolean("twoFactorEnabled");
        table.timestamp("updatedAt");
    });
    for (const name of ["monitor", "status_page"]) {
        await R.knex.schema.createTable(name, (table) => {
            table.increments("id");
            table.integer("parent").nullable();
            table.string("slug");
            table.string("user_id").references("id").inTable("better_auth_user").onDelete("SET NULL");
        });
    }
    for (const name of ["better_auth_session", "better_auth_account", "better_auth_twoFactor"]) {
        await R.knex.schema.createTable(name, (table) => {
            table.string("id").primary();
            table.string("userId").references("id").inTable("better_auth_user");
        });
    }
    await R.knex("better_auth_user").insert({ id: "legacy", username: "legacy", role: "user" });
    await migration.up(R.knex);
    assert.equal((await getPermissions("legacy")).role, "admin");
    await migration.down(R.knex);
    assert.equal(await R.knex.schema.hasTable("user_monitor_permission"), false);
    await migration.up(R.knex);
});

beforeEach(async () => {
    for (const name of [
        "better_auth_session",
        "better_auth_account",
        "better_auth_twoFactor",
        "monitor",
        "status_page",
        "better_auth_user",
    ]) {
        await R.knex(name).del();
    }
    await R.knex("better_auth_user").insert([
        { id: "admin", username: "admin", role: "admin", twoFactorEnabled: 1 },
        { id: "owner", username: "owner", role: "owner", twoFactorEnabled: 0 },
        { id: "member", username: "member", role: "member", twoFactorEnabled: 0 },
        { id: "other", username: "other", role: "admin", twoFactorEnabled: 0 },
    ]);
    await R.knex("monitor").insert([{ id: 1, user_id: "member" }, { id: 2 }, { id: 3, parent: 1 }]);
    await R.knex("status_page").insert([
        { id: 1, slug: "allowed" },
        { id: 2, slug: "other" },
    ]);
});

after(async () => {
    await R.knex.destroy();
});

test("Members read all monitors and pages while writes require an explicit grant", async () => {
    let member = await getPermissions("member");
    for (const event of [
        "getMonitorList",
        "getMonitor",
        "getMonitorChartData",
        "getHeartbeatHistory",
        "getStatusPage",
    ]) {
        await authorize(member, event, [2]);
    }
    for (const event of [
        "add",
        "addStatusPage",
        "setSettings",
        "addNotification",
        "shrinkDatabase",
        "saveManagedIncident",
        "createAccount",
        "getAccounts",
        "setAccountRole",
        "deleteAccount",
        "unknownOperation",
    ]) {
        await assert.rejects(authorize(member, event, []), /Permission denied/);
    }
    await accounts.savePermissions("owner", "member", { monitorIDs: [1], statusPageIDs: [1] });
    member = await getPermissions("member");
    assert.deepEqual(member.statusPageSlugs, ["allowed"]);
    await authorize(member, "clearEvents", [1]);
    await authorize(member, "saveStatusPage", ["allowed"]);
    await assert.rejects(authorize(member, "pauseMonitor", [2]), /Permission denied/);
    await assert.rejects(authorize(member, "saveStatusPage", ["other"]), /Permission denied/);
    // Pausing/deleting/editing a group cannot affect an unassigned descendant.
    for (const event of ["editMonitor", "pauseMonitor", "resumeMonitor", "deleteMonitor"]) {
        await assert.rejects(
            authorize(member, event, event === "editMonitor" ? [{ id: 1 }] : [1, true]),
            /Permission denied/
        );
    }
    await accounts.savePermissions("owner", "member", { monitorIDs: [1, 3], statusPageIDs: [1] });
    member = await getPermissions("member");
    await authorize(member, "pauseMonitor", [1]);
    await authorize(member, "editMonitor", [{ id: 3, parent: 1 }]);
    await assert.rejects(authorize(member, "editMonitor", [{ id: 3, parent: 2 }]), /Permission denied/);
});

test("Owners manage shared resources and Member grants but cannot administer accounts", async () => {
    const owner = await getPermissions("owner");
    for (const event of [
        "add",
        "addStatusPage",
        "editMonitor",
        "saveStatusPage",
        "setSettings",
        "saveAccountPermissions",
        "getAccounts",
    ]) {
        await authorize(owner, event, []);
    }
    for (const event of ["createAccount", "setAccountRole", "deleteAccount"]) {
        await assert.rejects(authorize(owner, event, []), /Permission denied/);
    }
    await assert.rejects(accounts.setRole("owner", "other", "member"), /Permission denied/);
    await assert.rejects(accounts.remove("owner", "member"), /Permission denied/);
    await assert.rejects(
        accounts.savePermissions("member", "member", { monitorIDs: [1], statusPageIDs: [] }),
        /Permission denied/
    );
    await assert.rejects(
        accounts.savePermissions("owner", "admin", { monitorIDs: [1], statusPageIDs: [] }),
        /only be assigned to Members/
    );
});

test("permission replacement is atomic and revocation takes effect on the next operation", async () => {
    await accounts.savePermissions("admin", "member", { monitorIDs: [2], statusPageIDs: [1] });
    await assert.rejects(
        accounts.savePermissions("owner", "member", { monitorIDs: [1], statusPageIDs: [999] }),
        /Resource not found/
    );
    assert.deepEqual((await getPermissions("member")).monitorIDs, [2]);
    await assert.rejects(
        accounts.savePermissions("owner", "member", { monitorIDs: ["2"], statusPageIDs: [] }),
        /Invalid resource/
    );
    await accounts.savePermissions("owner", "member", { monitorIDs: [], statusPageIDs: [] });
    await assert.rejects(authorize(await getPermissions("member"), "pauseMonitor", [2]), /Permission denied/);
});

test("Admins can promote and demote other accounts while their own account remains protected", async () => {
    await assert.rejects(accounts.setRole("admin", "admin", "member"), /Invalid account role change/);
    await assert.rejects(accounts.remove("admin", "admin"), /own account/);
    await assert.rejects(accounts.setRole("admin", "other", "invalid"), /Invalid account role change/);
    await accounts.savePermissions("owner", "member", { monitorIDs: [2], statusPageIDs: [1] });
    await accounts.setRole("admin", "member", "owner");
    await authorize(await getPermissions("member"), "add", []);
    await accounts.setRole("admin", "member", "member");
    assert.deepEqual((await getPermissions("member")).monitorIDs, []);
    await accounts.setRole("admin", "other", "member");
    await assert.rejects(accounts.setRole("other", "admin", "member"), /Permission denied/);
    // Both administrators cannot concurrently demote one another and leave no Admin.
    await accounts.setRole("admin", "other", "admin");
    const results = await Promise.allSettled([
        accounts.setRole("admin", "other", "member"),
        accounts.setRole("other", "admin", "member"),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((await R.knex("better_auth_user").where("role", "admin")).length, 1);
});

test("account lists contain role and 2FA state; deletion revokes credentials without deleting shared monitors", async () => {
    const users = await accounts.list("owner");
    assert.deepEqual(Object.keys(users[0]).sort(), [
        "id",
        "monitorIDs",
        "role",
        "statusPageIDs",
        "twoFactorEnabled",
        "username",
    ]);
    assert.equal(users.find((user) => user.id === "admin").twoFactorEnabled, true);
    await assert.rejects(accounts.list("member"), /Permission denied/);
    await accounts.savePermissions("owner", "member", { monitorIDs: [1], statusPageIDs: [1] });
    for (const table of ["better_auth_session", "better_auth_account", "better_auth_twoFactor"]) {
        await R.knex(table).insert({ id: table, userId: "member" });
    }
    await accounts.remove("admin", "member");
    await assert.rejects(getPermissions("member"), /not logged in/);
    assert.equal((await R.knex("monitor").where("id", 1).first()).user_id, null);
    assert.equal((await R.knex("user_monitor_permission")).length, 0);
    for (const table of ["better_auth_session", "better_auth_account", "better_auth_twoFactor"]) {
        assert.equal((await R.knex(table)).length, 0);
    }
});
