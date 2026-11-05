<template>
    <div>
        <router-link to="/incidents">{{ $t("Incidents") }}</router-link>
        <h1 class="my-3">{{ isNew ? $t("Create Incident") : $t("Edit Incident") }}</h1>
        <div v-if="loading" class="shadow-box">{{ $t("Loading...") }}</div>
        <template v-else-if="incident">
            <form class="shadow-box mb-4" data-testid="incident-settings" @submit.prevent="save">
                <div class="mb-3">
                    <label for="incident-title" class="form-label">{{ $t("Title") }}</label>
                    <input id="incident-title" v-model="incident.title" class="form-control" maxlength="255" required />
                </div>
                <div v-if="isNew" class="mb-3">
                    <label for="incident-initial-progress" class="form-label">{{ $t("Progress") }}</label>
                    <textarea
                        id="incident-initial-progress"
                        v-model="incident.content"
                        class="form-control"
                        rows="4"
                        maxlength="65535"
                        required
                    ></textarea>
                    <div class="form-text">{{ $t("markdownSupported") }}</div>
                </div>
                <h2 class="h4 mt-4">{{ $t("Affected Monitors") }}</h2>
                <label for="incident-monitors" class="form-label">{{ $t("Pick Affected Monitors...") }}</label>
                <VueMultiselect
                    id="incident-monitors"
                    v-model="selectedMonitors"
                    data-testid="incident-monitors-select"
                    :options="monitorOptions"
                    track-by="id"
                    label="pathName"
                    :multiple="true"
                    :close-on-select="false"
                    :placeholder="$t('Pick Affected Monitors...')"
                />
                <div v-for="monitor in selectedMonitors" :key="monitor.id" class="row align-items-center mt-3">
                    <label :for="`incident-override-${monitor.id}`" class="col-sm-6 col-form-label">
                        {{ monitor.pathName }}
                    </label>
                    <div class="col-sm-6">
                        <select
                            :id="`incident-override-${monitor.id}`"
                            v-model="overrides[monitor.id]"
                            class="form-select"
                        >
                            <option :value="null">{{ $t("Keep detected status") }}</option>
                            <option :value="3">{{ $t("Override as maintenance") }}</option>
                            <option :value="0">{{ $t("Override as DOWN") }}</option>
                        </select>
                    </div>
                </div>
                <div class="form-text mt-2">{{ $t("incidentOverrideDescription") }}</div>
                <h2 class="h4 mt-4">{{ $t("Status Pages") }}</h2>
                <label for="incident-pages" class="form-label">{{ $t("Select status pages...") }}</label>
                <VueMultiselect
                    id="incident-pages"
                    v-model="selectedPages"
                    data-testid="incident-pages-select"
                    :options="pageOptions"
                    track-by="id"
                    label="title"
                    :multiple="true"
                    :close-on-select="false"
                    :placeholder="$t('Select status pages...')"
                />
                <button class="btn btn-primary mt-4" :disabled="busy">{{ $t("Save") }}</button>
            </form>
            <template v-if="!isNew">
                <div class="shadow-box mb-4">
                    <div class="d-flex flex-wrap align-items-center gap-2 mb-3">
                        <h2 class="h4 me-auto mb-0">{{ incident.active ? $t("Active") : $t("Resolved") }}</h2>
                        <button
                            class="btn btn-normal"
                            :disabled="busy"
                            @click="changeState(incident.active ? 'resolve' : 'reopen')"
                        >
                            {{ incident.active ? $t("Resolve") : $t("Reopen Incident") }}
                        </button>
                        <button class="btn btn-danger" :disabled="busy" @click="$refs.confirmDelete.show()">
                            {{ $t("Delete") }}
                        </button>
                    </div>
                    <form v-if="incident.active" @submit.prevent="saveProgress(null, progress)">
                        <label for="incident-progress" class="form-label">{{ $t("Add Progress") }}</label>
                        <textarea
                            id="incident-progress"
                            v-model="progress"
                            class="form-control"
                            rows="4"
                            maxlength="65535"
                            required
                        ></textarea>
                        <button class="btn btn-primary mt-3" :disabled="busy">{{ $t("Add Progress") }}</button>
                    </form>
                </div>
                <div class="shadow-box">
                    <h2 class="h4">{{ $t("Progress History") }}</h2>
                    <div
                        v-for="update in incident.updates"
                        :key="update.id"
                        class="py-3 border-bottom"
                        data-testid="incident-progress-entry"
                    >
                        <div class="small mb-2">
                            {{ $root.datetime(update.createdDate) }}
                            <span v-if="update.lastUpdatedDate">
                                · {{ $t("Edited") }} {{ $root.datetime(update.lastUpdatedDate) }}
                            </span>
                        </div>
                        <form
                            v-if="editingUpdate === update.id"
                            @submit.prevent="saveProgress(update.id, editedContent)"
                        >
                            <label :for="`progress-${update.id}`" class="form-label">{{ $t("Progress") }}</label>
                            <textarea
                                :id="`progress-${update.id}`"
                                v-model="editedContent"
                                class="form-control"
                                rows="4"
                                maxlength="65535"
                                required
                            ></textarea>
                            <button class="btn btn-primary mt-2 me-2" :disabled="busy">{{ $t("Save") }}</button>
                            <button type="button" class="btn btn-normal mt-2" @click="editingUpdate = null">
                                {{ $t("Cancel") }}
                            </button>
                        </form>
                        <template v-else>
                            <IncidentTimeline :incident="{ content: update.content }" />
                            <button
                                class="btn btn-normal btn-sm mt-2"
                                @click="
                                    editingUpdate = update.id;
                                    editedContent = update.content;
                                "
                            >
                                {{ $t("Edit") }}
                            </button>
                        </template>
                    </div>
                </div>
            </template>
        </template>
        <Confirm ref="confirmDelete" btn-style="btn-danger" @yes="changeState('delete')">
            {{ $t("deleteIncidentMsg") }}
        </Confirm>
    </div>
