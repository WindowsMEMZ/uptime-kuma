import { z } from "zod";
import { HEARTBEAT_WINDOW_PRESETS, MAX_HEARTBEAT_WINDOW_MINUTES } from "../src/status-page-heartbeat";

/**
 * Config keys a client may write; anything else is dropped.
 */
export const monitorConfigSchema = z
    .object({
        systemServiceName: z.string().max(255).optional(),
        statusPageHeartbeatWindow: z.number().int().min(0).max(MAX_HEARTBEAT_WINDOW_MINUTES).optional(),
        statusPageHeartbeatWindowPreset: z.enum(["default", "day", "week", "half-month", "month", "custom"]).optional(),
    })
    .superRefine((config, context) => {
        const preset = config.statusPageHeartbeatWindowPreset;
        if (
            preset &&
            (preset === "custom"
                ? !(config.statusPageHeartbeatWindow && config.statusPageHeartbeatWindow > 0)
                : config.statusPageHeartbeatWindow !== HEARTBEAT_WINDOW_PRESETS[preset])
        ) {
            context.addIssue({
                code: "custom",
                path: ["statusPageHeartbeatWindow"],
                message:
                    "The window must match the selected preset; custom windows require a positive number of minutes.",
            });
        }
    });

export type MonitorConfig = z.infer<typeof monitorConfigSchema>;

/**
 * Monitor object as sent to and from the client; other columns pass through untouched.
 */
export interface MonitorObject {
    id?: number;
    name: string;
    type: string;
    active?: boolean;
    interval?: number;
    parent?: number | null;
    url?: string | null;
    hostname?: string | null;
    config: MonitorConfig;
    [key: string]: unknown;
}
