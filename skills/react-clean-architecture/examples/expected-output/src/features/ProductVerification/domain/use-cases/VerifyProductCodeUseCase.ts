import { IUseCase } from '@domain/shared/IUseCase';
import { Result } from '@shared/types/Result';
import type { IProductVerificationRepository } from '../repositories/IProductVerificationRepository';
import type { VerifyProductCodeResult, VerifyProductCodeInput } from '../entities/VerifyProductCodeResult';
import { createProductVerificationError, isProductVerificationError, type ProductVerificationError } from '../errors/ProductVerificationError';

/**
 * User story:
 * As a consumer I scan a product tax-stamp QR code so I can check the product is genuine. The code must be exactly 16 characters after trimming; otherwise show a validation error without calling the API.
 */
export class VerifyProductCodeUseCase implements IUseCase<VerifyProductCodeInput, Result<VerifyProductCodeResult, ProductVerificationError>> {
    constructor(private readonly repository: IProductVerificationRepository) {}

    async execute(input: VerifyProductCodeInput): Promise<Result<VerifyProductCodeResult, ProductVerificationError>> {
        // TODO(claude): implement business rules:
        //   - code required, exactly 16 characters after trimming
        try {
            const result = await this.repository.verifyProductCode(input);
            return Result.ok(result);
        } catch (error) {
            if (isProductVerificationError(error)) {
                return Result.err(error);
            }
            // classify the transport failure instead of collapsing everything to
            // NETWORK_ERROR: axios rejections carry response.status / code, and
            // app-host envelope rejections carry header.status.description
            const transport = error as {
                response?: { status?: number };
                code?: string;
                header?: { status?: { description?: string } };
            };
            const httpStatus = transport?.response?.status;
            if (httpStatus === 401 || httpStatus === 403) {
                return Result.err(createProductVerificationError('AUTH_ERROR', 'verifyProductCode unauthorized', error));
            }
            if (transport?.code === 'ECONNABORTED' || transport?.code === 'ETIMEDOUT') {
                return Result.err(createProductVerificationError('TIMEOUT', 'verifyProductCode timed out', error));
            }
            const description = transport?.header?.status?.description;
            return Result.err(createProductVerificationError('NETWORK_ERROR', description || 'verifyProductCode failed', error));
        }
    }
}
