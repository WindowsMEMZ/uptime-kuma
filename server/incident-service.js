const { R } = require("redbean-node");
const dayjs = require("dayjs");
const apicache = require("./utils/response-cache");
const { DOWN, MAINTENANCE } = require("../src/util");
const { INCIDENT_LABELS } = require("../src/incident-status");

let revision = 0;
let overrideCache = null;

/**
 * Match both legacy incidents and incidents published on multiple pages.
 * @param {number} statusPageID Status page ID
 * @returns {import("knex").Knex.QueryBuilder} Incident query
 */
function pageQuery(statusPageID) {
    return R.knex("incident").where(function () {
        this.where("status_page_id", statusPageID).orWhereIn(
            "id",
            R.knex("incident_status_page").select("incident_id").where("status_page_id", statusPageID)
        );
    });
}

/**
 * Keep resolved incidents public for exactly three days without deleting history.
 * @param {number} statusPageID Status page ID
 * @param {number} now Current UTC timestamp
 * @returns {import("knex").Knex.QueryBuilder} Visible incidents
 */
function visibleForPage(statusPageID, now = Date.now()) {
    const cutoff = R.isoDateTimeMillis(dayjs.utc(now).subtract(3, "day"));
    return pageQuery(statusPageID).andWhere(function () {
        this.where("active", 1).orWhere("resolved_date", ">", cutoff);
    });
}

/**
 * Include automatic expiry in the public revision, even without a manual edit.
 * @param {number} statusPageID Status page ID
 * @returns {Promise<string>} Public revision
 */
async function publicRevision(statusPageID) {
    const [{ count }] = await visibleForPage(statusPageID).count("id as count");
    return `${revision}:${count}`;
}

/**
 * Validate the label of newly added progress.
 * @param {string} value Label
 * @returns {string} Valid label
 * @throws {Error} Invalid label
 */
function progressLabel(value = "updated") {
    if (!INCIDENT_LABELS.includes(value)) {
        throw new Error("Invalid incident label");
    }
    return value;
}

/**
 * Serialize incidents and their timelines in batches.
 * @param {object[]} rows Incident rows
 * @param {boolean} admin Include monitor and page assignments
 * @returns {Promise<object[]>} Incident payloads
 */
async function serialize(rows, admin = false) {
    if (!rows.length) {
        return [];
    }
    const ids = rows.map((row) => row.id);
    const [updates, monitors, pages] = await Promise.all([
        R.knex("incident_update").whereIn("incident_id", ids).orderBy("created_date", "desc").orderBy("id", "desc"),
        admin ? R.knex("incident_monitor").whereIn("incident_id", ids) : [],
        admin ? R.knex("incident_status_page").whereIn("incident_id", ids) : [],
    ]);
    return rows.map((row) => {
        const result = {
            id: row.id,
            title: row.title,
            content: row.content,
            style: row.style,
            active: !!row.active,
            pin: !!row.pin,
            createdDate: row.created_date,
            lastUpdatedDate: row.last_updated_date,
            resolvedDate: row.resolved_date,
            label: updates.find((update) => update.incident_id === row.id)?.label || "updated",
            status_page_id: row.status_page_id,
            updates: updates
                .filter((update) => update.incident_id === row.id)
                .map((update) => ({
                    id: update.id,
                    content: update.content,
                    label: update.label,
                    createdDate: update.created_date,
                    lastUpdatedDate: update.last_updated_date,
                })),
        };
        if (admin) {
            result.monitors = monitors
                .filter((monitor) => monitor.incident_id === row.id)
                .map((monitor) => ({
                    id: monitor.monitor_id,
                    overrideStatus: monitor.override_status,
                }));
            result.statusPageIDs = [
                ...new Set([
                    ...pages.filter((page) => page.incident_id === row.id).map((page) => page.status_page_id),
                    ...(row.status_page_id ? [row.status_page_id] : []),
                ]),
            ];
        }
        return result;
    });
}

/**
 * Get visible pinned incidents, including recently resolved incidents.
 * @param {number} statusPageID Status page ID
 * @returns {Promise<object[]>} Public incidents
 */
async function activeForPage(statusPageID) {
    return serialize(
        await visibleForPage(statusPageID).where({ pin: 1 }).orderBy("created_date", "desc").orderBy("id", "desc")
    );
}

/**
 * Get the effective override. DOWN takes precedence over maintenance.
 * @param {number} monitorID Monitor ID
 * @returns {Promise<number|null>} Forced status or null
 */
