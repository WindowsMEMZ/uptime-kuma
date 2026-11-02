import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { UP, DOWN, PENDING, MAINTENANCE } from "../../src/util";
import {
    fitHeartbeatBuckets,
    heartbeatBucketStatus,
    heartbeatWindowUptime,
    getStatusPageHeartbeatWindow,
    MAX_HEARTBEAT_WINDOW_MINUTES,
    type HeartbeatBucket,
} from "../../src/status-page-heartbeat";

describe("public heartbeat windows", () => {
    test("calculates window uptime from check counts instead of averaging bucket percentages", () => {
        assert.equal(
            heartbeatWindowUptime([
                { upCount: 99999, downCount: 0 },
                { upCount: 0, downCount: 1 },
            ]),
            0.99999
        );
        assert.equal(
            heartbeatWindowUptime([
                { upCount: 1, downCount: 1 },
                { upCount: 8, downCount: 0 },
            ]),
            0.9
        );
        assert.equal(heartbeatWindowUptime([{ upCount: 0, downCount: 0 }]), 0);
        assert.equal(heartbeatWindowUptime([]), 0);
    });

    test("reads valid windows and keeps automatic mode for missing or invalid config", () => {
        assert.equal(getStatusPageHeartbeatWindow('{"statusPageHeartbeatWindow":90}'), 90);
        assert.equal(
            getStatusPageHeartbeatWindow({ statusPageHeartbeatWindow: MAX_HEARTBEAT_WINDOW_MINUTES }),
            MAX_HEARTBEAT_WINDOW_MINUTES
        );
        for (const config of [
            undefined,
            null,
            "{bad",
            "null",
            {},
            { statusPageHeartbeatWindow: "60" },
            { statusPageHeartbeatWindow: -1 },
            { statusPageHeartbeatWindow: 1.5 },
            { statusPageHeartbeatWindow: Infinity },
        ]) {
            assert.equal(getStatusPageHeartbeatWindow(config), 0);
        }
    });

    test("classifies passed, failed, mixed, maintenance and empty intervals", () => {
        assert.equal(heartbeatBucketStatus({ upCount: 5, downCount: 0, maintenanceCount: 0 }), UP);
        assert.equal(heartbeatBucketStatus({ upCount: 0, downCount: 5, maintenanceCount: 0 }), DOWN);
        assert.equal(heartbeatBucketStatus({ upCount: 5, downCount: 1, maintenanceCount: 0 }), PENDING);
        assert.equal(heartbeatBucketStatus({ upCount: 0, downCount: 0, maintenanceCount: 3 }), MAINTENANCE);
        assert.equal(heartbeatBucketStatus({ upCount: 0, downCount: 0, maintenanceCount: 0 }), null);
        assert.equal(heartbeatBucketStatus({ upCount: 5, downCount: 0, maintenanceCount: 3 }), UP);
    });

    test("resizing preserves the entire window and every failure", () => {
        const buckets: HeartbeatBucket[] = Array.from({ length: 100 }, (_, index) => ({
            time: String(index),
            endTime: String(index + 1),
            upCount: index === 0 ? 0 : 1,
            downCount: index === 0 ? 1 : 0,
            maintenanceCount: 0,
            status: index === 0 ? DOWN : UP,
        }));

        for (const width of [1, 3, 17, 37, 99, 100, 200]) {
            const fitted = fitHeartbeatBuckets(buckets, width);
            assert.equal(fitted.length, Math.min(width, 100));
            assert.equal(fitted[0].time, "0");
            assert.equal(fitted.at(-1)!.endTime, "100");
            assert.equal(
                fitted.reduce((total, bucket) => total + bucket.upCount, 0),
                99
            );
            assert.equal(
                fitted.reduce((total, bucket) => total + bucket.downCount, 0),
                1
            );
            assert.equal(fitted[0].status, width < 100 ? PENDING : DOWN);
            for (let i = 1; i < fitted.length; i++) {
                assert.equal(fitted[i - 1].endTime, fitted[i].time);
            }
        }
        assert.equal(buckets[0].upCount, 0);
        assert.equal(buckets[0].endTime, "1");
        assert.deepEqual(fitHeartbeatBuckets([], 3), []);
    });
});
