import { expect, test } from "../fixtures";
import { login, restoreSqliteSnapshot } from "../util-test";
import BetterSqlite3 from "better-sqlite3";
import { DEFAULT_STATUS_COLORS, STATUS_COLOR_KEYS } from "../../../src/status-colors";

test.beforeEach(async () => {
    await restoreSqliteSnapshot();
});

/**
 * Read the solid pixels painted by a heartbeat canvas.
 * @param {import("@playwright/test").Locator} canvas Canvas
 * @returns {Promise<string[]>} Unique hex colors
 */
async function canvasColors(canvas) {
    return canvas.evaluate((element) => {
        const pixels = element.getContext("2d").getImageData(0, 0, element.width, element.height).data;
        const colors = new Set();
        for (let index = 0; index < pixels.length; index += 4) {
            if (pixels[index + 3] === 255) {
                colors.add(
                    "#" +
                        Array.from(pixels.slice(index, index + 3), (value) => value.toString(16).padStart(2, "0")).join(
                            ""
                        )
                );
            }
        }
        return [...colors];
    });
}

test("shares saved palettes with internal pages and every public page, including live canvas updates", async ({
    page,
    browser,
}) => {
    test.setTimeout(90_000);
    await page.goto("./add");
    await login(page);
    await page.getByTestId("monitor-type-select").selectOption("push");
    await page.getByTestId("friendly-name-input").fill("Color Monitor");
    await page.getByTestId("save-button").click();
    await page.waitForURL(/\/dashboard\/\d+/);
    const monitorID = Number(page.url().split("/").pop());
    const db = new BetterSqlite3("data/playwright-test/kuma.db");
    try {
        const insert = db.prepare(
            "INSERT INTO heartbeat (monitor_id,status,time,retries,important) VALUES (?,?,?,?,0)"
        );
        for (const [index, status] of [0, 2, 3, 1].entries()) {
            insert.run(
                monitorID,
                status,
                new Date(Date.now() - (3 - index) * 60000 + 1000).toISOString().replace("T", " ").replace("Z", ""),
                0
            );
        }
    } finally {
        db.close();
    }

    for (const slug of ["colors-one", "colors-two"]) {
        await page.goto("./add-status-page");
        await page.getByTestId("name-input").fill(slug);
        await page.getByTestId("slug-input").fill(slug);
        await page.getByTestId("submit-button").click();
        await page.waitForURL(`/status/${slug}?edit`);
        await expect(page.getByTestId("edit-sidebar")).toHaveAttribute("data-status-page-id", /^\d+$/);
        await page.getByTestId("refresh-interval-input").fill("5");
        await page.getByTestId("add-group-button").click();
        await page.getByTestId("group-name").fill("Core");
        await page.getByTestId("monitor-select").click();
        await page.getByTestId("monitor-select").getByRole("option", { name: "Color Monitor" }).click();
        await Promise.all([page.waitForEvent("load"), page.getByTestId("save-button").click()]);
    }

    const visitor = await browser.newContext({ baseURL: "http://localhost:3001" });
    const publicPage = await visitor.newPage();
    const dashboard = await page.context().newPage();
    try {
        // Warm both public config/HTML caches before changing the server-wide palette.
        for (const slug of ["colors-one", "colors-two"]) {
            await publicPage.goto(`/status/${slug}`);
            await expect(publicPage.locator("canvas.heartbeat-canvas")).toBeVisible();
        }
        await dashboard.goto(`/dashboard/${monitorID}`);
        await expect(dashboard.getByTestId("monitor-status")).toBeVisible();
        await page.goto("./settings/appearance");
        const form = page.getByTestId("status-colors-form");
        await expect(form.locator('input[type="color"]')).toHaveCount(12);
        await page.getByLabel("Theme", { exact: true }).selectOption("light");
        const palettes = {
            light: {
                up: "#123456",
                down: "#f02040",
                pending: "#aabb00",
                maintenance: "#6611aa",
                unknown: "#888899",
                empty: "#abcdef",
            },
            dark: {
                up: "#fedcba",
                down: "#aa3355",
                pending: "#ffbb11",
                maintenance: "#4499ff",
                unknown: "#eeeeaa",
                empty: "#221133",
            },
        };
        for (const theme of ["light", "dark"]) {
            for (const status of STATUS_COLOR_KEYS) {
                await page.locator(`#status-color-${theme}-${status}`).fill(palettes[theme][status]);
            }
        }
        await form.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page.getByText("Saved.", { exact: true }).last()).toBeVisible();

        // An already open authenticated page receives the palette over its socket.
        await expect(dashboard.getByTestId("monitor-status")).toHaveCSS("background-color", "rgb(18, 52, 86)");
        await expect(dashboard.locator(".item .status-badge")).toHaveCSS("color", "rgb(255, 255, 255)");
        const internalCanvas = dashboard.locator("canvas.heartbeat-canvas").last();
        for (const status of ["up", "down", "pending", "maintenance", "empty"]) {
            await expect.poll(() => canvasColors(internalCanvas)).toContain(palettes.light[status]);
        }
        await page.reload();
        await expect(page.locator("#status-color-dark-up")).toHaveValue(palettes.dark.up);

        for (const slug of ["colors-one", "colors-two"]) {
            const config = await (await publicPage.request.get(`/api/status-page/${slug}`)).json();
            expect(config.config.statusColors).toEqual(palettes);
            await publicPage.goto(`/status/${slug}`);
            await expect(publicPage.locator(".status-badge")).toHaveCSS("background-color", "rgb(18, 52, 86)");
            await publicPage.addStyleTag({ content: ".light .info .status-badge { color: black !important; }" });
            await expect(publicPage.locator(".status-badge")).toHaveCSS("color", "rgb(255, 255, 255)");
            for (const status of ["up", "down", "pending", "maintenance", "empty"]) {
                await expect
                    .poll(() => canvasColors(publicPage.locator("canvas.heartbeat-canvas")))
                    .toContain(palettes.light[status]);
            }
        }
        // The status page follows its configured theme, independently of the dashboard's theme.
        await publicPage.evaluate(() => {
            document.querySelector("#app")._vnode.component.proxy.statusPageTheme = "dark";
        });
        await expect(publicPage.locator(".status-badge")).toHaveCSS("background-color", "rgb(254, 220, 186)");
        await publicPage.addStyleTag({ content: ".dark .info .status-badge { color: white !important; }" });
        await expect(publicPage.locator(".status-badge")).toHaveCSS("color", "rgb(0, 0, 0)");
        for (const status of ["up", "down", "pending", "maintenance", "empty"]) {
            await expect
                .poll(() => canvasColors(publicPage.locator("canvas.heartbeat-canvas")))
                .toContain(palettes.dark[status]);
        }

        await page.getByLabel("Theme", { exact: true }).selectOption("dark");
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: test.info().outputPath("status-colors-mobile.png"), fullPage: true });
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.screenshot({ path: test.info().outputPath("status-colors-desktop.png"), fullPage: true });

        // Invalid values never replace the last saved palette.
        const invalid = await page.evaluate(async () => {
            const root = document.querySelector("#app")._vnode.component.proxy;
            return new Promise((resolve) =>
                root.getSocket().emit("setSettings", { statusColors: { light: { up: "red" } } }, null, resolve)
            );
        });
        expect(invalid.ok).toBe(false);
        expect((await (await page.request.get("/api/status-page/heartbeat/colors-one")).json()).statusColors).toEqual(
            palettes
        );

        await form.getByRole("button", { name: "Restore default colors" }).click();
        await form.getByRole("button", { name: "Save", exact: true }).click();
        // Already open anonymous pages receive updates through their normal heartbeat polling.
        await expect
            .poll(
                async () => {
                    return publicPage.evaluate(
                        () => document.querySelector("#app")._vnode.component.proxy.statusColors
                    );
                },
                { timeout: 20_000 }
            )
            .toEqual(DEFAULT_STATUS_COLORS);
        await expect(publicPage.locator(".status-badge")).toHaveCSS("background-color", "rgb(92, 221, 139)");
    } finally {
        await dashboard.close();
        await visitor.close();
    }
});
