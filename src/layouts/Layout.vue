<template>
    <div :class="classes">
        <div v-if="!$root.socket.connected && !$root.socket.firstConnect" class="lost-connection">
            <div class="container-fluid">
                {{ $root.connectionErrorMsg }}
                <div v-if="$root.showReverseProxyGuide">
                    {{ $t("Using a Reverse Proxy?") }}
                    <a href="https://github.com/louislam/uptime-kuma/wiki/Reverse-Proxy" target="_blank">
                        {{ $t("Check how to config it for WebSocket") }}
                    </a>
                </div>
            </div>
        </div>

        <a class="skip-link" href="#main-content">{{ $t("Skip to content") }}</a>
        <header class="app-header">
            <div class="header-toolbar">
                <router-link to="/dashboard" class="app-brand">
                    <img width="32" height="32" src="/icon.svg" alt="" />
                    <span class="title">{{ $root.appName }}</span>
                </router-link>
                <div class="header-actions">
                    <a
                        v-if="hasNewVersion"
                        target="_blank"
                        rel="noopener noreferrer"
                        href="https://github.com/louislam/uptime-kuma/releases"
                        class="btn btn-normal btn-sm header-update"
                        :aria-label="$t('New Update')"
                        :title="$t('New Update')"
                    >
                        <font-awesome-icon icon="arrow-alt-circle-up" />
                        <span class="update-label">{{ $t("New Update") }}</span>
                    </a>
                    <div v-if="$root.loggedIn" class="dropdown dropdown-profile-pic">
                        <button
                            class="profile-toggle"
                            type="button"
                            data-bs-toggle="dropdown"
                            :aria-label="$t('Account')"
                            aria-expanded="false"
                        >
                            <span class="profile-pic">{{ $root.usernameFirstChar }}</span>
                            <font-awesome-icon icon="angle-down" class="profile-chevron" />
                        </button>
                        <ul class="dropdown-menu dropdown-menu-end">
                            <li>
                                <i18n-t
                                    v-if="$root.username != null"
                                    tag="span"
                                    keypath="signedInDisp"
                                    class="dropdown-item-text"
                                >
                                    <strong>{{ $root.username }}</strong>
                                </i18n-t>
                                <span v-else class="dropdown-item-text">{{ $t("signedInDispDisabled") }}</span>
                            </li>
                            <li><hr class="dropdown-divider" /></li>
                            <li>
                                <a
                                    href="https://github.com/louislam/uptime-kuma/wiki"
                                    class="dropdown-item"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                >
                                    <font-awesome-icon icon="info-circle" />
                                    {{ $t("Help") }}
                                </a>
                            </li>
                            <li>
                                <button class="dropdown-item" @click="$root.logout">
                                    <font-awesome-icon icon="sign-out-alt" />
                                    {{ $t("Logout") }}
                                </button>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
            <nav v-if="$root.loggedIn" ref="primaryNavigation" class="primary-nav" :aria-label="$t('Main navigation')">
                <router-link to="/dashboard" class="nav-link" :class="{ active: isMonitorRoute }">
                    <font-awesome-icon icon="tachometer-alt" />
                    {{ $t("Dashboard") }}
                </router-link>
                <router-link
                    to="/manage-status-page"
                    class="nav-link"
                    :class="{ active: $route.path === '/add-status-page' }"
                >
                    <font-awesome-icon icon="stream" />
                    {{ $t("Status Pages") }}
                </router-link>
                <router-link to="/incidents" class="nav-link" :class="{ active: $route.path.startsWith('/incidents') }">
                    <font-awesome-icon icon="info-circle" />
                    {{ $t("Incidents") }}
                </router-link>
                <router-link
                    to="/maintenance"
                    class="nav-link"
                    :class="{ active: /^\/(maintenance|add-maintenance)(\/|$)/.test($route.path) }"
                >
                    <font-awesome-icon icon="wrench" />
                    {{ $t("Maintenance") }}
                </router-link>
                <router-link
                    :to="
                        $root.isMobile
                            ? '/settings'
                            : $root.canManageShared
                              ? '/settings/general'
                              : '/settings/security'
                    "
                    class="nav-link"
                    :class="{ active: $route.path.startsWith('/settings') }"
                >
                    <font-awesome-icon icon="cog" />
                    {{ $t("Settings") }}
                </router-link>
            </nav>
        </header>

        <main id="main-content" tabindex="-1">
            <router-view v-if="$root.loggedIn" />
            <Login v-if="!$root.loggedIn && $root.allowLoginDialog" />
        </main>

        <button
            v-if="numActiveToasts != 0"
            type="button"
            class="btn btn-normal clear-all-toast-btn"
            @click="clearToasts"
        >
            <font-awesome-icon icon="times" />
        </button>
    </div>
</template>

<script>
import Login from "../components/Login.vue";
import compareVersions from "compare-versions";
import { useToast } from "vue-toastification";
const toast = useToast();

