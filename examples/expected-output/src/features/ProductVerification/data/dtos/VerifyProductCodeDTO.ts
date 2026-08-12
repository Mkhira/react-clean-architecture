export type VerifyProductCodeRequestDTO = {
    ScanCode: string;
    ScanCodeType: string;
    ScanDateTime: string;
    ScanDeviceId: string;
    ScanDeviceName: string;
    ScanDeviceOS: string;
    ScanDeviceOSVersion: string;
    ScanDeviceLanguage: string;
    ScanCustomerId: number;
};

export type VerifyProductCodeResponsePackDTO = {
    ProductDescription: string;
    DateOfManufacture: string;
    OrganisationName: string;
    CountryOfManufacture: string;
    CustomsAuthority: string | null;
    CustomersClearanceDate: string | null;
};

export type VerifyProductCodeResponseDTO = {
    IsValid: boolean;
    IsPackCode: boolean;
    IsDTSCode: boolean;
    pack: VerifyProductCodeResponsePackDTO | null;
};

export type DeviceMetadata = {
    id: string;
    name: string;
    os: string;
    osVersion: string;
    language: string;
};
