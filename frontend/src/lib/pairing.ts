// Pairing codes and links (the Android app ↔ a Nexote server). A code is 16
// characters of Crockford base32, shown in groups of four; a link is
// `<server origin>/pair#<code>` — the code sits in the fragment so it never
// reaches a server log. The server and the app's engine check everything
// again; these helpers only recognize and tidy up what the user scans or
// types.

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_LENGTH = 16;

/** Uppercase, without spaces and dashes, with Crockford's look-alikes
 *  (I, L → 1; O → 0) folded the way the server does. */
export function normalizePairingCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/[IL]/g, "1")
    .replace(/O/g, "0");
}

/** True for a complete code (after normalizing). */
export function isPairingCode(raw: string): boolean {
  const code = normalizePairingCode(raw);
  return code.length === CODE_LENGTH && [...code].every((c) => ALPHABET.includes(c));
}

/** `ABCD-EFGH-JKMN-PQRS`; partial input is grouped as far as it goes. */
export function formatPairingCode(raw: string): string {
  return (normalizePairingCode(raw).match(/.{1,4}/g) ?? []).join("-");
}

/** The server and code of a pairing link, or null for anything else (other
 *  QR codes, links into notes, a broken code). http is let through here: the
 *  engine decides which addresses it accepts and says why. */
export function parsePairingLink(raw: string): { server: string; code: string } | null {
  let url: URL;
  let code: string;
  try {
    url = new URL(raw.trim());
    code = decodeURIComponent(url.hash.slice(1));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.pathname.replace(/\/+$/, "") !== "/pair") return null;
  if (!isPairingCode(code)) return null;
  return { server: url.origin, code: formatPairingCode(code) };
}
