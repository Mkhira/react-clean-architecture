import type { IProductVerificationRepository } from '../../domain/IRepositories/IProductVerificationRepository';
import type { IProductVerificationService } from '../IServices/IProductVerificationService';
import type { VerifyProductCodeResult, VerifyProductCodeInput } from '../../domain/entities/VerifyProductCodeResult';
import type { GetScanHistoryResult, GetScanHistoryInput } from '../../domain/entities/GetScanHistoryResult';

export class ProductVerificationRepository implements IProductVerificationRepository {
    constructor(private readonly apiService: IProductVerificationService) {}

    async verifyProductCode(input: VerifyProductCodeInput): Promise<VerifyProductCodeResult> {
        return this.apiService.verifyProductCode(input);
    }

    async getScanHistory(input: GetScanHistoryInput): Promise<GetScanHistoryResult> {
        return this.apiService.getScanHistory({ from: input.from });
    }

    // <create-feature:methods>
}
