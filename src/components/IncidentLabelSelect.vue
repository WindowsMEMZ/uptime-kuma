<template>
    <div class="my-3">
        <label :for="id" class="form-label">{{ $t("Progress Label") }}</label>
        <select
            :id="id"
            :value="modelValue"
            class="form-select"
            @change="$emit('update:modelValue', $event.target.value)"
        >
            <option v-for="label in labels" :key="label" :value="label">{{ $t(`incidentLabel-${label}`) }}</option>
        </select>
    </div>
</template>

<script>
import { INCIDENT_LABELS } from "../incident-status";

export default {
    props: {
        id: { type: String, required: true },
        modelValue: { type: String, default: "updated" },
    },
    emits: ["update:modelValue"],
    data: () => ({ labels: INCIDENT_LABELS }),
};
</script>
