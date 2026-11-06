<template>
    <transition ref="tableContainer" name="slide-fade" appear>
        <div v-if="$route.name === 'DashboardHome'">
            <h1 class="mb-3">
                {{ $t("Quick Stats") }}
            </h1>

            <div class="shadow-box big-padding text-center mb-3">
                <div class="row">
                    <div class="col">
                        <h3>{{ $t("Up") }}</h3>
                        <span class="num status-text" :class="$root.stats.up === 0 && 'text-secondary'">
                            {{ $root.stats.up }}
                        </span>
                    </div>
                    <div class="col">
                        <h3>{{ $t("Down") }}</h3>
                        <span class="num status-text" :class="$root.stats.down > 0 ? 'text-danger' : 'text-secondary'">
                            {{ $root.stats.down }}
                        </span>
                    </div>
                    <div class="col">
                        <h3>{{ $t("Maintenance") }}</h3>
                        <span
                            class="num status-text"
                            :class="$root.stats.maintenance > 0 ? 'text-maintenance' : 'text-secondary'"
                        >
                            {{ $root.stats.maintenance }}
                        </span>
                    </div>
                    <div class="col">
                        <h3>{{ $t("Unknown") }}</h3>
                        <span class="num status-text text-secondary">{{ $root.stats.unknown }}</span>
                    </div>
                    <div class="col">
                        <h3>{{ $t("pauseDashboardHome") }}</h3>
                        <span class="num status-text text-secondary">{{ $root.stats.pause }}</span>
                    </div>
                </div>
            </div>

            <div class="shadow-box table-shadow-box table-wrapper" :class="{ 'resizing-columns': columnResize }">
                <div class="mb-3 d-flex justify-content-end gap-2">
                    <button
                        v-if="!stackedEventTable && hasCustomColumnWidths"
                        class="btn btn-sm btn-normal"
                        type="button"
                        @click="resetColumnWidths"
                    >
                        {{ $t("Reset column widths") }}
                    </button>
                    <button
                        class="btn btn-sm btn-outline-danger"
                        :disabled="clearingAllEvents"
                        @click="clearAllEventsDialog"
                    >
                        {{ $t("Clear All Events") }}
                    </button>
                </div>
                <div ref="eventTableViewport" class="events-table-scroll">
                    <table
                        class="table table-borderless table-hover events-table"
                        data-testid="dashboard-events"
                        :style="stackedEventTable ? undefined : { width: eventTableWidth + 'px' }"
                        :aria-label="$t('Events')"
                    >
                        <colgroup v-if="!stackedEventTable">
                            <col
                                v-for="column in eventColumns"
                                :key="column.key"
                                :style="{ width: column.width + 'px' }"
                            />
                        </colgroup>
                        <thead>
                            <tr>
                                <th
                                    v-for="column in eventColumns"
                                    :key="column.key"
                                    scope="col"
                                    :data-column="column.key"
                                >
                                    {{ $t(column.label) }}
                                    <span
                                        class="column-resizer"
                                        role="separator"
                                        tabindex="0"
                                        aria-orientation="vertical"
                                        :aria-label="$t('Resize event column', { column: $t(column.label) })"
                                        :aria-valuemin="column.min"
                                        :aria-valuemax="1200"
                                        :aria-valuenow="column.width"
                                        :title="$t('Drag to resize column')"
                                        @pointerdown="startColumnResize($event, column)"
                                        @pointermove="moveColumnResize"
                                        @pointerup="finishColumnResize"
                                        @pointercancel="finishColumnResize"
                                        @lostpointercapture="finishColumnResize"
                                        @keydown="resizeColumnWithKeyboard($event, column)"
                                        @dblclick="resetColumnWidth(column.key)"
                                    ></span>
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="(beat, index) in displayedRecords"
                                :key="index"
                                :class="{ 'shadow-box': $root.windowWidth <= 550 }"
                            >
                                <td v-if="showGroupColumn">
                                    <router-link
                                        v-if="getGroupName(beat.monitorID)"
                                        :to="`/dashboard/${getGroupId(beat.monitorID)}`"
                                    >
                                        {{ getGroupName(beat.monitorID) }}
                                    </router-link>
                                    <span v-else class="text-secondary">—</span>
                                </td>
                                <td class="name-column">
                                    <router-link :to="`/dashboard/${beat.monitorID}`">
                                        {{ $root.monitorList[beat.monitorID]?.name }}
                                    </router-link>
                                </td>
                                <td class="event-status"><Status :status="beat.status" /></td>
                                <td class="event-time" :class="{ 'border-0': !beat.msg }">
                                    <Datetime :value="beat.time" />
                                </td>
                                <td class="border-0 event-message">{{ beat.msg }}</td>
                            </tr>

                            <tr v-if="importantHeartBeatListLength === 0">
                                <td :colspan="tableColumnCount">
                                    {{ $t("No important events") }}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                <div class="d-flex justify-content-center kuma_pagination">
                    <pagination
                        v-model="page"
                        :records="importantHeartBeatListLength"
                        :per-page="perPage"
                        :options="paginationConfig"
                    />
                </div>
            </div>
        </div>
    </transition>
    <Confirm
        ref="confirmClearEvents"
        btn-style="btn-danger"
        :yes-text="$t('Yes')"
        :no-text="$t('No')"
        @yes="clearAllEvents"
    >
        {{ $t("clearAllEventsMsg") }}
    </Confirm>
    <router-view ref="child" />
