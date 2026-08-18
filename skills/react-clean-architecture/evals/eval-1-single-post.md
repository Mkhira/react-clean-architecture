# Eval 1 — single POST on an external host (credentials in headers)

New feature, one external POST with `client_id`/`client_secret` headers, device/timestamp
provenance, and a status enum. Modelled on the shape of the real DTS scan case — **all values
below are fabricated**.

## User inputs

Feature name: `ProductVerification` (must not exist yet).

Curl paste:

```
curl --location 'https://api.example-dts.test/ECA/v2/scancode/savedetails' \
--header 'Content-Type: application/json' \
--header 'Accept: application/json' \
--header 'client_id: demo-client-id' \
--header 'client_secret: demo-client-secret' \
--header 'Authorization: Bearer eyFake' \
--data '{"ScanCode":"1234567890123456","ScanCodeType":"","ScanDateTime":"2025-01-01T00:00:00Z","ScanDeviceId":"device-1","ScanDeviceName":"Test Phone","ScanDeviceOS":"iOS","ScanDeviceOSVersion":"17.0","ScanDeviceLanguage":"English","ScanCustomerId":1}'
```

Response body: the `responseSample` of the first endpoint in
[../examples/feature-spec.example.json](../examples/feature-spec.example.json).

User story: "As a consumer I scan a product tax-stamp QR code so I can check the product is
genuine. The code must be exactly 16 characters after trimming; otherwise show a validation
error without calling the API."

Expected confirmation-table outcomes:
- Headers: Content-Type/Accept → `literal`; client_id/client_secret → `env`
  (`EXPO_PUBLIC_PRODUCT_VERIFICATION_*`); Authorization → `session` (excluded).
- Provenance: ScanCode → input · ScanCodeType → constant `""` · ScanDateTime → timestamp ·
  ScanDevice\* → device · ScanCustomerId → session.
- Status enum: `valid | invalid | notFound` on field `status`.

## Expected artifacts

- Spec ≈ endpoint 1 of `examples/feature-spec.example.json` (mode `create`).
- File manifest = the `ProductVerification` entries in `examples/expected-output/` for this
  endpoint + the feature-level files.
- DI: `TOKENS.ProductVerificationService/'IProductVerificationService'`,
  `...Repository`, `VerifyProductCodeUseCase`; container blocks service → repository → use case;
  registry use-case entry `IUseCase<VerifyProductCodeInput, Result<VerifyProductCodeResult, ProductVerificationError>>`.
- i18n: `productVerification` in `featureTranslations`.
- Env: 3 keys in all six env files; real values only in `.env` + `.env.development`.
- Claude fills: 16-char rule in the use case, status derivation in the mapper, rule test.

## Pass criteria

`audit.js <spec> --persist-spec` → PASS · tsc diff 0 new errors · feature jest suites green ·
persisted spec contains `<env:…>` references and no fabricated secret values.
