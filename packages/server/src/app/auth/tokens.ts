import { createHash, randomBytes } from "node:crypto";

/** Random 256-bit secret, in base64url (invitation link). */
export const randomSecret = (): string => randomBytes(32).toString("base64url");

/** Only the hash of a secret (invitation) is stored: a database leak gives no access. */
export const hashSecret = (secret: string): string => createHash("sha256").update(secret).digest("hex");
