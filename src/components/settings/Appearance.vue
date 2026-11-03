<template>
    <div>
        <div class="my-4">
            <label for="language" class="form-label">
                {{ $t("Language") }}
            </label>
            <select id="language" v-model="$root.language" class="form-select">
                <option v-for="(lang, i) in $i18n.availableLocales" :key="`Lang${i}`" :value="lang">
                    {{ $i18n.messages[lang].languageName }}
                </option>
            </select>
        </div>
        <div class="my-4">
            <label for="timezone" class="form-label">{{ $t("Theme") }}</label>
            <div>
                <div class="btn-group" role="group" :aria-label="$t('Basic checkbox toggle button group')">
                    <input
                        id="btncheck1"
                        v-model="$root.userTheme"
                        type="radio"
                        class="btn-check"
                        name="theme"
                        autocomplete="off"
                        value="light"
                    />
                    <label class="btn btn-outline-primary" for="btncheck1">
                        {{ $t("Light") }}
                    </label>

                    <input
                        id="btncheck2"
                        v-model="$root.userTheme"
                        type="radio"
                        class="btn-check"
                        name="theme"
                        autocomplete="off"
                        value="dark"
                    />
                    <label class="btn btn-outline-primary" for="btncheck2">
                        {{ $t("Dark") }}
                    </label>

                    <input
                        id="btncheck3"
                        v-model="$root.userTheme"
                        type="radio"
                        class="btn-check"
                        name="theme"
                        autocomplete="off"
                        value="auto"
                    />
                    <label class="btn btn-outline-primary" for="btncheck3">
                        {{ $t("Auto") }}
                    </label>
                </div>
            </div>
        </div>
        <div class="my-4">
            <label class="form-label">{{ $t("Theme - Heartbeat Bar") }}</label>
            <div>
                <div class="btn-group" role="group" :aria-label="$t('Basic checkbox toggle button group')">
                    <input
                        id="btncheck4"
                        v-model="$root.userHeartbeatBar"
                        type="radio"
                        class="btn-check"
                        name="heartbeatBarTheme"
                        autocomplete="off"
                        value="normal"
                    />
                    <label class="btn btn-outline-primary" for="btncheck4">
                        {{ $t("Normal") }}
                    </label>

                    <input
                        id="btncheck5"
                        v-model="$root.userHeartbeatBar"
                        type="radio"
                        class="btn-check"
                        name="heartbeatBarTheme"
                        autocomplete="off"
                        value="bottom"
                    />
                    <label class="btn btn-outline-primary" for="btncheck5">
                        {{ $t("Bottom") }}
                    </label>

                    <input
                        id="btncheck6"
                        v-model="$root.userHeartbeatBar"
                        type="radio"
                        class="btn-check"
                        name="heartbeatBarTheme"
                        autocomplete="off"
                        value="none"
                    />
                    <label class="btn btn-outline-primary" for="btncheck6">
                        {{ $t("None") }}
                    </label>
                </div>
            </div>
        </div>

        <!-- Timeline -->
        <div class="my-4">
            <label class="form-label">{{ $t("styleElapsedTime") }}</label>
            <div>
                <div class="btn-group" role="group">
                    <input
                        id="styleElapsedTimeShowNoLine"
                        v-model="$root.styleElapsedTime"
                        type="radio"
                        class="btn-check"
                        name="styleElapsedTime"
                        autocomplete="off"
                        value="no-line"
                    />
                    <label class="btn btn-outline-primary" for="styleElapsedTimeShowNoLine">
                        {{ $t("styleElapsedTimeShowNoLine") }}
                    </label>

                    <input
                        id="styleElapsedTimeShowWithLine"
                        v-model="$root.styleElapsedTime"
                        type="radio"
                        class="btn-check"
                        name="styleElapsedTime"
                        autocomplete="off"
                        value="with-line"
                    />
                    <label class="btn btn-outline-primary" for="styleElapsedTimeShowWithLine">
                        {{ $t("styleElapsedTimeShowWithLine") }}
                    </label>

                    <input
                        id="styleElapsedTimeNone"
                        v-model="$root.styleElapsedTime"
                        type="radio"
                        class="btn-check"
                        name="styleElapsedTime"
                        autocomplete="off"
                        value="none"
                    />
                    <label class="btn btn-outline-primary" for="styleElapsedTimeNone">
                        {{ $t("None") }}
                    </label>
                </div>
            </div>
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

<style lang="scss" scoped>
@import "../../assets/vars.scss";

.btn-check:active + .btn-outline-primary,
.btn-check:checked + .btn-outline-primary,
.btn-check:hover + .btn-outline-primary {
    color: #fff;

    .dark & {
        color: #000;
    }
}

.dark {
    .list-group-item {
        background-color: $dark-bg2;
        color: $dark-font-color;
    }
}
</style>
