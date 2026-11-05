exports.up = async function (knex) {
    await knex.schema.alterTable("better_auth_user", (table) => {
        table.boolean("can_manage_incidents").notNullable().defaultTo(false);
        table.boolean("can_manage_maintenance").notNullable().defaultTo(false);
    });
    await knex.schema.createTable("user_passkey", (table) => {
        table.string("id", 255).primary();
        table.string("user_id", 255).notNullable().references("id").inTable("better_auth_user").onDelete("CASCADE");
        table.string("credential_hash", 64).notNullable().unique();
        table.text("credential_id").notNullable();
        table.text("public_key").notNullable();
        table.bigInteger("counter").notNullable().defaultTo(0);
        table.string("rp_id", 255).notNullable();
        table.string("name", 100).notNullable();
        table.text("transports").notNullable();
        table.timestamp("created_date").notNullable();
        table.timestamp("last_used_date");
        table.index(["user_id", "rp_id"]);
    });
};

exports.down = async function (knex) {
    await knex.schema.dropTable("user_passkey");
    await knex.schema.alterTable("better_auth_user", (table) => {
        table.dropColumn("can_manage_incidents");
        table.dropColumn("can_manage_maintenance");
    });
};
