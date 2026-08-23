import type { VerifyProductCodeStatus } from '../constants/productVerification';
export type { VerifyProductCodeStatus };

export type VerifyProductCodePack = {
    productDescription: string | null;
    dateOfManufacture: string | null;
    organisationName: string | null;
    countryOfManufacture: string | null;
    customsAuthority: string | null;
    customersClearanceDate: string | null;
};

export type VerifyProductCodeResult = {
    status: VerifyProductCodeStatus;
    isValid: boolean;
    isPackCode: boolean;
    isDTSCode: boolean;
    pack: VerifyProductCodePack | null;
};

export type VerifyProductCodeInput = {
    scanCode: string;
    scanCustomerId: number; // TODO: from auth session
};
