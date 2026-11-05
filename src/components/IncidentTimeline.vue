<template>
    <div class="incident-timeline">
        <template v-if="incident.updates?.length">
            <div v-for="update in visibleUpdates" :key="update.id" class="incident-progress mb-3">
                <div class="small mb-1">
                    <IncidentLabel :label="update.label" class="me-2" />
                    <time :datetime="update.createdDate">{{ $root.datetime(update.createdDate) }}</time>
                    <span v-if="update.lastUpdatedDate">· {{ $t("Edited") }}</span>
                </div>
                <!-- eslint-disable-next-line vue/no-v-html -->
                <div class="content" v-html="renderContent(update.content)"></div>
            </div>
            <button
                v-if="collapsible && incident.updates.length > 1"
                type="button"
                class="btn btn-link p-0 timeline-toggle"
                :aria-expanded="expanded"
                @click="expanded = !expanded"
            >
                {{ expanded ? $t("Collapse progress") : $t("Show all progress", { count: incident.updates.length }) }}
            </button>
        </template>
        <!-- eslint-disable-next-line vue/no-v-html -->
        <div v-else class="content" v-html="renderContent(incident.content)"></div>
    </div>
</template>

<script>
import { marked } from "marked";
import DOMPurify from "dompurify";
import IncidentLabel from "./IncidentLabel.vue";

export default {
    components: { IncidentLabel },
    props: {
        incident: { type: Object, required: true },
        collapsible: { type: Boolean, default: false },
    },
    data: () => ({ expanded: false }),
    computed: {
        visibleUpdates() {
            const updates = this.incident.updates || [];
            return this.collapsible && !this.expanded ? updates.slice(0, 1) : updates;
        },
    },
    methods: {
        renderContent(content) {
            return DOMPurify.sanitize(marked(content || ""));
        },
    },
};
</script>

<style scoped>
.incident-progress {
    border-inline-start: 2px solid currentcolor;
    padding-inline-start: 12px;
    overflow-wrap: anywhere;
}

.timeline-toggle {
    color: inherit;
    font-size: 0.875em;
}
</style>
