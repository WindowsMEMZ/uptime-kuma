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
    for (const windowMinutes of [0, 1440]) {
        test(`hides retries from public history and availability with a ${windowMinutes}-minute window`, async ({
            page,
        }) => {
            test.setTimeout(90_000);
            const pushUrl = await addPushMonitor(page, "Retry Monitor");
            const monitorID = Number(page.url().split("/").pop());
            await page.goto(`/edit/${monitorID}`);
            await page.locator("#maxRetries").fill("2");
            await page.getByTestId("status-page-heartbeat-window").fill(String(windowMinutes));
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
                await expect(page.getByText(expectedStatus, { exact: true })).toBeVisible();
                const pill = page.getByTestId("monitor").locator(".info .badge");
                await expect(pill).toHaveText(`${Math.round(expectedUptime * 10000) / 100}%`);
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

    test("saves a per-monitor window and renders aggregated history for visitors", async ({ page }) => {
        await addPushMonitor(page, "Window Monitor");
        const monitorID = Number(page.url().split("/").pop());
        await addStatusPageWithMonitor(page, "Window Demo", "window-demo", "Window Monitor");

        // Prime both public caches before changing the monitor's window.
        await page.request.get("/api/status-page/window-demo");
        await page.request.get("/api/status-page/heartbeat/window-demo");
        await page.goto(`/edit/${monitorID}`);
        const windowInput = page.getByTestId("status-page-heartbeat-window");
        await expect(windowInput).toHaveValue("0");
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
