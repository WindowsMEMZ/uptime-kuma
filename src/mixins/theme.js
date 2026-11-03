import { normalizeStatusColors, STATUS_COLOR_KEYS, statusColorForeground } from "../status-colors";

export default {
    data() {
        return {
            system: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
            userTheme: localStorage.theme,
            userHeartbeatBar: localStorage.heartbeatBarTheme,
            styleElapsedTime: localStorage.styleElapsedTime,
            statusPageTheme: "light",
            forceStatusPageTheme: false,
            path: "",
            statusColors: normalizeStatusColors(null),
        };
    },

    mounted() {
        // Default Light
        if (!this.userTheme) {
            this.userTheme = "auto";
        }

        // Default Heartbeat Bar
        if (!this.userHeartbeatBar) {
            this.userHeartbeatBar = "normal";
        }

        // Default Elapsed Time Style
        if (!this.styleElapsedTime) {
            this.styleElapsedTime = "no-line";
        }

        document.body.classList.add(this.theme);
        this.updateThemeColorMeta();
    },

    computed: {
        theme() {
            // As entry can be status page now, set forceStatusPageTheme to true to use status page theme
            if (this.forceStatusPageTheme) {
                if (this.statusPageTheme === "auto") {
                    return this.system;
                }
                return this.statusPageTheme;
            }

            // Entry no need dark
            if (this.path === "") {
                return "light";
            }

            if (this.path.startsWith("/status-page") || this.path.startsWith("/status")) {
                if (this.statusPageTheme === "auto") {
                    return this.system;
                }
                return this.statusPageTheme;
            } else {
                if (this.userTheme === "auto") {
                    return this.system;
                }
                return this.userTheme;
            }
        },

        isDark() {
            return this.theme === "dark";
        },

        statusPalette() {
            return this.statusColors[this.isDark ? "dark" : "light"];
        },
    },

    watch: {
        statusPalette: {
            immediate: true,
            deep: true,
            handler(palette) {
                for (const key of STATUS_COLOR_KEYS) {
                    document.body.style.setProperty(`--status-${key}`, palette[key]);
                    document.body.style.setProperty(`--status-${key}-text`, statusColorForeground(palette[key]));
                }
            },
        },
        "$route.fullPath"(path) {
            this.path = path;
        },

        userTheme(to, from) {
            localStorage.theme = to;
        },

        styleElapsedTime(to, from) {
            localStorage.styleElapsedTime = to;
        },

        theme(to, from) {
            document.body.classList.remove(from);
            document.body.classList.add(this.theme);
            this.updateThemeColorMeta();
        },

        userHeartbeatBar(to, from) {
            localStorage.heartbeatBarTheme = to;
        },

        heartbeatBarTheme(to, from) {
            document.body.classList.remove(from);
            document.body.classList.add(this.heartbeatBarTheme);
        },
    },

    methods: {
        /**
         * Apply the server's shared light and dark status palettes.
         * @param {object} colors Status color settings
         * @returns {void}
         */
        setStatusColors(colors) {
            this.statusColors = normalizeStatusColors(colors);
        },
        /**
         * Update the theme color meta tag
         * @returns {void}
         */
        updateThemeColorMeta() {
            if (this.theme === "dark") {
                document.querySelector("#theme-color").setAttribute("content", "#161B22");
            } else {
                document.querySelector("#theme-color").setAttribute("content", "#5cdd8b");
            }
        },
    },
};
