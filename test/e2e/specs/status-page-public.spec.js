import { expect, test } from "../fixtures";
import { login, restoreSqliteSnapshot } from "../util-test";
import BetterSqlite3 from "better-sqlite3";
import dayjs from "dayjs";

test.beforeEach(async ({ page }) => {
    await restoreSqliteSnapshot(page);
});

/**
 * Create an HTTP monitor
 * @param {import("@playwright/test").Page} page Page
 * @param {string} name Monitor name
 * @returns {Promise<void>}
 */
async function addHttpMonitor(page, name) {
    await page.goto("./add");
    await login(page);
    await page.getByTestId("monitor-type-select").selectOption("http");
    await page.getByTestId("friendly-name-input").fill(name);
    await page.getByTestId("url-input").fill("https://example.com");
    await page.getByTestId("save-button").click();
    await page.waitForURL(/\/dashboard\/\d+/);
    return page.url().split("/").pop();
}

/**
 * Create a push monitor and return its push URL
 * @param {import("@playwright/test").Page} page Page
 * @param {string} name Monitor name
 * @returns {Promise<string>} Push URL
 */
async function addPushMonitor(page, name) {
    await page.goto("./add");
    await login(page);
    await page.getByTestId("monitor-type-select").selectOption("push");
    await page.getByTestId("friendly-name-input").fill(name);
    await page.getByTestId("save-button").click();
    await page.waitForURL(/\/dashboard\/\d+/);
    return await page.locator('a[href*="/api/push/"]').first().getAttribute("href");
}

/**
 * Create a status page with one group holding the given monitor
 * @param {import("@playwright/test").Page} page Page
 * @param {string} name Status page name
 * @param {string} slug Status page slug
 * @param {string} monitorName Monitor to publish
 * @returns {Promise<void>}
 */
async function addStatusPageWithMonitor(page, name, slug, monitorName) {
    await page.goto("./add-status-page");
    await page.getByTestId("name-input").fill(name);
    await page.getByTestId("slug-input").fill(slug);
    await page.getByTestId("submit-button").click();
    await page.waitForURL(`/status/${slug}?edit`);
    await expect(page.getByTestId("edit-sidebar")).toHaveAttribute("data-status-page-id", /^\d+$/);

    await page.getByTestId("add-group-button").click();
    await page.getByTestId("group-name").fill("Core");
    await page.getByTestId("monitor-select").click();
    await page.getByTestId("monitor-select").getByRole("option", { name: monitorName }).click();
    await expect(page.getByTestId("monitor")).toHaveCount(1);

    // Saving reloads the page, the edit sidebar disappears afterwards
    await Promise.all([page.waitForEvent("load"), page.getByTestId("save-button").click()]);
    await expect(page.getByTestId("edit-sidebar")).toHaveCount(0);
}

