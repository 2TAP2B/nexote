"use client";

// Passkey ceremonies in the browser. The server sends WebAuthn options as JSON
// with base64url strings for every binary field; the browser API wants
// ArrayBuffers, and the server wants the resulting credential back as JSON
// with base64url fields again. Nothing here trusts the server's JSON shape:
// each field is checked before it reaches navigator.credentials.

import { ApiError, type CeremonyFinish, type CeremonyStart } from "@/lib/api";

type JsonObject = { [key: string]: unknown };

const isObject = (v: unknown): v is JsonObject => typeof v === "object" && v !== null && !Array.isArray(v);

function bytesFromB64u(value: unknown, field: string): ArrayBuffer {
  if (typeof value !== "string") throw new Error(`Invalid passkey options from the server (${field})`);
  let b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function b64uFromBytes(buf: ArrayBuffer): string {
  let bin = "";
  for (const byte of new Uint8Array(buf)) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function reqString(o: JsonObject, key: string, field: string): string {
  const value = o[key];
  if (typeof value !== "string") throw new Error(`Invalid passkey options from the server (${field})`);
  return value;
}

const TRANSPORTS: readonly AuthenticatorTransport[] = ["ble", "hybrid", "internal", "nfc", "usb"];
const isTransport = (v: unknown): v is AuthenticatorTransport =>
  typeof v === "string" && TRANSPORTS.some((t) => t === v);

const USER_VERIFICATION: readonly UserVerificationRequirement[] = ["discouraged", "preferred", "required"];

const RESIDENT_KEY: readonly ResidentKeyRequirement[] = ["discouraged", "preferred", "required"];
const ATTACHMENT: readonly AuthenticatorAttachment[] = ["cross-platform", "platform"];
const ATTESTATION: readonly AttestationConveyancePreference[] = ["direct", "enterprise", "indirect", "none"];

function credentialDescriptors(list: unknown, field: string): PublicKeyCredentialDescriptor[] {
  if (list === undefined || list === null) return [];
  if (!Array.isArray(list)) throw new Error(`Invalid passkey options from the server (${field})`);
  return list.map((item) => {
    if (!isObject(item)) throw new Error(`Invalid passkey options from the server (${field})`);
    const transports = Array.isArray(item.transports) ? item.transports.filter(isTransport) : undefined;
    return {
      type: "public-key",
      id: bytesFromB64u(item.id, `${field}.id`),
      ...(transports?.length ? { transports } : {}),
    };
  });
}

// go-webauthn may wrap the options as {publicKey: {...}}; accept both.
function unwrap(options: unknown): JsonObject {
  if (!isObject(options)) throw new Error("Invalid passkey options from the server");
  return isObject(options.publicKey) ? options.publicKey : options;
}

function creationOptions(options: unknown): PublicKeyCredentialCreationOptions {
  const o = unwrap(options);
  if (!isObject(o.rp) || !isObject(o.user) || !Array.isArray(o.pubKeyCredParams)) {
    throw new Error("Invalid passkey options from the server");
  }
  const rpId = typeof o.rp.id === "string" ? o.rp.id : undefined;
  const params: PublicKeyCredentialParameters[] = o.pubKeyCredParams.flatMap((p) =>
    isObject(p) && typeof p.alg === "number" ? [{ type: "public-key" as const, alg: p.alg }] : [],
  );
  const sel = isObject(o.authenticatorSelection) ? o.authenticatorSelection : undefined;
  const authenticatorSelection: AuthenticatorSelectionCriteria | undefined = sel && {
    authenticatorAttachment: ATTACHMENT.find((x) => x === sel.authenticatorAttachment),
    residentKey: RESIDENT_KEY.find((x) => x === sel.residentKey),
    requireResidentKey: typeof sel.requireResidentKey === "boolean" ? sel.requireResidentKey : undefined,
    userVerification: USER_VERIFICATION.find((x) => x === sel.userVerification),
  };
  return {
    rp: { name: reqString(o.rp, "name", "rp.name"), ...(rpId ? { id: rpId } : {}) },
    user: {
      id: bytesFromB64u(o.user.id, "user.id"),
      name: reqString(o.user, "name", "user.name"),
      displayName: reqString(o.user, "displayName", "user.displayName"),
    },
    challenge: bytesFromB64u(o.challenge, "challenge"),
    pubKeyCredParams: params,
    timeout: typeof o.timeout === "number" ? o.timeout : undefined,
    excludeCredentials: credentialDescriptors(o.excludeCredentials, "excludeCredentials"),
    authenticatorSelection,
    attestation: ATTESTATION.find((x) => x === o.attestation),
    // Ask for credProps so the server learns whether the key is discoverable.
    ...(isObject(o.extensions) && o.extensions.credProps === true ? { extensions: { credProps: true } } : {}),
  };
}

function requestOptions(options: unknown): PublicKeyCredentialRequestOptions {
  const o = unwrap(options);
  return {
    challenge: bytesFromB64u(o.challenge, "challenge"),
    timeout: typeof o.timeout === "number" ? o.timeout : undefined,
    rpId: typeof o.rpId === "string" ? o.rpId : undefined,
    allowCredentials: credentialDescriptors(o.allowCredentials, "allowCredentials"),
    userVerification: USER_VERIFICATION.find((x) => x === o.userVerification),
  };
}

/** Runs navigator.credentials.create and returns the credential as the
 *  server's JSON (base64url fields). */
export async function createPasskey(options: unknown): Promise<JsonObject> {
  const cred = await navigator.credentials.create({ publicKey: creationOptions(options) });
  if (!(cred instanceof PublicKeyCredential) || !(cred.response instanceof AuthenticatorAttestationResponse)) {
    throw new Error("The browser returned no passkey");
  }
  const response = cred.response;
  return {
    id: cred.id,
    rawId: b64uFromBytes(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: b64uFromBytes(response.clientDataJSON),
      attestationObject: b64uFromBytes(response.attestationObject),
      transports: typeof response.getTransports === "function" ? response.getTransports() : [],
    },
    clientExtensionResults: cred.getClientExtensionResults(),
    authenticatorAttachment: cred.authenticatorAttachment,
  };
}

/** Runs navigator.credentials.get and returns the assertion as JSON. */
export async function getPasskey(options: unknown): Promise<JsonObject> {
  const cred = await navigator.credentials.get({ publicKey: requestOptions(options) });
  if (!(cred instanceof PublicKeyCredential) || !(cred.response instanceof AuthenticatorAssertionResponse)) {
    throw new Error("The browser returned no passkey");
  }
  const response = cred.response;
  return {
    id: cred.id,
    rawId: b64uFromBytes(cred.rawId),
    type: cred.type,
    response: {
      clientDataJSON: b64uFromBytes(response.clientDataJSON),
      authenticatorData: b64uFromBytes(response.authenticatorData),
      signature: b64uFromBytes(response.signature),
      userHandle: response.userHandle ? b64uFromBytes(response.userHandle) : null,
    },
    clientExtensionResults: cred.getClientExtensionResults(),
    authenticatorAttachment: cred.authenticatorAttachment,
  };
}

/** begin → create a passkey on this device → finish (labelled with the device). */
export async function registerPasskey<T>(
  begin: () => Promise<CeremonyStart>,
  finish: (input: CeremonyFinish) => Promise<T>,
): Promise<T> {
  const { ceremonyId, options } = await begin();
  const credential = await createPasskey(options);
  return finish({ ceremonyId, credential, name: defaultPasskeyName() });
}

/** begin → pick a passkey → finish. */
export async function authenticateWithPasskey<T>(
  begin: () => Promise<CeremonyStart>,
  finish: (input: CeremonyFinish) => Promise<T>,
): Promise<T> {
  const { ceremonyId, options } = await begin();
  const credential = await getPasskey(options);
  return finish({ ceremonyId, credential });
}

/** False on browsers without WebAuthn and on plain-http origins (the API
 *  only exists in secure contexts). */
export function passkeysSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    typeof window.PublicKeyCredential === "function" &&
    typeof navigator.credentials?.create === "function"
  );
}

