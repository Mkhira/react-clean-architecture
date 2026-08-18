import type { IHttpClient } from '@core/http/IHttpClient';
import type { IConfigService } from '@core/config/IConfigService';
import type { IProductVerificationService } from '../../domain/IServices/IProductVerificationService';
import { PRODUCT_VERIFICATION_ENDPOINTS } from '../endpoints/endpoints';
import { createProductVerificationError } from '../../domain/errors/ProductVerificationError';
import type { VerifyProductCodeRequestDTO, VerifyProductCodeResponseDTO } from '../dtos/VerifyProductCodeDTO';
import type { VerifyProductCodeResult } from '../../domain/entities/VerifyProductCodeResult';
import { VerifyProductCodeMapper } from '../mappers/VerifyProductCodeMapper';
import type { GetScanHistoryResult } from '../../domain/entities/GetScanHistoryResult';
import { GetScanHistoryMapper } from '../mappers/GetScanHistoryMapper';

export class ProductVerificationService implements IProductVerificationService {
    constructor(
        private readonly httpClient: IHttpClient,
        private readonly configService: IConfigService,
    ) {}

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
            throw createProductVerificationError('HTTP_ERROR', `${action} HTTP ${response.status}: ${text}`);
        }
        return response;
    }

    private async parseExternalJson<TResponseDTO>(action: string, response: Response): Promise<TResponseDTO> {
        try {
            return (await response.json()) as TResponseDTO;
        } catch (error) {
            throw createProductVerificationError('PARSE_ERROR', `${action} response was not valid JSON`, error);
        }
    }

    async verifyProductCode(payload: VerifyProductCodeRequestDTO): Promise<VerifyProductCodeResult> {
        const { productVerificationBaseUrl, productVerificationClientId, productVerificationClientSecret } = this.configService.get();
        const url = `${productVerificationBaseUrl}${PRODUCT_VERIFICATION_ENDPOINTS.VERIFY_PRODUCT_CODE}`;
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
        return VerifyProductCodeMapper.toDomain(dto);
    }

    async getScanHistory(query: { from: string }): Promise<GetScanHistoryResult> {
        const response = await this.httpClient.get<GetScanHistoryResult>(PRODUCT_VERIFICATION_ENDPOINTS.GET_SCAN_HISTORY, { mapper: GetScanHistoryMapper.toDomain, params: query });
        return response.data;
    }

    // <create-feature:methods>
}
