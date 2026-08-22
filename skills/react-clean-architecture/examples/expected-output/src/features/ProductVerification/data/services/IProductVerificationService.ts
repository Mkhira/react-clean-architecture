import type { VerifyProductCodeInput, VerifyProductCodeResult } from '../../domain/entities/VerifyProductCodeResult';
import type { GetScanHistoryResult } from '../../domain/entities/GetScanHistoryResult';

export interface IProductVerificationService {
    verifyProductCode(input: VerifyProductCodeInput): Promise<VerifyProductCodeResult>;
    getScanHistory(query: { from: string }): Promise<GetScanHistoryResult>;
    // <create-feature:signatures>
}
