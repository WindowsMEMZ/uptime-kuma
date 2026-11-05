const accounts = require("../account-service");
const { getPermissions } = require("../permissions");

/**
 * Register account management and permission discovery.
 * @param {Socket} socket Dashboard socket
 * @param {UptimeKumaServer} server Server instance
 * @returns {void}
 */
module.exports.accountSocketHandler = (socket, server) => {
    const handle = (event, operation) => {
        socket.on(event, async (...args) => {
            const callback = args.pop();
            if (typeof callback !== "function") {
                return;
            }
            try {
                callback({ ok: true, ...(await operation(...args)) });
            } catch (error) {
                callback({ ok: false, msg: error.message, msgi18n: error.message.startsWith("account") });
            }
        });
    };
    const refresh = async (userID) => {
        server.io.to(userID).emit("permissions", await getPermissions(userID));
        server.io.to("account-managers").emit("accountsChanged");
    };
    handle("getMyPermissions", async () => ({ permissions: await getPermissions(socket.userID) }));
    handle("getAccounts", async () => ({ accounts: await accounts.list(socket.userID) }));
    handle("createAccount", async (input) => {
        const result = await accounts.create(socket.userID, input);
        server.io.to("account-managers").emit("accountsChanged");
        return result;
    });
    handle("saveAccountPermissions", async (userID, input) => {
        await accounts.savePermissions(socket.userID, userID, input);
        await refresh(userID);
    });
    handle("setAccountRole", async (userID, role) => {
        await accounts.setRole(socket.userID, userID, role);
        // Reconnect so downgraded accounts leave privileged rooms immediately.
        server.disconnectAllSocketClients(userID);
        server.io.to("account-managers").emit("accountsChanged");
    });
    handle("deleteAccount", async (userID) => {
        await accounts.remove(socket.userID, userID);
        server.disconnectAllSocketClients(userID);
        server.io.to("account-managers").emit("accountsChanged");
    });
};
