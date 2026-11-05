import { test, expect } from "../fixtures";
import { login, restoreSqliteSnapshot } from "../util-test";
import { createOTP } from "@better-auth/utils/otp";
import { base32 } from "@better-auth/utils/base32";
import BetterSqlite3 from "better-sqlite3";

const password = "Kuma-E2E-8f4Q2xR9p";
const origin = "http://localhost:3001";

test.beforeEach(async () => {
    await restoreSqliteSnapshot();
});

/**
 * Start a login without completing the second factor.
 * @param {import("@playwright/test").Page} page Page
 * @returns {Promise<object>} Sign-in response
 */
async function beginLogin(page) {
    await page.goto("/dashboard");
    await page.getByPlaceholder("Username").fill("admin");
    await page.getByPlaceholder("Password").fill(password);
    const response = page.waitForResponse((res) => res.url().endsWith("/api/auth/sign-in/username"));
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    const body = await (await response).json();
    expect(body.twoFactorRedirect).toBe(true);
    expect(await (await page.request.get("/api/auth/get-session")).json()).toBeNull();
    return body;
}

/**
 * Clear the current full session and refresh the login screen.
 * @param {import("@playwright/test").Page} page Page
 * @returns {Promise<void>}
 */
async function signOut(page) {
    const response = await page.request.post("/api/auth/sign-out", { headers: { origin }, data: {} });
    expect(response.ok()).toBe(true);
    await page.reload();
}

