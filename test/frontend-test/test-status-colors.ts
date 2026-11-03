import { test } from "node:test";
import assert from "node:assert/strict";
import {
    DEFAULT_STATUS_COLORS,
    normalizeStatusColors,
    statusColorForeground,
    validateStatusColors,
} from "../../src/status-colors";

test("stored colors use independent defaults and reject CSS injection", () => {
    const colors = normalizeStatusColors({ light: { up: "#ABCDEF", down: "url(https://example.com)" } });
    assert.equal(colors.light.up, "#abcdef");
    assert.equal(colors.light.down, DEFAULT_STATUS_COLORS.light.down);
    assert.deepEqual(colors.dark, DEFAULT_STATUS_COLORS.dark);
    colors.dark.up = "#000000";
    assert.equal(DEFAULT_STATUS_COLORS.dark.up, "#5cdd8b");
    for (const value of [null, undefined, false, 7, "red", []]) {
        assert.deepEqual(normalizeStatusColors(value), DEFAULT_STATUS_COLORS);
    }
});

test("saving requires valid colors for every status in both themes", () => {
    assert.doesNotThrow(() => validateStatusColors(DEFAULT_STATUS_COLORS));
    for (const value of [
        null,
        {},
        { light: DEFAULT_STATUS_COLORS.light },
        { ...DEFAULT_STATUS_COLORS, dark: { up: "#fff" } },
    ]) {
        assert.throws(() => validateStatusColors(value), /Invalid status color/);
    }
});

test("badge text remains readable on both bright and dark custom colors", () => {
    assert.equal(statusColorForeground("#ffffff"), "#000000");
    assert.equal(statusColorForeground("#ffff00"), "#000000");
    assert.equal(statusColorForeground("#000000"), "#ffffff");
    assert.equal(statusColorForeground("#1747f5"), "#ffffff");
});
