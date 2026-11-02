const dayjs = require("dayjs");
const { R } = require("redbean-node");
const { UP, DOWN, PENDING, MAINTENANCE, SQL_DATETIME_FORMAT } = require("../src/util");
const { heartbeatBucketStatus } = require("../src/status-page-heartbeat");

const BUCKET_COUNT = 100;
const TIME_FORMAT = SQL_DATETIME_FORMAT + ".SSS";
const CONFIRMED_HEARTBEAT = `NOT (status = ${PENDING} AND COALESCE(retries, 0) > 0)`;

/**
 * Create stable hourly or daily columns in the server's timezone.
 * @param {number} windowMinutes Selected window in minutes
 * @param {dayjs.Dayjs} now Current time
 * @param {string} preset Selected preset
 * @param {string} timezone Server timezone
 * @returns {object|null} Calendar boundaries and labels, or null for a custom window
 */
function calendarLayout(windowMinutes, now, preset, timezone) {
    if (preset === "custom" || preset === "default") {
        return null;
    }
    const localNow = now.tz(timezone);
    if (preset === "day") {
        const hourStart = now.valueOf() - (localNow.minute() * 60 + localNow.second()) * 1000 - localNow.millisecond();
        return {
            unit: "hour",
            boundaries: Array.from({ length: 25 }, (_, index) => hourStart + (index - 23) * 3600000),
        };
    }
    const days = windowMinutes / 1440;
    const today = dayjs.utc(localNow.format("YYYY-MM-DD"));
    return {
        unit: "day",
        boundaries: Array.from({ length: days + 1 }, (_, index) =>
            dayjs.tz(today.add(index - days + 1, "day").format("YYYY-MM-DD"), timezone).valueOf()
        ),
    };
}

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
 * @param {object} options Calendar preset and timezone
 * @param {string} options.preset Selected preset, defaults to a rolling custom window
 * @param {string} options.timezone Timezone for calendar boundaries
 * @returns {Promise<object[]>} Chronological buckets, including empty intervals
 */
async function getStatusPageHeartbeatBuckets(
    monitorID,
    windowMinutes,
    now = dayjs.utc(),
    { preset = "custom", timezone = "UTC" } = {}
) {
    const layout = calendarLayout(windowMinutes, now, preset, timezone);
    const end = layout ? layout.boundaries.at(-1) : now.valueOf();
    const start = layout ? layout.boundaries[0] : end - windowMinutes * 60 * 1000;
    const count = layout ? layout.boundaries.length - 1 : BUCKET_COUNT;
    const bucketWidth = (end - start) / count;
    const startTime = dayjs
        .utc(start)
        .format(TIME_FORMAT)
        .replace(/\.000$/, "");
    const endTime = dayjs
        .utc(Math.min(end, now.valueOf()))
        .format(TIME_FORMAT)
        .replace(/\.000$/, "");

    // Round SQLite's Julian-day arithmetic to milliseconds before assigning boundaries.
    const boundaryBindings = layout
        ? layout.boundaries.slice(1, -1).map((time) =>
              dayjs
                  .utc(time)
                  .format(TIME_FORMAT)
                  .replace(/\.000$/, "")
          )
        : [startTime, bucketWidth];
    const bucketIndex = layout
        ? `CASE ${boundaryBindings.map((_, index) => `WHEN time < ? THEN ${index}`).join(" ")} ELSE ${count - 1} END`
        : R.knex.client.config.client === "better-sqlite3"
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
        [...boundaryBindings, UP, DOWN, PENDING, MAINTENANCE, monitorID, startTime, endTime]
    );

    const buckets = Array.from({ length: count }, (_, index) => ({
        time: dayjs.utc(layout ? layout.boundaries[index] : start + index * bucketWidth).format(TIME_FORMAT),
        endTime: dayjs
            .utc(layout ? layout.boundaries[index + 1] : start + (index + 1) * bucketWidth)
            .format(TIME_FORMAT),
        upCount: 0,
        downCount: 0,
        maintenanceCount: 0,
        status: null,
        ...(layout
            ? {
                  calendarUnit: layout.unit,
                  timezone,
                  label: dayjs
                      .utc(layout.boundaries[index])
                      .tz(timezone)
                      .format(layout.unit === "day" ? "YYYY-MM-DD" : "YYYY-MM-DD HH:mm Z"),
              }
            : {}),
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
