<template>
    <span class="incident-label badge" :class="`incident-label-${label}`">{{ $t(`incidentLabel-${label}`) }}</span>
</template>

<script>
export default {
    props: { label: { type: String, default: "updated" } },
};
</script>

<style scoped>
.incident-label {
    color: inherit;
    border: 1px solid currentcolor;
    font-weight: 500;
}
</style>
