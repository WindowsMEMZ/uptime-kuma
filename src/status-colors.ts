export const STATUS_COLOR_KEYS = ["up", "down", "pending", "maintenance", "unknown", "empty"] as const;
export const STATUS_COLOR_THEMES = ["light", "dark"] as const;

export type StatusColorKey = (typeof STATUS_COLOR_KEYS)[number];
export type StatusPalette = Record<StatusColorKey, string>;
export type StatusColors = Record<(typeof STATUS_COLOR_THEMES)[number], StatusPalette>;

export const DEFAULT_STATUS_COLORS: StatusColors = {
    light: {
        up: "#5cdd8b",
        down: "#dc3545",
        pending: "#f8a306",
        maintenance: "#1747f5",
        unknown: "#6c757d",
        empty: "#f0f8ff",
    },
    dark: {
        up: "#5cdd8b",
        down: "#dc3545",
        pending: "#f8a306",
        maintenance: "#1747f5",
        unknown: "#6c757d",
        empty: "#848484",
    },
};

/** Normalize stored settings without allowing arbitrary CSS values. */
export function normalizeStatusColors(value: unknown): StatusColors {
    const colors = value as StatusColors | null;
    return Object.fromEntries(
        STATUS_COLOR_THEMES.map((theme) => [
            theme,
            Object.fromEntries(
                STATUS_COLOR_KEYS.map((status) => {
                    const color = colors?.[theme]?.[status];
                    return [
                        status,
                        typeof color === "string" && /^#[\da-f]{6}$/i.test(color)
                            ? color.toLowerCase()
                            : DEFAULT_STATUS_COLORS[theme][status],
                    ];
                })
            ),
        ])
    ) as StatusColors;
}

/** Require a complete palette when saving, rather than silently discarding invalid input. */
export function validateStatusColors(value: unknown): asserts value is StatusColors {
    const colors = value as StatusColors | null;
    for (const theme of STATUS_COLOR_THEMES) {
        for (const status of STATUS_COLOR_KEYS) {
            const color = colors?.[theme]?.[status];
            if (typeof color !== "string" || !/^#[\da-f]{6}$/i.test(color)) {
                throw new Error(`Invalid status color: ${theme}.${status}`);
            }
        }
    }
}

/** Choose the more readable badge foreground using relative luminance. */
export function statusColorForeground(color: string): string {
    const [red, green, blue] = color
        .slice(1)
        .match(/../g)!
        .map((channel) => {
            const value = parseInt(channel, 16) / 255;
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "#000000" : "#ffffff";
}
