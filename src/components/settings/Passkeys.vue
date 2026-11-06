<template>
    <div class="mt-4" data-testid="passkey-settings">
        <h6>{{ $t("Passkeys") }}</h6>
        <p class="form-text">{{ $t("passkeySecondFactorHint") }}</p>
        <ul v-if="passkeys.length" class="list-group mb-3">
            <li
                v-for="key in passkeys"
                :key="key.id"
                class="list-group-item d-flex align-items-center justify-content-between gap-2"
            >
                <div class="text-break">
                    <strong>{{ key.name }}</strong>
                    <div class="small text-secondary">{{ key.rp_id }}</div>
                </div>
                <button
                    class="btn btn-outline-danger btn-sm"
                    type="button"
                    :disabled="busy"
                    @click="confirmDelete(key)"
                >
                    {{ $t("Delete") }}
                </button>
            </li>
        </ul>
        <form name="account-verification" @submit.prevent="add">
            <div class="mb-3">
                <label for="passkey-username" class="form-label">{{ $t("Username") }}</label>
                <input
                    id="passkey-username"
                    :value="$root.username"
                    name="username"
                    type="text"
                    class="form-control"
                    autocomplete="username"
                    readonly
                />
            </div>
            <div class="mb-3">
                <label for="passkey-password" class="form-label">{{ $t("Current Password") }}</label>
                <input
                    id="passkey-password"
                    v-model="password"
                    name="password"
                    type="password"
                    class="form-control"
                    autocomplete="current-password"
                    required
                />
            </div>
            <div class="mb-3">
                <label for="passkey-name" class="form-label">{{ $t("Passkey Name") }}</label>
                <input
                    id="passkey-name"
                    v-model="name"
                    name="credential-label"
                    class="form-control"
                    autocomplete="off"
                    maxlength="100"
                    required
                />
            </div>
            <button class="btn btn-primary" type="submit" :disabled="busy">{{ $t("Add Passkey") }}</button>
        </form>
        <Confirm ref="deleteDialog" btn-style="btn-danger" @yes="remove">
            <p>{{ $t("passkeyDeleteConfirm", { name: deleting?.name }) }}</p>
            <label for="passkey-delete-password" class="form-label">{{ $t("Current Password") }}</label>
            <input
                id="passkey-delete-password"
                v-model="deletePassword"
                type="password"
                class="form-control"
                autocomplete="current-password"
                required
            />
        </Confirm>
    </div>
</template>

<script>
import Confirm from "../Confirm.vue";
import { passkeyRequest, registerPasskey } from "../../passkey-client";

export default {
    components: { Confirm },
    data: () => ({ passkeys: [], name: "", password: "", busy: false, deleting: null, deletePassword: "" }),
    mounted() {
        this.load();
    },
    methods: {
        /**
         * Load only the current account's registered passkeys.
         * @returns {Promise<void>}
         */
        async load() {
            try {
                this.passkeys = (await passkeyRequest("list")).passkeys;
            } catch (error) {
                this.$root.toastError(this.$t(error.message));
            }
        },
        /**
         * Register a passkey and enable its use as a second factor.
         * @returns {Promise<void>}
         */
        async add() {
            this.busy = true;
            try {
                await registerPasskey(this.name, this.password);
                this.name = "";
                this.password = "";
                await this.load();
                this.$root.emitter.emit("accountSecurityChanged");
                this.$root.toastSuccess(this.$t("Passkey Added"));
            } catch (error) {
                this.$root.toastError(
                    this.$t(
                        error.name === "NotAllowedError" || error.name === "AbortError"
                            ? "passkeyCancelled"
                            : error.message
                    )
                );
            } finally {
                this.busy = false;
            }
        },
        /**
         * Ask for the account password before removing a passkey.
         * @param {object} key Selected passkey
         * @returns {void}
         */
        confirmDelete(key) {
            this.deleting = key;
            this.deletePassword = "";
            this.$refs.deleteDialog.show();
        },
        /**
         * Delete a credential owned by the current account.
         * @returns {Promise<void>}
         */
        async remove() {
            this.busy = true;
            try {
                await passkeyRequest("delete", { id: this.deleting.id, password: this.deletePassword });
                this.deletePassword = "";
                this.deleting = null;
                await this.load();
                this.$root.emitter.emit("accountSecurityChanged");
            } catch (error) {
                this.$root.toastError(this.$t(error.message));
            } finally {
                this.busy = false;
            }
        },
    },
};
</script>
