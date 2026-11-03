<template>
    <span :class="className" :title="title">{{ uptime }}</span>
</template>

<script>
import { DOWN, MAINTENANCE, PENDING, UP } from "../util.ts";
import { formatUptime } from "../uptime";
import { getStatusPageHeartbeatWindow } from "../status-page-heartbeat";

export default {
    props: {
        /** Monitor this represents */
        monitor: {
            type: Object,
            default: null,
        },
        /** Type of monitor */
        type: {
            type: String,
            default: null,
        },
        /** Is this a pill? */
        pill: {
            type: Boolean,
            default: false,
        },
    },

    computed: {
        uptime() {
            if (this.type === "maintenance") {
                return this.$t("statusMaintenance");
            }

            let key = this.monitor.id + "_" + this.type;

            return formatUptime(this.$root.uptimeList[key]) ?? this.$t("notAvailableShort");
        },

        color() {
            if (this.lastHeartBeat.status === MAINTENANCE) {
                return "maintenance";
            }

            if (this.lastHeartBeat.status === DOWN) {
                return "danger";
            }

            if (this.lastHeartBeat.status === UP) {
                return "primary";
            }

            if (this.lastHeartBeat.status === PENDING) {
                return "warning";
            }

            return "secondary";
        },

        lastHeartBeat() {
            if (this.monitor.id in this.$root.lastHeartbeatList && this.$root.lastHeartbeatList[this.monitor.id]) {
                return this.$root.lastHeartbeatList[this.monitor.id];
            }

            return {
                status: -1,
            };
        },

        className() {
            if (this.pill) {
                return `badge rounded-pill status-badge bg-${this.color}`;
            }

            return "";
        },

        title() {
            if (this.type === "statusPage") {
                const minutes = getStatusPageHeartbeatWindow(this.monitor);
                if (minutes > 0) {
                    if (minutes % 1440 === 0) {
                        return this.$t("days", minutes / 1440);
                    }
                    if (minutes % 60 === 0) {
                        return this.$t("hours", minutes / 60);
                    }
                    return this.$t("minutes", minutes);
                }
            }
            if (this.type === "1y") {
                return this.$t("years", 1);
            }
            if (this.type === "720") {
                return this.$t("days", 30);
            }
            return this.$t("hours", 24);
        },
    },
};
</script>

<style>
.badge {
    min-width: 62px;
}
</style>
