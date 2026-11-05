<template>
    <section class="my-5" data-testid="account-management">
        <h5 class="my-4 settings-subheading">{{ $t("Accounts") }}</h5>
        <form v-if="$root.isAdmin" class="mb-4" data-testid="create-account-form" @submit.prevent="createAccount">
            <div class="row g-2 align-items-end">
                <div class="col-sm-6">
                    <label for="account-username" class="form-label">{{ $t("Username") }}</label>
                    <input
                        id="account-username"
                        v-model="newUsername"
                        class="form-control"
                        autocomplete="off"
                        pattern="[a-zA-Z0-9_.]{3,30}"
                        required
                    />
                </div>
                <div class="col-sm-3">
                    <label for="account-role" class="form-label">{{ $t("Account Role") }}</label>
                    <select id="account-role" v-model="newRole" class="form-select">
                        <option v-for="role in roles" :key="role" :value="role">{{ roleName(role) }}</option>
                    </select>
                </div>
                <div class="col-sm-3">
                    <button class="btn btn-primary" type="submit" :disabled="busy">{{ $t("Create Account") }}</button>
                </div>
            </div>
        </form>
        <div v-if="created" class="alert alert-success" data-testid="initial-password">
            <p>{{ $t("accountCreatedPassword", { username: created.username }) }}</p>
            <label for="account-initial-password" class="form-label">{{ $t("Initial Password") }}</label>
            <input
                id="account-initial-password"
                :value="created.password"
                class="form-control font-monospace mb-3"
                readonly
                autocomplete="off"
                @focus="$event.target.select()"
            />
            <button class="btn btn-outline-success" type="button" @click="created = null">{{ $t("Done") }}</button>
        </div>
        <div class="table-responsive">
            <table class="table align-middle account-table">
                <thead>
                    <tr>
                        <th scope="col">{{ $t("Username") }}</th>
                        <th scope="col">{{ $t("Account Role") }}</th>
                        <th scope="col">2FA</th>
                        <th scope="col">{{ $t("Actions") }}</th>
                    </tr>
                </thead>
                <tbody>
                    <tr v-for="account in accounts" :key="account.id" :data-account-username="account.username">
                        <th scope="row">{{ account.username }}</th>
                        <td>
                            <span class="d-block d-sm-none small text-secondary">{{ $t("Account Role") }}</span>
                            <select
                                v-if="$root.isAdmin && account.id !== $root.permissions.userID"
                                class="form-select"
                                :aria-label="$t('accountRoleFor', { username: account.username })"
                                :value="account.role"
                                :disabled="busy"
                                @change="setRole(account, $event.target.value)"
                            >
                                <option v-for="role in roles" :key="role" :value="role">{{ roleName(role) }}</option>
                            </select>
                            <span v-else>{{ roleName(account.role) }}</span>
                        </td>
                        <td>
                            <span class="d-block d-sm-none small text-secondary">2FA</span>
                            {{ $t(account.twoFactorEnabled ? "account2FAEnabled" : "account2FADisabled") }}
                        </td>
                        <td class="account-actions">
                            <button
                                v-if="account.role === 'member'"
                                class="btn btn-outline-primary btn-sm me-2 mb-1"
                                type="button"
                                :disabled="busy"
                                @click="editPermissions(account)"
                            >
                                {{ $t("Edit Permissions") }}
                            </button>
                            <button
                                v-if="$root.isAdmin && account.id !== $root.permissions.userID"
                                class="btn btn-outline-danger btn-sm mb-1"
                                type="button"
                                :disabled="busy"
                                @click="confirmDelete(account)"
                            >
                                {{ $t("Delete") }}
                            </button>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        <form v-if="selected" class="my-4" data-testid="account-permissions" @submit.prevent="savePermissions">
            <h6>{{ $t("accountPermissionsFor", { username: selected.username }) }}</h6>
            <p class="form-text">{{ $t("accountMemberPermissionsHint") }}</p>
            <fieldset class="mb-3">
                <legend class="fs-6">{{ $t("Monitors") }}</legend>
                <div v-for="monitor in $root.monitorList" :key="monitor.id" class="form-check">
                    <input
                        :id="`permission-monitor-${monitor.id}`"
                        v-model="selected.monitorIDs"
                        class="form-check-input"
                        type="checkbox"
                        :value="Number(monitor.id)"
                    />
                    <label :for="`permission-monitor-${monitor.id}`" class="form-check-label">{{ monitor.name }}</label>
                </div>
            </fieldset>
            <fieldset class="mb-3">
                <legend class="fs-6">{{ $t("Status Pages") }}</legend>
                <div v-for="statusPage in $root.statusPageList" :key="statusPage.id" class="form-check">
                    <input
                        :id="`permission-page-${statusPage.id}`"
                        v-model="selected.statusPageIDs"
                        class="form-check-input"
                        type="checkbox"
                        :value="Number(statusPage.id)"
                    />
                    <label :for="`permission-page-${statusPage.id}`" class="form-check-label">
                        {{ statusPage.title }}
                    </label>
                </div>
            </fieldset>
            <button type="submit" class="btn btn-primary me-2" :disabled="busy">{{ $t("Save") }}</button>
            <button type="button" class="btn btn-outline-secondary" @click="selected = null">{{ $t("Cancel") }}</button>
        </form>
        <Confirm ref="deleteDialog" btn-style="btn-danger" @yes="deleteAccount">
            {{ $t("accountDeleteConfirm", { username: deleting?.username }) }}
        </Confirm>
    </section>
