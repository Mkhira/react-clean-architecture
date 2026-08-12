import type { IHttpClient } from '@core/http/IHttpClient';
import type { IConfigService } from '@core/config/IConfigService';
import type { IProductVerificationService } from '../../domain/IServices/IProductVerificationService';
import { PRODUCT_VERIFICATION_ENDPOINTS } from '../endpoints/endpoints';
import { createProductVerificationError } from '../../domain/errors/ProductVerificationError';
import type { VerifyProductCodeRequestDTO, VerifyProductCodeResponseDTO } from '../dtos/VerifyProductCodeDTO';
import type { VerifyProductCodeResult } from '../../domain/entities/VerifyProductCodeResult';
import { VerifyProductCodeMapper } from '../mappers/VerifyProductCodeMapper';
import type { GetScanHistoryResponseDTO } from '../dtos/GetScanHistoryDTO';
import type { GetScanHistoryResult } from '../../domain/entities/GetScanHistoryResult';
import { GetScanHistoryMapper } from '../mappers/GetScanHistoryMapper';

export class ProductVerificationService implements IProductVerificationService {
    constructor(
        private readonly httpClient: IHttpClient,
        private readonly configService: IConfigService,
    ) {}

    async verifyProductCode(payload: VerifyProductCodeRequestDTO): Promise<VerifyProductCodeResult> {
        const { productVerificationBaseUrl, productVerificationClientId, productVerificationClientSecret, timeout } = this.configService.get();
        const url = `${productVerificationBaseUrl}${PRODUCT_VERIFICATION_ENDPOINTS.VERIFY_PRODUCT_CODE}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        let response: Response;
        try {
            response = await fetch(url, {
                method: 'POST',
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    client_id: productVerificationClientId,
                    client_secret: productVerificationClientSecret,
                },
                body: JSON.stringify(payload),
                signal: controller.signal,
            });
        } catch (error) {
            throw createProductVerificationError('NETWORK_ERROR', 'verifyProductCode request failed', error);
        } finally {
            clearTimeout(timer);
        }
        if (!response.ok) {
            const text = await response.text();
            throw createProductVerificationError('HTTP_ERROR', `verifyProductCode HTTP ${response.status}: ${text}`);
        }
        let dto: VerifyProductCodeResponseDTO;
        try {
            dto = (await response.json()) as VerifyProductCodeResponseDTO;
        } catch (error) {
            throw createProductVerificationError('PARSE_ERROR', 'verifyProductCode response was not valid JSON', error);
        }
        return VerifyProductCodeMapper.toDomain(dto);
    }

    async getScanHistory(query: { from: string }): Promise<GetScanHistoryResult> {
        const response = await this.httpClient.get<GetScanHistoryResponseDTO>(PRODUCT_VERIFICATION_ENDPOINTS.GET_SCAN_HISTORY, { params: query });
        return GetScanHistoryMapper.toDomain(response.data);
    }

    // <create-feature:methods>
}
