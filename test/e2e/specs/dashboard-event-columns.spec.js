import { expect, test } from "../fixtures";
import { login, restoreSqliteSnapshot } from "../util-test";

test.beforeEach(async () => {
    await restoreSqliteSnapshot();
});

/**
 * Invoke an authenticated dashboard operation.
 * @param {import("@playwright/test").Page} page Page
 * @param {string} event Socket operation
 * @param {any[]} args Operation arguments
 * @returns {Promise<object>} Operation response
 */
function request(page, event, ...args) {
    return page.evaluate(
        ({ event, args }) =>
            new Promise((resolve) => {
                document
                    .querySelector("#app")
                    ._vnode.component.proxy.getSocket()
                    .emit(event, ...args, resolve);
            }),
        { event, args }
    );
}

test("keeps event columns readable and remembers resizing across reloads and group changes", async ({
    page,
}, testInfo) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("./add");
    await login(page);
    await page.getByTestId("monitor-type-select").selectOption("group");
    await page.getByTestId("friendly-name-input").fill("上游服务");
    await page.getByTestId("save-button").click();
    await page.waitForURL(/\/dashboard\/\d+/);
    await page.goto("./add");
    await page.getByTestId("friendly-name-input").fill("Darock 官网");
    await page.getByTestId("url-input").fill("http://localhost:3001/api/entry-page");
    await page.locator("#monitorGroupSelector").selectOption({ label: "上游服务" });
    await page.getByTestId("save-button").click();
    await page.waitForURL(/\/dashboard\/\d+/);
    const monitorID = Number(page.url().split("/").pop());
    await expect(page.getByTestId("monitor-status")).toHaveText("Up");
    await page.goto("./dashboard");
    await page.evaluate(() => (document.querySelector("#app")._vnode.component.proxy.language = "zh-CN"));

    const table = page.getByTestId("dashboard-events");
    const header = (key) => table.locator(`th[data-column="${key}"]`);
    const width = (key) => header(key).evaluate((element) => element.getBoundingClientRect().width);
    const nameHandle = header("name").getByRole("separator");
    await expect(header("group")).toHaveText("分组名称");
    await expect(table.locator(".event-time").first()).toBeVisible();
    const lineCount = await table
        .locator(".event-time span")
        .first()
        .evaluate((element) => {
            const range = document.createRange();
            range.selectNodeContents(element);
            return range.getClientRects().length;
        });
    expect(lineCount).toBe(1);
    await page.screenshot({ path: testInfo.outputPath("event-columns-default.png"), animations: "disabled" });

    const originalWidth = await width("name");
    const handle = await nameHandle.boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 120, handle.y + handle.height / 2, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => width("name")).toBeCloseTo(originalWidth + 120, 0);
    const savedWidth = await width("name");
    await page.reload();
    await expect.poll(() => width("name")).toBeCloseTo(savedWidth, 0);

    const monitor = (await request(page, "getMonitor", monitorID)).monitor;
    expect((await request(page, "editMonitor", { ...monitor, parent: null })).ok).toBe(true);
    await expect(header("group")).toHaveCount(0);
    await expect.poll(() => width("name")).toBeCloseTo(savedWidth, 0);
    await nameHandle.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => width("name")).toBeCloseTo(savedWidth + 10, 0);
    await page.keyboard.press("Home");
    await expect.poll(() => width("name")).toBeCloseTo(originalWidth, 0);

    await header("time").getByRole("separator").focus();
    await page.keyboard.press("ArrowRight");
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(table.locator("thead")).toBeHidden();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({
        path: testInfo.outputPath("event-columns-mobile.png"),
        fullPage: true,
        animations: "disabled",
    });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("button", { name: "重置列宽", exact: true }).click();
    await expect(page.getByRole("button", { name: "重置列宽", exact: true })).toHaveCount(0);
    await page.evaluate(() => (document.querySelector("#app")._vnode.component.proxy.userTheme = "dark"));
    await page.screenshot({ path: testInfo.outputPath("event-columns-dark.png"), animations: "disabled" });

    await page.evaluate(() => localStorage.setItem("dashboardEventColumnWidths", "invalid JSON"));
    await page.reload();
    await expect(header("time")).toBeVisible();
    await expect.poll(() => width("name")).toBeCloseTo(originalWidth, 0);
    await page.getByRole("link", { name: "Darock 官网", exact: true }).last().click();
    await page.waitForURL(`/dashboard/${monitorID}`);
    await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "仪表盘" }).click();
    await expect(table).toBeVisible();
    expect(await table.evaluate((element) => element.clientWidth >= element.parentElement.clientWidth)).toBe(true);
});
