import { IUseCase } from '@domain/shared/IUseCase';
import { Result } from '@shared/types/Result';
import type { ILogger } from '@core/logging/ILogger';
import type { IProductVerificationRepository } from '../IRepositories/IProductVerificationRepository';
import type { GetScanHistoryResult, GetScanHistoryInput } from '../entities/GetScanHistoryResult';
import { createProductVerificationError, isProductVerificationError, type ProductVerificationError } from '../errors/ProductVerificationError';

export class GetScanHistoryUseCase implements IUseCase<GetScanHistoryInput, Result<GetScanHistoryResult, ProductVerificationError>> {
    constructor(
        private readonly repository: IProductVerificationRepository,
        private readonly logger: ILogger
    ) {}

    async execute(input: GetScanHistoryInput): Promise<Result<GetScanHistoryResult, ProductVerificationError>> {
        // TODO(claude): business rules (user story was skipped)
        try {
            const result = await this.repository.getScanHistory(input);
            return Result.ok(result);
        } catch (error) {
            // never swallow a failure silently — reviewers require the log
            this.logger.exception('getScanHistory failed', error);
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
                return Result.err(createProductVerificationError('AUTH_ERROR', 'getScanHistory unauthorized', error));
            }
            if (transport?.code === 'ECONNABORTED' || transport?.code === 'ETIMEDOUT') {
                return Result.err(createProductVerificationError('TIMEOUT', 'getScanHistory timed out', error));
            }
            const description = transport?.header?.status?.description;
            return Result.err(createProductVerificationError('NETWORK_ERROR', description || 'getScanHistory failed', error));
        }
    }
}
