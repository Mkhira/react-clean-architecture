import type { VerifyProductCodeRequestDTO } from '../../data/dtos/VerifyProductCodeDTO';
import type { VerifyProductCodeResult } from '../entities/VerifyProductCodeResult';
import type { GetScanHistoryResult } from '../entities/GetScanHistoryResult';

export interface IProductVerificationService {
    verifyProductCode(payload: VerifyProductCodeRequestDTO): Promise<VerifyProductCodeResult>;
    getScanHistory(query: { from: string }): Promise<GetScanHistoryResult>;
    // <create-feature:signatures>
}
