<template>
    <div class="container-fluid dashboard-layout" :class="{ 'workspace-layout': !showMonitorSidebar }">
        <div class="row dashboard-columns" :class="{ 'with-monitor-sidebar': showMonitorSidebar }">
            <div v-if="showMonitorSidebar" class="monitor-sidebar">
                <div>
                    <router-link v-if="$root.canManageShared" to="/add" class="btn btn-primary mb-3">
                        <font-awesome-icon icon="plus" />
                        {{ $t("Add New Monitor") }}
                    </router-link>
                </div>
                <MonitorList :scrollbar="true" />
            </div>

            <div ref="container" class="dashboard-content mb-3">
                <!-- Add :key to disable vue router re-use the same component -->
                <router-view :key="$route.fullPath" :calculatedHeight="height" />
            </div>
        </div>
    </div>
</template>

<script>
import MonitorList from "../components/MonitorList.vue";

export default {
    components: {
        MonitorList,
    },
    data() {
        return {
            height: 0,
        };
    },
    computed: {
        showMonitorSidebar() {
            return !this.$root.isMobile && /^\/(dashboard|add|edit|clone|list)(\/|$)/.test(this.$route.path);
        },
    },
    mounted() {
        this.height = this.$refs.container.offsetHeight;
    },
};
</script>

<style lang="scss" scoped>
.dashboard-layout {
    width: 100%;
    max-width: 1600px;
    padding: 0 32px;
}

.dashboard-columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 24px;
    margin: 0;
}

.workspace-layout {
    max-width: 1280px;
}

.with-monitor-sidebar {
    grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
}

.monitor-sidebar,
.dashboard-content {
    min-width: 0;
    padding: 0;
}

@media (max-width: 1100px) {
    .with-monitor-sidebar {
        grid-template-columns: 280px minmax(0, 1fr);
    }
}

@media (max-width: 767px) {
    .dashboard-layout {
        padding: 0 16px;
    }

    .dashboard-columns {
        grid-template-columns: minmax(0, 1fr);
    }
}
</style>
