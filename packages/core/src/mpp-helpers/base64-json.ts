/**
 * Shared base64 -> JSON decoder used by MPP credential / probe paths.
 * Returns `null` instead of throwing on malformed input so callers can
 * decide whether to surface a generic error.
 */
export function decodeBase64Json(b64: string): unknown {
  try {
    let bin: string;
    if (typeof atob === 'function') {
      bin = atob(b64);
    } else {
      bin = Buffer.from(b64, 'base64').toString('binary');
    }
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
