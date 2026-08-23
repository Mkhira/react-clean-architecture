import type { AppError } from '@shared/types/errors';

// The feature reuses the app-wide error contract as-is. AppError's code union
// (src/shared/types/errors.ts) is the ONLY allowed set — do not invent feature
// codes like HTTP_ERROR/PARSE_ERROR and do not widen the type with
// Omit<AppError, 'code'>: reviewers reject both. Map transport failures onto
// these four (a bad payload is VALIDATION_ERROR, a bad response is
// NETWORK_ERROR). If a genuinely new code is needed, add it to AppError itself
// so every feature shares it.
export const PRODUCT_VERIFICATION_ERROR_CODE_VALUES = [
    'NETWORK_ERROR',
    'AUTH_ERROR',
    'TIMEOUT',
    'VALIDATION_ERROR',
] as const satisfies readonly AppError['code'][];

export type PRODUCT_VERIFICATION_ERROR_CODES = (typeof PRODUCT_VERIFICATION_ERROR_CODE_VALUES)[number];

export type ProductVerificationError = AppError;

export const createProductVerificationError = (
    code: PRODUCT_VERIFICATION_ERROR_CODES,
    message: string,
    originalError?: unknown
): ProductVerificationError => ({ code, message, originalError });

export const isProductVerificationError = (error: unknown): error is ProductVerificationError =>
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    PRODUCT_VERIFICATION_ERROR_CODE_VALUES.includes((error as { code?: unknown }).code as PRODUCT_VERIFICATION_ERROR_CODES);
