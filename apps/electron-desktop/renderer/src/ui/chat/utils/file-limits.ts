/** Must match gateway parseMessageWithAttachments / saveMediaBuffer (5MB). */
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_ATTACHMENTS_DEFAULT = 5;
/** Max total size of all attachments in one message (5 files × 5MB). */
export const MAX_TOTAL_ATTACHMENTS_BYTES = MAX_ATTACHMENTS_DEFAULT * MAX_FILE_SIZE_BYTES;

/** Approximate decoded size of a data URL (base64). */
export function dataUrlDecodedBytes(dataUrl: string): number {
  const base = dataUrl.indexOf(",");
  if (base === -1) return 0;
  const b64 = dataUrl.slice(base + 1);
  return Math.floor((b64.length * 3) / 4);
}
