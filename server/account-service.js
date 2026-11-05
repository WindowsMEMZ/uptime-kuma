const { randomBytes, randomUUID } = require("node:crypto");
const { R } = require("redbean-node");
const { roles, getPermissions, requireOwner, requireAdmin } = require("./permissions");

// Serialize account changes so concurrent requests cannot demote the final administrator.
let pending = Promise.resolve();

/**
 * Execute an account change with fresh authorization.
 * @param {string} actorID Acting account
 * @param {Function} operation Authorized operation
 * @returns {Promise<object>} Operation result
 */
function change(actorID, operation) {
    const result = pending.then(async () => operation(await getPermissions(actorID)));
    pending = result.catch(() => {});
    return result;
}

/**
 * List accounts and explicit resource grants without credentials.
 * @param {string} actorID Acting account
 * @returns {Promise<Array>} Accounts
 */
async function list(actorID) {
    requireOwner(await getPermissions(actorID));
    const [users, monitors, pages, passkeys] = await Promise.all([
        R.knex("better_auth_user")
            .select("id", "username", "role", "twoFactorEnabled", "can_manage_incidents", "can_manage_maintenance")
            .orderBy("username"),
        R.knex("user_monitor_permission"),
        R.knex("user_status_page_permission"),
        R.knex("user_passkey").distinct("user_id"),
    ]);
    return users.map((user) => ({
        id: user.id,
        username: user.username,
        role: user.role,
        twoFactorEnabled: !!user.twoFactorEnabled || passkeys.some((key) => key.user_id === user.id),
        canManageIncidents: !!user.can_manage_incidents,
        canManageMaintenance: !!user.can_manage_maintenance,
        monitorIDs: monitors.filter((row) => row.user_id === user.id).map((row) => Number(row.monitor_id)),
        statusPageIDs: pages.filter((row) => row.user_id === user.id).map((row) => Number(row.status_page_id)),
    }));
}

/**
 * Create an account with an unpredictable initial password, returned once.
 * @param {string} actorID Acting account
 * @param {object} input Username and role
 * @returns {Promise<object>} Created account ID and initial password
 */
function create(actorID, input) {
    return change(actorID, async (permissions) => {
        requireAdmin(permissions);
        const username = typeof input?.username === "string" ? input.username.trim().toLowerCase() : "";
        if (!/^[a-z0-9_.]{3,30}$/.test(username)) {
            throw new Error("accountUsernameInvalid");
        }
        if (!roles.includes(input.role)) {
            throw new Error("Invalid account role.");
        }
        if (await R.knex("better_auth_user").whereRaw("LOWER(username) = ?", [username]).first()) {
            throw new Error("accountUsernameExists");
        }
        const password = randomBytes(24).toString("base64url");
        const email = `${randomUUID()}@noreply.uptime-kuma.internal`;
        try {
            const { auth } = require("./better-auth");
            const result = await auth().api.createUser({
                body: {
                    name: username,
                    email,
                    password,
                    role: input.role,
                    data: { username, displayUsername: username },
                },
            });
            return { userID: result.user.id, username, password };
        } catch (error) {
            // The auth plugin can reject a password after inserting a partial user.
            const partial = await R.knex("better_auth_user").where({ email }).first();
            if (partial) {
                await removeRows(R.knex, partial.id);
            }
            throw error;
        }
    });
}

/**
 * Validate an explicit list of resource IDs.
 * @param {Array} values Requested IDs
 * @returns {Array<number>} Unique valid IDs
 * @throws {Error} If any resource ID is invalid
 */
function resourceIDs(values) {
    if (!Array.isArray(values) || values.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
        throw new Error("Invalid resource permissions.");
    }
    return [...new Set(values)];
}

/**
 * Replace a Member's grants atomically.
 * @param {string} actorID Acting account
 * @param {string} userID Target account
 * @param {object} input Monitor and status page IDs
 * @returns {Promise<void>}
 */
function savePermissions(actorID, userID, input) {
    return change(actorID, async (permissions) => {
        requireOwner(permissions);
        for (const flag of ["canManageIncidents", "canManageMaintenance"]) {
            if (input?.[flag] !== undefined && typeof input[flag] !== "boolean") {
                throw new Error("Invalid resource permissions.");
            }
        }
        const monitorIDs = resourceIDs(input?.monitorIDs);
        const statusPageIDs = resourceIDs(input?.statusPageIDs);
        await R.knex.transaction(async (trx) => {
            const user = await trx("better_auth_user").where("id", userID).first();
            if (!user || user.role !== "member") {
                throw new Error("Permissions can only be assigned to Members.");
            }
            await trx("better_auth_user")
                .where("id", userID)
                .update({
                    can_manage_incidents: input.canManageIncidents ?? false,
                    can_manage_maintenance: input.canManageMaintenance ?? false,
                });
            for (const [table, column, ids, resource] of [
                ["user_monitor_permission", "monitor_id", monitorIDs, "monitor"],
                ["user_status_page_permission", "status_page_id", statusPageIDs, "status_page"],
            ]) {
                const rows = await trx(resource).whereIn("id", ids).select("id");
                if (rows.length !== ids.length) {
                    throw new Error("Resource not found.");
                }
                await trx(table).where("user_id", userID).del();
                if (ids.length) {
                    for (let offset = 0; offset < ids.length; offset += 100) {
                        await trx(table).insert(
                            ids.slice(offset, offset + 100).map((id) => ({ user_id: userID, [column]: id }))
                        );
                    }
                }
            }
        });
    });
}

/**
 * Change another account's role and clear obsolete Member grants.
 * @param {string} actorID Acting account
 * @param {string} userID Target account
 * @param {string} role New role
 * @returns {Promise<void>}
 */
function setRole(actorID, userID, role) {
    return change(actorID, async (permissions) => {
        requireAdmin(permissions);
        if (userID === actorID || !roles.includes(role)) {
            throw new Error("Invalid account role change.");
        }
        await R.knex.transaction(async (trx) => {
            const user = await trx("better_auth_user").where("id", userID).first();
            if (!user) {
                throw new Error("Account not found.");
            }
            await trx("better_auth_user")
                .where("id", userID)
                .update({ role, can_manage_incidents: false, can_manage_maintenance: false, updatedAt: new Date() });
            await trx("user_monitor_permission").where("user_id", userID).del();
            await trx("user_status_page_permission").where("user_id", userID).del();
        });
    });
}

/**
 * Delete authentication records; shared monitors and settings remain in the instance.
 * @param {object} db Database connection or transaction
 * @param {string} userID Target account
 * @returns {Promise<void>}
 */
async function removeRows(db, userID) {
    for (const table of ["better_auth_session", "better_auth_account", "better_auth_twoFactor"]) {
        await db(table).where("userId", userID).del();
    }
    await db("better_auth_user").where("id", userID).del();
}

/**
 * Delete another account and revoke its sessions and API keys.
 * @param {string} actorID Acting account
 * @param {string} userID Target account
 * @returns {Promise<void>}
 */
function remove(actorID, userID) {
    return change(actorID, async (permissions) => {
        requireAdmin(permissions);
        if (userID === actorID) {
            throw new Error("You cannot delete your own account.");
        }
        await R.knex.transaction(async (trx) => {
            if (!(await trx("better_auth_user").where("id", userID).first())) {
                throw new Error("Account not found.");
            }
            await removeRows(trx, userID);
        });
    });
}

module.exports = { list, create, savePermissions, setRole, remove };