</template>

<script>
import Confirm from "../Confirm.vue";

export default {
    components: { Confirm },
    data() {
        return {
            roles: ["member", "owner", "admin"],
            accounts: [],
            newUsername: "",
            newRole: "member",
            created: null,
            selected: null,
            deleting: null,
            busy: false,
        };
    },
    mounted() {
        this.loadAccounts();
        this.$root.getSocket().on("accountsChanged", this.loadAccounts);
    },
    beforeUnmount() {
        this.$root.getSocket().off("accountsChanged", this.loadAccounts);
        this.created = null;
    },
    methods: {
        /**
         * Display the role's stable product name.
         * @param {string} role Role key
         * @returns {string} Role name
         */
        roleName(role) {
            return { admin: "Admin", owner: "Owner", member: "Member" }[role];
        },
        /**
         * Load the latest account list.
         * @returns {void}
         */
        loadAccounts() {
            this.$root.getSocket().emit("getAccounts", (res) => {
                if (res.ok) {
                    this.accounts = res.accounts;
                    if (
                        this.selected &&
                        !res.accounts.some((account) => account.id === this.selected.id && account.role === "member")
                    ) {
                        this.selected = null;
                    }
                } else {
                    this.$root.toastRes(res);
                }
            });
        },
        /**
         * Perform an account mutation and refresh the list.
         * @param {string} event Operation
         * @param {Array} args Arguments
         * @returns {Promise<object>} Server response
         */
        async request(event, ...args) {
            this.busy = true;
            try {
                const res = await new Promise((resolve) => this.$root.getSocket().emit(event, ...args, resolve));
                if (!res.ok) {
                    this.$root.toastRes(res);
                }
                this.loadAccounts();
                return res;
            } finally {
                this.busy = false;
            }
        },
        /**
         * Show the new account's one-time initial password.
         * @returns {Promise<void>}
         */
        async createAccount() {
            this.created = null;
            const res = await this.request("createAccount", { username: this.newUsername, role: this.newRole });
            if (res.ok) {
                this.created = res;
                this.newUsername = "";
            }
        },
        /**
         * Save a role change.
         * @param {object} account Account
         * @param {string} role New role
         * @returns {Promise<void>}
         */
        async setRole(account, role) {
            await this.request("setAccountRole", account.id, role);
        },
        /**
         * Open a Member's grant editor.
         * @param {object} account Account
         * @returns {void}
         */
        editPermissions(account) {
            this.selected = {
                ...account,
                monitorIDs: [...account.monitorIDs],
                statusPageIDs: [...account.statusPageIDs],
            };
        },
        /**
         * Replace the selected Member's resource grants.
         * @returns {Promise<void>}
         */
        async savePermissions() {
            const res = await this.request("saveAccountPermissions", this.selected.id, {
                monitorIDs: this.selected.monitorIDs,
                statusPageIDs: this.selected.statusPageIDs,
            });
            if (res.ok) {
                this.selected = null;
                this.$root.toastSuccess(this.$t("Saved."));
            }
        },
        /**
         * Ask before deleting an account.
         * @param {object} account Account
         * @returns {void}
         */
        confirmDelete(account) {
            this.deleting = account;
            this.$refs.deleteDialog.show();
        },
        /**
         * Delete the confirmed account.
         * @returns {Promise<void>}
         */
        async deleteAccount() {
            await this.request("deleteAccount", this.deleting.id);
            this.deleting = null;
        },
    },
};
</script>

<style scoped>
.account-actions {
    white-space: nowrap;
}

@media (max-width: 575.98px) {
    .account-table thead {
        display: none;
    }

    .account-table tbody {
        display: block;
    }

    .account-table tr {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 0.75rem;
        padding: 1rem 0;
        border-bottom: 1px solid var(--bs-border-color, #dee2e6);
    }

    .account-table th,
    .account-table td {
        padding: 0;
        border: 0;
    }

    .account-table th,
    .account-actions {
        grid-column: 1 / -1;
    }
}
</style>
