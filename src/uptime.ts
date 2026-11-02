/**
 * Format availability without rounding a confirmed outage up to perfect uptime.
 * @param uptime Successful check fraction
 * @returns Percentage with two decimal places, or null for unavailable data
 */
export function formatUptime(uptime: unknown): string | null {
    if (typeof uptime !== "number" || !Number.isFinite(uptime)) {
        return null;
    }
    const percentage = Math.max(0, Math.min(100, uptime * 100));
    const rounded = Math.round(percentage * 100) / 100;
    return Math.min(rounded, uptime < 1 ? 99.99 : 100).toFixed(2) + "%";
}
