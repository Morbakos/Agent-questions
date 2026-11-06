// Shared constants without dependencies: the UI imports them at runtime without bundling zod.
/** Minimum password length, in characters (enforced by `PasswordSchema`, mirrored by the UI forms). */
export const PASSWORD_MIN_LENGTH = 10;
/** Maximum password length, in characters (same sharing as `PASSWORD_MIN_LENGTH`). */
export const PASSWORD_MAX_LENGTH = 200;
