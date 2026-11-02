const { PENDING } = require("../../src/util");

exports.up = async function (knex) {
    const sqlite = knex.client.config.client === "better-sqlite3";
    const epoch = sqlite
        ? "CAST(strftime('%s', COALESCE(end_time, time)) AS INTEGER)"
        : "TIMESTAMPDIFF(SECOND, '1970-01-01 00:00:00', COALESCE(end_time, time))";

    // Correct only retry attempts whose raw history is still available.
    for (const [table, seconds] of [
        ["stat_minutely", 60],
        ["stat_hourly", 3600],
        ["stat_daily", 86400],
    ]) {
        const bucket = sqlite
            ? `CAST(${epoch} / ${seconds} AS INTEGER) * ${seconds}`
            : `FLOOR(${epoch} / ${seconds}) * ${seconds}`;
        const rows = await knex("heartbeat")
            .select("monitor_id", knex.raw(`${bucket} AS bucket`))
            .count({ retry_count: "id" })
            .where({ status: PENDING })
            .where("retries", ">", 0)
            .groupBy("monitor_id", "bucket");

        for (const row of rows) {
            await knex(table)
                .where({ monitor_id: row.monitor_id, timestamp: row.bucket })
                .update({
                    down: knex.raw("CASE WHEN ?? >= ? THEN ?? - ? ELSE 0 END", [
                        "down",
                        row.retry_count,
                        "down",
                        row.retry_count,
                    ]),
                });
        }
    }
};

exports.down = async function () {
    // Historical data corrections cannot be reversed after raw checks are pruned.
};
