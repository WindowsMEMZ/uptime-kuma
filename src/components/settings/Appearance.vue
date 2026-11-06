<template>
    <div>
        <div class="my-4">
            <label for="language" class="form-label">
                {{ $t("Language") }}
            </label>
            <select id="language" v-model="$root.language" class="form-select appearance-select">
                <option v-for="(lang, i) in $i18n.availableLocales" :key="`Lang${i}`" :value="lang">
                    {{ $i18n.messages[lang].languageName }}
                </option>
            </select>
        </div>
        <div class="my-4">
            <label for="theme" class="form-label">{{ $t("Theme") }}</label>
            <select id="theme" v-model="$root.userTheme" class="form-select appearance-select">
                <option value="light">{{ $t("Light") }}</option>
                <option value="dark">{{ $t("Dark") }}</option>
                <option value="auto">{{ $t("Auto") }}</option>
            </select>
        </div>
        <div class="my-4">
            <label for="heartbeat-bar-theme" class="form-label">{{ $t("Theme - Heartbeat Bar") }}</label>
            <select id="heartbeat-bar-theme" v-model="$root.userHeartbeatBar" class="form-select appearance-select">
                <option value="normal">{{ $t("Normal") }}</option>
                <option value="bottom">{{ $t("Bottom") }}</option>
                <option value="none">{{ $t("None") }}</option>
            </select>
        </div>
        <div class="my-4">
            <label for="elapsed-time-style" class="form-label">{{ $t("styleElapsedTime") }}</label>
            <select id="elapsed-time-style" v-model="$root.styleElapsedTime" class="form-select appearance-select">
                <option value="no-line">{{ $t("styleElapsedTimeShowNoLine") }}</option>
                <option value="with-line">{{ $t("styleElapsedTimeShowWithLine") }}</option>
                <option value="none">{{ $t("None") }}</option>
            </select>
        </div>

        <form v-if="settingsLoaded" class="my-4" data-testid="status-colors-form" @submit.prevent="saveStatusColors">
            <h4>{{ $t("Status colors") }}</h4>
            <p class="form-text">{{ $t("statusColorsDescription") }}</p>
            <div v-for="status in statusKeys" :key="status" class="row align-items-center mb-3">
                <div class="col-12 col-sm-4 mb-2 mb-sm-0">{{ $t(statusLabels[status]) }}</div>
                <div v-for="theme in colorThemes" :key="theme" class="col-6 col-sm-4">
                    <label :for="`status-color-${theme}-${status}`" class="form-label">
                        {{ $t(theme === "light" ? "Light" : "Dark") }}
                    </label>
                    <div class="d-flex flex-wrap align-items-center gap-2">
                        <input
                            :id="`status-color-${theme}-${status}`"
                            v-model="statusColors[theme][status]"
                            type="color"
                            class="form-control form-control-color"
                            :aria-label="`${$t(statusLabels[status])} — ${$t(theme === 'light' ? 'Light' : 'Dark')}`"
                        />
                        <small class="font-monospace">{{ statusColors[theme][status] }}</small>
                    </div>
                </div>
            </div>
            <button type="submit" class="btn btn-primary me-2" :disabled="saving">{{ $t("Save") }}</button>
            <button type="button" class="btn btn-normal" @click="resetStatusColors">
                {{ $t("Restore default colors") }}
            </button>
        </form>
    </div>
</template>

<script>
import { normalizeStatusColors, STATUS_COLOR_KEYS, STATUS_COLOR_THEMES } from "../../status-colors";

export default {
    data() {
        return {
            statusColors: normalizeStatusColors(null),
            statusKeys: STATUS_COLOR_KEYS,
            colorThemes: STATUS_COLOR_THEMES,
            statusLabels: {
                up: "Up",
                down: "Down",
                pending: "Pending / Partial outage",
                maintenance: "statusMaintenance",
                unknown: "Unknown",
                empty: "No data",
            },
            saving: false,
        };
    },
    computed: {
        settings() {
            return this.$parent.$parent.$parent.settings;
        },
        settingsLoaded() {
            return this.$parent.$parent.$parent.settingsLoaded;
        },
    },
    watch: {
        "settings.statusColors": {
            immediate: true,
            handler(colors) {
                this.statusColors = normalizeStatusColors(colors);
            },
        },
    },
    methods: {
        /** @returns {void} */
        saveStatusColors() {
            this.saving = true;
            this.settings.statusColors = normalizeStatusColors(this.statusColors);
            this.$parent.$parent.$parent.saveSettings(() => {
                this.saving = false;
            });
        },
        /** @returns {void} */
        resetStatusColors() {
            this.statusColors = normalizeStatusColors(null);
        },
    },
};
</script>
