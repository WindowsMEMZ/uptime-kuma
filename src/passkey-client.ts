import { startRegistration, startAuthentication } from "@simplewebauthn/browser";
import { authClient } from "./auth-client";

/**
 * Convert authenticator cancellation and errors to localized UI messages.
 * @param error Authenticator error
 * @throws {Error} With a user-facing message key
 */
function credentialError(error: unknown): never {
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
    throw new Error(
        cause instanceof Error && ["NotAllowedError", "AbortError"].includes(cause.name)
            ? "passkeyCancelled"
            : "passkeyVerificationFailed"
    );
}

/**
 * Call a passkey endpoint using the existing HTTP-only authentication cookies.
 * @param path Passkey endpoint
 * @param body Request data
 * @returns Endpoint response
 */
export async function passkeyRequest(path: string, body?: object): Promise<any> {
    const { data, error } = await authClient.$fetch(`/passkey-2fa/${path}`, {
        method: body === undefined ? "GET" : "POST",
        ...(body === undefined ? {} : { body }),
    });
    if (error) {
        throw new Error(error.message || "passkeyVerificationFailed");
    }
    return data;
}

/**
 * Register a user-verified credential after confirming the account password.
 * @param name Display name
 * @param password Current account password
 */
export async function registerPasskey(name: string, password: string) {
    const optionsJSON = await passkeyRequest("register-options", { name, password });
    const response = await startRegistration({ optionsJSON }).catch(credentialError);
    await passkeyRequest("register", { response });
}

/** Complete a password-verified pending login using one registered passkey. */
export async function verifyPasskey() {
    const optionsJSON = await passkeyRequest("authenticate-options", {});
    const response = await startAuthentication({ optionsJSON }).catch(credentialError);
    await passkeyRequest("authenticate", { response });
}
