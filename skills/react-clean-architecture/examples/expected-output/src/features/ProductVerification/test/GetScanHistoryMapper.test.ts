import { GetScanHistoryMapper } from '../data/mappers/GetScanHistoryMapper';
import { formatNumericGregorianDate } from '@shared/utils/dateFormat';

jest.mock('@shared/components', () => ({}));

const SAMPLE = [
    {
        "ScanId": 7,
        "ScanCode": "1234567890123456",
        "ScannedAt": "2025-01-01T10:00:00Z",
        "WasValid": true
    }
] as const;

describe('GetScanHistoryMapper', () => {
    it('toDomain maps the sample response to the domain entity', () => {
        const mapped = GetScanHistoryMapper.toDomain(SAMPLE as never);

        expect(mapped[0].scanId).toBe(7);
        expect(mapped[0].scanCode).toBe("1234567890123456");
        expect(mapped[0].scannedAt).toBe(formatNumericGregorianDate(SAMPLE[0].ScannedAt));
        expect(mapped[0].wasValid).toBe(true);
    });
});
