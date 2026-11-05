const { R } = require("redbean-node");
const { checkLogin } = require("../util");
const incidents = require("../incident-service");

/**
 * Register incident management operations for authenticated dashboard users.
 * @param {Socket} socket Socket.io connection
 * @returns {void}
 */
module.exports.incidentSocketHandler = (socket) => {
    const handle = (event, operation) => {
        socket.on(event, async (...args) => {
            const callback = args.pop();
            if (typeof callback !== "function") {
                return;
            }
            try {
                checkLogin(socket);
                callback({ ok: true, ...(await operation(...args)) });
            } catch (error) {
                callback({ ok: false, msg: error.message });
            }
        });
    };
    handle("getManagedIncidents", async () => ({
        incidents: await incidents.serialize(
            await R.knex("incident").orderBy("active", "desc").orderBy("created_date", "desc").orderBy("id", "desc"),
            true
        ),
    }));
    handle("saveManagedIncident", async (input) => ({ incidentID: await incidents.save(input) }));
    handle("saveIncidentUpdate", async (incidentID, updateID, content, label) => {
        await incidents.saveUpdate(incidentID, updateID, content, label);
    });
    handle("managedIncidentAction", async (incidentID, action) => {
        await incidents.action(incidentID, action);
    });
};
