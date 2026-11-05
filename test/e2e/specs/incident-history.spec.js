import { expect, test } from "../fixtures";
import { login, restoreSqliteSnapshot, screenshot } from "../util-test";

test.describe("Incident History", () => {
    test.beforeEach(async ({ page }) => {
        await restoreSqliteSnapshot(page);
    });

    test("past incidents section is hidden when no incidents exist", async ({ page }, testInfo) => {
        test.setTimeout(60000);

        await page.goto("./add");
        await login(page);
        await expect(page.getByTestId("monitor-type-select")).toBeVisible();

        await page.goto("./add-status-page");
        await page.getByTestId("name-input").fill("Empty Test");
        await page.getByTestId("slug-input").fill("empty-test");
        await page.getByTestId("submit-button").click();
        await page.waitForURL("/status/empty-test?edit");

        await page.getByTestId("save-button").click();
        await expect(page.getByTestId("edit-sidebar")).toHaveCount(0);

        const pastIncidentsSection = page.locator(".past-incidents-section");
        await expect(pastIncidentsSection).toHaveCount(0);

        await screenshot(testInfo, page);
    });

    test("active pinned incidents are shown at top and not in past incidents", async ({ page }, testInfo) => {
        test.setTimeout(60000);

        await page.goto("./add");
        await login(page);
        await expect(page.getByTestId("monitor-type-select")).toBeVisible();

        await page.goto("./add-status-page");
        await page.getByTestId("name-input").fill("Dedup Test");
        await page.getByTestId("slug-input").fill("dedup-test");
        await page.getByTestId("submit-button").click();
        await page.waitForURL("/status/dedup-test?edit");

        await page.getByTestId("create-incident-button").click();
        await page.getByTestId("incident-edit").getByTestId("incident-title").fill("Active Incident");
        await page.getByTestId("incident-content-editable").fill("This is an active incident");
        await page.getByTestId("post-incident-button").click();

        await page.waitForTimeout(500);

        await page.getByTestId("save-button").click();
        await expect(page.getByTestId("edit-sidebar")).toHaveCount(0);

        const activeIncident = page.getByTestId("incident").filter({ hasText: "Active Incident" });
        await expect(activeIncident).toBeVisible();

        const pastIncidentsSection = page.locator(".past-incidents-section");
        await expect(pastIncidentsSection).toHaveCount(0);

        await screenshot(testInfo, page);
    });

    test("resolved incidents stay visible with their progress label", async ({ page }, testInfo) => {
        test.setTimeout(120000);

        await page.goto("./add");
        await login(page);
        await expect(page.getByTestId("monitor-type-select")).toBeVisible();

        await page.goto("./add-status-page");
        await page.getByTestId("name-input").fill("Resolve Test");
        await page.getByTestId("slug-input").fill("resolve-test");
        await page.getByTestId("submit-button").click();
        await page.waitForURL("/status/resolve-test?edit");

        await page.getByTestId("create-incident-button").click();
        await page.getByTestId("incident-edit").getByTestId("incident-title").fill("Resolved Incident");
        await page.getByTestId("incident-content-editable").fill("This incident will be resolved");
        await page.getByTestId("post-incident-button").click();

        await page.waitForTimeout(500);

        const activeIncidentBanner = page.getByTestId("incident").filter({ hasText: "Resolved Incident" });
        await expect(activeIncidentBanner).toBeVisible({ timeout: 10000 });

        await expect(activeIncidentBanner.getByRole("button", { name: "Resolve", exact: true })).toHaveCount(0);
        await page.getByTestId("save-button").click();
        await expect(page.getByTestId("edit-sidebar")).toHaveCount(0);
        await page.goto("./incidents");
        await page.getByRole("link", { name: "Resolved Incident", exact: true }).click();
        await page.locator("#incident-progress-label").selectOption("resolved");
        await page.locator("#incident-progress").fill("Service restored");
        await page.getByRole("button", { name: "Add Progress", exact: true }).click();
        await expect(page.getByTestId("incident-progress-entry")).toHaveCount(2);
        await page.goto("./status/resolve-test");
        await expect(page.getByTestId("incident").locator(".incident-label-resolved")).toBeVisible();
        await expect(page.locator(".past-incidents-section")).toHaveCount(0);

        await screenshot(testInfo, page);
    });

    test("incident history pagination loads more incidents", async ({ page }, testInfo) => {
        test.setTimeout(180000);

        await page.goto("./add");
        await login(page);
        await expect(page.getByTestId("monitor-type-select")).toBeVisible();

        await page.goto("./add-status-page");
        await page.getByTestId("name-input").fill("Pagination Test");
        await page.getByTestId("slug-input").fill("pagination-test");
        await page.getByTestId("submit-button").click();
        await page.waitForURL("/status/pagination-test?edit");

        for (let i = 1; i <= 12; i++) {
            await page.getByTestId("create-incident-button").click();
            await page
                .getByTestId("incident-edit")
                .getByTestId("incident-title")
                .fill("Incident " + i);
            await page.getByTestId("incident-content-editable").fill("Content for incident " + i);
            await page.getByTestId("post-incident-button").click();
            await page.waitForTimeout(300);
        }

        await page.evaluate(async () => {
            const socket = document.querySelector("#app")._vnode.component.proxy.getSocket();
            await new Promise((resolve) => socket.emit("unpinIncident", "pagination-test", resolve));
        });
        await page.getByTestId("save-button").click();
        await expect(page.getByTestId("edit-sidebar")).toHaveCount(0);

        await page.reload();
        await page.waitForTimeout(1000);

        const pastIncidentsSection = page.locator(".past-incidents-section");
        await expect(pastIncidentsSection).toBeVisible();

        const loadMoreButton = page.locator("button", { hasText: "Load More" });

        await expect(pastIncidentsSection.locator(".incident-title")).toHaveCount(10);
        await loadMoreButton.click();
        await expect(pastIncidentsSection.locator(".incident-title")).toHaveCount(12);
        await screenshot(testInfo, page);
    });
});
