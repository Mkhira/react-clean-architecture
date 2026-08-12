import type { AppError } from '@shared/types/errors';

export type PRODUCT_VERIFICATION_ERROR_CODES =
    | 'NETWORK_ERROR'
    | 'HTTP_ERROR'
    | 'PARSE_ERROR'
    | 'VALIDATION_ERROR';

export type ProductVerificationError = Omit<AppError, 'code'> & {
    code: PRODUCT_VERIFICATION_ERROR_CODES;
};

export const createProductVerificationError = (
    code: PRODUCT_VERIFICATION_ERROR_CODES,
    message: string,
    originalError?: unknown
): ProductVerificationError => ({ code, message, originalError });

export const isProductVerificationError = (error: unknown): error is ProductVerificationError =>
    typeof error === 'object' && error !== null && 'code' in error && 'message' in error;