test("passkeys require a password and provide an alternative to TOTP", async ({ page, context, browser }) => {
    test.setTimeout(90000);
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", {
        options: {
            protocol: "ctap2",
            transport: "internal",
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            automaticPresenceSimulation: true,
        },
    });
    expect(
        (
            await page.request.post("/api/auth/passkey-2fa/authenticate-options", { headers: { origin }, data: {} })
        ).status()
    ).toBe(401);
    await page.goto("/settings/security");
    await login(page);
    await expect(page.getByTestId("passkey-settings")).toBeVisible();
    const wrong = await page.request.post("/api/auth/passkey-2fa/register-options", {
        headers: { origin },
        data: { name: "Wrong password", password: "wrong" },
    });
    expect(wrong.status()).toBe(401);
    await page.locator("#passkey-name").fill("Test security key");
    await page.locator("#passkey-password").fill(password);
    const registered = page.waitForResponse((res) => res.url().endsWith("/api/auth/passkey-2fa/register"));
    await page.getByRole("button", { name: "Add Passkey", exact: true }).click();
    expect((await registered).ok()).toBe(true);
    await expect(page.getByTestId("passkey-settings")).toContainText("Test security key");
    await expect(page.locator("#passkey-password")).toHaveValue("");
    await expect(page.locator('[data-account-username="admin"]')).toContainText("Enabled");
    const keys = (await (await page.request.get("/api/auth/passkey-2fa/list")).json()).passkeys;
    expect(keys).toHaveLength(1);
    expect(Object.keys(keys[0]).sort()).toEqual(["created_date", "id", "last_used_date", "name", "rp_id"]);

    const other = await page.evaluate(
        () =>
            new Promise((resolve) => {
                document
                    .querySelector("#app")
                    ._vnode.component.proxy.getSocket()
                    .emit("createAccount", { username: "other_passkey_user", role: "member" }, resolve);
            })
    );
    expect(other.ok).toBe(true);
    const otherContext = await browser.newContext({ baseURL: origin });
    try {
        expect(
            (
                await otherContext.request.post("/api/auth/sign-in/username", {
                    headers: { origin },
                    data: { username: other.username, password: other.password },
                })
            ).ok()
        ).toBe(true);
        expect((await (await otherContext.request.get("/api/auth/passkey-2fa/list")).json()).passkeys).toHaveLength(0);
        expect(
            (
                await otherContext.request.post("/api/auth/passkey-2fa/delete", {
                    headers: { origin },
                    data: { id: keys[0].id, password: other.password },
                })
            ).ok()
        ).toBe(true);
        expect((await (await page.request.get("/api/auth/passkey-2fa/list")).json()).passkeys).toHaveLength(1);
    } finally {
        await otherContext.close();
    }
    await signOut(page);
    expect((await beginLogin(page)).twoFactorMethods).toEqual(["passkey"]);
    const db = new BetterSqlite3("data/playwright-test/kuma.db");
    db.prepare("UPDATE better_auth_verification SET expiresAt=? WHERE identifier LIKE '2fa-%'").run(
        new Date(Date.now() - 600000).toISOString()
    );
    db.close();
    expect(
        (
            await page.request.post("/api/auth/passkey-2fa/authenticate-options", { headers: { origin }, data: {} })
        ).status()
    ).toBe(401);
    await page.getByRole("button", { name: "Back to Sign In", exact: true }).click();
    await expect(page.getByPlaceholder("Password")).toBeVisible();
    expect((await beginLogin(page)).twoFactorMethods).toEqual(["passkey"]);

    let original;
    await page.route("**/api/auth/passkey-2fa/authenticate", async (route) => {
        const body = route.request().postDataJSON();
        original = structuredClone(body.response);
        body.response.response.signature = "AAAA";
        await route.continue({ postData: JSON.stringify(body) });
    });
    await page.getByRole("button", { name: "Verify with Passkey", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    expect(await (await page.request.get("/api/auth/get-session")).json()).toBeNull();
    await page.unroute("**/api/auth/passkey-2fa/authenticate");
    const replay = await page.request.post("/api/auth/passkey-2fa/authenticate", {
        headers: { origin },
        data: { response: original },
    });
    expect(replay.status()).toBe(401);
    await page.getByRole("button", { name: "Verify with Passkey", exact: true }).click();
    await expect
        .poll(async () => (await (await page.request.get("/api/auth/get-session")).json())?.user?.username)
        .toBe("admin");

    await page.goto("/settings/security");
    await page.getByRole("button", { name: "Authenticator App (TOTP)", exact: true }).click();
    await page.locator("#totp-current-password").fill(password);
    const enabledResponse = page.waitForResponse((response) => response.url().endsWith("/api/auth/two-factor/enable"));
    await page.getByRole("button", { name: "Enable TOTP", exact: true }).click();
    const enabled = await enabledResponse;
    expect(enabled.ok(), await enabled.text()).toBe(true);
    const secret = new URL((await enabled.json()).totpURI).searchParams.get("secret");
    const otp = () => createOTP(base32.decode(secret)).totp();
    await page.locator('.modal.show input[autocomplete="one-time-code"]').fill(await otp());
    await page.locator(".modal.show").getByRole("button", { name: "Save", exact: true }).click();
    const verified = page.waitForResponse((response) => response.url().endsWith("/api/auth/two-factor/verify-totp"));
    await page.locator(".modal.show").getByRole("button", { name: "Yes", exact: true }).click();
    expect((await verified).ok()).toBe(true);
    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    new Promise((resolve) => {
                        document
                            .querySelector("#app")
                            ._vnode.component.proxy.getSocket()
                            .emit("getAccounts", (result) => resolve(result.ok));
                    })
            )
        )
        .toBe(true);
    await signOut(page);
    expect((await beginLogin(page)).twoFactorMethods).toEqual(["passkey", "totp"]);
    await page.getByRole("button", { name: "Authenticator App", exact: true }).click();
    await page.locator("#otp").fill(await otp());
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect
        .poll(async () => (await (await page.request.get("/api/auth/get-session")).json())?.user?.username)
        .toBe("admin");

    await signOut(page);
    await beginLogin(page);
    await page.getByRole("button", { name: "Verify with Passkey", exact: true }).click();
    await expect
        .poll(async () => (await (await page.request.get("/api/auth/get-session")).json())?.user?.username)
        .toBe("admin");
    const removed = await page.request.post("/api/auth/passkey-2fa/delete", {
        headers: { origin },
        data: { id: keys[0].id, password },
    });
    expect(removed.ok()).toBe(true);
    await signOut(page);
    expect((await beginLogin(page)).twoFactorMethods).toEqual(["totp"]);
    await expect(page.locator("#otp")).toBeVisible();
    await page.locator("#otp").fill(await otp());
    await page.getByRole("button", { name: "Log in", exact: true }).click();
    await expect
        .poll(async () => (await (await page.request.get("/api/auth/get-session")).json())?.user?.username)
        .toBe("admin");
    await page.goto("/settings/security");
    await page.getByRole("button", { name: "Authenticator App (TOTP)", exact: true }).click();
    await page.locator("#totp-current-password").fill(password);
    await page.getByRole("button", { name: "Disable TOTP", exact: true }).click();
    const disabled = page.waitForResponse((response) => response.url().endsWith("/api/auth/two-factor/disable"));
    await page.locator(".modal.show").getByRole("button", { name: "Yes", exact: true }).click();
    expect((await disabled).ok()).toBe(true);
    await expect
        .poll(() =>
            page.evaluate(
                () =>
                    new Promise((resolve) => {
                        document
                            .querySelector("#app")
                            ._vnode.component.proxy.getSocket()
                            .emit("getAccounts", (result) => resolve(result.ok));
                    })
            )
        )
        .toBe(true);
    await expect(page.locator('[data-account-username="admin"]')).toContainText("Disabled");
    await cdp.detach();
});
