import type {
    GetScanHistoryResponseDTO,
    GetScanHistoryResponseItemDTO,
} from '../dtos/GetScanHistoryDTO';
import type {
    GetScanHistoryResult,
    GetScanHistoryItem,
} from '../../domain/entities/GetScanHistoryResult';
import { formatNumericGregorianDate } from '@shared/utils/dateFormat';

const cleanString = (value: string | null | undefined): string | null => value?.trim() || null;

const toGetScanHistoryItem = (dto: GetScanHistoryResponseItemDTO): GetScanHistoryItem => ({
    scanId: dto.ScanId,
    scanCode: cleanString(dto.ScanCode),
    scannedAt: formatNumericGregorianDate(dto.ScannedAt),
    wasValid: dto.WasValid,
});

export const GetScanHistoryMapper = {
    toDomain(dto: GetScanHistoryResponseDTO): GetScanHistoryResult {
        return dto.map(toGetScanHistoryItem);
    },
};