</template>

<script>
import { markRaw } from "vue";
import Status from "../components/Status.vue";
import Datetime from "../components/Datetime.vue";
import Pagination from "v-pagination-3";
import Confirm from "../components/Confirm.vue";

const eventColumnStorageKey = "dashboardEventColumnWidths";
const eventColumnDefinitions = [
    { key: "group", label: "Group Name", width: 128, min: 96 },
    { key: "name", label: "Name", width: 220, min: 140 },
    { key: "status", label: "Status", width: 112, min: 96 },
    { key: "time", label: "DateTime", width: 200, min: 184 },
    { key: "message", label: "Message", width: 240, min: 180 },
];

/**
 * Read valid preferences while allowing dashboards with restricted browser storage.
 * @returns {object} Saved column widths in pixels
 */
function loadEventColumnWidths() {
    try {
        const saved = JSON.parse(localStorage.getItem(eventColumnStorageKey));
        return Object.fromEntries(
            eventColumnDefinitions
                .filter((column) => Number.isFinite(saved?.[column.key]))
                .map((column) => [column.key, Math.round(Math.min(1200, Math.max(column.min, saved[column.key])))])
        );
    } catch {
        return {};
    }
}

export default {
    components: {
        Datetime,
        Status,
        Pagination,
        Confirm,
    },
    props: {
        calculatedHeight: {
            type: Number,
            default: 0,
        },
    },
    data() {
        return {
            page: 1,
            perPage: 25,
            initialPerPage: 25,
            paginationConfig: {
                hideCount: true,
                chunksNavigation: "scroll",
            },
            importantHeartBeatListLength: 0,
            displayedRecords: [],
            clearingAllEvents: false,
            customColumnWidths: loadEventColumnWidths(),
            eventViewportWidth: 0,
            eventTableObserver: null,
            columnResize: null,
        };
    },
    computed: {
        stackedEventTable() {
            return this.$root.windowWidth <= 550;
        },
        hasCustomColumnWidths() {
            return Object.keys(this.customColumnWidths).length > 0;
        },
        eventColumns() {
            const columns = eventColumnDefinitions.filter((column) => column.key !== "group" || this.showGroupColumn);
            const occupied = columns
                .filter((column) => column.key !== "message")
                .reduce((total, column) => total + (this.customColumnWidths[column.key] ?? column.width), 0);
            return columns.map((column) => ({
                ...column,
                width:
                    this.customColumnWidths[column.key] ??
                    (column.key === "message"
                        ? Math.max(column.width, this.eventViewportWidth - occupied)
                        : column.width),
            }));
        },
        eventTableWidth() {
            return this.eventColumns.reduce((total, column) => total + column.width, 0);
        },
        showGroupColumn() {
            return Object.values(this.$root.monitorList).some((m) => m.parent != null);
        },
        tableColumnCount() {
            return this.showGroupColumn ? 5 : 4;
        },
    },
    watch: {
        "$route.name"() {
            this.$nextTick(this.observeEventTable);
        },
        perPage() {
            this.$nextTick(() => {
                this.getImportantHeartbeatListPaged();
            });
        },

        page() {
            this.getImportantHeartbeatListPaged();
        },
    },

    mounted() {
        this.observeEventTable();
        this.getImportantHeartbeatListLength();

        this.$root.emitter.on("newImportantHeartbeat", this.onNewImportantHeartbeat);

        this.initialPerPage = this.perPage;

        window.addEventListener("resize", this.updatePerPage);
        this.updatePerPage();
    },

    beforeUnmount() {
        this.eventTableObserver?.disconnect();
        if (this.columnResize) {
            this.saveColumnWidths();
        }
        this.$root.emitter.off("newImportantHeartbeat", this.onNewImportantHeartbeat);

        window.removeEventListener("resize", this.updatePerPage);
    },

    methods: {
        observeEventTable() {
            this.eventTableObserver?.disconnect();
            const viewport = this.$refs.eventTableViewport;
            if (viewport) {
                this.eventViewportWidth = viewport.clientWidth;
                this.eventTableObserver = markRaw(
                    new ResizeObserver(([entry]) => {
                        this.eventViewportWidth = Math.floor(entry.contentRect.width);
                    })
                );
                this.eventTableObserver.observe(viewport);
            }
        },
        saveColumnWidths() {
            try {
                localStorage.setItem(eventColumnStorageKey, JSON.stringify(this.customColumnWidths));
            } catch {
                // Keep resizing available when browser storage is restricted or full.
            }
        },
        setColumnWidth(column, width) {
            this.customColumnWidths[column.key] = Math.round(Math.min(1200, Math.max(column.min, width)));
        },
        startColumnResize(event, column) {
            if (event.button !== 0 || this.columnResize || this.stackedEventTable) {
                return;
            }
            event.preventDefault();
            this.columnResize = {
                column,
                startX: event.clientX,
                startWidth: column.width,
                pointerID: event.pointerId,
                direction: getComputedStyle(event.currentTarget.closest("table")).direction === "rtl" ? -1 : 1,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
        },
        moveColumnResize(event) {
            const resize = this.columnResize;
            if (resize && resize.pointerID === event.pointerId) {
                this.setColumnWidth(
                    resize.column,
                    resize.startWidth + (event.clientX - resize.startX) * resize.direction
                );
            }
        },
        finishColumnResize(event) {
            if (this.columnResize?.pointerID !== event.pointerId) {
                return;
            }
            this.columnResize = null;
            this.saveColumnWidths();
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
                event.currentTarget.releasePointerCapture(event.pointerId);
            }
        },
        resizeColumnWithKeyboard(event, column) {
            if (event.key === "Home") {
                event.preventDefault();
                this.resetColumnWidth(column.key);
            } else if (["ArrowLeft", "ArrowRight"].includes(event.key)) {
                event.preventDefault();
                const direction = getComputedStyle(event.currentTarget.closest("table")).direction === "rtl" ? -1 : 1;
                const delta = (event.key === "ArrowRight" ? 1 : -1) * direction * (event.shiftKey ? 50 : 10);
                this.setColumnWidth(column, column.width + delta);
                this.saveColumnWidths();
            }
        },
        resetColumnWidth(key) {
            delete this.customColumnWidths[key];
            this.saveColumnWidths();
        },
        resetColumnWidths() {
            this.customColumnWidths = {};
            this.saveColumnWidths();
        },
        /**
         * Returns the group (parent) name for a monitor, or empty string if none.
         * @param {number} monitorID - The monitor ID.
         * @returns {string} The group name or empty string.
         */
        getGroupName(monitorID) {
            const monitor = this.$root.monitorList[monitorID];
            if (!monitor || monitor.parent == null) {
                return "";
            }
            const parent = this.$root.monitorList[monitor.parent];
            return parent ? parent.name : "";
        },

        /**
         * Returns the group (parent) ID for a monitor, or null if none.
         * @param {number} monitorID - The monitor ID.
         * @returns {number|null} The group monitor ID or null.
         */
        getGroupId(monitorID) {
            const monitor = this.$root.monitorList[monitorID];
            return monitor && monitor.parent != null ? monitor.parent : null;
        },

        /**
         * Updates the displayed records when a new important heartbeat arrives.
         * @param {object} heartbeat - The heartbeat object received.
         * @returns {void}
         */
        onNewImportantHeartbeat(heartbeat) {
            if (this.page === 1) {
                this.displayedRecords.unshift(heartbeat);
                if (this.displayedRecords.length > this.perPage) {
                    this.displayedRecords.pop();
                }
                this.importantHeartBeatListLength += 1;
            }
        },

        /**
         * Retrieves the length of the important heartbeat list for all monitors.
         * @returns {void}
         */
        getImportantHeartbeatListLength() {
            this.$root.getSocket().emit("monitorImportantHeartbeatListCount", null, (res) => {
                if (res.ok) {
                    this.importantHeartBeatListLength = res.count;
                    this.getImportantHeartbeatListPaged();
                }
            });
        },

        /**
         * Retrieves the important heartbeat list for the current page.
         * @returns {void}
         */
        getImportantHeartbeatListPaged() {
            const offset = (this.page - 1) * this.perPage;
            this.$root.getSocket().emit("monitorImportantHeartbeatListPaged", null, offset, this.perPage, (res) => {
                if (res.ok) {
                    this.displayedRecords = res.data;
                }
            });
        },

        /**
         * Updates the number of items shown per page based on the available height.
         * @returns {void}
         */
        updatePerPage() {
            const tableContainer = this.$refs.tableContainer;
            const tableContainerHeight = tableContainer.offsetHeight;
            const availableHeight = window.innerHeight - tableContainerHeight;
            const additionalPerPage = Math.floor(availableHeight / 58);

            if (additionalPerPage > 0) {
                this.perPage = Math.max(this.initialPerPage, this.perPage + additionalPerPage);
            } else {
                this.perPage = this.initialPerPage;
            }
        },

        clearAllEventsDialog() {
            this.$refs.confirmClearEvents.show();
        },
        clearAllEvents() {
            this.clearingAllEvents = true;
            const monitorIDs = Object.keys(this.$root.monitorList);
            let failed = 0;
            const total = monitorIDs.length;

            if (total === 0) {
                this.clearingAllEvents = false;
                this.$root.toastError(this.$t("No monitors found"));
                return;
            }

            monitorIDs.forEach((monitorID) => {
                this.$root.getSocket().emit("clearEvents", monitorID, (res) => {
                    if (!res || !res.ok) {
                        failed++;
                    }
                });
            });
            this.clearingAllEvents = false;
            this.page = 1;
            this.getImportantHeartbeatListLength();
            if (failed === 0) {
                this.$root.toastSuccess(this.$t("Events cleared successfully"));
            } else {
                this.$root.toastError(
                    this.$t("Could not clear events", {
                        failed,
                        total,
                    })
                );
            }
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../assets/vars";

.num {
    font-size: 30px;
    color: var(--status-up);
    font-weight: bold;
    display: block;
}

.shadow-box {
    padding: 20px;
}

.events-table-scroll {
    overflow-x: auto;
}

.events-table {
    table-layout: fixed;
    font-size: 14px;

    th {
        position: relative;
        white-space: nowrap;
    }

    td {
        overflow-wrap: anywhere;
    }

    .event-status,
    .event-time {
        white-space: nowrap;
    }
}

.column-resizer {
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    z-index: 1;
    width: 8px;
    cursor: col-resize;
    touch-action: none;

    &::after {
        content: "";
        position: absolute;
        inset-block: 8px;
        inset-inline-start: 3px;
        width: 2px;
        border-radius: 1px;
        background: var(--app-border);
    }

    &:hover::after,
    &:focus-visible::after {
        background: var(--app-accent);
    }
}

.resizing-columns {
    user-select: none;

    .column-resizer::after {
        background: var(--app-accent);
    }
}

@media (max-width: 550px) {
    .events-table {
        width: 100%;
    }

    .column-resizer {
        display: none;
    }
}
</style>
