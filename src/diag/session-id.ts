/**
 * Diagnostics session ids, made to be read aloud from inside a headset: no
 * characters that look alike (0/o, 1/l/i), shown in two groups of five.
 * Every id also fits the server's check (lowercase letters and digits).
 */
export const SESSION_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const SESSION_LENGTH = 10;

export function newSessionId(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return Array.from(random(SESSION_LENGTH), (b) => SESSION_ALPHABET[b % SESSION_ALPHABET.length]).join('');
}

/** "k3x9qm2p7a" -> "k3x9q m2p7a": easier to read off the panel and to type later. */
export function formatSessionId(id: string): string {
  return id.match(/.{1,5}/g)?.join(' ') ?? id;
}