export default {
    components: {
        Login,
    },

    data() {
        return {
            toastContainer: null,
            numActiveToasts: 0,
            toastContainerObserver: null,
        };
    },

    computed: {
        // Theme or Mobile
        classes() {
            const classes = { "internal-app": true };
            classes[this.$root.theme] = true;
            classes["mobile"] = this.$root.isMobile;
            return classes;
        },

        isMonitorRoute() {
            return /^\/(dashboard|add|edit|clone|list)(\/|$)/.test(this.$route.path);
        },

        hasNewVersion() {
            if (this.$root.info.latestVersion && this.$root.info.version) {
                return compareVersions(this.$root.info.latestVersion, this.$root.info.version) >= 1;
            } else {
                return false;
            }
        },
    },

    watch: {
        "$route.fullPath"() {
            this.$nextTick(this.scrollActiveNavigation);
        },
        "$root.loggedIn"() {
            this.$nextTick(this.scrollActiveNavigation);
        },
        "$root.windowWidth"() {
            this.$nextTick(this.scrollActiveNavigation);
        },
    },

    mounted() {
        this.$nextTick(this.scrollActiveNavigation);
        this.toastContainer = document.querySelector(".bottom-right.toast-container");

        // Watch the number of active toasts
        this.toastContainerObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.type === "childList") {
                    this.numActiveToasts = mutation.target.children.length;
                }
            }
        });

        if (this.toastContainer != null) {
            this.toastContainerObserver.observe(this.toastContainer, { childList: true });
        }
    },

    beforeUnmount() {
        this.toastContainerObserver.disconnect();
    },

    methods: {
        scrollActiveNavigation() {
            const navigation = this.$refs.primaryNavigation;
            const active = navigation?.querySelector(".nav-link.active");
            if (!this.$root.isMobile || !active) {
                return;
            }
            const bounds = navigation.getBoundingClientRect();
            const item = active.getBoundingClientRect();
            if (item.left < bounds.left) {
                navigation.scrollLeft += item.left - bounds.left - 12;
            } else if (item.right > bounds.right) {
                navigation.scrollLeft += item.right - bounds.right + 12;
            }
        },
        /**
         * Clear all toast notifications.
         * @returns {void}
         */
        clearToasts() {
            toast.clear();
        },
    },
};
</script>

<style lang="scss" scoped>
.app-header {
    background: var(--app-canvas-subtle);
    border-bottom: 1px solid var(--app-border);
    margin-bottom: 24px;
}

.header-toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    min-height: 64px;
    padding: 16px 32px;
}

.app-brand {
    display: inline-flex;
    align-items: center;
    gap: 12px;
    text-decoration: none;
    font-size: 16px;
    font-weight: 600;
}

.header-actions,
.profile-toggle {
    display: flex;
    align-items: center;
    gap: 12px;
}

.profile-toggle {
    border: 0;
    padding: 0;
    background: transparent;
    color: inherit;
}

.profile-pic {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: 1px solid var(--app-border);
    border-radius: 50%;
    background: var(--app-selected);
    color: var(--app-fg);
    font-weight: 600;
}

.primary-nav {
    display: flex;
    gap: 8px;
    padding: 0 24px;
    overflow-x: auto;

    .nav-link {
        position: relative;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
        padding: 12px;
        border-radius: 6px 6px 0 0;

        &.active::after {
            position: absolute;
            content: "";
            height: 2px;
            background: #fd8c73;
            inset: auto 8px -1px;
        }

        &.active {
            font-weight: 600;
        }
    }
}

main {
    min-height: calc(100vh - 170px);
    padding-bottom: max(16px, env(safe-area-inset-bottom));
    outline: none;
}

.lost-connection {
    position: fixed;
    width: 100%;
    padding: 8px;
    background: #cf222e;
    color: white;
    z-index: 99999;
}

.skip-link {
    position: fixed;
    top: -100px;
    left: 16px;
    z-index: 10000;
    padding: 8px 16px;
    background: var(--app-canvas);
    border: 1px solid var(--app-border);
    border-radius: 6px;

    &:focus {
        top: 8px;
    }
}

.clear-all-toast-btn {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 100;
}

@media (max-width: 767px) {
    .header-toolbar {
        min-height: 56px;
        gap: 8px;
        padding: max(12px, env(safe-area-inset-top)) 16px 12px;
    }

    .app-header {
        margin-bottom: 16px;
    }

    .header-actions {
        gap: 8px;
    }

    .app-brand {
        gap: 8px;
        font-size: 15px;
        white-space: nowrap;
    }

    .profile-chevron,
    .update-label {
        display: none;
    }

    .header-update {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 32px;
        height: 32px;
        padding: 0;
    }

    .primary-nav {
        gap: 4px;
        padding: 0 8px;
        scrollbar-width: none;

        &::-webkit-scrollbar {
            display: none;
        }

        .nav-link {
            gap: 6px;
            padding: 12px 10px;
            white-space: nowrap;
        }
    }
}
</style>
