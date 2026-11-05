<template>
    <div>
        <h1 class="mb-3">{{ $t("Incidents") }}</h1>
        <router-link v-if="$root.canManageShared" to="/incidents/new" class="btn btn-primary mb-3">
            <font-awesome-icon icon="plus" />
            {{ $t("Create Incident") }}
        </router-link>
        <div class="shadow-box">
            <div v-if="loading" class="text-center my-3">{{ $t("Loading...") }}</div>
            <div v-else-if="!incidents.length" class="text-center my-3">{{ $t("No incidents recorded") }}</div>
            <div v-for="incident in incidents" :key="incident.id" class="incident-row py-3 border-bottom">
                <div>
                    <router-link :to="`/incidents/${incident.id}`" class="h5">{{ incident.title }}</router-link>
                    <div class="small mt-1">
                        {{ $t(`incidentLabel-${incident.label}`) }} ·
                        {{ $root.datetime(incident.lastUpdatedDate || incident.createdDate) }}
                    </div>
                </div>
                <router-link v-if="$root.canManageShared" :to="`/incidents/${incident.id}`" class="btn btn-normal">{{ $t("Edit") }}</router-link>
            </div>
        </div>
    </div>
</template>

<script>
export default {
    data: () => ({ incidents: [], loading: true }),
    mounted() {
        this.load();
        this.$root.getSocket().on("incidentChanged", this.load);
        this.$root.getSocket().on("connect", this.load);
    },
    beforeUnmount() {
        this.$root.getSocket().off("incidentChanged", this.load);
        this.$root.getSocket().off("connect", this.load);
    },
    methods: {
        load() {
            this.$root.getSocket().emit("getManagedIncidents", (res) => {
                this.loading = false;
                if (res.ok) {
                    this.incidents = res.incidents;
                } else {
                    this.$root.toastRes(res);
                }
            });
        },
    },
};
</script>

<style scoped>
.incident-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    overflow-wrap: anywhere;
}
</style>
