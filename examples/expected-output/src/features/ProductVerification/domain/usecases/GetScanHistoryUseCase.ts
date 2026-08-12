import { IUseCase } from '@domain/shared/IUseCase';
import { Result } from '@shared/types/Result';
import type { IProductVerificationRepository } from '../IRepositories/IProductVerificationRepository';
import type { GetScanHistoryResult, GetScanHistoryInput } from '../entities/GetScanHistoryResult';
import { createProductVerificationError, isProductVerificationError, type ProductVerificationError } from '../errors/ProductVerificationError';

export class GetScanHistoryUseCase implements IUseCase<GetScanHistoryInput, Result<GetScanHistoryResult, ProductVerificationError>> {
    constructor(private readonly repository: IProductVerificationRepository) {}

    async execute(input: GetScanHistoryInput): Promise<Result<GetScanHistoryResult, ProductVerificationError>> {
        // TODO(claude): business rules (user story was skipped)
        try {
            const result = await this.repository.getScanHistory(input);
            return Result.ok(result);
        } catch (error) {
            if (isProductVerificationError(error)) {
                return Result.err(error);
            }
            return Result.err(createProductVerificationError('NETWORK_ERROR', 'getScanHistory failed', error));
        }
    }
}
