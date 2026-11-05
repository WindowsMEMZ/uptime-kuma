exports.up = async function (knex) {
    // All accounts predating multi-user support were instance administrators.
    await knex("better_auth_user").update({ role: "admin" });
    await knex.schema.createTable("user_monitor_permission", (table) => {
        table.string("user_id", 255).references("id").inTable("better_auth_user").onDelete("CASCADE");
        table.integer("monitor_id").unsigned().references("id").inTable("monitor").onDelete("CASCADE");
        table.primary(["user_id", "monitor_id"]);
    });
    await knex.schema.createTable("user_status_page_permission", (table) => {
        table.string("user_id", 255).references("id").inTable("better_auth_user").onDelete("CASCADE");
        table.integer("status_page_id").unsigned().references("id").inTable("status_page").onDelete("CASCADE");
        table.primary(["user_id", "status_page_id"]);
    });
};

exports.down = async function (knex) {
    await knex.schema.dropTable("user_status_page_permission");
    await knex.schema.dropTable("user_monitor_permission");
};
