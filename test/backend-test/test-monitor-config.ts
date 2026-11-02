import { describe, test } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Monitor = require("../../server/model/monitor");
const { monitorConfigSchema } = require("../../server/types");

/**
 * Create a mock monitor with a stored config
 * @param {object} config Stored config
 * @returns {object} Mock monitor object
 */
function createMonitor(config) {
    return Object.create(Monitor.prototype, {
        config: {
            value: JSON.stringify(config),
            writable: true,
            enumerable: true,
        },
    });
}

describe("monitorConfigSchema", () => {
    test("validates preset durations and requires positive custom minutes", () => {
        for (const [preset, minutes] of [
            ["default", 0],
            ["day", 1440],
            ["week", 10080],
            ["half-month", 21600],
            ["month", 43200],
            ["custom", 90],
            ["custom", 1440],
        ]) {
            const config = { statusPageHeartbeatWindowPreset: preset, statusPageHeartbeatWindow: minutes };
            assert.deepStrictEqual(monitorConfigSchema.parse(config), config);
        }
        for (const config of [
            { statusPageHeartbeatWindowPreset: "custom", statusPageHeartbeatWindow: 0 },
            { statusPageHeartbeatWindowPreset: "custom" },
            { statusPageHeartbeatWindowPreset: "month", statusPageHeartbeatWindow: 90 },
            { statusPageHeartbeatWindowPreset: "invalid", statusPageHeartbeatWindow: 90 },
        ]) {
            assert.throws(() => monitorConfigSchema.parse(config));
        }
    });
    test("validates the public heartbeat window", () => {
        for (const value of [0, 1, 90, 525600]) {
            assert.strictEqual(
                monitorConfigSchema.parse({ statusPageHeartbeatWindow: value }).statusPageHeartbeatWindow,
                value
            );
        }
        for (const value of [-1, 1.5, 525601, "60", null]) {
            assert.throws(
                () => monitorConfigSchema.parse({ statusPageHeartbeatWindow: value }),
                /statusPageHeartbeatWindow/
            );
        }
    });
    test("strips keys a client may not write", () => {
        assert.deepStrictEqual(monitorConfigSchema.parse({ systemServiceName: "nginx", injected: 1 }), {
            systemServiceName: "nginx",
        });
    });
});

describe("Monitor.getConfig()", () => {
    test("returns the whole config", () => {
        assert.deepStrictEqual(createMonitor({ a: 1 }).getConfig(), { a: 1 });
    });

    test("returns an empty object for invalid JSON", () => {
        const monitor = Object.create(Monitor.prototype, { config: { value: "{oops", writable: true } });

        assert.deepStrictEqual(monitor.getConfig(), {});
    });

    test("returns an empty object for a missing config", () => {
        assert.deepStrictEqual(Object.create(Monitor.prototype).getConfig(), {});
    });
});

describe("Monitor.getConfigValue()", () => {
    test("returns one key", () => {
        assert.strictEqual(createMonitor({ a: 1 }).getConfigValue("a"), 1);
    });

    test("returns the default for a missing key", () => {
        assert.strictEqual(createMonitor({}).getConfigValue("a", "fallback"), "fallback");
    });
});

describe("Monitor.setConfigValue()", () => {
    test("sets one key and keeps the others", () => {
        const monitor = createMonitor({ a: 1 });

        monitor.setConfigValue("b", 2);

        assert.deepStrictEqual(monitor.getConfig(), { a: 1, b: 2 });
    });
});

describe("Monitor.applyClientConfig()", () => {
    test("persists and publishes a preset without exposing the full monitor config", async () => {
        const monitor = createMonitor({ private_key: "hidden" });
        monitor.applyClientConfig({ statusPageHeartbeatWindow: 43200, statusPageHeartbeatWindowPreset: "month" });
        assert.equal(monitor.getConfig().statusPageHeartbeatWindowPreset, "month");
        const publicMonitor = await monitor.toPublicJSON();
        assert.equal(publicMonitor.statusPageHeartbeatWindowPreset, "month");
        assert.equal(publicMonitor.config, undefined);
        monitor.applyClientConfig({ statusPageHeartbeatWindow: 43200, statusPageHeartbeatWindowPreset: "custom" });
        assert.equal((await monitor.toPublicJSON()).statusPageHeartbeatWindowPreset, "custom");
    });
    test("saves and resets the heartbeat window without overwriting other config", async () => {
        const monitor = createMonitor({ server_key: 1 });
        monitor.applyClientConfig({ statusPageHeartbeatWindow: 1440 });
        assert.deepStrictEqual(monitor.getConfig(), { server_key: 1, statusPageHeartbeatWindow: 1440 });
        assert.strictEqual((await monitor.toPublicJSON()).statusPageHeartbeatWindow, 1440);
        assert.strictEqual((await monitor.toPublicJSON()).config, undefined);
        monitor.applyClientConfig({ statusPageHeartbeatWindow: 0 });
        assert.deepStrictEqual(monitor.getConfig(), { server_key: 1, statusPageHeartbeatWindow: 0 });
    });
    test("writes a known key one at a time", () => {
        const monitor = createMonitor({});

        monitor.applyClientConfig({ systemServiceName: "nginx" });

        assert.deepStrictEqual(monitor.getConfig(), { systemServiceName: "nginx" });
    });

    test("keeps stored keys the client did not send", () => {
        const monitor = createMonitor({ server_key: 1 });

        monitor.applyClientConfig({ systemServiceName: "nginx" });

        assert.deepStrictEqual(monitor.getConfig(), { server_key: 1, systemServiceName: "nginx" });
    });

    test("ignores keys the client is not allowed to write", () => {
        const monitor = createMonitor({ server_key: 1 });

        monitor.applyClientConfig({ server_key: 2, injected: "x" });

        assert.deepStrictEqual(monitor.getConfig(), { server_key: 1 });
    });

    test("ignores a payload without a config", () => {
        const monitor = createMonitor({ server_key: 1 });

        monitor.applyClientConfig(undefined);
        monitor.applyClientConfig(null);

        assert.deepStrictEqual(monitor.getConfig(), { server_key: 1 });
    });

    test("rejects a service name that is not a string", () => {
        const monitor = createMonitor({});

        assert.throws(() => monitor.applyClientConfig({ systemServiceName: 42 }), /systemServiceName/);
        assert.deepStrictEqual(monitor.getConfig(), {});
    });
});
