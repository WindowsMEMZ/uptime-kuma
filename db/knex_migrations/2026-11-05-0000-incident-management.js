exports.up = async function (knex) {
    await knex.schema.createTable("incident_push_state", (table) => {
        table.integer("monitor_id").unsigned().primary().references("monitor.id").onDelete("CASCADE");
        table.smallint("status").notNullable();
        table.datetime("time").notNullable();
        table.text("msg");
        table.float("ping", 20, 2);
        table.integer("retries").notNullable().defaultTo(0);
    });
    await knex.schema.createTable("incident_update", (table) => {
        table.increments("id");
        table.integer("incident_id").unsigned().notNullable().references("incident.id").onDelete("CASCADE");
        table.text("content").notNullable();
        table.datetime("created_date").notNullable();
        table.datetime("last_updated_date");
        table.index(["incident_id", "created_date"]);
    });
    await knex.schema.createTable("incident_monitor", (table) => {
        table.integer("incident_id").unsigned().notNullable().references("incident.id").onDelete("CASCADE");
        table.integer("monitor_id").unsigned().notNullable().references("monitor.id").onDelete("CASCADE");
        table.smallint("override_status");
        table.primary(["incident_id", "monitor_id"]);
        table.index("monitor_id");
    });
    await knex.schema.createTable("incident_status_page", (table) => {
        table.integer("incident_id").unsigned().notNullable().references("incident.id").onDelete("CASCADE");
        table.integer("status_page_id").unsigned().notNullable().references("status_page.id").onDelete("CASCADE");
        table.primary(["incident_id", "status_page_id"]);
        table.index("status_page_id");
    });
    const incidents = await knex("incident").select("id", "content", "created_date", "status_page_id");
    for (const incident of incidents) {
        await knex("incident_update").insert({
            incident_id: incident.id,
            content: incident.content,
            created_date: incident.created_date,
        });
        if (incident.status_page_id) {
            await knex("incident_status_page").insert({
                incident_id: incident.id,
                status_page_id: incident.status_page_id,
            });
        }
    }
};

exports.down = async function (knex) {
    await knex.schema.dropTable("incident_push_state");
    await knex.schema.dropTable("incident_status_page");
    await knex.schema.dropTable("incident_monitor");
    await knex.schema.dropTable("incident_update");
};