async function monitorOverride(monitorID) {
    if (!overrideCache) {
        overrideCache = R.knex("incident_monitor as im")
            .join("incident as i", "i.id", "im.incident_id")
            .where("i.active", 1)
            .whereIn("im.override_status", [DOWN, MAINTENANCE])
            .groupBy("im.monitor_id")
            .select("im.monitor_id")
            .min("im.override_status as status")
            .then((rows) => new Map(rows.map((row) => [row.monitor_id, Number(row.status)])))
            .catch((error) => {
                overrideCache = null;
                throw error;
            });
    }
    return (await overrideCache).get(monitorID) ?? null;
}

/**
 * Retain the real push result independently of incident-generated heartbeats.
 * @param {number} monitorID Monitor ID
 * @param {object} heartbeat Unmodified push heartbeat
 * @returns {Promise<void>}
 */
async function recordPush(monitorID, heartbeat) {
    await R.knex("incident_push_state")
        .insert({
            monitor_id: monitorID,
            status: heartbeat.status,
            time: heartbeat.time,
            msg: heartbeat.msg,
            ping: heartbeat.ping,
            retries: heartbeat.retries || 0,
        })
        .onConflict("monitor_id")
        .merge();
}

/**
 * Get the last real push, without extending its expiry during an incident.
 * @param {number} monitorID Monitor ID
 * @returns {Promise<object|undefined>} Original heartbeat
 */
async function lastPush(monitorID) {
    const state = await R.knex("incident_push_state").where("monitor_id", monitorID).first();
    if (state) {
        return state;
    }
    return R.knex("heartbeat")
        .where("monitor_id", monitorID)
        .whereNot("msg", "Status overridden by incident")
        .orderBy("id", "desc")
        .first();
}

/**
 * Invalidate public caches and refresh affected monitors immediately.
 * @param {number[]} monitorIDs Affected monitor IDs
 * @returns {void}
 */
function changed(monitorIDs = []) {
    revision++;
    overrideCache = null;
    apicache.clear();
    const { UptimeKumaServer } = require("./uptime-kuma-server");
    const server = UptimeKumaServer.getInstance();
    server.io.to("dashboard").emit("incidentChanged");
    for (const id of new Set(monitorIDs)) {
        server.monitorList[id]?.requestImmediateCheck?.();
    }
}

/**
 * Validate bounded text fields.
 * @param {unknown} value Input
 * @param {number} maxLength Maximum length
 * @returns {string} Trimmed text
 * @throws {Error} Invalid text
 */
function text(value, maxLength) {
    if (typeof value !== "string" || !value.trim() || value.length > maxLength) {
        throw new Error("Invalid incident text");
    }
    return value.trim();
}

/**
 * Validate IDs before querying or updating relations.
 * @param {unknown} value Input
 * @returns {number} ID
 * @throws {Error} Invalid selection
 */
function id(value) {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new Error("Invalid incident selection");
    }
    return value;
}

/**
 * Atomically save an incident and its assignments.
 * @param {object} input Incident fields
 * @returns {Promise<number>} Incident ID
 */
async function save(input) {
    const title = text(input.title, 255);
    if (!Array.isArray(input.monitors) || !Array.isArray(input.statusPageIDs)) {
        throw new Error("Invalid incident selection");
    }
    const monitors = input.monitors.map((monitor) => {
        if (![null, DOWN, MAINTENANCE].includes(monitor.overrideStatus)) {
            throw new Error("Invalid incident override");
        }
        return { monitor_id: id(monitor.id), override_status: monitor.overrideStatus };
    });
    const pageIDs = [...new Set(input.statusPageIDs.map(id))];
    if (new Set(monitors.map((monitor) => monitor.monitor_id)).size !== monitors.length) {
        throw new Error("Invalid incident selection");
    }
    const content = input.id ? null : text(input.content, 65535);
    const label = input.id ? null : progressLabel(input.label);
    const previous = input.id ? await R.knex("incident_monitor").where("incident_id", id(input.id)) : [];
    const incidentID = await R.knex.transaction(async (trx) => {
        if (input.id && !(await trx("incident").where("id", input.id).first())) {
            throw new Error("Incident not found");
        }
        if (
            (
                await trx("monitor").whereIn(
                    "id",
                    monitors.map((monitor) => monitor.monitor_id)
                )
            ).length !== monitors.length ||
            (await trx("status_page").whereIn("id", pageIDs)).length !== pageIDs.length
        ) {
            throw new Error("Invalid incident selection");
        }
        const now = R.isoDateTimeMillis(dayjs.utc());
        const fields = { title, status_page_id: pageIDs[0] ?? null, last_updated_date: now };
        let incidentID = input.id;
        if (incidentID) {
            await trx("incident").where("id", incidentID).update(fields);
        } else {
            [incidentID] = await trx("incident").insert({
                ...fields,
                content,
                style: "warning",
                pin: 1,
                active: label === "resolved" ? 0 : 1,
                resolved_date: label === "resolved" ? now : null,
                created_date: now,
            });
            await trx("incident_update").insert({ incident_id: incidentID, content, label, created_date: now });
        }
        await trx("incident_monitor").where("incident_id", incidentID).delete();
        await trx("incident_status_page").where("incident_id", incidentID).delete();
        if (monitors.length) {
            await trx("incident_monitor").insert(monitors.map((monitor) => ({ ...monitor, incident_id: incidentID })));
        }
        if (pageIDs.length) {
            await trx("incident_status_page").insert(
                pageIDs.map((pageID) => ({ incident_id: incidentID, status_page_id: pageID }))
            );
        }
        return incidentID;
    });
    changed([...previous.map((monitor) => monitor.monitor_id), ...monitors.map((monitor) => monitor.monitor_id)]);
    return incidentID;
}

