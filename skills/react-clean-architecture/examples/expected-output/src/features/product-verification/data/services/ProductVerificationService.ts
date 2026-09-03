import type { IHttpClient } from '@core/http/IHttpClient';
import type { IConfigService } from '@core/config/IConfigService';
import type { IProductVerificationService } from '../IServices/IProductVerificationService';
import { PRODUCT_VERIFICATION_ENDPOINTS } from '../endpoints/endpoints';
import { createProductVerificationError } from '../../domain/errors/ProductVerificationError';
import type { VerifyProductCodeResponseDTO } from '../dtos/VerifyProductCodeDTO';
import type { VerifyProductCodeResult, VerifyProductCodeInput } from '../../domain/entities/VerifyProductCodeResult';
import { toVerifyProductCodeResult, toVerifyProductCodeRequestDTO } from '../mappers/VerifyProductCodeMapper';
import type { GetScanHistoryResult } from '../../domain/entities/GetScanHistoryResult';
import { toGetScanHistoryResult } from '../mappers/GetScanHistoryMapper';
import { Platform } from 'react-native';
import { getStoredLanguage } from '@core/localization/i18n';
import type { ITaxpayerAuthDeviceContextService } from '@core/device/ITaxpayerAuthDeviceContextService';
import type { DeviceMetadata } from '../dtos/VerifyProductCodeDTO';

export class ProductVerificationService implements IProductVerificationService {
    constructor(
        private readonly httpClient: IHttpClient,
        private readonly configService: IConfigService,
        private readonly deviceContext: ITaxpayerAuthDeviceContextService,
    ) {}

    private async getDeviceMetadata(): Promise<DeviceMetadata> {
        const context = await this.deviceContext.getContext();
        const language = String((await getStoredLanguage()) ?? 'ar');

        return {
            id: context.deviceId,
            name: context.deviceName,
            os: context.devicePlatform,
            osVersion: String(Platform.Version),
            language,
        };
    }

    private async requestExternal(
        action: string,
        url: string,
        init: { method: string; headers: Record<string, string>; body?: string }
    ): Promise<Response> {
        const { timeout } = this.configService.get();
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        let response: Response;
        try {
            response = await fetch(url, { ...init, signal: controller.signal });
        } catch (error) {
            throw createProductVerificationError('NETWORK_ERROR', `${action} request failed`, error);
        } finally {
            clearTimeout(timer);
        }
        if (!response.ok) {
            const text = await response.text();
            throw createProductVerificationError('NETWORK_ERROR', `${action} HTTP ${response.status}: ${text}`);
        }
        return response;
    }

    private async parseExternalJson<TResponseDTO>(action: string, response: Response): Promise<TResponseDTO> {
        try {
            return (await response.json()) as TResponseDTO;
        } catch (error) {
            throw createProductVerificationError('VALIDATION_ERROR', `${action} response was not valid JSON`, error);
        }
    }

    async verifyProductCode(input: VerifyProductCodeInput): Promise<VerifyProductCodeResult> {
        const { productVerificationBaseUrl, productVerificationClientId, productVerificationClientSecret } = this.configService.get();
        const url = `${productVerificationBaseUrl}${PRODUCT_VERIFICATION_ENDPOINTS.VERIFY_PRODUCT_CODE}`;
        const device = await this.getDeviceMetadata();
        const payload = toVerifyProductCodeRequestDTO(input, device);
        const response = await this.requestExternal('verifyProductCode', url, {
            method: 'POST',
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                client_id: productVerificationClientId,
                client_secret: productVerificationClientSecret,
            },
            body: JSON.stringify(payload),
        });
        const dto = await this.parseExternalJson<VerifyProductCodeResponseDTO>('verifyProductCode', response);
        return toVerifyProductCodeResult(dto);
    }

    async getScanHistory(query: { from: string }): Promise<GetScanHistoryResult> {
        const response = await this.httpClient.get<GetScanHistoryResult>(PRODUCT_VERIFICATION_ENDPOINTS.GET_SCAN_HISTORY, { mapper: toGetScanHistoryResult, params: query });
        return response.data;
    }

    // <create-feature:methods>
}
