/**
 * Single source of truth for this feature's enums.
 *
 * Every layer derives from these arrays — entities take their union type from
 * them, mappers validate against them, mock catalogs iterate them, and the
 * presentation filter options map over them. NEVER retype these literals
 * anywhere else; import from here instead.
 */

/** Confirmed verify product code statuses. */
export const VERIFY_PRODUCT_CODE_STATUS_VALUES = ['valid', 'invalid', 'notFound'] as const;

export type VerifyProductCodeStatus = (typeof VERIFY_PRODUCT_CODE_STATUS_VALUES)[number];
