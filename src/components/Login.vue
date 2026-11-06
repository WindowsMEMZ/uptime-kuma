<template>
    <div class="form-container">
        <div class="form">
            <h1 class="login-heading">{{ $t("Login") }}</h1>
            <form aria-label="Login Form" class="pt-3" @submit.prevent="submit">
                <div v-if="!tokenRequired" class="form-floating">
                    <input
                        id="floatingInput"
                        v-model="username"
                        type="text"
                        class="form-control"
                        placeholder="Username"
                        autocomplete="username"
                        required
                    />
                    <label for="floatingInput">{{ $t("Username") }}</label>
                </div>

                <div v-if="!tokenRequired" class="form-floating mt-3">
                    <input
                        id="floatingPassword"
                        v-model="password"
                        type="password"
                        class="form-control"
                        placeholder="Password"
                        autocomplete="current-password"
                        required
                    />
                    <label for="floatingPassword">{{ $t("Password") }}</label>
                </div>

                <div v-if="tokenRequired">
                    <div v-if="twoFactorMethods.length > 1" class="d-flex gap-2 mt-3">
                        <button
                            v-for="method in twoFactorMethods"
                            :key="method"
                            type="button"
                            class="btn flex-fill"
                            :class="twoFactorMethod === method ? 'btn-primary' : 'btn-outline-primary'"
                            :disabled="processing"
                            @click="
                                twoFactorMethod = method;
                                res = null;
                            "
                        >
                            {{ $t(method === "passkey" ? "Passkey" : "Authenticator App") }}
                        </button>
                    </div>
                    <div v-if="twoFactorMethod === 'totp'" class="form-floating mt-3">
                        <input
                            id="otp"
                            ref="otpInput"
                            v-model="token"
                            type="text"
                            maxlength="6"
                            class="form-control"
                            placeholder="123456"
                            autocomplete="one-time-code"
                            required
                        />
                        <label for="otp">{{ $t("Token") }}</label>
                    </div>
                </div>

                <div v-if="!tokenRequired" class="form-check mb-3 mt-3 d-flex justify-content-center pe-4">
                    <div class="form-check">
                        <input
                            id="remember"
                            v-model="$root.remember"
                            type="checkbox"
                            value="remember-me"
                            class="form-check-input"
                        />

                        <label class="form-check-label" for="remember">
                            {{ $t("Remember me") }}
                        </label>
                    </div>
                </div>
                <button class="w-100 btn btn-primary mt-3" type="submit" :disabled="processing">
                    {{ $t(tokenRequired && twoFactorMethod === "passkey" ? "Verify with Passkey" : "Login") }}
                </button>

                <button
                    v-if="tokenRequired"
                    class="btn btn-link mt-2"
                    type="button"
                    :disabled="processing"
                    @click="resetLogin"
                >
                    {{ $t("Back to Sign In") }}
                </button>

                <div v-if="res && !res.ok" class="alert alert-danger mt-3" role="alert">
                    {{ $t(res.msg) }}
                </div>
            </form>
        </div>
    </div>
</template>

<script>
import { login, verifyTotp } from "../auth-client";
import { verifyPasskey } from "../passkey-client";
import { reconnectSocket } from "../mixins/socket";

export default {
    data() {
        return {
            processing: false,
            username: "",
            password: "",
            token: "",
            res: null,
            tokenRequired: false,
            twoFactorMethods: ["totp"],
            twoFactorMethod: "totp",
        };
    },

    watch: {
        tokenRequired(newVal) {
            if (newVal) {
                this.$nextTick(() => {
                    this.$refs.otpInput?.focus();
                });
            }
        },
    },

    mounted() {
        document.title += " - Login";
    },

    unmounted() {
        document.title = document.title.replace(" - Login", "");
    },

    methods: {
        /**
         * Return to password entry after a cancelled or expired challenge.
         * @returns {void}
         */
        resetLogin() {
            this.tokenRequired = false;
            this.password = "";
            this.token = "";
            this.res = null;
        },
        /**
         * Submit the user details and attempt to log in
         * @returns {void}
         */
        async submit() {
            this.processing = true;

            try {
                if (this.tokenRequired) {
                    if (this.twoFactorMethod === "passkey") {
                        await verifyPasskey();
                        reconnectSocket();
                    } else {
                        await verifyTotp(this.token);
                    }
                    return;
                }

                const result = await login(this.username, this.password, this.$root.remember);
                if (result?.twoFactorRequired) {
                    this.twoFactorMethods = result.methods;
                    this.twoFactorMethod = result.methods.includes("passkey") ? "passkey" : "totp";
                    this.password = "";
                    this.tokenRequired = true;
                }
            } catch (e) {
                this.res = {
                    ok: false,
                    msg: e.name === "NotAllowedError" || e.name === "AbortError" ? "passkeyCancelled" : e.message,
                };
            } finally {
                this.processing = false;
            }
        },
    },
};
</script>

<style lang="scss" scoped>
.form-container {
    display: flex;
    align-items: center;
    padding-top: 40px;
    padding-bottom: 40px;
}

.form-floating {
    > label {
        padding-left: 1.3rem;
    }

    > .form-control {
        padding-left: 1.3rem;
    }
}

.form {
    width: 100%;
    max-width: 330px;
    padding: 15px;
    margin: auto;
    text-align: center;
}
</style>
