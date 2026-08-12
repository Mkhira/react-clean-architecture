import type {
    VerifyProductCodeRequestDTO,
    VerifyProductCodeResponseDTO,
    DeviceMetadata,
    VerifyProductCodeResponsePackDTO,
} from '../dtos/VerifyProductCodeDTO';
import type {
    VerifyProductCodeResult,
    VerifyProductCodeInput,
    VerifyProductCodePack,
} from '../../domain/entities/VerifyProductCodeResult';
import { formatDateTimeDateMonthYear } from '@shared/utils/dateFormat';

const cleanString = (value: string | null | undefined): string | null => value?.trim() || null;

const toVerifyProductCodePack = (dto: VerifyProductCodeResponsePackDTO): VerifyProductCodePack => ({
    productDescription: cleanString(dto.ProductDescription),
    dateOfManufacture: formatDateTimeDateMonthYear(dto.DateOfManufacture),
    organisationName: cleanString(dto.OrganisationName),
    countryOfManufacture: cleanString(dto.CountryOfManufacture),
    customsAuthority: cleanString(dto.CustomsAuthority),
    customersClearanceDate: formatDateTimeDateMonthYear(dto.CustomersClearanceDate),
});

export const VerifyProductCodeMapper = {
    toDomain(dto: VerifyProductCodeResponseDTO): VerifyProductCodeResult {
        return {
            // TODO(claude): status derivation — map the response flags to 'valid' | 'invalid' | 'notFound'
            status: 'valid',
            isValid: dto.IsValid,
            isPackCode: dto.IsPackCode,
            isDTSCode: dto.IsDTSCode,
            pack: dto.pack ? toVerifyProductCodePack(dto.pack) : null,
        };
    },

    toDTO(input: VerifyProductCodeInput, device: DeviceMetadata): VerifyProductCodeRequestDTO {
        return {
            ScanCode: input.scanCode,
            ScanCodeType: "",
            ScanDateTime: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
            ScanDeviceId: device.id,
            ScanDeviceName: device.name,
            ScanDeviceOS: device.os,
            ScanDeviceOSVersion: device.osVersion,
            ScanDeviceLanguage: device.language,
            ScanCustomerId: input.scanCustomerId, // TODO: from auth session
        };
    },
};
