import type { AppError, INFRA_ERROR_CODES } from '@shared/types/errors';

/**
 * This feature reuses AppError's own code union — a feature never invents its
 * own codes, so a caller can handle NETWORK_ERROR / VALIDATION_ERROR the same
 * way everywhere. A malformed payload is VALIDATION_ERROR, a bad HTTP response
 * is NETWORK_ERROR. Never invent codes like HTTP_ERROR / PARSE_ERROR and never
 * widen the type with Omit<AppError, 'code'> — reviewers reject both. A genuinely
 * new code goes into AppError itself (src/shared/types/errors.ts), where every
 * feature shares it.
 */
export type PRODUCT_VERIFICATION_ERROR_CODES = INFRA_ERROR_CODES;

export type ProductVerificationError = AppError;

export const createProductVerificationError = (
    code: PRODUCT_VERIFICATION_ERROR_CODES,
    message: string,
    originalError?: unknown
): ProductVerificationError => ({ code, message, originalError });

export const PRODUCT_VERIFICATION_ERROR_CODE_VALUES: readonly PRODUCT_VERIFICATION_ERROR_CODES[] = [
    'NETWORK_ERROR',
    'AUTH_ERROR',
    'TIMEOUT',
    'VALIDATION_ERROR',
];

export const isProductVerificationError = (error: unknown): error is ProductVerificationError =>
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    PRODUCT_VERIFICATION_ERROR_CODE_VALUES.includes((error as { code?: unknown }).code as PRODUCT_VERIFICATION_ERROR_CODES);
