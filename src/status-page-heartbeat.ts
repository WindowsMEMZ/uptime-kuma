import { DOWN, UP, PENDING, MAINTENANCE } from "./util";

export const MAX_HEARTBEAT_WINDOW_MINUTES = 365 * 24 * 60;

export interface HeartbeatBucket {
    time: string;
    endTime: string;
    upCount: number;
    downCount: number;
    maintenanceCount: number;
    status: number | null;
}

/**
 * Read the public heartbeat window from a monitor's stored config.
 * @param config Stored monitor config
 * @returns Window in minutes, or zero for automatic mode
 */
export function getStatusPageHeartbeatWindow(config: unknown): number {
    try {
        const parsed: unknown = typeof config === "string" ? JSON.parse(config) : config;
        if (!parsed || typeof parsed !== "object") {
            return 0;
        }
        const value = (parsed as { statusPageHeartbeatWindow?: unknown }).statusPageHeartbeatWindow;
        return typeof value === "number" &&
            Number.isInteger(value) &&
            value >= 0 &&
            value <= MAX_HEARTBEAT_WINDOW_MINUTES
            ? value
            : 0;
    } catch {
        return 0;
    }
}

/**
 * Determine the status from check counts, excluding maintenance from checks.
 * @param bucket Counts in the interval
 * @returns Status, or null when no checks were recorded
 */
export function heartbeatBucketStatus(
    bucket: Pick<HeartbeatBucket, "upCount" | "downCount" | "maintenanceCount">
): number | null {
    if (bucket.downCount > 0) {
        return bucket.upCount > 0 ? PENDING : DOWN;
    }
    if (bucket.upCount > 0) {
        return UP;
    }
    return bucket.maintenanceCount > 0 ? MAINTENANCE : null;
}

/**
 * Calculate availability from every confirmed check in the displayed window.
 * @param buckets Buckets covering the public heartbeat window
 * @returns Successful check fraction, excluding maintenance and empty intervals
 */
export function heartbeatWindowUptime(buckets: Pick<HeartbeatBucket, "upCount" | "downCount">[]): number {
    let up = 0;
    let down = 0;
    for (const bucket of buckets) {
        up += bucket.upCount;
        down += bucket.downCount;
    }
    return up + down > 0 ? up / (up + down) : 0;
}

/**
 * Fit server buckets into a bar without dropping any part of its time window.
 * @param buckets Chronological server buckets, including empty intervals
 * @param maxPoints Available columns
 * @returns Merged buckets covering the same window
 */
export function fitHeartbeatBuckets(buckets: HeartbeatBucket[], maxPoints: number): HeartbeatBucket[] {
    if (maxPoints <= 0 || buckets.length <= maxPoints) {
        return buckets;
    }

    const result: HeartbeatBucket[] = [];
    for (let i = 0; i < buckets.length; i++) {
        const index = Math.floor((i * maxPoints) / buckets.length);
        const bucket = buckets[i];
        if (!result[index]) {
            result[index] = { ...bucket };
        } else {
            const merged = result[index];
            merged.endTime = bucket.endTime;
            merged.upCount += bucket.upCount;
            merged.downCount += bucket.downCount;
            merged.maintenanceCount += bucket.maintenanceCount;
            merged.status = heartbeatBucketStatus(merged);
        }
    }
    return result;
}