</template>

<script>
import VueMultiselect from "vue-multiselect";
import Confirm from "../components/Confirm.vue";
import IncidentTimeline from "../components/IncidentTimeline.vue";

export default {
    components: { VueMultiselect, Confirm, IncidentTimeline },
    data: () => ({
        incident: null,
        loading: true,
        busy: false,
        selectedMonitors: [],
        selectedPages: [],
        overrides: {},
        progress: "",
        editingUpdate: null,
        editedContent: "",
    }),
    computed: {
        listsReady() {
            return this.$root.monitorListLoaded && this.$root.statusPageListLoaded;
        },
        isNew() {
            return this.$route.path === "/incidents/new";
        },
        monitorOptions() {
            return Object.values(this.$root.monitorList).map((monitor) => ({
                id: monitor.id,
                pathName: monitor.pathName || monitor.name,
            }));
        },
        pageOptions() {
            return Object.values(this.$root.statusPageList);
        },
    },
    watch: {
        selectedMonitors(monitors) {
            for (const monitor of monitors) {
                if (!(monitor.id in this.overrides)) {
                    this.overrides[monitor.id] = null;
                }
            }
        },
        "$route.params.id": "load",
        listsReady(ready) {
            if (ready && this.loading) {
                this.load();
            }
        },
    },
    mounted() {
        this.load();
        this.$root.getSocket().on("incidentChanged", this.refreshProgress);
    },
    beforeUnmount() {
        this.$root.getSocket().off("incidentChanged", this.refreshProgress);
    },
    methods: {
        refreshProgress() {
            if (this.isNew || !this.incident?.id) {
                return;
            }
            this.$root.getSocket().emit("getManagedIncidents", (res) => {
                if (!res.ok) {
                    return;
                }
                const current = res.incidents.find((incident) => incident.id === this.incident?.id);
                if (!current) {
                    this.$router.replace("/incidents");
                    return;
                }
                this.incident.updates = current.updates;
                this.incident.active = current.active;
                this.incident.lastUpdatedDate = current.lastUpdatedDate;
            });
        },
        load() {
            this.loading = true;
            if (!this.listsReady) {
                return;
            }
            if (this.isNew) {
                this.incident = { title: "", content: "", active: true, monitors: [], statusPageIDs: [] };
                this.selectedMonitors = [];
                this.selectedPages = [];
                this.overrides = {};
                this.loading = false;
                return;
            }
            this.$root.getSocket().emit("getManagedIncidents", (res) => {
                this.loading = false;
                if (!res.ok) {
                    this.$root.toastRes(res);
                    return;
                }
                this.incident = res.incidents.find((incident) => incident.id === Number(this.$route.params.id));
                if (!this.incident) {
                    this.$router.replace("/incidents");
                    return;
                }
                this.selectedMonitors = this.incident.monitors
                    .map((monitor) => this.monitorOptions.find((option) => option.id === monitor.id))
                    .filter(Boolean);
                this.selectedPages = this.incident.statusPageIDs
                    .map((id) => this.pageOptions.find((option) => option.id === id))
                    .filter(Boolean);
                this.overrides = Object.fromEntries(
                    this.incident.monitors.map((monitor) => [monitor.id, monitor.overrideStatus])
                );
            });
        },
        async request(event, ...args) {
            this.busy = true;
            try {
                const res = await new Promise((resolve) => this.$root.getSocket().emit(event, ...args, resolve));
                if (!res.ok) {
                    this.$root.toastRes(res);
                }
                return res;
            } finally {
                this.busy = false;
            }
        },
        async save() {
            const res = await this.request("saveManagedIncident", {
                id: this.incident.id,
                title: this.incident.title,
                content: this.incident.content,
                monitors: this.selectedMonitors.map((monitor) => ({
                    id: monitor.id,
                    overrideStatus: this.overrides[monitor.id] ?? null,
                })),
                statusPageIDs: this.selectedPages.map((page) => page.id),
            });
            if (res.ok) {
                if (this.isNew) {
                    await this.$router.replace(`/incidents/${res.incidentID}`);
                } else {
                    this.load();
                }
            }
        },
        async saveProgress(updateID, content) {
            const res = await this.request("saveIncidentUpdate", this.incident.id, updateID, content);
            if (res.ok) {
                this.progress = "";
                this.editingUpdate = null;
                this.load();
            }
        },
        async changeState(action) {
            const res = await this.request("managedIncidentAction", this.incident.id, action);
            if (res.ok) {
                if (action === "delete") {
                    this.$router.push("/incidents");
                } else {
                    this.load();
                }
            }
        },
    },
};
</script>