/** Why passkeys can't work here, or null when they can. */
export function passkeyUnsupportedReason(): string | null {
  if (passkeysSupported()) return null;
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return "Passkeys need a secure connection. Open Nexote over HTTPS (or on localhost).";
  }
  return "This browser doesn't support passkeys. Use a current browser.";
}

/** A label for a new passkey, from the device it's created on. */
export function defaultPasskeyName(): string {
  if (typeof navigator === "undefined") return "Passkey";
  const ua = navigator.userAgent;
  if (/iPhone/i.test(ua)) return "iPhone";
  // iPadOS reports itself as a Mac; touch support gives it away.
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/CrOS/i.test(ua)) return "Chromebook";
  if (/Linux/i.test(ua)) return "Linux";
  return "Passkey";
}

/** A user-facing message for a failed passkey ceremony or its API calls. */
export function passkeyErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message || `Request failed (${err.status})`;
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotAllowedError":
      case "AbortError":
        return "The passkey prompt was cancelled or timed out.";
      case "InvalidStateError":
        return "This device already has a passkey for this account.";
      case "SecurityError":
        return "Passkeys don't work at this address: open Nexote at the address the server is configured for (NEXOTE_PUBLIC_URL).";
      case "NotSupportedError":
        return "This device doesn't support the requested passkey type.";
    }
  }
  if (err instanceof TypeError) return "Can't reach the server. Check your connection.";
  return err instanceof Error && err.message ? err.message : "Something went wrong with the passkey.";
}
