import type { IProductVerificationRepository } from '../../domain/IRepositories/IProductVerificationRepository';
import type { IProductVerificationService } from '../../domain/IServices/IProductVerificationService';
import type { VerifyProductCodeResult, VerifyProductCodeInput } from '../../domain/entities/VerifyProductCodeResult';
import { VerifyProductCodeMapper } from '../mappers/VerifyProductCodeMapper';
import type { GetScanHistoryResult, GetScanHistoryInput } from '../../domain/entities/GetScanHistoryResult';
import { getDeviceInfo } from '@shared/utils/deviceInfo/deviceInfo';
import type { DeviceMetadata } from '../dtos/VerifyProductCodeDTO';

export class ProductVerificationRepository implements IProductVerificationRepository {
    constructor(private readonly apiService: IProductVerificationService) {}

    private async getDeviceMetadata(): Promise<DeviceMetadata> {
        const deviceInfo = await getDeviceInfo();

        return {
            id: deviceInfo.deviceID,
            name: deviceInfo.deviceName,
            os: deviceInfo.platFrom,
            osVersion: deviceInfo.osVersion,
            language: deviceInfo.language,
        };
    }

    async verifyProductCode(input: VerifyProductCodeInput): Promise<VerifyProductCodeResult> {
        const device = await this.getDeviceMetadata();
        const payload = VerifyProductCodeMapper.toDTO(input, device);
        return this.apiService.verifyProductCode(payload);
    }

    async getScanHistory(input: GetScanHistoryInput): Promise<GetScanHistoryResult> {
        return this.apiService.getScanHistory({ from: input.from });
    }

    // <create-feature:methods>
}
