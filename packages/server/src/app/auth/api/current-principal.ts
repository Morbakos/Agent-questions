import { CurrentUser } from "@nestjs/authentication";

/**
 * The principal established by authentication (`@nestjs/authentication`, global guard). Never read from the body, the
 * query or a client-supplied header.
 */
export const CurrentPrincipal = CurrentUser;
