import { test, expect } from "../fixtures";
import { login, restoreSqliteSnapshot } from "../util-test";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";

test.beforeEach(async () => {
    await restoreSqliteSnapshot();
});

/**
 * Call an operation through the page's authenticated socket.
 * @param {import("@playwright/test").Page} page Browser page
 * @param {string} event Operation name
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

/**
 * Sign in using a new account and wait for its permissions.
 * @param {import("@playwright/test").Page} page Browser page
 * @param {string} username Account username
 * @param {string} password Password
 * @param {string} role Expected role
 * @returns {Promise<void>}
 */
async function signIn(page, username, password, role) {
    await page.goto("/dashboard");
    await page.getByPlaceholder("Username").fill(username);
    await page.getByPlaceholder("Password").fill(password);
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect
        .poll(() => page.evaluate(() => document.querySelector("#app")._vnode.component.proxy.permissions.role))
        .toBe(role);
}

test("manages accounts, scoped Member access, passwords, 2FA, role changes, and deletion", async ({
    page,
    browser,
}, testInfo) => {
    test.setTimeout(180000);
    await page.goto("/add");
    await login(page);
    await page.getByTestId("friendly-name-input").fill("Assigned monitor");
    await page.getByTestId("url-input").fill("http://localhost:3001/api/entry-page");
    await page.getByTestId("save-button").click();
    await page.waitForURL(/\/dashboard\/\d+/);
    const assignedID = Number(page.url().split("/").pop());
    const firstMonitor = (await request(page, "getMonitor", assignedID)).monitor;
    await page.goto("/add");
    await page.getByTestId("monitor-type-select").selectOption("push");
    await page.getByTestId("friendly-name-input").fill("Other monitor");
    await page.locator("#interval").fill("3600");
    await page.getByTestId("save-button").click();
    await page.waitForURL(/\/dashboard\/\d+/);
    const otherID = Number(page.url().split("/").pop());
    expect((await request(page, "addStatusPage", "Assigned page", "assigned-page")).ok).toBe(true);
    expect((await request(page, "addStatusPage", "Other page", "other-page")).ok).toBe(true);
    const pageConfig = (await request(page, "getStatusPage", "assigned-page")).config;

    await page.goto("/settings/security");
    await expect(page.getByTestId("account-management")).toBeVisible();
    const credentials = {};
    for (const role of ["member", "owner"]) {
        await page.locator("#account-username").fill(`test_${role}`);
        await page.locator("#account-role").selectOption(role);
        await page.getByRole("button", { name: "Create Account", exact: true }).click();
        await expect(page.getByTestId("initial-password")).toBeVisible();
        credentials[role] = await page.locator("#account-initial-password").inputValue();
        expect(credentials[role]).toMatch(/^[A-Za-z0-9_-]{32}$/);
        await page.getByTestId("initial-password").getByRole("button", { name: "Done" }).click();
        await expect(page.locator(`[data-account-username="test_${role}"]`)).toContainText("Disabled");
    }
    expect(credentials.member).not.toBe(credentials.owner);
    const users = (await request(page, "getAccounts")).accounts;
    const memberID = users.find((user) => user.username === "test_member").id;
    const ownerID = users.find((user) => user.username === "test_owner").id;
    expect((await request(page, "createAccount", { username: "TEST_MEMBER", role: "admin" })).ok).toBe(false);
    expect((await request(page, "createAccount", { username: "bad", role: "superadmin" })).ok).toBe(false);

    const memberContext = await browser.newContext({ baseURL: "http://localhost:3001" });
    const ownerContext = await browser.newContext({ baseURL: "http://localhost:3001" });
    const member = await memberContext.newPage();
    const owner = await ownerContext.newPage();
    const errors = [];
    member.on("pageerror", (error) => errors.push(error.message));
    owner.on("pageerror", (error) => errors.push(error.message));
    try {
        await signIn(member, "test_member", credentials.member, "member");
        await signIn(owner, "test_owner", credentials.owner, "owner");
        await expect(member.getByRole("link", { name: "Add New Monitor" })).toHaveCount(0);
        expect((await request(member, "getMonitor", otherID)).monitor.pushToken).toBeUndefined();
        expect((await request(member, "getHeartbeatHistory", assignedID)).ok).toBe(true);
        expect((await request(member, "getMonitorChartData", assignedID, 24)).ok).toBe(true);
        expect((await request(member, "getStatusPage", "other-page")).ok).toBe(true);
        for (const [event, ...args] of [
            ["pauseMonitor", assignedID],
            ["deleteMonitor", otherID],
            ["editMonitor", { ...firstMonitor, name: "Denied" }],
            ["add", firstMonitor],
            ["addStatusPage", "Denied", "denied"],
            ["saveStatusPage", "other-page", {}],
            ["getAccounts"],
            ["createAccount", { username: "escalation", role: "admin" }],
            ["setAccountRole", memberID, "admin"],
            ["setSettings", {}, ""],
        ]) {
            expect((await request(member, event, ...args)).ok, event).toBe(false);
        }

        await owner.goto("/settings/security");
        await expect(owner.getByTestId("account-management")).toBeVisible();
        await expect(owner.getByTestId("create-account-form")).toHaveCount(0);
        await expect(
            owner.getByTestId("account-management").getByRole("button", { name: "Delete", exact: true })
        ).toHaveCount(0);
        for (const [event, ...args] of [
            ["setAccountRole", memberID, "owner"],
            ["deleteAccount", memberID],
            ["createAccount", { username: "denied_owner", role: "admin" }],
        ]) {
            expect((await request(owner, event, ...args)).ok).toBe(false);
        }
        const memberRow = owner.locator('[data-account-username="test_member"]');
        await memberRow.getByRole("button", { name: "Edit Permissions" }).click();
        await owner.locator(`#permission-monitor-${assignedID}`).check();
        await owner.locator(`#permission-page-${pageConfig.id}`).check();
        await owner.getByTestId("account-permissions").getByRole("button", { name: "Save", exact: true }).click();
        await expect
            .poll(() =>
                member.evaluate(() => document.querySelector("#app")._vnode.component.proxy.permissions.monitorIDs)
            )
            .toEqual([assignedID]);
        expect((await request(member, "pauseMonitor", assignedID)).ok).toBe(true);
        expect((await request(member, "resumeMonitor", assignedID)).ok).toBe(true);
        await member.goto(`/edit/${assignedID}`);
        await member.getByTestId("friendly-name-input").fill("Member edit");
        await expect(member.getByRole("button", { name: "Setup Notification", exact: true })).toHaveCount(0);
        await member.getByTestId("save-button").click();
        await expect
            .poll(async () => (await request(member, "getMonitor", assignedID)).monitor.name)
            .toBe("Member edit");
        const config = (await request(member, "getStatusPage", "assigned-page")).config;
        expect(
            (
                await request(
                    member,
                    "saveStatusPage",
                    "assigned-page",
                    { ...config, title: "Member page edit" },
                    config.icon || "/icon.svg",
                    []
                )
            ).ok
        ).toBe(true);
        expect((await request(member, "pauseMonitor", otherID)).ok).toBe(false);
        expect((await request(owner, "editMonitor", { ...firstMonitor, name: "Owner edit" })).ok).toBe(true);
        expect((await request(owner, "addStatusPage", "Owner created", "owner-created")).ok).toBe(true);
        const sharedSettings = (await request(owner, "getSettings")).data;
        expect(
            (await request(owner, "setSettings", { ...sharedSettings, primaryBaseURL: "https://example.test" }, "")).ok
        ).toBe(true);
        expect(
            (await request(owner, "setSettings", { ...sharedSettings, disableAuth: true }, credentials.owner)).ok
        ).toBe(false);

        expect(
            (
                await request(
                    owner,
                    "setSettings",
                    { ...sharedSettings, primaryBaseURL: sharedSettings.primaryBaseURL || "" },
                    ""
                )
            ).ok
        ).toBe(true);

        // A public-page deep link uses the same grants without loading the dashboard first.
        await member.goto("/status/assigned-page");
        await expect(member.getByTestId("edit-button")).toBeVisible();
        await member.getByTestId("edit-button").click();
        await expect(member.getByTestId("edit-sidebar")).toHaveAttribute("data-status-page-id", /^\d+$/);
        await member.getByTestId("add-group-button").click();
        await member.getByTestId("group-name").fill("Member group");
        await Promise.all([member.waitForEvent("load"), member.getByTestId("save-button").click()]);
        await expect(member.getByTestId("group-name")).toContainText("Member group");
        await member.goto("/status/other-page?edit");
        await expect(member.getByTestId("edit-button")).toHaveCount(0);
        await expect(member.getByTestId("edit-sidebar")).toHaveCount(0);
        await member.goto("/dashboard");
        await expect
            .poll(() =>
                member
                    .evaluate(() => document.querySelector("#app")._vnode.component.proxy.permissions.role)
                    .catch(() => null)
            )
            .toBe("member");
        expect(
            (await request(owner, "saveAccountPermissions", memberID, { monitorIDs: [], statusPageIDs: [] })).ok
        ).toBe(true);
        expect((await request(member, "pauseMonitor", assignedID)).ok).toBe(false);

        // Members can update their own password and configure their own 2FA.
        await member.goto("/settings/security");
        await expect(member.getByTestId("account-management")).toHaveCount(0);
        await expect(member.locator("#disableAuth-btn")).toHaveCount(0);
        const replacement = "New-Member-Password-7fB2xR9k";
        await member.locator("#current-password:visible").fill(credentials.member);
        await member.locator("#new-password").fill(replacement);
        await member.locator("#repeat-new-password").fill(replacement);
        const changed = member.waitForResponse((response) => response.url().endsWith("/api/auth/change-password"));
        await member.getByRole("button", { name: "Update Password" }).click();
        expect((await changed).ok()).toBe(true);
        await expect(member.locator("#current-password:visible")).toHaveValue("");
        const oldLogin = await memberContext.request.post("/api/auth/sign-in/username", {
            headers: { origin: "http://localhost:3001" },
            data: { username: "test_member", password: credentials.member },
        });
        expect(oldLogin.ok()).toBe(false);
        const enabled = await memberContext.request.post("/api/auth/two-factor/enable", {
            headers: { origin: "http://localhost:3001" },
            data: { password: replacement },
        });
        expect(enabled.ok(), await enabled.text()).toBe(true);
        const secret = new URL((await enabled.json()).totpURI).searchParams.get("secret");
        const code = await createOTP(base32.decode(secret)).totp();
        const verified = await memberContext.request.post("/api/auth/two-factor/verify-totp", {
            headers: { origin: "http://localhost:3001" },
            data: { code },
        });
        expect(verified.ok(), await verified.text()).toBe(true);
        await owner.reload();
        await expect(owner.locator('[data-account-username="test_member"]')).toContainText("Enabled");

        // Promotion and demotion apply to existing authenticated sessions.
        const roleSelect = page.locator('[data-account-username="test_member"] select');
        await roleSelect.selectOption("admin");
        await expect
            .poll(() =>
                member
                    .evaluate(() => document.querySelector("#app")._vnode.component.proxy.permissions.role)
                    .catch(() => null)
            )
            .toBe("admin");
        expect((await request(member, "getAccounts")).ok).toBe(true);
        await roleSelect.selectOption("member");
        await expect
            .poll(() =>
                member
                    .evaluate(() => document.querySelector("#app")._vnode.component.proxy.permissions.role)
                    .catch(() => null)
            )
            .toBe("member");
        expect((await request(member, "createAccount", { username: "after_demotion", role: "admin" })).ok).toBe(false);

        // The alternate auth HTTP endpoints cannot bypass role checks.
        for (const path of ["set-role", "create-user", "remove-user"]) {
            const response = await memberContext.request.post(`/api/auth/admin/${path}`, {
                data: { userId: memberID, role: "admin" },
            });
            expect(response.status()).toBe(404);
        }
        await page.setViewportSize({ width: 390, height: 844 });
        await testInfo.attach("accounts-mobile", {
            body: await page.screenshot({ fullPage: true, path: testInfo.outputPath("accounts-mobile.png") }),
            contentType: "image/png",
        });
        await page
            .locator('[data-account-username="test_member"]')
            .getByRole("button", { name: "Delete", exact: true })
            .click();
        await page.locator(".modal.show").getByRole("button", { name: "Yes", exact: true }).click();
        await expect(page.locator('[data-account-username="test_member"]')).toHaveCount(0);
        await expect(member.getByPlaceholder("Username")).toBeVisible();
        expect((await memberContext.request.get("/api/account-permissions")).status()).toBe(401);
        expect((await request(page, "getMonitor", assignedID)).ok).toBe(true);
        expect((await request(page, "deleteAccount", ownerID)).ok).toBe(true);
        expect(errors).toEqual([]);
    } finally {
        await memberContext.close();
        await ownerContext.close();
    }
});
