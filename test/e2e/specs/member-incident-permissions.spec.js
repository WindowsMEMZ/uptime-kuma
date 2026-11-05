import { test, expect } from "../fixtures";
import { login, restoreSqliteSnapshot } from "../util-test";

/**
 * Invoke an authenticated dashboard operation.
 * @param {import("@playwright/test").Page} page Page
 * @param {string} event Operation
 * @param {...any} args Arguments
 * @returns {Promise<object>} Response
 */
async function request(page, event, ...args) {
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

test("Members can manage incidents and planned maintenance only with their respective grants", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(60000);
    await restoreSqliteSnapshot();
    await page.goto("/add");
    await login(page);
    await page.getByTestId("friendly-name-input").fill("Permission monitor");
    await page.getByTestId("url-input").fill("http://localhost:3001/api/entry-page");
    await page.getByTestId("save-button").click();
    await page.waitForURL(/\/dashboard\/\d+/);
    await page.goto("/settings/security");
    await page.locator("#account-username").fill("incident_member");
    await page.getByRole("button", { name: "Create Account", exact: true }).click();
    const password = await page.locator("#account-initial-password").inputValue();
    await page.getByTestId("initial-password").screenshot({ path: testInfo.outputPath("initial-password-panel.png") });
    const account = (await request(page, "getAccounts")).accounts.find((row) => row.username === "incident_member");
    const context = await browser.newContext({ baseURL: "http://localhost:3001" });
    const member = await context.newPage();
    try {
        await member.goto("/dashboard");
        await member.getByPlaceholder("Username").fill("incident_member");
        await member.getByPlaceholder("Password").fill(password);
        await member.getByRole("button", { name: "Log in", exact: true }).click();
        await expect
            .poll(() => member.evaluate(() => document.querySelector("#app")._vnode.component.proxy.permissions.role))
            .toBe("member");
        expect(
            (
                await request(member, "saveManagedIncident", {
                    title: "Denied",
                    content: "Denied",
                    monitors: [],
                    statusPageIDs: [],
                })
            ).ok
        ).toBe(false);
        expect((await request(member, "addMaintenance", {})).ok).toBe(false);
        await page
            .locator('[data-account-username="incident_member"]')
            .getByRole("button", { name: "Edit Permissions" })
            .click();
        await page.locator("#permission-incidents").check();
        await page.getByTestId("account-permissions").getByRole("button", { name: "Save", exact: true }).click();
        await member.goto("/incidents/new");
        await member.locator("#incident-title").fill("Member incident");
        await member.locator("#incident-initial-progress").fill("Investigating");
        await member.getByTestId("incident-settings").getByRole("button", { name: "Save", exact: true }).click();
        await member.waitForURL(/\/incidents\/\d+/);
        const incidentID = Number(member.url().split("/").pop());
        expect((await request(member, "saveIncidentUpdate", incidentID, null, "Identified", "identified")).ok).toBe(
            true
        );
        expect((await request(member, "addMaintenance", {})).ok).toBe(false);

        await page
            .locator('[data-account-username="incident_member"]')
            .getByRole("button", { name: "Edit Permissions" })
            .click();
        await page.locator("#permission-maintenance").check();
        await page.getByTestId("account-permissions").getByRole("button", { name: "Save", exact: true }).click();
        await member.goto("/add-maintenance");
        await member.locator("#name").fill("Member maintenance");
        await member.locator("#strategy").selectOption("single");
        await member.getByText("Pick Affected Monitors…").click();
        await member.getByRole("option", { name: "Permission monitor" }).click();
        await member.keyboard.press("Escape");
        await member.locator("#monitor-submit-btn").click();
        await member.waitForURL(/\/maintenance$/);
        await expect(member.locator(".item", { hasText: "Member maintenance" })).toBeVisible();
        await member
            .locator(".item", { hasText: "Member maintenance" })
            .getByRole("link", { name: /edit/i })
            .first()
            .click();
        await expect(member.locator(".multiselect__tag")).toContainText("Permission monitor");
        await member.locator("#name").fill("Member updated maintenance");
        await member.locator("#monitor-submit-btn").click();
        await member.waitForURL(/\/maintenance$/);
        await expect(member.locator(".item", { hasText: "Member updated maintenance" })).toBeVisible();
        expect((await request(member, "setSettings", {}, "")).ok).toBe(false);
        expect((await request(member, "addStatusPage", "Denied", "denied")).ok).toBe(false);
        expect(
            (
                await request(page, "saveAccountPermissions", account.id, {
                    monitorIDs: [],
                    statusPageIDs: [],
                    canManageIncidents: false,
                    canManageMaintenance: false,
                })
            ).ok
        ).toBe(true);
        expect((await request(member, "saveIncidentUpdate", incidentID, null, "Denied")).ok).toBe(false);
        expect((await request(member, "addMaintenance", {})).ok).toBe(false);
        await member.goto("/incidents/new");
        await expect(member.getByTestId("incident-settings")).toHaveCount(0);
    } finally {
        await context.close().catch(() => {});
    }
});
