const { R } = require("redbean-node");

const roles = ["admin", "owner", "member"];
const readEvents = new Set([
    "needSetup",
    "dashboardRendered",
    "getMonitorList",
    "getMonitor",
    "getHeartbeatHistory",
    "getMonitorBeats",
    "monitorImportantHeartbeatListCount",
    "monitorImportantHeartbeatListPaged",
    "getMonitorChartData",
    "getTags",
    "getStatusPage",
    "getIncidentHistory",
    "getManagedIncidents",
    "getMaintenance",
    "getMaintenanceList",
    "getMonitorMaintenance",
    "getMaintenanceStatusPage",
    "getSettings",
    "getGameList",
    "getPushExample",
    "checkDomain",
    "disconnectOtherSocketClients",
    "getMyPermissions",
]);
const monitorEvents = new Set([
    "editMonitor",
    "pauseMonitor",
    "resumeMonitor",
    "deleteMonitor",
    "clearEvents",
    "clearHeartbeats",
    "addMonitorTag",
    "editMonitorTag",
    "deleteMonitorTag",
]);

/**
 * Read the current role and grants, independent of cached login sessions.
 * @param {string} userID Account ID
 * @param {object} db Database connection or transaction
 * @returns {Promise<object>} Current account permissions
 */
async function getPermissions(userID, db = R.knex) {
    const user = await db("better_auth_user").where("id", userID).first();
    if (!user || user.banned || !roles.includes(user.role)) {
        throw new Error("You are not logged in.");
    }
    if (user.role !== "member") {
        return {
            userID: user.id,
            role: user.role,
            monitorIDs: [],
            statusPageIDs: [],
            statusPageSlugs: [],
            canManageIncidents: true,
            canManageMaintenance: true,
        };
    }
    const [monitors, pages] = await Promise.all([
        db("user_monitor_permission").where("user_id", userID).select("monitor_id"),
        db("user_status_page_permission").where("user_id", userID).select("status_page_id"),
    ]);
    return {
        userID: user.id,
        role: user.role,
        canManageIncidents: !!user.can_manage_incidents,
        canManageMaintenance: !!user.can_manage_maintenance,
        monitorIDs: monitors.map((row) => Number(row.monitor_id)),
        statusPageIDs: pages.map((row) => Number(row.status_page_id)),
        statusPageSlugs: (
            await db("status_page")
                .whereIn(
                    "id",
                    pages.map((row) => row.status_page_id)
                )
                .select("slug")
        ).map((page) => page.slug),
    };
}

/**
 * Require a role capable of managing shared resources.
 * @param {object} permissions Current permissions
 * @returns {void}
 * @throws {Error} If the account cannot manage shared resources
 */
function requireOwner(permissions) {
    if (!["owner", "admin"].includes(permissions.role)) {
        throw new Error("Permission denied.");
    }
}

/**
 * Require administrator privileges.
 * @param {object} permissions Current permissions
 * @returns {void}
 * @throws {Error} If the account is not an administrator
 */
function requireAdmin(permissions) {
    if (permissions.role !== "admin") {
        throw new Error("Permission denied.");
    }
}

/**
 * Authorize one dashboard operation before its handler can run.
 * @param {object} permissions Current account permissions
 * @param {string} event Operation name
 * @param {Array} args Operation arguments
 * @returns {Promise<void>}
 */
async function authorize(permissions, event, args) {
    if (readEvents.has(event)) {
        return;
    }
    if (["getAccounts", "saveAccountPermissions"].includes(event)) {
        requireOwner(permissions);
        return;
    }
    if (["createAccount", "setAccountRole", "deleteAccount"].includes(event)) {
        requireAdmin(permissions);
        return;
    }
    if (["admin", "owner"].includes(permissions.role)) {
        return;
    }
    if (permissions.role !== "member") {
        throw new Error("Permission denied.");
    }
    if (
        permissions.canManageIncidents &&
        [
            "saveManagedIncident",
            "saveIncidentUpdate",
            "managedIncidentAction",
            "postIncident",
            "unpinIncident",
            "editIncident",
            "deleteIncident",
            "resolveIncident",
        ].includes(event)
    ) {
        return;
    }
    if (
        permissions.canManageMaintenance &&
        [
            "addMaintenance",
            "editMaintenance",
            "addMonitorMaintenance",
            "addMaintenanceStatusPage",
            "deleteMaintenance",
            "pauseMaintenance",
            "resumeMaintenance",
        ].includes(event)
    ) {
        return;
    }
    if (monitorEvents.has(event)) {
        const id = Number(event === "editMonitor" ? args[0]?.id : event.endsWith("MonitorTag") ? args[1] : args[0]);
        if (!permissions.monitorIDs.includes(id)) {
            throw new Error("Permission denied.");
        }
        // Group operations can also change descendants, even when only the parent was selected.
        const Monitor = require("./model/monitor");
        if (["editMonitor", "deleteMonitor", "pauseMonitor", "resumeMonitor"].includes(event)) {
            const children = await Monitor.getAllChildrenIDs(id);
            if (children.some((child) => !permissions.monitorIDs.includes(Number(child)))) {
                throw new Error("Permission denied.");
            }
        }
        if (event === "editMonitor") {
            const current = await R.knex("monitor").where("id", id).first();
            const parent = args[0]?.parent;
            if (
                Number(parent || 0) !== Number(current?.parent || 0) &&
                parent &&
                !permissions.monitorIDs.includes(Number(parent))
            ) {
                throw new Error("Permission denied.");
            }
        }
        return;
    }
    if (["saveStatusPage", "deleteStatusPage"].includes(event)) {
        const page = await R.knex("status_page").where("slug", args[0]).first();
        if (page && permissions.statusPageIDs.includes(Number(page.id))) {
            return;
        }
    }
    throw new Error("Permission denied.");
}

/**
 * Enforce permissions for every socket packet, including API-key connections.
 * @param {Socket} socket Socket.io connection
 * @returns {void}
 */
function installPermissionMiddleware(socket) {
    socket.use(async ([event, ...args], next) => {
        try {
            if (["needSetup", "getIncidentHistory"].includes(event) && !socket.session) {
                next();
                return;
            }
            if (!socket.session) {
                throw new Error("You are not logged in.");
            }
            const permissions = await getPermissions(socket.userID);
            if (socket.apiKeyLogin) {
                const { getSessionFromHeaders } = require("./better-auth");
                const session = await getSessionFromHeaders(undefined, socket.authAPIKey);
                if (!session || session.user.id !== socket.userID) {
                    throw new Error("You are not logged in.");
                }
            }
            if (socket.session.session.id !== "disable-auth" && !socket.apiKeyLogin) {
                const session = await R.knex("better_auth_session")
                    .where({ id: socket.session.session.id, userId: socket.userID })
                    .first();
                if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
                    throw new Error("You are not logged in.");
                }
            }
            await authorize(permissions, event, args);
            socket.permissions = permissions;
            next();
        } catch (error) {
            const callback = args[args.length - 1];
            if (typeof callback === "function") {
                callback({ ok: false, msg: error.message });
            }
            // A rejected packet must never reach the operation handler.
        }
    });
}

module.exports = { roles, getPermissions, requireOwner, requireAdmin, authorize, installPermissionMiddleware };
