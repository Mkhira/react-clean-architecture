import type { VerifyProductCodeInput, VerifyProductCodeResult } from '../entities/VerifyProductCodeResult';
import type { GetScanHistoryInput, GetScanHistoryResult } from '../entities/GetScanHistoryResult';

export interface IProductVerificationRepository {
    verifyProductCode(input: VerifyProductCodeInput): Promise<VerifyProductCodeResult>;
    getScanHistory(input: GetScanHistoryInput): Promise<GetScanHistoryResult>;
    // <create-feature:signatures>
}