/**
 * Add progress or correct an existing entry without changing its original time.
 * @param {number} incidentID Incident ID
 * @param {number|null} updateID Entry ID, or null for new progress
 * @param {string} content Progress description
 * @param {string} label Label for new progress
 * @returns {Promise<void>}
 */
async function saveUpdate(incidentID, updateID, content, label = "updated") {
    id(incidentID);
    content = text(content, 65535);
    label = progressLabel(label);
    let stateChanged = false;
    if (updateID !== null) {
        id(updateID);
    }
    await R.knex.transaction(async (trx) => {
        const incident = await trx("incident").where("id", incidentID).first();
        if (!incident) {
            throw new Error("Incident not found");
        }
        const now = R.isoDateTimeMillis(dayjs.utc());
        if (updateID) {
            const count = await trx("incident_update")
                .where({ id: updateID, incident_id: incidentID })
                .update({ content, last_updated_date: now });
            if (!count) {
                throw new Error("Incident update not found");
            }
        } else {
            await trx("incident_update").insert({ incident_id: incidentID, content, label, created_date: now });
        }
        const latest = await trx("incident_update")
            .where("incident_id", incidentID)
            .orderBy("created_date", "desc")
            .orderBy("id", "desc")
            .first();
        const active = latest.label !== "resolved";
        stateChanged = !!incident.active !== active;
        await trx("incident")
            .where("id", incidentID)
            .update({
                content: latest.content,
                active: active ? 1 : 0,
                resolved_date: active
                    ? null
                    : !updateID || stateChanged || !incident.resolved_date
                      ? latest.created_date
                      : incident.resolved_date,
                last_updated_date: now,
            });
    });
    const monitors = stateChanged ? await R.knex("incident_monitor").where("incident_id", incidentID) : [];
    changed(monitors.map((monitor) => monitor.monitor_id));
}

/**
 * Resolve, reopen, or delete an incident and release its overrides.
 * @param {number} incidentID Incident ID
 * @param {string} action Action
 * @returns {Promise<void>}
 */
async function action(incidentID, action) {
    id(incidentID);
    if (!["resolve", "reopen", "delete"].includes(action)) {
        throw new Error("Invalid incident action");
    }
    if (action !== "delete") {
        const incident = await R.knex("incident").where("id", incidentID).first();
        if (!incident) {
            throw new Error("Incident not found");
        }
        await saveUpdate(incidentID, null, incident.content, action === "resolve" ? "resolved" : "updated");
        return;
    }
    const monitors = await R.knex("incident_monitor").where("incident_id", incidentID);
    await R.knex.transaction(async (trx) => {
        if (!(await trx("incident").where("id", incidentID).first())) {
            throw new Error("Incident not found");
        }
        await trx("incident_update").where("incident_id", incidentID).delete();
        await trx("incident_monitor").where("incident_id", incidentID).delete();
        await trx("incident_status_page").where("incident_id", incidentID).delete();
        await trx("incident").where("id", incidentID).delete();
    });
    changed(monitors.map((monitor) => monitor.monitor_id));
}

module.exports = {
    pageQuery,
    visibleForPage,
    publicRevision,
    progressLabel,
    serialize,
    activeForPage,
    monitorOverride,
    recordPush,
    lastPush,
    changed,
    save,
    saveUpdate,
    action,
    getRevision: () => revision,
};
