import { randomBytes, randomUUID, createHash } from "node:crypto";
import { APIError, createAuthEndpoint, createAuthMiddleware, sessionMiddleware } from "better-auth/api";
import { deleteSessionCookie, expireCookie, setSessionCookie } from "better-auth/cookies";
import type { BetterAuthPlugin } from "better-auth/types";
import type { GenericEndpointContext } from "@better-auth/core";
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { z } from "zod";
import { R } from "redbean-node";
// @ts-ignore
import { Settings } from "./settings";

const challengeLifetime = 300;
const twoFactorCookieName = "two_factor";

/**
 * Reject an invalid or expired authentication ceremony.
 * @throws {APIError} When verification fails
 */
function invalid(): never {
    throw new APIError("UNAUTHORIZED", { message: "passkeyVerificationFailed" });
}

/**
 * Derive the relying party from the browser origin and bind it to the request host.
 * @param ctx Authentication endpoint context
 * @returns Browser origin and relying-party ID
 */
async function relyingParty(ctx: GenericEndpointContext) {
    const rawOrigin = ctx.headers?.get("origin");
    if (!rawOrigin || !ctx.request) {
        invalid();
    }
    const origin = new URL(rawOrigin);
    const requestHost = new URL(ctx.request.url).hostname;
    let configuredHost = "";
    const configuredURL = await Settings.get("primaryBaseURL");
    if (configuredURL) {
        try {
            configuredHost = new URL(configuredURL).hostname;
        } catch {
            // Ignore a legacy value that is not a complete URL.
        }
    }
    if (
        (origin.hostname !== requestHost && origin.hostname !== configuredHost) ||
        (origin.protocol !== "https:" && !["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname))
    ) {
        invalid();
    }
    return { origin: origin.origin, rpID: origin.hostname };
}

/**
 * Require the account password before adding or removing a second factor.
 * @param ctx Authentication endpoint context
 * @returns Authenticated account
 */
async function requirePassword(ctx: GenericEndpointContext) {
    const user = ctx.context.session?.user;
    if (!user) {
        invalid();
    }
    const activeSession = await ctx.context.internalAdapter.findSession(ctx.context.session!.session.token);
    if (
        !activeSession ||
        activeSession.session.id !== ctx.context.session!.session.id ||
        activeSession.user.id !== user.id
    ) {
        invalid();
    }
    const accounts = await ctx.context.internalAdapter.findAccounts(user.id);
    const credential = accounts.find((account) => account.providerId === "credential");
    if (
        !ctx.headers?.get("cookie") ||
        !credential?.password ||
        !(await ctx.context.password.verify({ hash: credential.password, password: ctx.body.password }))
    ) {
        throw new APIError("UNAUTHORIZED", { message: "Incorrect current password" });
    }
    return user;
}

/**
 * Store a short-lived challenge in a signed, browser-bound cookie.
 * @param ctx Authentication endpoint context
 * @param purpose Challenge purpose
 * @param data Challenge binding
 */
async function storeChallenge(ctx: GenericEndpointContext, purpose: string, data: object) {
    const identifier = `passkey-${purpose}-${randomBytes(24).toString("base64url")}`;
    await ctx.context.internalAdapter.createVerificationValue({
        identifier,
        value: JSON.stringify(data),
        expiresAt: new Date(Date.now() + challengeLifetime * 1000),
    });
    const cookie = ctx.context.createAuthCookie(`passkey_${purpose}`, { maxAge: challengeLifetime });
    await ctx.setSignedCookie(cookie.name, identifier, ctx.context.secret, cookie.attributes);
}

/**
 * Consume each WebAuthn challenge once, before checking the signed response.
 * @param ctx Authentication endpoint context
 * @param purpose Challenge purpose
 * @returns The consumed challenge
 */
async function consumeChallenge(ctx: GenericEndpointContext, purpose: string) {
    const cookie = ctx.context.createAuthCookie(`passkey_${purpose}`);
    const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
    if (!identifier || !identifier.startsWith(`passkey-${purpose}-`)) {
        invalid();
    }
    const record = await ctx.context.internalAdapter.consumeVerificationValue(identifier);
    expireCookie(ctx, cookie);
    if (!record || new Date(record.expiresAt).getTime() <= Date.now()) {
        invalid();
    }
    const data = JSON.parse(record.value);
    const rp = await relyingParty(ctx);
    if (data.origin !== rp.origin || data.rpID !== rp.rpID) {
        invalid();
    }
    return data;
}

/**
 * Resolve only a password-verified, unfinished Better Auth two-factor challenge.
 * @param ctx Authentication endpoint context
 * @returns Pending login and account
 */
async function pendingLogin(ctx: GenericEndpointContext) {
    const cookie = ctx.context.createAuthCookie(twoFactorCookieName);
    const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
    if (!identifier || !identifier.startsWith("2fa-")) {
        invalid();
    }
    const record = await ctx.context.internalAdapter.findVerificationValue(identifier);
    if (!record || new Date(record.expiresAt).getTime() <= Date.now()) {
        invalid();
    }
    const user = await ctx.context.internalAdapter.findUserById(record.value);
    if (!user || (user as typeof user & { banned?: boolean }).banned) {
        invalid();
    }
    const totp = await R.knex("better_auth_twoFactor").where("userId", user.id).first();
    if (totp?.lockedUntil && new Date(totp.lockedUntil).getTime() > Date.now()) {
        throw new APIError("TOO_MANY_REQUESTS", { message: "Account temporarily locked. Please try again later." });
    }
    if (totp?.lockedUntil) {
        await R.knex("better_auth_twoFactor")
            .where("userId", user.id)
            .where("lockedUntil", "<=", new Date())
            .update({ failedVerificationCount: 0, lockedUntil: null });
    }
    return { identifier, record, user, cookie };
}

/**
 * Add an alternative second factor to password sign-in.
 * @returns Better Auth plugin
 */
export function passkeyTwoFactor(): BetterAuthPlugin {
    const passwordBody = z.object({ password: z.string().min(1) });
    const responseBody = z.object({ response: z.any() });
    return {
        id: "kuma-passkey-two-factor",
        endpoints: {
            listSecondFactorPasskeys: createAuthEndpoint(
                "/passkey-2fa/list",
                { method: "GET", use: [sessionMiddleware] },
                async (ctx) => {
                    const passkeys = await R.knex("user_passkey")
                        .where("user_id", ctx.context.session.user.id)
                        .select("id", "name", "rp_id", "created_date", "last_used_date")
                        .orderBy("created_date");
                    return ctx.json({ passkeys });
                }
            ),
            passkeyRegistrationOptions: createAuthEndpoint(
                "/passkey-2fa/register-options",
                {
                    method: "POST",
                    body: passwordBody.extend({ name: z.string().trim().min(1).max(100) }),
                    use: [sessionMiddleware],
                },
                async (ctx) => {
                    const user = await requirePassword(ctx);
                    const rp = await relyingParty(ctx);
                    const credentials = await R.knex("user_passkey").where({ user_id: user.id, rp_id: rp.rpID });
                    const options = await generateRegistrationOptions({
                        rpName: "Uptime Kuma",
                        rpID: rp.rpID,
                        userName: user.name,
                        userID: new Uint8Array(Buffer.from(user.id)),
                        attestationType: "none",
                        supportedAlgorithmIDs: [-7, -257],
                        excludeCredentials: credentials.map((key: { credential_id: string }) => ({
                            id: key.credential_id,
                        })),
                        authenticatorSelection: { residentKey: "required", userVerification: "required" },
                    });
                    await storeChallenge(ctx, "registration", {
                        ...rp,
                        userID: user.id,
                        sessionID: ctx.context.session.session.id,
                        challenge: options.challenge,
                        name: ctx.body.name,
                    });
                    return ctx.json(options);
                }
            ),
            verifyPasskeyRegistration: createAuthEndpoint(
                "/passkey-2fa/register",
                { method: "POST", body: responseBody, use: [sessionMiddleware] },
                async (ctx) => {
                    const challenge = await consumeChallenge(ctx, "registration");
                    if (
                        challenge.userID !== ctx.context.session.user.id ||
                        challenge.sessionID !== ctx.context.session.session.id
                    ) {
                        invalid();
                    }
                    let result;
                    try {
                        result = await verifyRegistrationResponse({
                            response: ctx.body.response,
                            expectedChallenge: challenge.challenge,
                            expectedOrigin: challenge.origin,
                            expectedRPID: challenge.rpID,
                            requireUserVerification: true,
                        });
                    } catch {
                        invalid();
                    }
                    if (!result.verified || !result.registrationInfo) {
                        invalid();
                    }
                    const credential = result.registrationInfo.credential;
                    await R.knex("user_passkey").insert({
                        id: randomUUID(),
                        user_id: challenge.userID,
                        credential_id: credential.id,
                        credential_hash: createHash("sha256").update(credential.id).digest("hex"),
                        public_key: Buffer.from(credential.publicKey).toString("base64url"),
                        counter: credential.counter,
                        rp_id: challenge.rpID,
                        name: challenge.name,
                        transports: JSON.stringify(credential.transports || []),
                        created_date: new Date(),
                    });
                    return ctx.json({ ok: true });
                }
            ),
            removeSecondFactorPasskey: createAuthEndpoint(
                "/passkey-2fa/delete",
                { method: "POST", body: passwordBody.extend({ id: z.string().min(1) }), use: [sessionMiddleware] },
                async (ctx) => {
                    const user = await requirePassword(ctx);
                    await R.knex("user_passkey").where({ id: ctx.body.id, user_id: user.id }).del();
                    return ctx.json({ ok: true });
                }
            ),
            passkeyAuthenticationOptions: createAuthEndpoint(
                "/passkey-2fa/authenticate-options",
                { method: "POST" },
                async (ctx) => {
                    const pending = await pendingLogin(ctx);
                    const rp = await relyingParty(ctx);
                    const credentials = await R.knex("user_passkey").where({
                        user_id: pending.user.id,
                        rp_id: rp.rpID,
                    });
                    if (!credentials.length) {
                        invalid();
                    }
                    const options = await generateAuthenticationOptions({
                        rpID: rp.rpID,
                        userVerification: "required",
                        allowCredentials: credentials.map((key: { credential_id: string; transports: string }) => ({
                            id: key.credential_id,
                            transports: JSON.parse(key.transports),
                        })),
                    });
                    await storeChallenge(ctx, "authentication", {
                        ...rp,
                        userID: pending.user.id,
                        loginID: pending.identifier,
                        challenge: options.challenge,
                    });
                    return ctx.json(options);
                }
            ),
            verifyPasskeySecondFactor: createAuthEndpoint(
                "/passkey-2fa/authenticate",
                { method: "POST", body: responseBody },
                async (ctx) => {
                    const pending = await pendingLogin(ctx);
                    const challenge = await consumeChallenge(ctx, "authentication");
                    if (challenge.userID !== pending.user.id || challenge.loginID !== pending.identifier) {
                        invalid();
                    }
                    const attemptID = `2fa-attempts-${pending.identifier}`;
                    const attempt = await ctx.context.internalAdapter.consumeVerificationValue(attemptID);
                    const count = Number(attempt?.value);
                    if (!attempt || !Number.isInteger(count) || count < 0 || count >= 5) {
                        await ctx.context.internalAdapter.consumeVerificationValue(pending.identifier);
                        expireCookie(ctx, pending.cookie);
                        invalid();
                    }
                    try {
                        const credential = await R.knex("user_passkey")
                            .where({
                                user_id: pending.user.id,
                                rp_id: challenge.rpID,
                                credential_hash: createHash("sha256")
                                    .update(String(ctx.body.response?.id))
                                    .digest("hex"),
                            })
                            .first();
                        if (!credential) {
                            invalid();
                        }
                        const result = await verifyAuthenticationResponse({
                            response: ctx.body.response,
                            expectedChallenge: challenge.challenge,
                            expectedOrigin: challenge.origin,
                            expectedRPID: challenge.rpID,
                            requireUserVerification: true,
                            credential: {
                                id: credential.credential_id,
                                publicKey: new Uint8Array(Buffer.from(credential.public_key, "base64url")),
                                counter: Number(credential.counter),
                                transports: JSON.parse(credential.transports),
                            },
                        });
                        if (
                            !result.verified ||
                            !(await R.knex("user_passkey")
                                .where({ id: credential.id, counter: credential.counter })
                                .update({ counter: result.authenticationInfo.newCounter, last_used_date: new Date() }))
                        ) {
                            invalid();
                        }
                    } catch {
                        await R.knex("better_auth_twoFactor")
                            .where("userId", pending.user.id)
                            .increment("failedVerificationCount", 1);
                        await R.knex("better_auth_twoFactor")
                            .where("userId", pending.user.id)
                            .where("failedVerificationCount", ">=", 10)
                            .update({ lockedUntil: new Date(Date.now() + 900000) });
                        await ctx.context.internalAdapter.createVerificationValue({
                            identifier: attemptID,
                            value: String(count + 1),
                            expiresAt: pending.record.expiresAt,
                        });
                        invalid();
                    }
                    const consumed = await ctx.context.internalAdapter.consumeVerificationValue(pending.identifier);
                    if (!consumed || consumed.value !== pending.user.id) {
                        invalid();
                    }
                    const user = await ctx.context.internalAdapter.findUserById(pending.user.id);
                    if (!user || (user as typeof user & { banned?: boolean }).banned) {
                        invalid();
                    }
                    const dontRemember = await ctx.getSignedCookie(
                        ctx.context.authCookies.dontRememberToken.name,
                        ctx.context.secret
                    );
                    const session = await ctx.context.internalAdapter.createSession(user.id, !!dontRemember);
                    await setSessionCookie(ctx, { session, user }, !!dontRemember);
                    expireCookie(ctx, pending.cookie);
                    await R.knex("better_auth_twoFactor")
                        .where("userId", user.id)
                        .update({ failedVerificationCount: 0, lockedUntil: null });
                    return ctx.json({ ok: true });
                }
            ),
        },
        hooks: {
            after: [
                {
                    matcher: (ctx) => ["/sign-in/username", "/sign-in/email"].includes(ctx.path || ""),
                    handler: createAuthMiddleware(async (ctx) => {
                        const data = ctx.context.newSession;
                        if (!data || !(await R.knex("user_passkey").where("user_id", data.user.id).first())) {
                            return;
                        }
                        // Use the same pending challenge as TOTP so either factor consumes the login.
                        deleteSessionCookie(ctx, true);
                        await ctx.context.internalAdapter.deleteSession(data.session.token);
                        ctx.context.setNewSession(null);
                        const cookie = ctx.context.createAuthCookie(twoFactorCookieName, { maxAge: 600 });
                        const identifier = `2fa-${randomBytes(24).toString("base64url")}`;
                        const expiresAt = new Date(Date.now() + 600000);
                        await ctx.context.internalAdapter.createVerificationValue({
                            identifier,
                            value: data.user.id,
                            expiresAt,
                        });
                        await ctx.context.internalAdapter.createVerificationValue({
                            identifier: `2fa-attempts-${identifier}`,
                            value: "0",
                            expiresAt,
                        });
                        await ctx.setSignedCookie(cookie.name, identifier, ctx.context.secret, cookie.attributes);
                        const totp = await R.knex("better_auth_twoFactor").where("userId", data.user.id).first();
                        return ctx.json({
                            twoFactorRedirect: true,
                            twoFactorMethods:
                                data.user.twoFactorEnabled && totp?.verified ? ["passkey", "totp"] : ["passkey"],
                        });
                    }),
                },
            ],
        },
        rateLimit: [{ pathMatcher: (path) => path.startsWith("/passkey-2fa/"), window: 60, max: 20 }],
    };
}
