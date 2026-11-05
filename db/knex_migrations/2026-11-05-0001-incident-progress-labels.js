exports.up = async function (knex) {
    await knex.schema.alterTable("incident_update", (table) => {
        table.string("label", 20).notNullable().defaultTo("updated");
    });
    await knex.schema.alterTable("incident", (table) => {
        table.datetime("resolved_date");
        table.index(["active", "resolved_date"]);
    });
    const resolved = await knex("incident").where("active", 0);
    for (const incident of resolved) {
        const latest = await knex("incident_update")
            .where("incident_id", incident.id)
            .orderBy("created_date", "desc")
            .orderBy("id", "desc")
            .first();
        const resolvedDate = incident.last_updated_date || incident.created_date;
        if (latest) {
            await knex("incident_update").where("id", latest.id).update({ label: "resolved" });
        }
        await knex("incident").where("id", incident.id).update({ resolved_date: resolvedDate });
    }
};

exports.down = async function (knex) {
    await knex.schema.alterTable("incident", (table) => {
        table.dropIndex(["active", "resolved_date"]);
        table.dropColumn("resolved_date");
    });
    await knex.schema.alterTable("incident_update", (table) => table.dropColumn("label"));
};
