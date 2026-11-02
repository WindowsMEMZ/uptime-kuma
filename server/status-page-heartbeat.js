const dayjs = require("dayjs");
const { R } = require("redbean-node");
const { UP, DOWN, PENDING, MAINTENANCE, SQL_DATETIME_FORMAT } = require("../src/util");
const { heartbeatBucketStatus } = require("../src/status-page-heartbeat");

const BUCKET_COUNT = 100;
const TIME_FORMAT = SQL_DATETIME_FORMAT + ".SSS";
const CONFIRMED_HEARTBEAT = `NOT (status = ${PENDING} AND COALESCE(retries, 0) > 0)`;

/**
 * Return public checks without exposing failures that are still being retried.
 * @param {number} monitorID Monitor id
 * @param {number} limit Maximum number of confirmed checks
 * @returns {Promise<object[]>} Chronological public heartbeats
 */
async function getStatusPageHeartbeatList(monitorID, limit = 100) {
    const rows = await R.getAll(
        `SELECT * FROM heartbeat
         WHERE monitor_id = ? AND ${CONFIRMED_HEARTBEAT}
         ORDER BY time DESC, id DESC LIMIT ?`,
        [monitorID, limit]
    );
    return R.convertToBeans("heartbeat", rows)
        .reverse()
        .map((row) => row.toPublicJSON());
}

/**
 * Aggregate retained checks in SQL so a long window never sends raw history to visitors.
 * @param {number} monitorID Monitor id
 * @param {number} windowMinutes Window in minutes
 * @param {dayjs.Dayjs} now End of the window
 * @returns {Promise<object[]>} Chronological buckets, including empty intervals
 */
async function getStatusPageHeartbeatBuckets(monitorID, windowMinutes, now = dayjs.utc()) {
    const end = now.valueOf();
    const start = end - windowMinutes * 60 * 1000;
    const bucketWidth = (end - start) / BUCKET_COUNT;
    const startTime = dayjs
        .utc(start)
        .format(TIME_FORMAT)
        .replace(/\.000$/, "");
    const endTime = dayjs
        .utc(end)
        .format(TIME_FORMAT)
        .replace(/\.000$/, "");

    // Round SQLite's Julian-day arithmetic to milliseconds before assigning boundaries.
    const bucketIndex =
        R.knex.client.config.client === "better-sqlite3"
            ? "CAST(ROUND((julianday(time) - julianday(?)) * 86400000) / ? AS INTEGER)"
            : "FLOOR(TIMESTAMPDIFF(MICROSECOND, ?, time) / 1000 / ?)";
    const rows = await R.getAll(
        `SELECT ${bucketIndex} AS bucket,
                SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS up_count,
                SUM(CASE WHEN status IN (?, ?) THEN 1 ELSE 0 END) AS down_count,
                SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) AS maintenance_count
         FROM heartbeat
         WHERE monitor_id = ? AND time >= ? AND time < ? AND ${CONFIRMED_HEARTBEAT}
         GROUP BY bucket ORDER BY bucket`,
        [startTime, bucketWidth, UP, DOWN, PENDING, MAINTENANCE, monitorID, startTime, endTime]
    );

    const buckets = Array.from({ length: BUCKET_COUNT }, (_, index) => ({
        time: dayjs.utc(start + index * bucketWidth).format(TIME_FORMAT),
        endTime: dayjs.utc(start + (index + 1) * bucketWidth).format(TIME_FORMAT),
        upCount: 0,
        downCount: 0,
        maintenanceCount: 0,
        status: null,
    }));
    for (const row of rows) {
        const bucket = buckets[Number(row.bucket)];
        if (bucket) {
            bucket.upCount = Number(row.up_count);
            bucket.downCount = Number(row.down_count);
            bucket.maintenanceCount = Number(row.maintenance_count);
            bucket.status = heartbeatBucketStatus(bucket);
        }
    }
    return buckets;
}

module.exports = { getStatusPageHeartbeatBuckets, getStatusPageHeartbeatList };
