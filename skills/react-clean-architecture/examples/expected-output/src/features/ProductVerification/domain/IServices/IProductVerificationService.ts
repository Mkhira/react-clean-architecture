import type { VerifyProductCodeInput, VerifyProductCodeResult } from '../entities/VerifyProductCodeResult';
import type { GetScanHistoryResult } from '../entities/GetScanHistoryResult';

export interface IProductVerificationService {
    verifyProductCode(input: VerifyProductCodeInput): Promise<VerifyProductCodeResult>;
    getScanHistory(query: { from: string }): Promise<GetScanHistoryResult>;
    // <create-feature:signatures>
}