test.describe("Public status page", () => {
    test("saves every preset, validates custom minutes, and keeps daily cells on mobile", async ({ page }) => {
        test.setTimeout(90_000);
        const pushUrl = await addPushMonitor(page, "Preset Monitor");
        const monitorID = Number(page.url().split("/").pop());
        await page.request.get(pushUrl);
        await addStatusPageWithMonitor(page, "Preset Demo", "preset-demo", "Preset Monitor");
        await page.goto(`/edit/${monitorID}`);
        const select = page.getByTestId("status-page-heartbeat-window-preset");
        const input = page.getByTestId("status-page-heartbeat-window");
        await expect(select.locator("option")).toHaveText([
            "Default",
            "One day",
            "One week",
            "Half a month",
            "One month",
            "Custom",
        ]);
        const db = new BetterSqlite3("data/playwright-test/kuma.db", { readonly: true });
        let monthBuckets;
        try {
            for (const [preset, minutes, columns] of [
                ["default", 0, 0],
                ["day", 1440, 24],
                ["week", 10080, 7],
                ["half-month", 21600, 15],
                ["month", 43200, 30],
            ]) {
                await select.selectOption(preset);
                await expect(input).toHaveCount(0);
                await page.getByTestId("save-button").click();
                await expect(page.getByText("Saved.", { exact: true }).last()).toBeVisible();
                await expect
                    .poll(() => JSON.parse(db.prepare("SELECT config FROM monitor WHERE id=?").get(monitorID).config))
                    .toMatchObject({ statusPageHeartbeatWindow: minutes, statusPageHeartbeatWindowPreset: preset });
                const response = await page.request.get(`/api/status-page/heartbeat/preset-demo?preset=${preset}`);
                const { heartbeatBarList } = await response.json();
                if (columns) {
                    const buckets = heartbeatBarList[monitorID];
                    expect(buckets).toHaveLength(columns);
                    expect(buckets.every((bucket) => bucket.calendarUnit === (preset === "day" ? "hour" : "day"))).toBe(
                        true
                    );
                    if (preset === "month") {
                        monthBuckets = buckets;
                    }
                } else {
                    expect(heartbeatBarList[monitorID]).toBeUndefined();
                }
                await page.reload();
                await expect(select).toHaveValue(preset);
            }
            await expect(select).toHaveValue("month");
            await select.selectOption("custom");
            await expect(input).toHaveValue("43200");
            await page.getByTestId("save-button").click();
            await expect
                .poll(
                    () =>
                        JSON.parse(db.prepare("SELECT config FROM monitor WHERE id=?").get(monitorID).config)
                            .statusPageHeartbeatWindowPreset
                )
                .toBe("custom");
            const customResponse = await page.request.get("/api/status-page/heartbeat/preset-demo?preset=month");
            expect((await customResponse.json()).heartbeatBarList[monitorID]).toHaveLength(100);
            await page.reload();
            await expect(select).toHaveValue("custom");
            await input.fill("");
            await page.getByTestId("save-button").click();
            expect(await input.evaluate((element) => element.validity.valid)).toBe(false);
            expect(
                JSON.parse(db.prepare("SELECT config FROM monitor WHERE id=?").get(monitorID).config)
                    .statusPageHeartbeatWindowPreset
            ).toBe("custom");
            await input.fill("0");
            expect(await input.evaluate((element) => element.checkValidity())).toBe(false);
            await input.fill("90");
            await page.getByTestId("save-button").click();
            await expect
                .poll(
                    () =>
                        JSON.parse(db.prepare("SELECT config FROM monitor WHERE id=?").get(monitorID).config)
                            .statusPageHeartbeatWindow
                )
                .toBe(90);
            await page.reload();
            await expect(select).toHaveValue("custom");
            await expect(input).toHaveValue("90");
            await select.selectOption("month");
            await page.getByTestId("save-button").click();
            await expect
                .poll(
                    () =>
                        JSON.parse(db.prepare("SELECT config FROM monitor WHERE id=?").get(monitorID).config)
                            .statusPageHeartbeatWindowPreset
                )
                .toBe("month");
        } finally {
            db.close();
        }

        await page.context().clearCookies();
        await page.setViewportSize({ width: 390, height: 800 });
        await page.goto("/status/preset-demo");
        const canvas = page.locator("canvas.heartbeat-canvas").first();
        await expect(canvas).toBeVisible();
        await canvas.focus();
        await canvas.press("Home");
        await expect(page.locator(".tooltip-time")).toHaveText(monthBuckets[0].label);
        await canvas.press("End");
        await expect(page.locator(".tooltip-time")).toHaveText(monthBuckets.at(-1).label);
        await canvas.press("ArrowLeft");
        await expect(page.locator(".tooltip-time")).toHaveText(monthBuckets.at(-2).label);
        await expect(canvas).toHaveAttribute("aria-label", /^Heartbeat history: 30 intervals/);
        const bounds = await canvas.boundingBox();
        await page.mouse.move(bounds.x + bounds.width / 60, bounds.y + bounds.height / 2);
        await expect(page.locator(".tooltip-time")).toHaveText(monthBuckets[0].label);
        await page.mouse.move(bounds.x + (bounds.width * 59) / 60, bounds.y + bounds.height / 2);
        await expect(page.locator(".tooltip-time")).toHaveText(monthBuckets.at(-1).label);
    });

    for (const windowMinutes of [0, 1440]) {
        test(`hides retries from public history and availability with a ${windowMinutes}-minute window`, async ({
            page,
        }) => {
            test.setTimeout(90_000);
            const pushUrl = await addPushMonitor(page, "Retry Monitor");
            const monitorID = Number(page.url().split("/").pop());
            await page.goto(`/edit/${monitorID}`);
            await page.locator("#maxRetries").fill("2");
            await page
                .getByTestId("status-page-heartbeat-window-preset")
                .selectOption(windowMinutes ? "custom" : "default");
            if (windowMinutes) {
                await page.getByTestId("status-page-heartbeat-window").fill(String(windowMinutes));
            }
            await page.getByTestId("save-button").click();
            await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
            await addStatusPageWithMonitor(page, "Retry Demo", "retry-demo", "Retry Monitor");

            let phase = 0;
            await page.route("**/api/status-page/heartbeat/retry-demo", async (route) => {
                await route.continue({ url: route.request().url() + `?phase=${phase}` });
            });
            const push = async (status) => {
                const url = new URL(pushUrl);
                url.searchParams.set("status", status);
                const response = await page.request.get(url.toString());
                expect((await response.json()).ok).toBe(true);
            };
            const visit = async (expectedStatus, expectedUptime, expectedHistory) => {
                phase++;
                const polling = page.waitForResponse((response) =>
                    response.url().includes(`/api/status-page/heartbeat/retry-demo?phase=${phase}`)
                );
                await page.goto("/status/retry-demo");
                const { heartbeatList, heartbeatBarList, uptimeList } = await (await polling).json();
                expect(heartbeatList[monitorID].map((beat) => beat.status)).toEqual(expectedHistory);
                expect(uptimeList[`${monitorID}_24`]).toBeCloseTo(expectedUptime);
                expect(uptimeList[`${monitorID}_statusPage`]).toBeCloseTo(expectedUptime);
                await expect(page.getByText(expectedStatus, { exact: true })).toBeVisible();
                const pill = page.getByTestId("monitor").locator(".info .badge");
                await expect(pill).toHaveText(`${(Math.round(expectedUptime * 10000) / 100).toFixed(2)}%`);
                await expect(pill).toHaveClass(expectedHistory.at(-1) === 1 ? /bg-primary/ : /bg-danger/);
                const badge = await page.request.get(`/api/status-page/retry-demo/badge?phase=${phase}`);
                expect(await badge.text()).toContain(expectedHistory.at(-1) === 1 ? "Up" : "Down");
                const rss = await page.request.get(`/status/retry-demo/rss?phase=${phase}`);
                expect((await rss.text()).includes("Retry Monitor is down")).toBe(expectedHistory.at(-1) === 0);
                if (windowMinutes > 0) {
                    const buckets = heartbeatBarList[monitorID];
                    const failures = buckets.reduce((sum, bucket) => sum + bucket.downCount, 0);
                    expect(failures).toBe(expectedHistory.filter((status) => status === 0).length);
                    if (failures === 0) {
                        expect(buckets.every((bucket) => bucket.status === 1 || bucket.status === null)).toBe(true);
                    }
                }
            };

            await push("up");
            // Non-explicit failures use the same retry counter as missed push heartbeats.
            await push("error");
            await push("error");
            await page.context().clearCookies();
            await visit("All Systems Operational", 1, [1]);

            const db = new BetterSqlite3("data/playwright-test/kuma.db", { readonly: true });
            try {
                const attempts = db
                    .prepare("SELECT status, retries FROM heartbeat WHERE monitor_id = ? ORDER BY id")
                    .all(monitorID);
                expect(attempts).toEqual([
                    { status: 1, retries: 0 },
                    { status: 2, retries: 1 },
                    { status: 2, retries: 2 },
                ]);
                const stats = db
                    .prepare("SELECT SUM(up) AS up, SUM(down) AS down FROM stat_minutely WHERE monitor_id = ?")
                    .get(monitorID);
                expect(stats).toEqual({ up: 1, down: 0 });
            } finally {
                db.close();
            }

            await push("up");
            await visit("All Systems Operational", 1, [1, 1]);
            await push("error");
            await push("error");
            await visit("All Systems Operational", 1, [1, 1]);
            await push("error");
            await visit("Degraded Service", 2 / 3, [1, 1, 0]);
        });
    }

    test("uses the full 30-day window and caps rare outages at 99.99%", async ({ page }) => {
        test.setTimeout(90_000);
        const pushUrl = await addPushMonitor(page, "Rare Outage Monitor");
        const monitorID = Number(page.url().split("/").pop());
        await page.goto(`/edit/${monitorID}`);
        await page.getByTestId("status-page-heartbeat-window-preset").selectOption("month");
        await page.getByTestId("save-button").click();
        await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
        await page.request.get(pushUrl);

        const db = new BetterSqlite3("data/playwright-test/kuma.db");
        try {
            const insert = db.prepare(
                "INSERT INTO heartbeat (monitor_id,status,time,retries,important) VALUES (?,?,?,?,0)"
            );
            const timestamp = (daysAgo) =>
                dayjs().subtract(daysAgo, "days").toISOString().replace("T", " ").replace("Z", "");
            db.transaction(() => {
                db.prepare("DELETE FROM heartbeat WHERE monitor_id=?").run(monitorID);
                for (let index = 0; index < 20001; index++) {
                    insert.run(monitorID, 1, timestamp(index === 0 ? 10 : 0.01), 0);
                }
                insert.run(monitorID, 0, timestamp(10), 0);
                insert.run(monitorID, 0, timestamp(31), 0);
                insert.run(monitorID, 3, timestamp(5), 0);
                insert.run(monitorID, 2, timestamp(0.001), 1);
            })();
        } finally {
            db.close();
        }

        await addStatusPageWithMonitor(page, "Rare Outage Demo", "rare-outage", "Rare Outage Monitor");
        await page.context().clearCookies();
        const polling = page.waitForResponse((response) =>
            response.url().endsWith("/api/status-page/heartbeat/rare-outage")
        );
        await page.goto("/status/rare-outage");
        const { heartbeatBarList, uptimeList } = await (await polling).json();
        expect(uptimeList[`${monitorID}_24`]).toBe(1);
        expect(uptimeList[`${monitorID}_statusPage`]).toBeCloseTo(20001 / 20002, 10);
        const buckets = heartbeatBarList[monitorID];
        expect(buckets.reduce((sum, bucket) => sum + bucket.downCount, 0)).toBe(1);
        expect(buckets.some((bucket) => bucket.status === 2)).toBe(true);
        const pill = page.getByTestId("monitor").locator(".info .badge");
        await expect(pill).toHaveText("99.99%");
        await expect(pill).toHaveAttribute("title", "30 days");
        await expect(page.getByText("All Systems Operational", { exact: true })).toBeVisible();
    });

    test("saves a per-monitor window and renders aggregated history for visitors", async ({ page }) => {
        await addPushMonitor(page, "Window Monitor");
        const monitorID = Number(page.url().split("/").pop());
        await addStatusPageWithMonitor(page, "Window Demo", "window-demo", "Window Monitor");

        // Prime both public caches before changing the monitor's window.
        await page.request.get("/api/status-page/window-demo");
        await page.request.get("/api/status-page/heartbeat/window-demo");
        await page.goto(`/edit/${monitorID}`);
        const windowInput = page.getByTestId("status-page-heartbeat-window");
        await expect(page.getByTestId("status-page-heartbeat-window-preset")).toHaveValue("default");
        await expect(windowInput).toHaveCount(0);
        await page.getByTestId("status-page-heartbeat-window-preset").selectOption("custom");
        await expect(windowInput).toHaveValue("");
        await windowInput.fill("1440");

        const db = new BetterSqlite3("data/playwright-test/kuma.db");
        try {
            const now = dayjs();
            const insert = db.prepare(
                "INSERT INTO heartbeat (monitor_id, status, time, important) VALUES (?, ?, ?, 0)"
            );
            db.prepare("DELETE FROM heartbeat WHERE monitor_id = ?").run(monitorID);
            for (const [hoursAgo, status] of [
                [21, 1],
                [18, 0],
                [12, 0],
                [12.001, 1],
                [6, 3],
                [0.05, 0],
                [0.01, 1],
            ]) {
                insert.run(
                    monitorID,
                    status,
                    now
                        .subtract(hoursAgo * 3600, "seconds")
                        .toISOString()
                        .replace("T", " ")
                        .replace("Z", "")
                );
            }
        } finally {
            db.close();
        }

        await page.getByTestId("save-button").click();
        await expect(page.getByText("Saved.", { exact: true })).toBeVisible();
        await page.goto(`/edit/${monitorID}`);
        await expect(windowInput).toHaveValue("1440");

        await page.context().clearCookies();
        const polling = page.waitForResponse((response) =>
            response.url().endsWith("/api/status-page/heartbeat/window-demo")
        );
        await page.goto("/status/window-demo");
        const response = await polling;
        expect(response.status()).toBe(200);
        const { heartbeatList, heartbeatBarList } = await response.json();
        const buckets = heartbeatBarList[monitorID];
        expect(buckets).toHaveLength(100);
        expect(buckets.map((bucket) => bucket.status)).toEqual(expect.arrayContaining([0, 1, 2, 3, null]));
        expect(heartbeatList[monitorID].at(-1).status).toBe(1);
        expect(buckets.at(-1).status).toBe(2);
        await expect(page.getByText("All Systems Operational")).toBeVisible();
        await expect(page.locator(".word").first()).toContainText("1d");

        const canvas = page.locator("canvas.heartbeat-canvas").first();
        await expect(canvas).toBeVisible();
        // Inspect the rendered canvas colors, rather than Vue's internal state.
        const colors = await canvas.evaluate((element) => {
            const context = element.getContext("2d");
            const pixels = context.getImageData(0, Math.floor(element.height / 2), element.width, 1).data;
            const painted = new Set();
            for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i + 3] === 255) {
                    painted.add(`rgb(${pixels[i]}, ${pixels[i + 1]}, ${pixels[i + 2]})`);
                }
            }
            const root = getComputedStyle(document.documentElement);
            const expected = ["--bs-primary", "--bs-danger", "--bs-warning"].map((name) => {
                context.fillStyle = root.getPropertyValue(name).trim();
                context.fillRect(0, 0, 1, 1);
                const value = context.getImageData(0, 0, 1, 1).data;
                return `rgb(${value[0]}, ${value[1]}, ${value[2]})`;
            });
            return { painted: [...painted], expected };
        });
        expect(colors.painted).toEqual(expect.arrayContaining(colors.expected));
        const bounds = await canvas.boundingBox();
        await page.mouse.move(bounds.x + bounds.width - 5, bounds.y + bounds.height / 2);
        await expect(page.locator(".tooltip-status")).toHaveText("Partial outage");
        await expect(page.locator(".tooltip-message")).toContainText("failed");

        await page.setViewportSize({ width: 900, height: 800 });
        await expect(page.locator(".word").first()).toContainText("1d");
        await expect(canvas).toHaveAttribute("aria-label", /up, [1-9]\d* down/);
        await page.setViewportSize({ width: 390, height: 800 });
        await expect(canvas).toBeVisible();
    });

    test("shows a published monitor to logged-out visitors", async ({ page }) => {
        const monitorID = await addHttpMonitor(page, "Public Monitor");
        await addStatusPageWithMonitor(page, "Public Demo", "public-demo", "Public Monitor");

        // Visit the page like a visitor without a session
        await page.context().clearCookies();
        await page.goto("./status/public-demo");

        await expect(page.getByTestId("group-name")).toContainText("Core");
        await expect(page.getByTestId("monitor-name")).toContainText("Public Monitor");
        await expect(page.getByTestId("edit-button")).toHaveCount(0);

        // The public monitor also answers the avg-response badge from its history
        const badge = await page.request.get(`/api/badge/${monitorID}/avg-response/24`);
        expect(badge.status()).toBe(200);
        expect(await badge.text()).toContain("<svg");
    });

    test("shows an active maintenance window to logged-out visitors", async ({ page }) => {
        const pushUrl = await addPushMonitor(page, "Maintenance Monitor");
        await addStatusPageWithMonitor(page, "Maintenance Demo", "maintenance-demo", "Maintenance Monitor");

        // A single window covering now, linked to the status page
        await page.goto("./add-maintenance");
        await page.locator("#name").fill("Planned Window");
        await page.locator("#strategy").selectOption("single");
        await page.getByText("Pick Affected Monitors…").click();
        await page.getByRole("option", { name: "Maintenance Monitor" }).click();
        await page.keyboard.press("Escape");
        await page.getByText("Select status pages…").click();
        await page.getByRole("option", { name: "Maintenance Demo" }).click();
        await page.keyboard.press("Escape");
        await page.locator("#monitor-submit-btn").click();
        await page.waitForURL(/\/maintenance$/);

        // The beat inside the window is recorded as maintenance
        await page.request.get(pushUrl);

        await page.context().clearCookies();
        await page.goto("./status/maintenance-demo");

        await expect(page.getByRole("alert").filter({ hasText: "Planned Window" })).toBeVisible();
        await expect(page.getByTestId("monitor-name")).toContainText("Maintenance Monitor");
    });
});
