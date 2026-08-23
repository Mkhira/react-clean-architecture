import { VerifyProductCodeMapper } from '../data/mappers/VerifyProductCodeMapper';

jest.mock('@shared/components', () => ({}));

const SAMPLE = {
    "IsValid": true,
    "IsPackCode": false,
    "IsDTSCode": true,
    "pack": {
        "ProductDescription": "Sample product",
        "DateOfManufacture": "2025-02-13T11:11:40.0110000Z",
        "OrganisationName": "Example Org",
        "CountryOfManufacture": "SA",
        "CustomsAuthority": null,
        "CustomersClearanceDate": null
    }
} as const;

describe('VerifyProductCodeMapper', () => {
    it('toDomain maps the sample response to the domain entity', () => {
        const mapped = VerifyProductCodeMapper.toDomain(SAMPLE as never);

        expect(mapped.isValid).toBe(true);
        expect(mapped.isPackCode).toBe(false);
        expect(mapped.isDTSCode).toBe(true);
        expect(["valid","invalid","notFound"]).toContain(mapped.status);
    });

    it('toDTO builds the request payload from input + device metadata', () => {
        const input = {
            scanCode: "1234567890123456",
            scanCustomerId: 1,
        };
        const device = { id: 'dev-1', name: 'Test Device', os: 'iOS', osVersion: '17.0', language: 'English' };
        const dto = VerifyProductCodeMapper.toDTO(input, device);

        expect(dto.ScanCode).toBe(input.scanCode);
        expect(dto.ScanCodeType).toBe("");
        expect(dto.ScanDateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
        expect(dto.ScanCustomerId).toBe(input.scanCustomerId);
    });
});
