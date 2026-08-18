import type { AppError } from '@shared/types/errors';

// Single source of truth for this feature's error codes — the union type and
// the runtime guard both derive from it, so adding a code is a one-line change.
export const PRODUCT_VERIFICATION_ERROR_CODE_VALUES = [
    'NETWORK_ERROR',
    'HTTP_ERROR',
    'PARSE_ERROR',
    'VALIDATION_ERROR',
] as const;

export type PRODUCT_VERIFICATION_ERROR_CODES = (typeof PRODUCT_VERIFICATION_ERROR_CODE_VALUES)[number];

export type ProductVerificationError = Omit<AppError, 'code'> & {
    code: PRODUCT_VERIFICATION_ERROR_CODES;
};

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
