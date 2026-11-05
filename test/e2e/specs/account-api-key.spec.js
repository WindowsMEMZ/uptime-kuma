import { test, expect } from "../fixtures";
import { login, restoreSqliteSnapshot } from "../util-test";
import { io } from "socket.io-client";

test("API-key sockets enforce Member grants and reject revoked credentials", async ({ page, browser }) => {
    await restoreSqliteSnapshot();
    await page.goto("/add");
    await login(page);
    await page.getByTestId("friendly-name-input").fill("API permission monitor");
    await page.getByTestId("url-input").fill("http://localhost:3001/api/entry-page");
    await page.getByTestId("save-button").click();
    await page.waitForURL(/\/dashboard\/\d+/);
    const monitorID = Number(page.url().split("/").pop());
    const request = (event, ...args) =>
        page.evaluate(
            ({ event, args }) =>
                new Promise((resolve) => {
                    document
                        .querySelector("#app")
                        ._vnode.component.proxy.getSocket()
                        .emit(event, ...args, resolve);
                }),
            { event, args }
        );
    const credentials = await request("createAccount", { username: "api_member", role: "member" });
    expect(credentials.ok).toBe(true);
    const settings = (await request("getSettings")).data;
    expect((await request("setSettings", { ...settings, apiEnabled: true }, "")).ok).toBe(true);
    const context = await browser.newContext({ baseURL: "http://localhost:3001" });
    let socket;
    try {
        const signedIn = await context.request.post("/api/auth/sign-in/username", {
            headers: { origin: "http://localhost:3001" },
            data: { username: credentials.username, password: credentials.password },
        });
        expect(signedIn.ok()).toBe(true);
        const created = await context.request.post("/api/auth/api-key/create", {
            headers: { origin: "http://localhost:3001" },
            data: { name: "Member API key" },
        });
        expect(created.ok(), await created.text()).toBe(true);
        const key = await created.json();
        socket = io("http://localhost:3001", {
            transports: ["websocket"],
            extraHeaders: { authorization: `Bearer ${key.key}` },
            autoConnect: false,
        });
        const connected = new Promise((resolve, reject) => {
            socket.once("session", resolve);
            socket.once("connect_error", reject);
        });
        socket.connect();
        await connected;
        const call = (event, ...args) => socket.timeout(5000).emitWithAck(event, ...args);
        expect((await call("getMonitorList")).ok).toBe(true);
        expect((await call("pauseMonitor", monitorID)).ok).toBe(false);
        expect((await call("createAccount", { username: "api_escalation", role: "admin" })).ok).toBe(false);
        expect(
            (
                await request("saveAccountPermissions", credentials.userID, {
                    monitorIDs: [monitorID],
                    statusPageIDs: [],
                })
            ).ok
        ).toBe(true);
        expect((await call("pauseMonitor", monitorID)).ok).toBe(true);
        expect(
            (await request("saveAccountPermissions", credentials.userID, { monitorIDs: [], statusPageIDs: [] })).ok
        ).toBe(true);
        expect((await call("resumeMonitor", monitorID)).ok).toBe(false);
        expect((await request("resumeMonitor", monitorID)).ok).toBe(true);
        const revoked = await context.request.post("/api/auth/api-key/delete", {
            headers: { origin: "http://localhost:3001" },
            data: { keyId: key.id },
        });
        expect(revoked.ok()).toBe(true);
        expect((await call("getMonitorList")).ok).toBe(false);
    } finally {
        socket?.disconnect();
        await context.close();
        await request("setSettings", { ...settings, apiEnabled: !!settings.apiEnabled }, "");
    }
});
