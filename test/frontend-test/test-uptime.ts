import { test } from "node:test";
import assert from "node:assert/strict";
import { formatUptime } from "../../src/uptime";

test("availability always displays two decimal places and never rounds an outage up to 100%", () => {
    assert.equal(formatUptime(1), "100.00%");
    assert.equal(formatUptime(0), "0.00%");
    assert.equal(formatUptime(0.99999), "99.99%");
    assert.equal(formatUptime(1 - Number.EPSILON), "99.99%");
    assert.equal(formatUptime(0.999949), "99.99%");
    assert.equal(formatUptime(0.9999), "99.99%");
    assert.equal(formatUptime(2 / 3), "66.67%");
    assert.equal(formatUptime(0.9), "90.00%");
    assert.equal(formatUptime(-1), "0.00%");
    assert.equal(formatUptime(1.1), "100.00%");
    for (const value of [undefined, null, NaN, Infinity, "1"]) {
        assert.equal(formatUptime(value), null);
    }
});
