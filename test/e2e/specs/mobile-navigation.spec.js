import { expect, test } from "../fixtures";
import { login, restoreSqliteSnapshot } from "../util-test";

test.beforeEach(async () => {
    await restoreSqliteSnapshot();
});

/**
 * Capture the completed route after Vue's enter and leave transitions settle.
 * @param {import("@playwright/test").Page} page Page
 * @param {import("@playwright/test").TestInfo} testInfo Test info
 * @param {string} name Screenshot name
 * @returns {Promise<void>} Completion
 */
async function capture(page, testInfo, name) {
    await expect(page.locator(".slide-fade-enter-active, .slide-fade-leave-active")).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(name), animations: "disabled", fullPage: true });
}

test("uses top navigation on phones while keeping monitors and settings reachable", async ({ page }, testInfo) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("./dashboard");
    await login(page);
    const mainNav = page.getByRole("navigation", { name: "Main navigation" });
    const monitorNav = page.getByRole("navigation", { name: "Monitor navigation" });
    await expect(mainNav).toBeVisible();
    await expect(page.locator(".bottom-nav")).toHaveCount(0);
    await monitorNav.getByRole("link", { name: "Add New Monitor" }).click();
    await page.getByTestId("friendly-name-input").fill("Mobile website");
    await page.getByTestId("url-input").fill("http://localhost:3001/api/entry-page");
    await page.getByTestId("save-button").click();
    await page.waitForURL(/\/dashboard\/\d+/);
    await expect(page.getByTestId("monitor-status")).toHaveText("Up");
    const monitorURL = new URL(page.url()).pathname;
    await monitorNav.getByRole("link", { name: "Monitors", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Monitors", exact: true })).toBeVisible();
    await capture(page, testInfo, "mobile-monitors.png");
    await page
        .getByTestId("monitor-list")
        .getByRole("link", { name: /Mobile website/ })
        .click();
    await page.waitForURL(monitorURL);
    await monitorNav.getByRole("link", { name: "Overview", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Quick Stats" })).toBeVisible();
    await capture(page, testInfo, "mobile-overview.png");

    await mainNav.getByRole("link", { name: "Incidents", exact: true }).click();
    await page.getByRole("link", { name: "Create Incident", exact: true }).click();
    await expect(page.locator("#incident-title")).toBeVisible();
    await expect(mainNav.getByRole("link", { name: "Incidents", exact: true })).toHaveClass(/active/);
    await mainNav.getByRole("link", { name: "Maintenance", exact: true }).click();
    await page.getByRole("link", { name: "Schedule Maintenance", exact: true }).click();
    await page.waitForURL("/add-maintenance");
    await expect(mainNav.getByRole("link", { name: "Maintenance", exact: true })).toHaveClass(/active/);
    await mainNav.getByRole("link", { name: "Status Pages", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Status Pages", exact: true })).toBeVisible();
    await mainNav.getByRole("link", { name: "Settings", exact: true }).click();
    await page.waitForURL("/settings");
    await page.getByRole("link", { name: "Appearance", exact: true }).click();
    await expect(page.locator("#settings-section")).toHaveValue("appearance");
    await page.getByLabel("Theme", { exact: true }).selectOption("dark");
    await capture(page, testInfo, "mobile-appearance-dark.png");
    await page.locator("#settings-section").selectOption("security");
    await expect(page.getByRole("heading", { name: "Passkeys", exact: true })).toBeVisible();
    for (const width of [320, 390, 767]) {
        await page.setViewportSize({ width, height: 844 });
        await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        const bounds = await mainNav.getByRole("link", { name: "Settings", exact: true }).boundingBox();
        expect(bounds.y).toBeLessThan(120);
        expect(bounds.x).toBeGreaterThanOrEqual(0);
        await expect
            .poll(async () => {
                const current = await mainNav.getByRole("link", { name: "Settings", exact: true }).boundingBox();
                return current.x >= 0 && current.x + current.width <= width;
            })
            .toBe(true);
    }
    await page.locator("#settings-section").selectOption("appearance");
    await page.getByLabel("Theme", { exact: true }).selectOption("light");
    await page.setViewportSize({ width: 390, height: 844 });
    await capture(page, testInfo, "mobile-appearance-light.png");
    await mainNav.getByRole("link", { name: "Dashboard", exact: true }).click();
    await monitorNav.getByRole("link", { name: "Monitors", exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.waitForURL("/dashboard");
    await expect(mainNav).toBeVisible();
    await expect(monitorNav).toHaveCount(0);
    await expect(page.locator(".monitor-sidebar")).toBeVisible();
    await expect(page.locator(".bottom-nav")).toHaveCount(0);
});
