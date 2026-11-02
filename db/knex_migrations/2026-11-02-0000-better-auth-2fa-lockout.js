exports.up = function (knex) {
    return knex.schema.alterTable("better_auth_twoFactor", (table) => {
        table.integer("failedVerificationCount").notNullable().defaultTo(0);
        table.timestamp("lockedUntil").nullable();
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable("better_auth_twoFactor", (table) => {
        table.dropColumn("failedVerificationCount");
        table.dropColumn("lockedUntil");
    });
};
