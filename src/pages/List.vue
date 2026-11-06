<template>
    <transition name="slide-fade" appear>
        <div class="monitor-list-page">
            <h1 class="mb-3">{{ $t("Monitor list") }}</h1>
            <MonitorList :scrollbar="true" />
        </div>
    </transition>
</template>

<script>
import MonitorList from "../components/MonitorList.vue";

export default {
    components: {
        MonitorList,
    },
    watch: {
        "$root.isMobile"(newVal) {
            if (!newVal && this.$route.path === "/list") {
                this.$router.replace({ path: "/dashboard" });
            }
        },
    },
    mounted() {
        if (!this.$root.isMobile && this.$route.path === "/list") {
            this.$router.replace({ path: "/dashboard" });
        }
    },
};
</script>
