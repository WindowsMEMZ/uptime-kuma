import { expect, test } from "../fixtures";
import { login, restoreSqliteSnapshot } from "../util-test";
import BetterSqlite3 from "better-sqlite3";
import { io } from "socket.io-client";

test.beforeEach(async () => {
    await restoreSqliteSnapshot();
});

/**
 * Invoke a dashboard operation through its authenticated socket.
 * @param {import("@playwright/test").Page} page Page
 * @param {string} event Operation
 * @param {any[]} args Arguments
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
 * Select an item in a multiple selection field.
 * @param {import("@playwright/test").Page} page Page
 * @param {string} id Field ID
 * @param {string} name Option name
 * @returns {Promise<void>}
 */
async function select(page, id, name) {
    await page.getByTestId(`${id}-select`).click();
    await page.getByRole("option", { name }).click();
    await page.keyboard.press("Escape");
}

test("manages shared incident timelines and immediate per-monitor overrides", async ({ page, browser }, testInfo) => {
    test.setTimeout(120000);
    await page.goto("./add");
    await login(page);
    await page.getByTestId("friendly-name-input").fill("Incident HTTP");
    await page.getByTestId("url-input").fill("http://localhost:3001/api/entry-page");
    await page.locator("#interval").fill("3600");
    await page.locator("#maxRetries").fill("3");
    await page.getByTestId("save-button").click();
    await page.waitForURL(/\/dashboard\/\d+/);
    const httpID = Number(page.url().split("/").pop());
    await expect(page.getByTestId("monitor-status")).toHaveText("Up");

    await page.goto("./add");
    await page.getByTestId("monitor-type-select").selectOption("push");
    await page.getByTestId("friendly-name-input").fill("Incident Push");
    await page.locator("#interval").fill("3600");
    await page.locator("#maxRetries").fill("3");
    await page.getByTestId("save-button").click();
    await page.waitForURL(/\/dashboard\/\d+/);
    const pushID = Number(page.url().split("/").pop());
    const pushURL = await page.locator('a[href*="/api/push/"]').first().getAttribute("href");
    await page.request.get(pushURL);

    for (const slug of ["incident-one", "incident-two"]) {
        await page.goto("./add-status-page");
        await page.getByTestId("name-input").fill(slug);
        await page.getByTestId("slug-input").fill(slug);
        await page.getByTestId("submit-button").click();
        await page.waitForURL(`/status/${slug}?edit`);
        await expect(page.getByTestId("edit-sidebar")).toHaveAttribute("data-status-page-id", /^\d+$/);
        await page.getByTestId("add-group-button").click();
        await page.getByTestId("group-name").fill("Core");
        for (const name of ["Incident HTTP", "Incident Push"]) {
            await page.getByTestId("monitor-select").click();
            await page.getByTestId("monitor-select").getByRole("option", { name }).click();
        }
        await Promise.all([page.waitForEvent("load"), page.getByTestId("save-button").click()]);
    }

    const visitor = await browser.newContext({ baseURL: "http://localhost:3001" });
    const publicPage = await visitor.newPage();
    const db = new BetterSqlite3("data/playwright-test/kuma.db");
    const latestStatus = (id) =>
        db.prepare("SELECT status,retries FROM heartbeat WHERE monitor_id=? ORDER BY id DESC LIMIT 1").get(id);
    try {
        await publicPage.goto("/status/incident-one");
        await page.goto("./incidents/new");
        await page.locator("#incident-title").fill("Network incident");
        await page.locator("#incident-initial-progress").fill("Investigating the network");
        await page.locator("#incident-initial-label").selectOption("investigating");
        await select(page, "incident-monitors", "Incident HTTP");
        await select(page, "incident-monitors", "Incident Push");
        await page.locator(`#incident-override-${httpID}`).selectOption("3");
        await page.locator(`#incident-override-${pushID}`).selectOption("0");
        for (const slug of ["incident-one", "incident-two"]) {
            await select(page, "incident-pages", slug);
        }
        await page.getByTestId("incident-settings").getByRole("button", { name: "Save", exact: true }).click();
        await page.waitForURL(/\/incidents\/\d+/);
        const incidentID = Number(page.url().split("/").pop());
        await expect.poll(() => latestStatus(httpID)?.status).toBe(3);
        await expect.poll(() => latestStatus(pushID)).toMatchObject({ status: 0, retries: 0 });
        // Explicit pushes cannot replace an active manual override.
        await page.request.get(pushURL);
        expect(latestStatus(pushID)).toMatchObject({ status: 0, retries: 0 });
        await expect(publicPage.getByTestId("incident")).toContainText("Network incident", { timeout: 15000 });
        await expect
            .poll(() =>
                publicPage.evaluate(
                    (id) => document.querySelector("#app")._vnode.component.proxy.lastHeartbeatList[id]?.status,
                    httpID
                )
            )
            .toBe(3);

        const original = db.prepare("SELECT * FROM incident_update WHERE incident_id=?").get(incidentID);
        await page.locator("#incident-progress-label").selectOption("identified");
        await page.locator("#incident-progress").fill("The cause has been identified");
        await page.getByRole("button", { name: "Add Progress", exact: true }).click();
        await expect(page.getByTestId("incident-progress-entry")).toHaveCount(2);
        await expect(page.locator("#incident-progress-label")).toHaveValue("updated");
        const publicIncident = publicPage.getByTestId("incident");
        await expect(publicIncident.locator(".incident-label-identified")).toBeVisible({ timeout: 15000 });
        await expect(publicIncident.locator(".incident-progress")).toHaveCount(1);
        await expect(publicIncident.locator(".incident-label-investigating")).toHaveCount(0);
        const toggle = publicIncident.getByRole("button", { name: "Show all progress (2)", exact: true });
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
        await toggle.click();
        await expect(publicIncident.locator(".incident-progress")).toHaveCount(2);
        await expect(publicIncident.getByRole("button", { name: "Collapse progress", exact: true })).toHaveAttribute(
            "aria-expanded",
            "true"
        );
        const oldest = page.getByTestId("incident-progress-entry").last();
        await oldest.getByRole("button", { name: "Edit", exact: true }).click();
        await oldest.locator("textarea").fill("Investigation started; corrected description");
        await oldest.getByRole("button", { name: "Save", exact: true }).click();
        await expect(oldest).toContainText("corrected description");
        const edited = db.prepare("SELECT * FROM incident_update WHERE id=?").get(original.id);
        expect(edited.created_date).toBe(original.created_date);
        expect(edited.last_updated_date).toBeTruthy();
        await expect(publicPage.getByTestId("incident")).toContainText("The cause has been identified", {
            timeout: 15000,
        });
        await expect(publicPage.getByTestId("incident")).toContainText("corrected description");
        await publicIncident.getByRole("button", { name: "Collapse progress", exact: true }).click();
        await expect(publicIncident.locator(".incident-progress")).toHaveCount(1);
        await expect(publicIncident).not.toContainText("corrected description");
        await publicIncident.getByRole("button", { name: "Show all progress (2)", exact: true }).click();
        for (const slug of ["incident-one", "incident-two"]) {
            const data = await (await publicPage.request.get(`/api/status-page/${slug}/incident-history`)).json();
            expect(data.incidents[0].updates).toHaveLength(2);
            expect(data.activeIncidents[0].id).toBe(incidentID);
        }
        await page.reload();
        await expect(page.locator(`#incident-override-${httpID}`)).toHaveValue("3");
        await expect(page.getByTestId("incident-pages-select").locator(".multiselect__tag")).toHaveCount(2);
        await page.screenshot({ path: testInfo.outputPath("incident-desktop.png"), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: testInfo.outputPath("incident-mobile.png"), fullPage: true });
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

        const other = await request(page, "saveManagedIncident", {
            title: "Second incident",
            content: "Still unavailable",
            monitors: [{ id: httpID, overrideStatus: 0 }],
            statusPageIDs: [],
        });
        expect(other.ok).toBe(true);
        await expect.poll(() => latestStatus(httpID)).toMatchObject({ status: 0, retries: 0 });
        await expect(page.getByRole("button", { name: "Resolve", exact: true })).toHaveCount(0);
        await page.locator("#incident-progress-label").selectOption("resolved");
        await page.locator("#incident-progress").fill("Service restored");
        await page.getByRole("button", { name: "Add Progress", exact: true }).click();
        await expect(page.getByTestId("incident-progress-entry")).toHaveCount(3);
        await expect.poll(() => latestStatus(httpID)?.status).toBe(0);
        expect((await request(page, "saveIncidentUpdate", other.incidentID, null, "Restored", "resolved")).ok).toBe(
            true
        );
        await expect.poll(() => latestStatus(httpID)?.status).toBe(1);
        await expect.poll(() => latestStatus(pushID)?.status).toBe(1);
        await page.request.get(pushURL);
        await expect.poll(() => latestStatus(pushID)?.status).toBe(1);
        await expect(publicPage.getByTestId("incident").locator(".incident-label-resolved")).toBeVisible({
            timeout: 15000,
        });
        await expect(publicPage.getByTestId("incident")).toContainText("corrected description");
        await expect(publicPage.locator(".past-incidents-section")).toHaveCount(0);
        await publicPage.evaluate(() => {
            const root = document.querySelector("#app")._vnode.component.proxy;
            root.statusPageTheme = "dark";
        });
        const darkCard = publicPage.getByTestId("incident");
        await expect(darkCard).toHaveCSS("color", "rgb(228, 232, 239)");
        const brightness = await darkCard.evaluate((element) => {
            const color = getComputedStyle(element).backgroundColor;
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            ctx.fillStyle = color;
            ctx.fillRect(0, 0, 1, 1);
            return Math.max(...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3));
        });
        expect(brightness).toBeLessThan(85);
        await publicPage.screenshot({ path: testInfo.outputPath("incident-dark.png"), fullPage: true });
        // Expiry does not need another edit or a scheduled cleanup job.
        const expired = new Date(Date.now() - 73 * 3600000).toISOString().replace("T", " ").replace("Z", "");
        db.prepare("UPDATE incident SET resolved_date=? WHERE id=?").run(expired, incidentID);
        await expect(publicPage.getByTestId("incident")).toHaveCount(0, { timeout: 15000 });
        const history = await (await publicPage.request.get("/api/status-page/incident-one/incident-history")).json();
        expect(history.incidents).toHaveLength(0);
        expect(db.prepare("SELECT id FROM incident WHERE id=?").get(incidentID)).toBeTruthy();

        // No-override assignments preserve normal monitoring, including after reopening.
        const current = (await request(page, "getManagedIncidents")).incidents.find((item) => item.id === incidentID);
        expect(
            (
                await request(page, "saveManagedIncident", {
                    ...current,
                    monitors: [{ id: httpID, overrideStatus: null }],
                    statusPageIDs: current.statusPageIDs,
                })
            ).ok
        ).toBe(true);
        // A new default-label update reopens a resolved incident.
        await page.locator("#incident-progress").fill("Checking again after resolution");
        await page.getByRole("button", { name: "Add Progress", exact: true }).click();
        await expect(page.getByTestId("incident-progress-entry")).toHaveCount(4);
        expect(db.prepare("SELECT active,resolved_date FROM incident WHERE id=?").get(incidentID)).toMatchObject({
            active: 1,
            resolved_date: null,
        });
        await expect(publicPage.getByTestId("incident").locator(".incident-label-updated")).toBeVisible({
            timeout: 15000,
        });
        await expect.poll(() => latestStatus(httpID)?.status).toBe(1);
        const invalid = await request(page, "saveManagedIncident", {
            ...current,
            title: "Must roll back",
            monitors: [{ id: httpID, overrideStatus: 1 }],
        });
        expect(invalid.ok).toBe(false);
        expect(db.prepare("SELECT title FROM incident WHERE id=?").get(incidentID).title).toBe("Network incident");
        const invalidUpdate = await request(
            page,
            "saveIncidentUpdate",
            other.incidentID,
            original.id,
            "Cross-incident edit"
        );
        expect(invalidUpdate.ok).toBe(false);
        expect((await request(page, "unpinIncident", "incident-one")).ok).toBe(true);
        const pastIncident = publicPage.locator(".past-incidents-section .incident-item");
        await expect(pastIncident.locator(".incident-progress")).toHaveCount(1, { timeout: 15000 });
        await pastIncident.getByRole("button", { name: "Show all progress (4)", exact: true }).click();
        await expect(pastIncident.locator(".incident-progress")).toHaveCount(4);
        await pastIncident.getByRole("button", { name: "Collapse progress", exact: true }).click();
        await expect(pastIncident.locator(".incident-progress")).toHaveCount(1);
        expect((await request(page, "managedIncidentAction", incidentID, "delete")).ok).toBe(true);
        expect(
            db.prepare("SELECT count(*) AS count FROM incident_update WHERE incident_id=?").get(incidentID).count
        ).toBe(0);
    } finally {
        db.close();
        await visitor.close();
    }
});

test("rejects unauthenticated incident mutations", async () => {
    const socket = io("http://localhost:3001", { transports: ["websocket"] });
    try {
        await new Promise((resolve, reject) => {
            socket.once("connect", resolve);
            socket.once("connect_error", reject);
        });
        for (const [event, args] of [
            ["getManagedIncidents", []],
            ["saveManagedIncident", [{}]],
            ["saveIncidentUpdate", [1, null, "Unauthorized"]],
            ["managedIncidentAction", [1, "delete"]],
        ]) {
            const response = await socket.timeout(5000).emitWithAck(event, ...args);
            expect(response.ok).toBe(false);
        }
    } finally {
        socket.disconnect();
    }
});
