#!/usr/bin/env node
/**
 * generate.js — scaffold a clean-architecture feature from feature-spec.json.
 * Node stdlib only. Templates mirror the zatcaReact repo's VERIFIED patterns:
 * Result.ok/err, AppError-style typed error objects, ApiResponse `.data`,
 * useResolve controllers, cleanString/formatNumericGregorianDate mappers.
 *
 * Usage:
 *   node generate.js <feature-spec.json> [--repo <path>]   (--repo defaults to cwd)
 *   node generate.js --help
 *
 * - NEVER overwrites an existing file (reports it as skipped).
 * - Writes anchor comments so append mode can insert later.
 * - Append mode: creates per-endpoint files and inserts at anchors in
 *   endpoints.ts / service / repository / interfaces; missing anchors are
 *   reported under NEEDS_MANUAL.
 * - Emits a compact manifest to stdout and writes .claude-skill-manifest.json
 *   at the repo root (used by audit.js and for rollback).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { generateTypes } = require('./json-to-dto.js');

const HELP = `generate.js — scaffold a clean-architecture feature from feature-spec.json.

Usage:
  node generate.js <feature-spec.json> [--repo <path>]
  node generate.js --help

--repo defaults to the current working directory (run from the target repo root).
Never overwrites existing files. Prints a manifest of created/skipped/patched
files plus the list of use-case skeletons Claude must fill in.`;

// ---------------------------------------------------------------- naming ----

const pascal = (value) =>
    String(value)
        .replace(/[^a-zA-Z0-9]+(.)/g, (_, ch) => ch.toUpperCase())
        .replace(/^(.)/, (_, ch) => ch.toUpperCase());

const camel = (value) => {
    const p = pascal(value);
    return p.charAt(0).toLowerCase() + p.slice(1);
};

/** PascalCase / camelCase → SCREAMING_SNAKE */
const snakeUpper = (value) =>
    String(value)
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .toUpperCase();

/** "TaxValidation" → "Tax Validation" */
const titleWords = (value) => pascal(value).replace(/([a-z0-9])([A-Z])/g, '$1 $2');

const kebab = (value) => pascal(value).replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const quoteKey = (key) => (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key));

// ------------------------------------------------------------ spec model ----

function endpointModel(spec, endpoint) {
    const feature = pascal(spec.feature);
    const ActionPascal = pascal(endpoint.action);
    const hasBody = endpoint.requestSample != null;
    const hasResponse = endpoint.responseSample !== null && endpoint.responseSample !== undefined;
    const pathParams = endpoint.pathParams ?? [];
    const queryParams = endpoint.queryParams ?? [];
    const sources = endpoint.requestFieldSources ?? {};

    const inputFields = [];
    if (hasBody) {
        for (const [dtoField, source] of Object.entries(sources)) {
            const kind = typeof source === 'string' ? source : 'constant';
            if (kind === 'input' || kind === 'session') {
                const sampleValue = endpoint.requestSample?.[dtoField];
                const type =
                    typeof sampleValue === 'number' ? 'number'
                    : typeof sampleValue === 'boolean' ? 'boolean'
                    : 'string';
                inputFields.push({ name: camel(dtoField), dtoField, type, session: kind === 'session' });
            }
        }
    }
    for (const param of pathParams) inputFields.push({ name: camel(param.name), dtoField: null, type: param.type || 'string', session: false, pathParam: param.name });
    for (const param of queryParams) inputFields.push({ name: camel(param.name), dtoField: null, type: param.type || 'string', session: false, queryParam: param.name });

    const usesDevice = hasBody && Object.values(sources).includes('device');

    return {
        ...endpoint,
        feature,
        ActionPascal,
        actionCamel: camel(endpoint.action),
        endpointKey: snakeUpper(endpoint.action),
        hasBody,
        hasResponse,
        pathParams,
        queryParams,
        sources,
        inputFields,
        usesDevice,
        requestDTO: `${ActionPascal}RequestDTO`,
        responseDTO: `${ActionPascal}ResponseDTO`,
        entity: `${ActionPascal}Result`,
        input: `${ActionPascal}Input`,
        statusType: `${ActionPascal}Status`,
        // the shared values array in domain/constants that statusType derives from
        statusValues: `${snakeUpper(ActionPascal)}_STATUS_VALUES`,
        useCase: `${ActionPascal}UseCase`,
        mapper: `${ActionPascal}Mapper`,
        returnType: hasResponse ? `${ActionPascal}Result` : 'void',
    };
}

function featureModel(spec) {
    const feature = pascal(spec.feature);
    // design-only resume records carry no endpoints — lifecycle scripts
    // (remove/rename) must still be able to model them without crashing
    const endpoints = (spec.endpoints ?? []).map((endpoint) => endpointModel(spec, endpoint));
    return {
        feature,
        // On-disk directory name. The repo convention is kebab-case
        // (`src/features/application-status`), while every IDENTIFIER derived
        // from the feature stays PascalCase. Reviewers reject PascalCase dirs,
        // so never build a path from `feature` — always use `featureDir`.
        featureDir: kebab(spec.feature),
        featureCamel: camel(spec.feature),
        FEATURE_SNAKE: snakeUpper(spec.feature),
        // mock backend lane (spec.mock: true) — the real API doesn't exist yet:
        // a MockService is generated next to the real one and register-di.js
        // registers IT in the container, with a swap comment for later
        mock: spec.mock === true,
        mockServiceClass: `${feature}MockService`,
        // spec opt-out for a feature whose on-disk directory deliberately stays
        // off the kebab convention (pre-1.14.0 name, or a category subdirectory
        // like Signup/EstablishmentSignup) — see audit.js review-conventions
        legacyDir: spec.legacyDir === true,
        serviceClass: `${feature}Service`,
        repositoryClass: `${feature}Repository`,
        serviceInterface: `I${feature}Service`,
        repositoryInterface: `I${feature}Repository`,
        errorType: `${feature}Error`,
        errorCodes: `${feature.toUpperCase() === feature ? feature : snakeUpper(feature)}_ERROR_CODES`,
        errorCodeValues: `${feature.toUpperCase() === feature ? feature : snakeUpper(feature)}_ERROR_CODE_VALUES`,
        errorFactory: `create${feature}Error`,
        errorGuard: `is${feature}Error`,
        hasExternal: endpoints.some((endpoint) => endpoint.hostType === 'external'),
        hasApp: endpoints.some((endpoint) => endpoint.hostType === 'app'),
        usesDevice: endpoints.some((endpoint) => endpoint.usesDevice),
        endpoints,
    };
}

// ------------------------------------------------- per-endpoint templates ----

function dtoFile(f, e) {
    const parts = [];
    if (e.hasBody) {
        const request = generateTypes(e.requestSample, e.requestDTO, {});
        parts.push(request.code);
    }
    if (e.hasResponse) {
        const response = generateTypes(e.responseSample, e.responseDTO, e.typeOverrides ?? {});
        parts.push(response.code);
    }
    if (e.usesDevice) {
        parts.push(`export type DeviceMetadata = {
    id: string;
    name: string;
    os: string;
    osVersion: string;
    language: string;
};`);
    }
    return parts.join('\n\n') + '\n';
}

/** Entity fields: strings → cleaned `string | null`, dates formatted, camelCase. */
function entityShape(f, e, sample, typeName, dateFields, prefix) {
    const lines = [];
    const subTypes = [];
    const statusField = e.statusEnum ? camel(e.statusEnum.field) : null;

    for (const [key, value] of Object.entries(sample)) {
        const name = camel(key);
        const dotPath = prefix ? `${prefix}.${key}` : key;
        if (statusField && name === statusField && !prefix) continue; // replaced by the status union
        if (dateFields.includes(dotPath)) {
            lines.push(`    ${name}: string | null;`);
        } else if (value === null || value === undefined) {
            const override = (e.typeOverrides ?? {})[dotPath];
            if (override && /date/.test(override)) lines.push(`    ${name}: string | null;`);
            else if (override) lines.push(`    ${name}: ${override.includes('null') ? 'string | null' : override.replace(/\|/g, ' | ')};`);
            else lines.push(`    ${name}: unknown;`);
        } else if (typeof value === 'string') {
            lines.push(`    ${name}: string | null;`);
        } else if (typeof value === 'number') {
            lines.push(`    ${name}: number;`);
        } else if (typeof value === 'boolean') {
            lines.push(`    ${name}: boolean;`);
        } else if (Array.isArray(value)) {
            const first = value[0];
            if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
                const subName = `${e.ActionPascal}${pascal(key)}`;
                const sub = entityShape(f, e, first, subName, dateFields, dotPath);
                subTypes.push(...sub.subTypes, sub.decl);
                lines.push(`    ${name}: ${subName}[];`);
            } else if (typeof first === 'string') {
                lines.push(`    ${name}: string[];`);
            } else if (first === undefined) {
                lines.push(`    ${name}: unknown[];`);
            } else {
                lines.push(`    ${name}: ${typeof first}[];`);
            }
        } else if (typeof value === 'object') {
            const subName = `${e.ActionPascal}${pascal(key)}`;
            const sub = entityShape(f, e, value, subName, dateFields, dotPath);
            subTypes.push(...sub.subTypes, sub.decl);
            const nullable = ((e.typeOverrides ?? {})[dotPath] ?? '').includes('null');
            lines.push(`    ${name}: ${subName}${nullable ? ' | null' : ''};`);
        }
    }
    if (statusField && !prefix) {
        lines.unshift(`    ${statusField}: ${e.statusType};`);
    }
    return { decl: `export type ${typeName} = {\n${lines.join('\n')}\n};`, subTypes, lines };
}

/**
 * `domain/constants/<featureCamel>.ts` — the ONE place each status enum's values
 * live. Mappers, mock data, filter sheets and the entity union all derive from
 * these arrays. Reviewers reject the same literal array retyped per layer, so
 * this file exists whenever any endpoint declares a statusEnum.
 */
function domainConstantsFile(f) {
    const blocks = f.endpoints
        .filter((e) => e.statusEnum)
        .map((e) => {
            const values = e.statusEnum.values.map((value) => `'${value}'`).join(', ');
            return `/** Confirmed ${titleWords(e.ActionPascal).toLowerCase()} statuses. */
export const ${e.statusValues} = [${values}] as const;

export type ${e.statusType} = (typeof ${e.statusValues})[number];`;
        });
    return `/**
 * Single source of truth for this feature's enums.
 *
 * Every layer derives from these arrays — entities take their union type from
 * them, mappers validate against them, mock catalogs iterate them, and the
 * presentation filter options map over them. NEVER retype these literals
 * anywhere else; import from here instead.
 */

${blocks.join('\n\n')}
`;
}

function entityFile(f, e) {
    const parts = [];
    if (e.statusEnum) {
        // union comes from domain/constants — never re-declared as a literal here.
        // Imported (the entity's own fields reference it) AND re-exported, so
        // existing consumers can keep importing it from the entity module.
        parts.push(
            `import type { ${e.statusType} } from '../constants/${f.featureCamel}';\n` +
            `export type { ${e.statusType} };`
        );
    }
    if (e.hasResponse) {
        const sample = Array.isArray(e.responseSample) ? e.responseSample[0] ?? {} : e.responseSample;
        const rootName = Array.isArray(e.responseSample) ? `${e.ActionPascal}Item` : e.entity;
        const shape = entityShape(f, e, sample, rootName, e.dateFields ?? [], '');
        parts.push(...shape.subTypes, shape.decl);
        if (Array.isArray(e.responseSample)) {
            parts.push(`export type ${e.entity} = ${rootName}[];`);
        }
    }
    if (e.inputFields.length) {
        const lines = e.inputFields.map((field) =>
            `    ${field.name}: ${field.type};${field.session ? ' // TODO: from auth session' : ''}`
        );
        parts.push(`export type ${e.input} = {\n${lines.join('\n')}\n};`);
    }
    return parts.join('\n\n') + '\n';
}

function mapperToDomainBody(f, e) {
    const sample = Array.isArray(e.responseSample) ? e.responseSample[0] ?? {} : e.responseSample;
    const statusField = e.statusEnum ? camel(e.statusEnum.field) : null;
    const dateFields = e.dateFields ?? [];
    const helpers = [];

    // formatNumericGregorianDate takes `string | undefined`, so a nullable DTO
    // field must be coalesced or the generated mapper fails tsc
    const dateExpr = (source, key, nullable) =>
        `formatNumericGregorianDate(${source}.${key}${nullable ? ' ?? undefined' : ''})`;

    const fieldExpr = (key, value, source, dotPath) => {
        const override = (e.typeOverrides ?? {})[dotPath] ?? '';
        const nullable = value === null || /null/.test(override);
        if (dateFields.includes(dotPath)) return dateExpr(source, key, nullable);
        if (typeof value === 'string' || value === null) {
            if (/date/.test(override)) return dateExpr(source, key, nullable);
            if (typeof value === 'string' || /string/.test(override)) return `cleanString(${source}.${key})`;
            return `${source}.${key}`;
        }
        if (typeof value === 'number' || typeof value === 'boolean') return `${source}.${key}`;
        return null; // objects/arrays handled by caller
    };

    const objectMapping = (objectSample, source, prefix, dtoTypeName, entityTypeName, fnName) => {
        const lines = [];
        for (const [key, value] of Object.entries(objectSample)) {
            const name = camel(key);
            const dotPath = prefix ? `${prefix}.${key}` : key;
            if (statusField && name === statusField && !prefix) continue;
            const simple = fieldExpr(key, value, source, dotPath);
            if (simple) {
                lines.push(`        ${name}: ${simple},`);
            } else if (Array.isArray(value)) {
                const first = value[0];
                if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
                    const childFn = `to${e.ActionPascal}${pascal(key)}`;
                    const childDto = `${e.responseDTO.replace(/DTO$/, '')}${pascal(key)}ItemDTO`;
                    helpers.push(objectMappingFn(first, dotPath, childDto, `${e.ActionPascal}${pascal(key)}`, childFn));
                    lines.push(`        ${name}: (${source}.${key} ?? []).map(${childFn}),`);
                } else {
                    lines.push(`        ${name}: ${source}.${key} ?? [],`);
                }
            } else if (value !== null && typeof value === 'object') {
                const childFn = `to${e.ActionPascal}${pascal(key)}`;
                const childDto = `${e.responseDTO.replace(/DTO$/, '')}${pascal(key)}DTO`;
                helpers.push(objectMappingFn(value, dotPath, childDto, `${e.ActionPascal}${pascal(key)}`, childFn));
                const nullable = ((e.typeOverrides ?? {})[dotPath] ?? '').includes('null');
                // non-nullable nested objects map directly — a `: null` fallback
                // would contradict the entity type under strict TS
                lines.push(`        ${name}: ${nullable ? `${source}.${key} ? ${childFn}(${source}.${key}) : null` : `${childFn}(${source}.${key})`},`);
            }
        }
        return lines;
    };

    const objectMappingFn = (objectSample, prefix, dtoTypeName, entityTypeName, fnName) => {
        const lines = objectMapping(objectSample, 'dto', prefix, dtoTypeName, entityTypeName, fnName);
        return `const ${fnName} = (dto: ${dtoTypeName}): ${entityTypeName} => ({\n${lines.map((l) => l.slice(4)).join('\n')}\n});`;
    };

    let body;
    if (Array.isArray(e.responseSample)) {
        const itemFn = `to${e.ActionPascal}Item`;
        helpers.push(objectMappingFn(sample, '', `${e.responseDTO.replace(/DTO$/, '')}ItemDTO`, `${e.ActionPascal}Item`, itemFn));
        body = `        return dto.map(${itemFn});`;
    } else {
        const lines = objectMapping(sample, 'dto', '', e.responseDTO, e.entity, null);
        if (statusField) {
            lines.unshift(
                `        // TODO(claude): status derivation — map the response flags onto ${e.statusType}.`,
                `        // Validate against ${e.statusValues} imported from`,
                `        // '../../domain/constants/${f.featureCamel}' — never retype the value list here.`,
                `        ${statusField}: '${e.statusEnum.values[0]}',`
            );
        }
        body = `        return {\n${lines.map((l) => `    ${l}`).join('\n')}\n        };`;
    }
    return { body, helpers };
}

function mapperToDTOBody(f, e) {
    const lines = [];
    for (const [dtoField, source] of Object.entries(e.sources)) {
        const kind = typeof source === 'string' ? source : 'constant';
        const key = quoteKey(dtoField);
        if (kind === 'input') {
            lines.push(`            ${key}: input.${camel(dtoField)},`);
        } else if (kind === 'session') {
            lines.push(`            ${key}: input.${camel(dtoField)}, // TODO: from auth session`);
        } else if (kind === 'timestamp') {
            lines.push(`            ${key}: new Date().toISOString().replace(/\\.\\d{3}Z$/, 'Z'),`);
        } else if (kind === 'device') {
            const deviceField =
                /osversion$/i.test(dtoField) ? 'osVersion'
                : /os$/i.test(dtoField) ? 'os'
                : /language|locale$/i.test(dtoField) ? 'language'
                : /name$/i.test(dtoField) ? 'name'
                : /id$/i.test(dtoField) ? 'id'
                : null;
            lines.push(
                deviceField
                    ? `            ${key}: device.${deviceField},`
                    : `            ${key}: device.id, // TODO(claude): pick the right DeviceMetadata field`
            );
        } else {
            const constant = typeof source === 'object' && source !== null ? source.constant : source;
            lines.push(`            ${key}: ${JSON.stringify(constant)},`);
        }
    }
    return lines.join('\n');
}

function mapperFile(f, e) {
    const dtoImports = [];
    if (e.hasBody) dtoImports.push(e.requestDTO);
    if (e.hasResponse) dtoImports.push(e.responseDTO);
    if (e.usesDevice) dtoImports.push('DeviceMetadata');

    const entityImports = [];
    if (e.hasResponse) entityImports.push(e.entity);
    if (e.hasBody && e.inputFields.length) entityImports.push(e.input);

    let toDomainSection = '';
    let helpers = [];
    let needsDate = false;
    let needsClean = false;
    if (e.hasResponse) {
        const { body, helpers: mappingHelpers } = mapperToDomainBody(f, e);
        helpers = mappingHelpers;
        needsDate = /formatNumericGregorianDate\(/.test(body + mappingHelpers.join(''));
        needsClean = /cleanString\(/.test(body + mappingHelpers.join(''));
        // sub-mapper DTO types must be imported too
        for (const helper of mappingHelpers) {
            const match = helper.match(/dto: (\w+)\)/);
            if (match && !dtoImports.includes(match[1])) dtoImports.push(match[1]);
            const entityMatch = helper.match(/\): (\w+) =>/);
            if (entityMatch && !entityImports.includes(entityMatch[1])) entityImports.push(entityMatch[1]);
        }
        if (Array.isArray(e.responseSample) && !entityImports.includes(`${e.ActionPascal}Item`)) {
            entityImports.push(`${e.ActionPascal}Item`);
        }
        toDomainSection = `    toDomain(dto: ${e.responseDTO}): ${e.entity} {\n${mapperToDomainBody(f, e).body}\n    },`;
    }

    let toDTOSection = '';
    if (e.hasBody) {
        const deviceParam = e.usesDevice ? `, device: DeviceMetadata` : '';
        toDTOSection = `    toDTO(input: ${e.input}${deviceParam}): ${e.requestDTO} {\n        return {\n${mapperToDTOBody(f, e)}\n        };\n    },`;
    }

    const importLines = [
        `import type {\n    ${[...new Set(dtoImports)].join(',\n    ')},\n} from '../dtos/${e.ActionPascal}DTO';`,
    ];
    if (entityImports.length) {
        importLines.push(
            `import type {\n    ${[...new Set(entityImports)].join(',\n    ')},\n} from '../../domain/entities/${e.entity}';`
        );
    }
    if (needsDate) importLines.push(`import { formatNumericGregorianDate } from '@shared/utils/dateFormat';`);

    const cleanHelper = needsClean
        ? `\nconst cleanString = (value: string | null | undefined): string | null => value?.trim() || null;\n`
        : '';

    return `${importLines.join('\n')}\n${cleanHelper}${helpers.length ? '\n' + helpers.join('\n\n') + '\n' : ''}
export const ${e.mapper} = {
${[toDomainSection, toDTOSection].filter(Boolean).join('\n\n')}
};
`;
}

// ------------------------------------------------ feature-level templates ----

function endpointsFile(f) {
    const entries = f.endpoints.map((e) => {
        if (e.pathParams.length) {
            const args = e.pathParams.map((p) => `${camel(p.name)}: ${p.type || 'string'}`).join(', ');
            const templatePath = e.path.replace(/\{(\w+)\}/g, (_, name) => '${' + camel(name) + '}');
            return `    ${e.endpointKey}: (${args}) => ` + '`' + templatePath + '`' + ',';
        }
        return `    ${e.endpointKey}: '${e.path}',`;
    });
    return `export const ${f.FEATURE_SNAKE}_ENDPOINTS = {
${entries.join('\n')}
    // <create-feature:endpoints>
};
`;
}

function serviceMethodArgs(e) {
    // path params ALWAYS come through — the endpoint URL expression needs them
    // regardless of whether a body is present
    const args = e.pathParams.map((p) => `${camel(p.name)}: ${p.type || 'string'}`);
    // domain input, NOT the transport DTO — the IService contract only speaks
    // domain types (the service converts via mapper.toDTO)
    if (e.hasBody) args.push(`input: ${e.input}`);
    if (e.queryParams.length) {
        const queryFields = e.queryParams.map((p) => `${camel(p.name)}: ${p.type || 'string'}`).join('; ');
        args.push(`query: { ${queryFields} }`);
    }
    return args;
}

function endpointUrlExpr(f, e) {
    return e.pathParams.length
        ? `${f.FEATURE_SNAKE}_ENDPOINTS.${e.endpointKey}(${e.pathParams.map((p) => camel(p.name)).join(', ')})`
        : `${f.FEATURE_SNAKE}_ENDPOINTS.${e.endpointKey}`;
}

/**
 * Body endpoints: the service (data layer) converts the domain input into the
 * transport payload — the DTO never crosses into the service contract's signatures.
 */
function payloadBuildLines(e) {
    if (!e.hasBody) return '';
    const deviceLine = e.usesDevice ? `        const device = await this.getDeviceMetadata();\n` : '';
    const deviceArg = e.usesDevice ? ', device' : '';
    return `${deviceLine}        const payload = ${e.mapper}.toDTO(input${deviceArg});\n`;
}

/**
 * Private device-metadata helper, emitted in the SERVICE class (it owns toDTO).
 * Sources: the DI-registered TaxpayerAuthDeviceContextService (id/name/platform),
 * react-native Platform (OS version), and the stored app language.
 */
function deviceMetadataHelper(f) {
    return f.usesDevice
        ? `
    private async getDeviceMetadata(): Promise<DeviceMetadata> {
        const context = await this.deviceContext.getContext();
        const language = String((await getStoredLanguage()) ?? 'ar');

        return {
            id: context.deviceId,
            name: context.deviceName,
            os: context.devicePlatform,
            osVersion: String(Platform.Version),
            language,
        };
    }
`
        : '';
}

/** Imports the device helper needs (service file + append mode). */
function deviceHelperImports(dtoActionPascal) {
    return [
        `import { Platform } from 'react-native';`,
        `import { getStoredLanguage } from '@core/localization/i18n';`,
        `import type { ITaxpayerAuthDeviceContextService } from '@core/device/ITaxpayerAuthDeviceContextService';`,
        `import type { DeviceMetadata } from '../dtos/${dtoActionPascal}DTO';`,
    ];
}

function appServiceMethod(f, e) {
    const args = serviceMethodArgs(e).join(', ');
    const urlExpr = endpointUrlExpr(f, e);
    // the app's HttpClient maps INSIDE the envelope interceptor (and warns when
    // no mapper is given) — pass the domain mapper in the config, so the
    // generic is the DOMAIN type and response.data is already mapped
    const generic = e.hasResponse ? e.returnType : 'void';
    const configEntries = [];
    if (e.hasResponse) configEntries.push(`mapper: ${e.mapper}.toDomain`);
    if (e.queryParams.length) configEntries.push('params: query');
    const config = configEntries.length ? `, { ${configEntries.join(', ')} }` : '';
    let call;
    if (e.method === 'GET') {
        call = `await this.httpClient.get<${generic}>(${urlExpr}${config})`;
    } else if (e.method === 'POST') {
        call = `await this.httpClient.post<${generic}>(${urlExpr}, ${e.hasBody ? 'payload' : 'undefined'}${config})`;
    } else {
        // PUT/DELETE — IHttpClient must expose them (SKILL.md step: mirror get/post if commented out)
        call = `await this.httpClient.${e.method.toLowerCase()}<${generic}>(${urlExpr}${e.method === 'PUT' ? `, ${e.hasBody ? 'payload' : 'undefined'}` : ''}${config})`;
    }
    const body = e.hasResponse
        ? `        const response = ${call};\n        return response.data;`
        : `        ${call};`;
    return `    async ${e.actionCamel}(${args}): Promise<${e.returnType}> {\n${payloadBuildLines(e)}${body}\n    }`;
}

/**
 * Shared transport helpers, emitted ONCE per service that has external
 * endpoints — every external method delegates here so the abort/timeout and
 * NETWORK/HTTP/PARSE error-mapping policy lives in exactly one place.
 */
function externalServiceHelpers(f) {
    const parseHelper = f.endpoints.some((e) => e.hostType === 'external' && e.hasResponse)
        ? `

    private async parseExternalJson<TResponseDTO>(action: string, response: Response): Promise<TResponseDTO> {
        try {
            return (await response.json()) as TResponseDTO;
        } catch (error) {
            throw ${f.errorFactory}('VALIDATION_ERROR', \`\${action} response was not valid JSON\`, error);
        }
    }`
        : '';
    return `    private async requestExternal(
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
            throw ${f.errorFactory}('NETWORK_ERROR', \`\${action} request failed\`, error);
        } finally {
            clearTimeout(timer);
        }
        if (!response.ok) {
            const text = await response.text();
            throw ${f.errorFactory}('NETWORK_ERROR', \`\${action} HTTP \${response.status}: \${text}\`);
        }
        return response;
    }${parseHelper}`;
}

function externalServiceMethod(f, e) {
    const args = serviceMethodArgs(e).join(', ');
    const baseField = e.baseUrl.configField;
    const envHeaderFields = (e.headers ?? []).filter((h) => h.source === 'env').map((h) => h.configField);
    const destructured = [...new Set([baseField, ...envHeaderFields])].join(', ');

    const headerLines = (e.headers ?? [])
        .filter((h) => h.source !== 'session')
        .map((h) => {
            const key = quoteKey(h.name);
            return h.source === 'env' ? `                ${key}: ${h.configField},` : `                ${key}: ${JSON.stringify(h.value)},`;
        });

    const urlExpr = endpointUrlExpr(f, e);
    let urlBuild;
    if (e.queryParams.length) {
        urlBuild =
            `        const queryString = Object.entries(query)\n` +
            `            .filter(([, value]) => value !== undefined && value !== '')\n` +
            '            .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)\n' +
            `            .join('&');\n` +
            '        const url = `${' + baseField + '}${' + urlExpr + '}${queryString ? `?${queryString}` : \'\'}`;';
    } else {
        urlBuild = '        const url = `${' + baseField + '}${' + urlExpr + '}`;';
    }

    const callPrefix = e.hasResponse ? 'const response = ' : '';
    const requestLines = [
        `        ${callPrefix}await this.requestExternal('${e.actionCamel}', url, {`,
        `            method: '${e.method}',`,
        `            headers: {`,
        ...headerLines,
        `            },`,
    ];
    if (e.hasBody) requestLines.push(`            body: JSON.stringify(payload),`);
    requestLines.push(`        });`);

    const resultSection = e.hasResponse
        ? `\n        const dto = await this.parseExternalJson<${e.responseDTO}>('${e.actionCamel}', response);
        return ${e.mapper}.toDomain(dto);`
        : '';

    return `    async ${e.actionCamel}(${args}): Promise<${e.returnType}> {
        const { ${destructured} } = this.configService.get();
${urlBuild}
${payloadBuildLines(e)}${requestLines.join('\n')}${resultSection}
    }`;
}

function serviceFile(f) {
    const methods = f.endpoints.map((e) => (e.hostType === 'external' ? externalServiceMethod(f, e) : appServiceMethod(f, e)));

    const ctorParams = [];
    if (f.hasApp) ctorParams.push('private readonly httpClient: IHttpClient');
    if (f.hasExternal) ctorParams.push('private readonly configService: IConfigService');

    const imports = [];
    if (f.hasApp) imports.push(`import type { IHttpClient } from '@core/http/IHttpClient';`);
    if (f.hasExternal) imports.push(`import type { IConfigService } from '@core/config/IConfigService';`);
    imports.push(`import type { ${f.serviceInterface} } from '../IServices/${f.serviceInterface}';`);
    imports.push(`import { ${f.FEATURE_SNAKE}_ENDPOINTS } from '../endpoints/endpoints';`);
    if (f.hasExternal) imports.push(`import { ${f.errorFactory} } from '../../domain/errors/${f.errorType}';`);
    for (const e of f.endpoints) {
        // the ResponseDTO is only referenced by external methods (parseExternalJson);
        // app-host methods map inside the HttpClient config. The RequestDTO
        // stays internal to mapper.toDTO — the service receives the domain input
        if (e.hasResponse && e.hostType === 'external') {
            imports.push(`import type { ${e.responseDTO} } from '../dtos/${e.ActionPascal}DTO';`);
        }
        const entityNames = [
            e.hasResponse ? e.entity : null,
            e.hasBody && e.inputFields.length ? e.input : null,
        ].filter(Boolean);
        if (entityNames.length) imports.push(`import type { ${entityNames.join(', ')} } from '../../domain/entities/${e.entity}';`);
        if (e.hasResponse || e.hasBody) imports.push(`import { ${e.mapper} } from '../mappers/${e.mapper}';`);
    }
    if (f.usesDevice) {
        imports.push(...deviceHelperImports(f.endpoints.find((e) => e.usesDevice).ActionPascal));
        ctorParams.push('private readonly deviceContext: ITaxpayerAuthDeviceContextService');
    }

    const helpers = f.hasExternal ? `${externalServiceHelpers(f)}\n\n` : '';

    return `${[...new Set(imports)].join('\n')}

export class ${f.serviceClass} implements ${f.serviceInterface} {
    constructor(${ctorParams.length ? `\n        ${ctorParams.join(',\n        ')},\n    ` : ''}) {}
${deviceMetadataHelper(f)}
${helpers}${methods.join('\n\n')}

    // <create-feature:methods>
}
`;
}

/**
 * Mock lane (spec.mock: true): one method per endpoint, same signature as the
 * real service. DTO-level samples (the spec's responseSample) flow through the
 * REAL mappers, so the domain layer stays fully exercised while the backend
 * doesn't exist. Claude then enriches the sample catalog by hand to cover the
 * story's filters/states (see SKILL.md Step 5.3).
 */
function mockServiceMethod(f, e) {
    // underscore-prefix: the generated skeleton ignores its inputs — Claude
    // renames them when the enriched mock starts filtering/paginating
    const args = serviceMethodArgs(e).map((arg) => `_${arg}`).join(', ');
    const body = e.hasResponse
        ? `        await mockDelay();\n        return ${e.mapper}.toDomain(${e.endpointKey}_SAMPLE);`
        : `        await mockDelay();`;
    return `    async ${e.actionCamel}(${args}): Promise<${e.returnType}> {\n${body}\n    }`;
}

function mockServiceFile(f) {
    const imports = [
        `import type { ${f.serviceInterface} } from '../IServices/${f.serviceInterface}';`,
    ];
    for (const e of f.endpoints) {
        if (e.hasResponse) {
            imports.push(`import type { ${e.responseDTO} } from '../dtos/${e.ActionPascal}DTO';`);
            imports.push(`import { ${e.mapper} } from '../mappers/${e.mapper}';`);
        }
        const entityNames = [
            e.hasResponse ? e.entity : null,
            e.hasBody && e.inputFields.length ? e.input : null,
        ].filter(Boolean);
        if (entityNames.length) imports.push(`import type { ${entityNames.join(', ')} } from '../../domain/entities/${e.entity}';`);
    }
    const samples = f.endpoints
        .filter((e) => e.hasResponse)
        .map((e) => `const ${e.endpointKey}_SAMPLE: ${e.responseDTO} = ${JSON.stringify(e.responseSample, null, 4)};`);

    return `${[...new Set(imports)].join('\n')}

/**
 * MOCK implementation of ${f.serviceInterface} — the real backend does not
 * exist yet (spec.mock). DTO-level samples flow through the REAL mappers so
 * DTOs, mappers, and entities stay exercised end-to-end.
 *
 * When the real API is live: in src/core/di/container.ts swap the
 * TOKENS.${f.feature}Service registration back to ${f.serviceClass} (resolve its
 * HttpClient/ConfigService dependencies like other features do), then delete
 * this file.
 *
 * TODO(claude): enrich the sample catalog to cover the user story's filters,
 * states, and pagination — a single sample item is a compile-time skeleton,
 * not a usable mock.
 */
const MOCK_DELAY_MS = 400;
const mockDelay = () => new Promise<void>((resolve) => setTimeout(resolve, MOCK_DELAY_MS));

${samples.length ? samples.join('\n\n') + '\n\n' : ''}export class ${f.mockServiceClass} implements ${f.serviceInterface} {
${f.endpoints.map((e) => mockServiceMethod(f, e)).join('\n\n')}

    // <create-feature:methods>
}
`;
}

function repositoryMethod(f, e) {
    const inputArg = e.inputFields.length ? `input: ${e.input}` : '';
    // mirror serviceMethodArgs exactly: path params, then the domain input,
    // then query — the DTO conversion lives in the service, not here
    const callArgs = [
        ...e.pathParams.map((p) => `input.${camel(p.name)}`),
        ...(e.hasBody ? ['input'] : []),
        ...(e.queryParams.length
            ? [`{ ${e.queryParams.map((p) => `${camel(p.name)}: input.${camel(p.name)}`).join(', ')} }`]
            : []),
    ].join(', ');

    return `    async ${e.actionCamel}(${inputArg}): Promise<${e.returnType}> {
        return this.apiService.${e.actionCamel}(${callArgs});
    }`;
}

function repositoryFile(f) {
    const imports = [
        `import type { ${f.repositoryInterface} } from '../../domain/IRepositories/${f.repositoryInterface}';`,
        `import type { ${f.serviceInterface} } from '../IServices/${f.serviceInterface}';`,
    ];
    for (const e of f.endpoints) {
        const names = [e.hasResponse ? e.entity : null, e.inputFields.length ? e.input : null].filter(Boolean);
        if (names.length) imports.push(`import type { ${names.join(', ')} } from '../../domain/entities/${e.entity}';`);
    }

    return `${[...new Set(imports)].join('\n')}

export class ${f.repositoryClass} implements ${f.repositoryInterface} {
    constructor(private readonly apiService: ${f.serviceInterface}) {}

${f.endpoints.map((e) => repositoryMethod(f, e)).join('\n\n')}

    // <create-feature:methods>
}
`;
}

function serviceInterfaceFile(f) {
    const imports = [];
    const signatures = f.endpoints.map((e) => {
        const args = serviceMethodArgs(e).join(', ');
        // signatures speak domain entities, never transport DTOs — the file
        // lives in data/IServices (a data-layer contract: only the repository
        // impl consumes it), but its imports point at domain only
        const names = [e.hasBody && e.inputFields.length ? e.input : null, e.hasResponse ? e.entity : null].filter(Boolean);
        if (names.length) imports.push(`import type { ${names.join(', ')} } from '../../domain/entities/${e.entity}';`);
        return `    ${e.actionCamel}(${args}): Promise<${e.returnType}>;`;
    });
    return `${[...new Set(imports)].join('\n')}

export interface ${f.serviceInterface} {
${signatures.join('\n')}
    // <create-feature:signatures>
}
`;
}

function repositoryInterfaceFile(f) {
    const imports = [];
    const signatures = f.endpoints.map((e) => {
        const names = [e.inputFields.length ? e.input : null, e.hasResponse ? e.entity : null].filter(Boolean);
        if (names.length) imports.push(`import type { ${names.join(', ')} } from '../entities/${e.entity}';`);
        return `    ${e.actionCamel}(${e.inputFields.length ? `input: ${e.input}` : ''}): Promise<${e.returnType}>;`;
    });
    return `${[...new Set(imports)].join('\n')}

export interface ${f.repositoryInterface} {
${signatures.join('\n')}
    // <create-feature:signatures>
}
`;
}

function errorsFile(f) {
    return `import type { AppError } from '@shared/types/errors';

// The feature reuses the app-wide error contract as-is. AppError's code union
// (src/shared/types/errors.ts) is the ONLY allowed set — do not invent feature
// codes like HTTP_ERROR/PARSE_ERROR and do not widen the type with
// Omit<AppError, 'code'>: reviewers reject both. Map transport failures onto
// these four (a bad payload is VALIDATION_ERROR, a bad response is
// NETWORK_ERROR). If a genuinely new code is needed, add it to AppError itself
// so every feature shares it.
export const ${f.errorCodeValues} = [
    'NETWORK_ERROR',
    'AUTH_ERROR',
    'TIMEOUT',
    'VALIDATION_ERROR',
] as const satisfies readonly AppError['code'][];

export type ${f.errorCodes} = (typeof ${f.errorCodeValues})[number];

export type ${f.errorType} = AppError;

export const ${f.errorFactory} = (
    code: ${f.errorCodes},
    message: string,
    originalError?: unknown
): ${f.errorType} => ({ code, message, originalError });

export const ${f.errorGuard} = (error: unknown): error is ${f.errorType} =>
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    ${f.errorCodeValues}.includes((error as { code?: unknown }).code as ${f.errorCodes});
`;
}

function useCaseFile(f, e) {
    const storyComment = e.userStory
        ? `/**\n * User story:\n${String(e.userStory).trim().split('\n').map((line) => ` * ${line}`.trimEnd()).join('\n')}\n */\n`
        : '';
    const rulesComment = (e.rules ?? []).length
        ? `        // TODO(claude): implement business rules:\n${e.rules.map((rule) => `        //   - ${rule}`).join('\n')}\n`
        : `        // TODO(claude): business rules (user story was skipped)\n`;

    const resultType = `Result<${e.returnType}, ${f.errorType}>`;
    const interfaceName = e.inputFields.length ? 'IUseCase' : 'IUseCaseNoParams';
    const implementsClause = e.inputFields.length
        ? `IUseCase<${e.input}, ${resultType}>`
        : `IUseCaseNoParams<${resultType}>`;
    const executeArg = e.inputFields.length ? `input: ${e.input}` : '';
    const repoArg = e.inputFields.length ? 'input' : '';

    const entityImports = [e.hasResponse ? e.entity : null, e.inputFields.length ? e.input : null].filter(Boolean);

    const okExpr = e.hasResponse ? 'Result.ok(result)' : 'Result.ok(undefined)';
    const callLine = e.hasResponse
        ? `            const result = await this.repository.${e.actionCamel}(${repoArg});\n            return ${okExpr};`
        : `            await this.repository.${e.actionCamel}(${repoArg});\n            return ${okExpr};`;

    return `import { ${interfaceName} } from '@domain/shared/IUseCase';
import { Result } from '@shared/types/Result';
import type { ILogger } from '@core/logging/ILogger';
import type { ${f.repositoryInterface} } from '../IRepositories/${f.repositoryInterface}';
${entityImports.length ? `import type { ${entityImports.join(', ')} } from '../entities/${e.entity}';\n` : ''}import { ${f.errorFactory}, ${f.errorGuard}, type ${f.errorType} } from '../errors/${f.errorType}';

${storyComment}export class ${e.useCase} implements ${implementsClause} {
    constructor(
        private readonly repository: ${f.repositoryInterface},
        private readonly logger: ILogger
    ) {}

    async execute(${executeArg}): Promise<${resultType}> {
${rulesComment}        try {
${callLine}
        } catch (error) {
            // never swallow a failure silently — reviewers require the log
            this.logger.exception('${e.actionCamel} failed', error);
            if (${f.errorGuard}(error)) {
                return Result.err(error);
            }
            // classify the transport failure instead of collapsing everything to
            // NETWORK_ERROR: axios rejections carry response.status / code, and
            // app-host envelope rejections carry header.status.description
            const transport = error as {
                response?: { status?: number };
                code?: string;
                header?: { status?: { description?: string } };
            };
            const httpStatus = transport?.response?.status;
            if (httpStatus === 401 || httpStatus === 403) {
                return Result.err(${f.errorFactory}('AUTH_ERROR', '${e.actionCamel} unauthorized', error));
            }
            if (transport?.code === 'ECONNABORTED' || transport?.code === 'ETIMEDOUT') {
                return Result.err(${f.errorFactory}('TIMEOUT', '${e.actionCamel} timed out', error));
            }
            const description = transport?.header?.status?.description;
            return Result.err(${f.errorFactory}('NETWORK_ERROR', description || '${e.actionCamel} failed', error));
        }
    }
}
`;
}

// ---------------------------------------------------- presentation files ----

/** Query-key constant name in src/data/services/keys.ts for one endpoint. */
function queryKeyName(f, e) {
    return `${f.FEATURE_SNAKE}_${e.endpointKey}`;
}

/** Kebab-case query-key value ("integrated-tariff-sections" style). */
function queryKeyValue(f, e) {
    return `${kebab(f.feature)}-${kebab(e.ActionPascal)}`;
}

/** Type imports one query hook needs (appended via ensureImports on append). */
function queryHookImports(f, e) {
    return e.inputFields.length
        ? [`import type { ${e.input} } from '../domain/entities/${e.entity}';`]
        : [];
}

/** One GET endpoint's query hook (used by create's queriesFile AND append). */
function queryHookSnippet(f, e) {
    const key = `QUERIES_KEYS.${queryKeyName(f, e)}`;
    // cache semantics (see SPEC_FORMAT.md): a duration → persistent device
    // cache (useApiQuery storeDuration); "always-fresh" → kill even the
    // app-wide 5-min in-memory staleTime so every mount/param-change refetches;
    // null → no device cache, in-memory react-query defaults still apply.
    const cacheOption =
        e.cache === 'always-fresh' ? 'staleTime: 0'
        : e.cache ? `storeDuration: '${e.cache}'`
        : null;
    if (!e.inputFields.length) {
        const options = cacheOption ? `,\n        { ${cacheOption} }` : '';
        return `export const use${e.ActionPascal}Query = () => {
    const ${e.actionCamel}UseCase = useResolve(TOKENS.${e.useCase});

    return useApiQuery(
        [${key}],
        async () => {
            const outcome = await ${e.actionCamel}UseCase.execute();
            if (Result.isErr(outcome)) throw outcome.error;
            return outcome.data;
        }${options}
    );
};`;
    }
    const optionEntries = [`enabled: options?.enabled ?? true`, cacheOption].filter(Boolean);
    return `export const use${e.ActionPascal}Query = (input: ${e.input}, options?: { enabled?: boolean }) => {
    const ${e.actionCamel}UseCase = useResolve(TOKENS.${e.useCase});

    return useApiQuery(
        [${key}, input],
        async () => {
            const outcome = await ${e.actionCamel}UseCase.execute(input);
            if (Result.isErr(outcome)) throw outcome.error;
            return outcome.data;
        },
        { ${optionEntries.join(', ')} }
    );
};`;
}

/**
 * React Query bindings — one hook per GET endpoint, matching the app pattern
 * (integrated-tariff): resolve the use case via DI, unwrap the Result so
 * react-query owns error state, cache via storeDuration when the spec asks.
 */
function queriesFile(f) {
    const gets = f.endpoints.filter((e) => e.method === 'GET');
    const inputImports = gets.flatMap((e) => queryHookImports(f, e));

    return `/**
 * ${f.feature} — React Query bindings.
 *
 * The presentation layer owns all server-state hooks; each hook resolves its
 * use case through DI and unwraps the Result so react-query owns error state.
 */

import QUERIES_KEYS from '@data/services/keys';
import { useApiQuery } from '@shared/hooks/useApiQuery';
import { useResolve } from '@shared/hooks/useResolve';
import { TOKENS } from '@core/di/tokens';
import { Result } from '@shared/types/Result';
${inputImports.length ? inputImports.join('\n') + '\n' : ''}
${gets.map((e) => queryHookSnippet(f, e)).join('\n\n')}

// <create-feature:queries>
`;
}

function controllerFile(f) {
    const first = f.endpoints[0];
    const others = f.endpoints.slice(1);
    const firstIsGetQuery = first.method === 'GET';

    const otherLines = others
        .map((e) => e.method === 'GET'
            ? `    // const { data: ${e.actionCamel}Result } = use${e.ActionPascal}Query(${e.inputFields.length ? '/* input */' : ''});`
            : `    // const ${e.actionCamel}UseCase = useResolve(TOKENS.${e.useCase});`)
        .join('\n');

    if (firstIsGetQuery) {
        const wired = !first.inputFields.length;
        const queryBlock = wired
            ? `    const {
        data: ${first.actionCamel}Result,
        isLoading,
        isError,
    } = use${first.ActionPascal}Query();`
            : `    // TODO(claude): wire the query once the screen knows its input values:
    // const { data: ${first.actionCamel}Result, isLoading, isError } = use${first.ActionPascal}Query({ /* input */ });`;
        const returnExtras = wired ? `${first.actionCamel}Result, isLoading, isError, ` : '';
        const queryImport = wired ? `import { use${first.ActionPascal}Query } from './queries';\n` : '';
        return `import React from 'react';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@core/theme/ThemeContext';
${queryImport}import { createStyles } from './styles';

/**
 * Screen controller — server state flows through the query hooks (./queries);
 * this hook owns UI state and derived values only.
 */
export function useController() {
    const theme = useTheme();
    const styles = React.useMemo(() => createStyles(theme), [theme]);
    const { t } = useTranslation();

${queryBlock}
${otherLines}${others.length ? '\n' : ''}
    return { styles, t, theme, ${returnExtras}};
}
`;
    }

    const typeImports = [first.hasResponse ? first.entity : null, first.inputFields.length ? first.input : null].filter(Boolean);
    const resultState = first.hasResponse
        ? `    const [result, setResult] = React.useState<${first.entity} | null>(null);\n`
        : '';
    const okBranch = first.hasResponse ? `            setResult(outcome.data);` : `            // success — no payload for this endpoint`;
    const runnerArg = first.inputFields.length ? `input: ${first.input}` : '';
    const runnerCall = first.inputFields.length ? 'input' : '';

    return `import React from 'react';
import { useTranslation } from 'react-i18next';
import { createLogger } from '@core/logging/LoggerService';
import { useTheme } from '@core/theme/ThemeContext';
import { TOKENS } from '@core/di/tokens';
import { useResolve } from '@shared/hooks/useResolve';
import { Result } from '@shared/types/Result';
${typeImports.length ? `import type { ${typeImports.join(', ')} } from '../domain/entities/${first.entity}';\n` : ''}import type { ${f.errorType} } from '../domain/errors/${f.errorType}';
import { createStyles } from './styles';

const logger = createLogger('${f.feature}');

export function useController() {
    const ${first.actionCamel}UseCase = useResolve(TOKENS.${first.useCase});
${otherLines}${others.length ? '\n' : ''}    const theme = useTheme();
    const styles = React.useMemo(() => createStyles(theme), [theme]);
    const { t } = useTranslation();
${resultState}    const [error, setError] = React.useState<${f.errorType} | null>(null);
    const [isLoading, setIsLoading] = React.useState(false);

    const ${first.actionCamel} = React.useCallback(async (${runnerArg}) => {
        setIsLoading(true);
        setError(null);
        const outcome = await ${first.actionCamel}UseCase.execute(${runnerCall});
        if (Result.isOk(outcome)) {
${okBranch}
        } else {
            // third arg = data → shows in the console (the second only reaches crash reporting)
            logger.error('${first.actionCamel} failed', outcome.error, outcome.error);
            setError(outcome.error);
        }
        setIsLoading(false);
    }, [${first.actionCamel}UseCase]);

    return { styles, t, theme, ${first.hasResponse ? 'result, ' : ''}error, isLoading, ${first.actionCamel} };
}
`;
}

function screenFile(f) {
    return `import React from 'react';
import { View } from 'react-native';
import { Label } from '@shared/components';
import { useController } from '../controller';

/** Starter screen — the design lane (DESIGN.md) replaces this with the Figma build. */
export default function ${f.feature}Screen() {
    const { styles, t } = useController();

    return (
        <View style={styles.container}>
            <Label type="h2Header">{t('${f.featureCamel}.title')}</Label>
        </View>
    );
}
`;
}

function stylesFile() {
    return `import { StyleSheet } from 'react-native';
import { Theme } from '@core/theme/types';

export const createStyles = (theme: Theme) =>
    StyleSheet.create({
        // every value here is a theme token — reviewers reject raw numbers and
        // raw RN keywords in styles. Missing token? add it to
        // src/core/theme/baseStyles.ts (+ the Theme type) and use it from there.
        container: {
            flex: theme.flex1,
            backgroundColor: theme.colors.background,
            padding: theme.spacing.md,
        },
    });
`;
}


// TS modules with a default-export barrel — the app convention (see
// integrated-tariff/presentation/translations and core/localization/merger.ts).
function translationsEn(f) {
    return `export default {
    title: '${titleWords(f.feature)}',
    errors: {
        network: 'Something went wrong. Please try again.',
        validation: 'Please check your input and try again.',
    },
};
`;
}

function translationsAr(f) {
    // Values are filled from the user story's Arabic strings when available —
    // Claude replaces these placeholders right after generation.
    return `export default {
    title: '${titleWords(f.feature)}',
    errors: {
        network: 'حدث خطأ ما، يرجى المحاولة مرة أخرى.',
        validation: 'يرجى التحقق من البيانات المدخلة والمحاولة مرة أخرى.',
    },
};
`;
}

function translationsIndex() {
    return `import ar from './ar.ts';
import en from './en.ts';

export default { ar, en };
`;
}

// ---------------------------------------------------------------- tests ----

function expectedCleaned(value) {
    return typeof value === 'string' ? (value.trim() || null) : value;
}

function mapperTestFile(f, e) {
    const sample = e.hasResponse
        ? (Array.isArray(e.responseSample) ? e.responseSample[0] ?? {} : e.responseSample)
        : {};
    const statusField = e.statusEnum ? camel(e.statusEnum.field) : null;
    const dateFields = e.dateFields ?? [];
    const asserts = [];
    const accessor = Array.isArray(e.responseSample) ? 'mapped[0]' : 'mapped';
    const sampleAccessor = Array.isArray(e.responseSample) ? 'SAMPLE[0]' : 'SAMPLE';

    let needsDateImport = false;
    for (const [key, value] of Object.entries(sample)) {
        const name = camel(key);
        if (statusField && name === statusField) continue;
        if (dateFields.includes(key)) {
            asserts.push(`        expect(${accessor}.${name}).toBe(formatNumericGregorianDate(${sampleAccessor}.${quoteKey(key)}));`);
            needsDateImport = true;
        } else if (typeof value === 'string') {
            asserts.push(`        expect(${accessor}.${name}).toBe(${JSON.stringify(expectedCleaned(value))});`);
        } else if (typeof value === 'number' || typeof value === 'boolean') {
            asserts.push(`        expect(${accessor}.${name}).toBe(${JSON.stringify(value)});`);
        } else if (Array.isArray(value)) {
            asserts.push(`        expect(${accessor}.${name}).toHaveLength(${value.length});`);
        } else if (value === null) {
            // typed via override; runtime shape untestable from a null sample — skip
        }
    }
    if (statusField) {
        asserts.push(`        expect(${JSON.stringify(e.statusEnum.values)}).toContain(${accessor}.${statusField});`);
    }

    let toDTOTest = '';
    if (e.hasBody) {
        const inputLiteral = e.inputFields
            .filter((field) => field.dtoField)
            .map((field) => {
                const sampleValue = e.requestSample?.[field.dtoField];
                return `            ${field.name}: ${JSON.stringify(sampleValue ?? (field.type === 'number' ? 0 : ''))},`;
            })
            .join('\n');
        const paramFields = e.inputFields.filter((field) => !field.dtoField)
            .map((field) => `            ${field.name}: ${field.type === 'number' ? '1' : "'x'"},`).join('\n');
        const deviceLiteral = e.usesDevice
            ? `        const device = { id: 'dev-1', name: 'Test Device', os: 'iOS', osVersion: '17.0', language: 'English' };\n`
            : '';
        const deviceArg = e.usesDevice ? ', device' : '';

        const dtoAsserts = [];
        for (const [dtoField, source] of Object.entries(e.sources)) {
            const kind = typeof source === 'string' ? source : 'constant';
            const key = quoteKey(dtoField);
            if (kind === 'input' || kind === 'session') {
                dtoAsserts.push(`        expect(dto.${key}).toBe(input.${camel(dtoField)});`);
            } else if (kind === 'timestamp') {
                dtoAsserts.push(`        expect(dto.${key}).toMatch(/^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$/);`);
            } else if (kind === 'constant') {
                const constant = typeof source === 'object' && source !== null ? source.constant : source;
                dtoAsserts.push(`        expect(dto.${key}).toBe(${JSON.stringify(constant)});`);
            }
        }

        toDTOTest = `
    it('toDTO builds the request payload from input${e.usesDevice ? ' + device metadata' : ''}', () => {
        const input = {
${[inputLiteral, paramFields].filter(Boolean).join('\n')}
        };
${deviceLiteral}        const dto = ${e.mapper}.toDTO(input${deviceArg});

${dtoAsserts.join('\n')}
    });
`;
    }

    const imports = [`import { ${e.mapper} } from '../data/mappers/${e.mapper}';`];
    if (needsDateImport) imports.push(`import { formatNumericGregorianDate } from '@shared/utils/dateFormat';`);

    // several shared utils (dateFormat, regex, …) import the @shared/components
    // barrel, which drags native-only modules into jest — mock it always; the
    // helpers under test never touch it (proven safe in the live AddIban run)
    const barrelMock = `\njest.mock('@shared/components', () => ({}));\n`;

    const sampleConst = e.hasResponse
        ? `\nconst SAMPLE = ${JSON.stringify(e.responseSample, null, 4)} as const;\n`
        : '';

    return `${imports.join('\n')}
${barrelMock}${sampleConst}
describe('${e.mapper}', () => {${e.hasResponse ? `
    it('toDomain maps the sample response to the domain entity', () => {
        const mapped = ${e.mapper}.toDomain(SAMPLE as never);

${asserts.join('\n')}
    });
` : ''}${toDTOTest}});
`;
}

function useCaseTestFile(f, e) {
    // use the (valid) sample request values so the tests still pass after
    // Claude fills in the validation rules
    const inputValue = (field) => {
        const sampleValue = field.dtoField ? e.requestSample?.[field.dtoField] : undefined;
        if (sampleValue !== undefined && sampleValue !== null) return JSON.stringify(sampleValue);
        return field.type === 'number' ? '1' : field.type === 'boolean' ? 'true' : "'value'";
    };
    const inputLiteral = e.inputFields.length
        ? `{ ${e.inputFields.map((field) => `${field.name}: ${inputValue(field)}`).join(', ')} }`
        : '';
    const executeArg = inputLiteral;
    const fakeResult = e.hasResponse ? `{} as never` : 'undefined';
    const rulesTodo = (e.rules ?? []).length
        ? `\n    // TODO(claude): add one test per business rule:\n${e.rules.map((rule) => `    //   - ${rule}`).join('\n')}\n`
        : '';

    return `import { ${e.useCase} } from '../domain/use-cases/${e.useCase}';
import { ${f.errorFactory} } from '../domain/errors/${f.errorType}';
import { Result } from '@shared/types/Result';
import type { ${f.repositoryInterface} } from '../domain/IRepositories/${f.repositoryInterface}';
import type { ILogger } from '@core/logging/ILogger';

// several shared utils import the @shared/components barrel, which drags
// native-only modules into jest — mock it so hand-written rules can reuse
// shared utils (digitNormalization, regex, …) without breaking the suite
jest.mock('@shared/components', () => ({}));

const makeRepository = (overrides: Partial<${f.repositoryInterface}> = {}): ${f.repositoryInterface} =>
    ({
        ${e.actionCamel}: jest.fn().mockResolvedValue(${fakeResult}),
        ...overrides,
    }) as ${f.repositoryInterface};

// the use case logs every failure before returning Result.err
const makeLogger = (): ILogger => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    exception: jest.fn(),
});

describe('${e.useCase}', () => {
    it('returns ok when the repository succeeds', async () => {
        const useCase = new ${e.useCase}(makeRepository(), makeLogger());

        const outcome = await useCase.execute(${executeArg});

        expect(Result.isOk(outcome)).toBe(true);
    });

    it('returns the feature error when the repository throws one', async () => {
        const repository = makeRepository({
            ${e.actionCamel}: jest.fn().mockRejectedValue(${f.errorFactory}('NETWORK_ERROR', 'boom')),
        } as Partial<${f.repositoryInterface}>);
        const useCase = new ${e.useCase}(repository, makeLogger());

        const outcome = await useCase.execute(${executeArg});

        expect(Result.isErr(outcome)).toBe(true);
        if (Result.isErr(outcome)) {
            expect(outcome.error.code).toBe('NETWORK_ERROR');
        }
    });

    it('classifies a 401 rejection as AUTH_ERROR', async () => {
        const repository = makeRepository({
            ${e.actionCamel}: jest.fn().mockRejectedValue({ response: { status: 401 } }),
        } as Partial<${f.repositoryInterface}>);
        const useCase = new ${e.useCase}(repository, makeLogger());

        const outcome = await useCase.execute(${executeArg});

        expect(Result.isErr(outcome)).toBe(true);
        if (Result.isErr(outcome)) {
            expect(outcome.error.code).toBe('AUTH_ERROR');
        }
    });

    it('classifies an aborted request as TIMEOUT', async () => {
        const repository = makeRepository({
            ${e.actionCamel}: jest.fn().mockRejectedValue({ code: 'ECONNABORTED' }),
        } as Partial<${f.repositoryInterface}>);
        const useCase = new ${e.useCase}(repository, makeLogger());

        const outcome = await useCase.execute(${executeArg});

        expect(Result.isErr(outcome)).toBe(true);
        if (Result.isErr(outcome)) {
            expect(outcome.error.code).toBe('TIMEOUT');
        }
    });
${rulesTodo}});
`;
}

// -------------------------------------------------------------- assembly ----

/**
 * New features get a `test/` dir; features generated before v1.3.0 keep their
 * existing `__tests__/` (jest matches *.test.ts by filename either way).
 */
function testsDirName(repo, feature) {
    return fs.existsSync(path.join(repo, 'src', 'features', feature, '__tests__')) ? '__tests__' : 'test';
}

function buildFilePlan(spec, f, testsDir = 'test') {
    const base = path.join('src', 'features', f.featureDir);
    const files = new Map();

    // feature-level files (create mode only)
    if (f.endpoints.some((e) => e.statusEnum)) {
        files.set(path.join(base, 'domain', 'constants', `${f.featureCamel}.ts`), domainConstantsFile(f));
    }
    files.set(path.join(base, 'data', 'endpoints', 'endpoints.ts'), endpointsFile(f));
    files.set(path.join(base, 'data', 'services', `${f.serviceClass}.ts`), serviceFile(f));
    if (f.mock) {
        files.set(path.join(base, 'data', 'services', `${f.mockServiceClass}.ts`), mockServiceFile(f));
    }
    files.set(path.join(base, 'data', 'repositories', `${f.repositoryClass}.ts`), repositoryFile(f));
    files.set(path.join(base, 'data', 'IServices', `${f.serviceInterface}.ts`), serviceInterfaceFile(f));
    files.set(path.join(base, 'domain', 'IRepositories', `${f.repositoryInterface}.ts`), repositoryInterfaceFile(f));
    files.set(path.join(base, 'domain', 'errors', `${f.errorType}.ts`), errorsFile(f));
    files.set(path.join(base, 'presentation', 'controller.ts'), controllerFile(f));
    if (f.endpoints.some((e) => e.method === 'GET')) {
        files.set(path.join(base, 'presentation', 'queries.ts'), queriesFile(f));
    }
    files.set(path.join(base, 'presentation', 'screens', `${f.feature}Screen.tsx`), screenFile(f));
    files.set(path.join(base, 'presentation', 'styles.ts'), stylesFile());
    files.set(path.join(base, 'presentation', 'translations', 'en.ts'), translationsEn(f));
    files.set(path.join(base, 'presentation', 'translations', 'ar.ts'), translationsAr(f));
    files.set(path.join(base, 'presentation', 'translations', 'index.ts'), translationsIndex());
    files.set(path.join(base, 'presentation', 'components', '.gitkeep'), '');
    files.set(path.join(base, 'presentation', 'utils', '.gitkeep'), '');

    // per-endpoint files (create + append)
    const perEndpoint = new Map();
    for (const e of f.endpoints) {
        if (e.hasBody || e.hasResponse) {
            perEndpoint.set(path.join(base, 'data', 'dtos', `${e.ActionPascal}DTO.ts`), dtoFile(f, e));
        }
        if (e.hasResponse || e.hasBody) {
            perEndpoint.set(path.join(base, 'data', 'mappers', `${e.mapper}.ts`), mapperFile(f, e));
        }
        if (e.hasResponse || e.inputFields.length) {
            perEndpoint.set(path.join(base, 'domain', 'entities', `${e.entity}.ts`), entityFile(f, e));
        }
        perEndpoint.set(path.join(base, 'domain', 'use-cases', `${e.useCase}.ts`), useCaseFile(f, e));
        if (e.hasResponse || e.hasBody) {
            perEndpoint.set(path.join(base, testsDir, `${e.mapper}.test.ts`), mapperTestFile(f, e));
        }
        perEndpoint.set(path.join(base, testsDir, `${e.useCase}.test.ts`), useCaseTestFile(f, e));
    }

    return { base, files, perEndpoint };
}

// ------------------------------------------------------- append helpers ----

function insertBeforeAnchor(content, anchor, insertText) {
    const lines = content.split('\n');
    const index = lines.findIndex((line) => line.includes(anchor));
    if (index === -1) return null;
    lines.splice(index, 0, ...insertText.split('\n'));
    return lines.join('\n');
}

/** Insert missing single-line imports after the last existing import. */
function ensureImports(content, importLines) {
    const lines = content.split('\n');
    let lastImport = -1;
    for (let index = 0; index < lines.length; index++) {
        if (/^import /.test(lines[index])) lastImport = index;
    }
    const missing = importLines.filter((line) => !content.includes(line));
    if (!missing.length) return content;
    lines.splice(lastImport + 1, 0, ...missing);
    return lines.join('\n');
}

function serviceEndpointImports(f, e) {
    const imports = [];
    if (e.hasResponse && e.hostType === 'external') {
        imports.push(`import type { ${e.responseDTO} } from '../dtos/${e.ActionPascal}DTO';`);
    }
    const entityNames = [
        e.hasResponse ? e.entity : null,
        e.hasBody && e.inputFields.length ? e.input : null,
    ].filter(Boolean);
    if (entityNames.length) imports.push(`import type { ${entityNames.join(', ')} } from '../../domain/entities/${e.entity}';`);
    if (e.hasResponse || e.hasBody) imports.push(`import { ${e.mapper} } from '../mappers/${e.mapper}';`);
    if (e.usesDevice) {
        imports.push(...deviceHelperImports(e.ActionPascal));
    }
    if (e.hostType === 'external') {
        imports.push(`import { ${f.errorFactory} } from '../../domain/errors/${f.errorType}';`);
    }
    return imports;
}

function repositoryEndpointImports(f, e) {
    const imports = [];
    const names = [e.hasResponse ? e.entity : null, e.inputFields.length ? e.input : null].filter(Boolean);
    if (names.length) imports.push(`import type { ${names.join(', ')} } from '../../domain/entities/${e.entity}';`);
    return imports;
}

function interfaceEndpointImports(f, e, forService) {
    const imports = [];
    if (forService) {
        // entity-only signatures — the transport DTO never appears in the service contract
        const names = [e.hasBody && e.inputFields.length ? e.input : null, e.hasResponse ? e.entity : null].filter(Boolean);
        if (names.length) imports.push(`import type { ${names.join(', ')} } from '../../domain/entities/${e.entity}';`);
    } else {
        const names = [e.inputFields.length ? e.input : null, e.hasResponse ? e.entity : null].filter(Boolean);
        if (names.length) imports.push(`import type { ${names.join(', ')} } from '../entities/${e.entity}';`);
    }
    return imports;
}

function appendFeature(repo, spec, f, manifest) {
    const base = path.join(repo, 'src', 'features', f.featureDir);
    const targets = [
        {
            file: path.join(base, 'data', 'endpoints', 'endpoints.ts'),
            anchor: '// <create-feature:endpoints>',
            text: (e) =>
                e.pathParams.length
                    ? `    ${e.endpointKey}: (${e.pathParams.map((p) => `${camel(p.name)}: ${p.type || 'string'}`).join(', ')}) => ` + '`' + e.path.replace(/\{(\w+)\}/g, (_, n) => '${' + camel(n) + '}') + '`' + ','
                    : `    ${e.endpointKey}: '${e.path}',`,
            imports: () => [],
        },
        {
            file: path.join(base, 'data', 'services', `${f.serviceClass}.ts`),
            anchor: '// <create-feature:methods>',
            text: (e) => (e.hostType === 'external' ? externalServiceMethod(f, e) : appServiceMethod(f, e)) + '\n',
            imports: (e) => serviceEndpointImports(f, e),
        },
        {
            file: path.join(base, 'data', 'repositories', `${f.repositoryClass}.ts`),
            anchor: '// <create-feature:methods>',
            text: (e) => repositoryMethod(f, e) + '\n',
            imports: (e) => repositoryEndpointImports(f, e),
        },
        // mock lane: appended endpoints get a mock method too (skipped when the
        // feature has no MockService on disk — targets missing files are reported)
        ...(f.mock
            ? [{
                file: path.join(base, 'data', 'services', `${f.mockServiceClass}.ts`),
                anchor: '// <create-feature:methods>',
                // the anchor sits INSIDE the class body, so the appended method
                // is self-contained: the sample lives as a local const, not at
                // module scope like create-mode samples
                text: (e) => {
                    if (!e.hasResponse) return `${mockServiceMethod(f, e)}\n`;
                    const args = serviceMethodArgs(e).map((arg) => `_${arg}`).join(', ');
                    const sampleJson = JSON.stringify(e.responseSample, null, 4).split('\n').join('\n        ');
                    return `    async ${e.actionCamel}(${args}): Promise<${e.returnType}> {
        const sample: ${e.responseDTO} = ${sampleJson};
        await mockDelay();
        return ${e.mapper}.toDomain(sample);
    }\n`;
                },
                imports: (e) => {
                    const mockImports = [];
                    if (e.hasResponse) {
                        mockImports.push(`import type { ${e.responseDTO} } from '../dtos/${e.ActionPascal}DTO';`);
                        mockImports.push(`import { ${e.mapper} } from '../mappers/${e.mapper}';`);
                    }
                    const entityNames = [
                        e.hasResponse ? e.entity : null,
                        e.hasBody && e.inputFields.length ? e.input : null,
                    ].filter(Boolean);
                    if (entityNames.length) mockImports.push(`import type { ${entityNames.join(', ')} } from '../../domain/entities/${e.entity}';`);
                    return mockImports;
                },
            }]
            : []),
        {
            file: path.join(base, 'data', 'IServices', `${f.serviceInterface}.ts`),
            anchor: '// <create-feature:signatures>',
            text: (e) => `    ${e.actionCamel}(${serviceMethodArgs(e).join(', ')}): Promise<${e.returnType}>;`,
            imports: (e) => interfaceEndpointImports(f, e, true),
        },
        {
            file: path.join(base, 'domain', 'IRepositories', `${f.repositoryInterface}.ts`),
            anchor: '// <create-feature:signatures>',
            text: (e) => `    ${e.actionCamel}(${e.inputFields.length ? `input: ${e.input}` : ''}): Promise<${e.returnType}>;`,
            imports: (e) => interfaceEndpointImports(f, e, false),
        },
    ];

    for (const target of targets) {
        if (!fs.existsSync(target.file)) {
            manifest.needsManual.push(`${path.relative(repo, target.file)}: file missing — apply the ${path.basename(target.file)} additions by hand`);
            continue;
        }
        let content = fs.readFileSync(target.file, 'utf8');
        let changed = false;
        for (const e of f.endpoints) {
            const insert = target.text(e);
            const probe = insert.trim().split('\n')[0];
            if (content.includes(probe)) continue; // idempotent — already present
            const updated = insertBeforeAnchor(content, target.anchor, insert);
            if (updated === null) {
                manifest.needsManual.push(`${path.relative(repo, target.file)}: anchor "${target.anchor}" missing — insert ${e.actionCamel} additions by hand, matching the file's own conventions`);
                break;
            }
            content = ensureImports(updated, target.imports(e));
            changed = true;
        }
        if (changed) {
            fs.writeFileSync(target.file, content);
            manifest.patched.push(path.relative(repo, target.file));
        }
    }

    // note ctor implications for mixed-host transitions — scripts cannot change
    // a ctor. Inspect the ctor PARAMETER LIST and helper DEFINITIONS, not the
    // whole file: the just-inserted method bodies mention configService /
    // requestExternal themselves and would self-satisfy a substring check.
    const serviceFilePath = path.join(base, 'data', 'services', `${f.serviceClass}.ts`);
    if (fs.existsSync(serviceFilePath)) {
        const content = fs.readFileSync(serviceFilePath, 'utf8');
        const ctorParams = (content.match(/constructor\s*\(([^)]*)\)/s) ?? [null, ''])[1];
        if (f.hasExternal && !ctorParams.includes('configService')) {
            manifest.needsManual.push(`${path.relative(repo, serviceFilePath)}: new external endpoint but the ctor lacks configService — add "private readonly configService: IConfigService" (+ its import and the DI registration argument) by hand`);
        }
        if (f.hasExternal && !content.includes('private async requestExternal')) {
            manifest.needsManual.push(`${path.relative(repo, serviceFilePath)}: new external endpoint but the service lacks the requestExternal/parseExternalJson helpers — copy them from a skill-generated external service (or examples/expected-output)`);
        }
        if (f.hasApp && !ctorParams.includes('httpClient')) {
            manifest.needsManual.push(`${path.relative(repo, serviceFilePath)}: new app-host endpoint but the ctor lacks httpClient — add "private readonly httpClient: IHttpClient" (+ its import and the DI registration argument) by hand`);
        }
        // a new device-using endpoint needs getDeviceMetadata() in the SERVICE
        // class (the service owns toDTO since v1.8.0 — a pre-1.8.0 helper in the
        // repository does not satisfy the appended method's this.getDeviceMetadata())
        if (f.usesDevice && !content.includes('getDeviceMetadata')) {
            manifest.needsManual.push(`${path.relative(repo, serviceFilePath)}: new endpoint uses device provenance but the service lacks getDeviceMetadata() — add the private helper (mirror a skill-generated service) + the ctor param "private readonly deviceContext: ITaxpayerAuthDeviceContextService" and its DI registration argument (resolve TOKENS.TaxpayerAuthDeviceContextService) by hand`);
        }
    }

    // presentation/queries.ts — every appended GET endpoint gets its hook here,
    // matching the query key register-di.js will add to keys.ts. Without this
    // the key would be an orphan and the hook silently missing.
    const gets = f.endpoints.filter((e) => e.method === 'GET');
    if (gets.length) {
        const queriesPath = path.join(base, 'presentation', 'queries.ts');
        if (!fs.existsSync(queriesPath)) {
            fs.mkdirSync(path.dirname(queriesPath), { recursive: true });
            fs.writeFileSync(queriesPath, queriesFile(f));
            manifest.created.push(path.relative(repo, queriesPath));
        } else {
            let content = fs.readFileSync(queriesPath, 'utf8');
            let changed = false;
            for (const e of gets) {
                if (content.includes(`export const use${e.ActionPascal}Query`)) continue; // idempotent
                const updated = insertBeforeAnchor(content, '// <create-feature:queries>', queryHookSnippet(f, e) + '\n');
                if (updated === null) {
                    manifest.needsManual.push(`src/features/${f.featureDir}/presentation/queries.ts: anchor "// <create-feature:queries>" missing — add use${e.ActionPascal}Query by hand, matching the file's existing hooks`);
                    continue;
                }
                content = ensureImports(updated, queryHookImports(f, e));
                changed = true;
            }
            if (changed) {
                fs.writeFileSync(queriesPath, content);
                manifest.patched.push(path.relative(repo, queriesPath));
            }
        }
        manifest.needsClaude.push(`src/features/${f.featureDir}/presentation — wire the new use<Action>Query hook(s) into the controller/screens where the flow needs them`);
    }
}

// ------------------------------------------------------------ validation ----

const SUPPORTED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE']);

/**
 * Allowed values for an endpoint's optional `cache`. Durations map onto
 * useApiQuery's storeDuration (persistent device cache); "always-fresh" maps
 * onto `staleTime: 0` (defeats the app-wide 5-min in-memory react-query
 * default — for lists whose server state changes between visits).
 */
const CACHE_DURATIONS = new Set(['always-fresh', '6-hours', '8-hours', '12-hours', '24-hours', '2-days', '1-week']);

/**
 * Rejects specs that would generate broken TypeScript instead of failing later
 * inside tsc. Returns a list of human-readable problems (empty = valid).
 */
function validateSpec(spec) {
    const problems = [];
    for (const required of ['feature', 'mode', 'endpoints']) {
        if (!spec[required]) problems.push(`spec is missing "${required}".`);
    }
    if (problems.length) return problems;

    if (!/^[A-Z][A-Za-z0-9]*$/.test(pascal(spec.feature))) {
        problems.push(`feature "${spec.feature}" does not normalize to a PascalCase identifier — pick a name made of letters/digits.`);
    }
    if (!['create', 'append'].includes(spec.mode)) {
        problems.push(`mode must be "create" or "append", got "${spec.mode}".`);
    }
    if (!Array.isArray(spec.endpoints) || !spec.endpoints.length) {
        problems.push('endpoints must be a non-empty array — design-only features never run generate.js (see SKILL.md Step 1b).');
        return problems;
    }
    if (spec.mock != null && typeof spec.mock !== 'boolean') {
        problems.push(`mock must be a boolean (got ${JSON.stringify(spec.mock)}) — true generates <Feature>MockService and registers it in DI instead of the real service.`);
    }

    const seenActions = new Set();
    for (const endpoint of spec.endpoints) {
        const label = `endpoint "${endpoint.action ?? '?'}"`;
        for (const required of ['action', 'method', 'path', 'hostType']) {
            if (!endpoint[required]) problems.push(`${label} is missing "${required}".`);
        }
        if (!endpoint.action || !endpoint.method) continue;

        const action = camel(endpoint.action);
        if (seenActions.has(action)) {
            problems.push(`duplicate action "${action}" — two endpoints would emit the same method/use case; suffix one (e.g. ${action}ById).`);
        }
        seenActions.add(action);

        if (!SUPPORTED_METHODS.has(endpoint.method)) {
            problems.push(`${label}: method "${endpoint.method}" is not supported (GET/POST/PUT/DELETE only).`);
        }
        if (endpoint.hostType === 'external' && !endpoint.baseUrl?.configField) {
            problems.push(`${label}: external endpoints need baseUrl.configField.`);
        }

        // every {placeholder} in the path needs a pathParam, and vice versa —
        // an orphan placeholder would ship a literal "{id}" in the request URL
        const placeholders = [...String(endpoint.path ?? '').matchAll(/\{(\w+)\}/g)].map((m) => camel(m[1]));
        const declared = (endpoint.pathParams ?? []).map((p) => camel(p.name));
        for (const name of placeholders) {
            if (!declared.includes(name)) problems.push(`${label}: path placeholder {${name}} has no matching pathParams entry.`);
        }
        for (const name of declared) {
            if (!placeholders.includes(name)) problems.push(`${label}: pathParams entry "${name}" does not appear in the path as {${name}}.`);
        }

        // provenance must cover the request sample exactly, both directions —
        // a mismatch generates a RequestDTO the mapper cannot satisfy (tsc error)
        if (endpoint.requestSample && typeof endpoint.requestSample === 'object') {
            const sampleKeys = Object.keys(endpoint.requestSample);
            const provenanceKeys = Object.keys(endpoint.requestFieldSources ?? {});
            for (const key of sampleKeys) {
                if (!provenanceKeys.includes(key)) problems.push(`${label}: request field "${key}" has no requestFieldSources entry (ask the provenance question).`);
            }
            for (const key of provenanceKeys) {
                if (!sampleKeys.includes(key)) problems.push(`${label}: requestFieldSources has "${key}" but the requestSample does not — remove it or add it to the sample.`);
            }
        }

        if (endpoint.statusEnum && !(endpoint.statusEnum.values ?? []).length) {
            problems.push(`${label}: statusEnum needs at least one value.`);
        }

        // optional response cache (maps onto useApiQuery's storeDuration)
        if (endpoint.cache != null) {
            if (!CACHE_DURATIONS.has(endpoint.cache)) {
                problems.push(`${label}: cache "${endpoint.cache}" is not a valid storeDuration (${[...CACHE_DURATIONS].join(', ')}).`);
            }
            if (endpoint.method && endpoint.method !== 'GET') {
                problems.push(`${label}: cache applies to GET endpoints only.`);
            }
        }

        if (endpoint.requestSample && ['GET', 'DELETE'].includes(endpoint.method)) {
            problems.push(`${label}: ${endpoint.method} endpoints must not carry a request body — move the values to queryParams or pathParams.`);
        }

        // a primitive sample would emit `ResponseDTO = string` plus a garbage
        // entity built from the string's character indices
        if (endpoint.responseSample != null && typeof endpoint.responseSample !== 'object') {
            problems.push(`${label}: responseSample must be a JSON object or array (got ${typeof endpoint.responseSample}) — wrap primitives in an object or use null for "none".`);
        }

        // the query string is modeled in queryParams, never inline in the path
        if (typeof endpoint.path === 'string' && endpoint.path.includes('?')) {
            problems.push(`${label}: path contains a query string — move it to queryParams (paths hold the path only).`);
        }

        // colliding input names (e.g. body field "Id" + path param "id") would
        // emit a duplicate field in the Input type
        const inputNames = [
            ...Object.entries(endpoint.requestFieldSources ?? {})
                .filter(([, source]) => source === 'input' || source === 'session')
                .map(([field]) => camel(field)),
            ...(endpoint.pathParams ?? []).map((p) => camel(p.name)),
            ...(endpoint.queryParams ?? []).map((p) => camel(p.name)),
        ];
        for (const name of inputNames.filter((name, i) => inputNames.indexOf(name) !== i)) {
            problems.push(`${label}: input field "${name}" appears more than once across body/path/query — rename one of them.`);
        }
    }

    // optional design-lane block (see DESIGN.md) — node IDs only, never full
    // Figma URLs (URLs can carry tokens and would be persisted verbatim)
    if (spec.design != null) {
        if (typeof spec.design !== 'object' || Array.isArray(spec.design)) {
            problems.push('design must be an object ({ fileKey, screens, serviceCard }), not an array or primitive.');
            return problems;
        }
        if (spec.design.screens != null && !Array.isArray(spec.design.screens)) {
            problems.push('design.screens must be an array.');
        }
        for (const screen of Array.isArray(spec.design?.screens) ? spec.design.screens : []) {
            if (!screen.name) problems.push('every design.screens entry needs a "name".');
        }
        const serialized = JSON.stringify(spec.design);
        // protocol-optional + case-insensitive so "figma.com/design/…?token=…"
        // can't slip through without the https:// prefix
        if (/figma\.com\//i.test(serialized)) {
            problems.push('design block must store fileKey + node IDs, not figma.com URLs (strip them before writing the spec).');
        }
    }
    return problems;
}

// ------------------------------------------------------------------ main ----

// stdout stays machine-readable but compact: file lists collapse to counts
// (the full manifest is on disk for anyone who needs the paths), while the
// actionable lists — Claude's hand-edit work — are printed verbatim.
function summarizeManifest(manifest) {
    return {
        status: manifest.needsManual.length ? 'NEEDS_MANUAL' : 'GENERATED',
        feature: manifest.feature,
        mode: manifest.mode,
        created: manifest.created.length,
        skipped: manifest.skipped.length,
        patched: manifest.patched.length,
        needsClaude: manifest.needsClaude,
        needsManual: manifest.needsManual,
        manifest: '.claude-skill-manifest.json',
    };
}

function main() {
    const argv = process.argv.slice(2);
    if (!argv.length || argv.includes('--help') || argv.includes('-h')) {
        console.log(HELP);
        return argv.length ? 0 : 1;
    }
    const repoIndex = argv.indexOf('--repo');
    const repo = repoIndex >= 0 ? path.resolve(argv[repoIndex + 1]) : process.cwd();
    const specPath = argv.find((a, i) => !a.startsWith('--') && !(repoIndex >= 0 && i === repoIndex + 1));
    if (!specPath) {
        console.error('generate.js: missing <feature-spec.json>. See --help.');
        return 1;
    }

    let spec;
    try {
        spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
    } catch (error) {
        console.error(`generate.js: cannot parse ${specPath}: ${error.message}`);
        return 1;
    }
    const problems = validateSpec(spec);
    if (problems.length) {
        for (const problem of problems) console.error(`generate.js: ${problem}`);
        return 1;
    }

    const f = featureModel(spec);
    // append mode may target a legacy PascalCase dir; create mode always uses kebab
    if (spec.mode !== 'create') f.featureDir = resolveFeatureDir(repo, spec.feature);

    // macOS FS is case-insensitive: creating "Ordertracking" next to an existing
    // "OrderTracking" would dump mismatched files INTO the existing feature dir.
    if (spec.mode === 'create') {
        const featuresDir = path.join(repo, 'src', 'features');
        // compare ignoring case AND separators: "ordertracking" and
        // "order-tracking" are different paths but the same feature to a human,
        // and on a case-insensitive FS the near-miss dumps mismatched files
        const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
        const clash = fs.existsSync(featuresDir)
            ? fs.readdirSync(featuresDir).find((name) => normalize(name) === normalize(f.featureDir) && name !== f.featureDir)
            : null;
        if (clash) {
            console.error(`generate.js: feature "${f.feature}" collides case-insensitively with existing src/features/${clash} — append to the existing name or pick a different one.`);
            return 1;
        }
    }

    const { files, perEndpoint } = buildFilePlan(spec, f, testsDirName(repo, f.featureDir));
    const manifest = { feature: f.feature, featureDir: f.featureDir, mode: spec.mode, created: [], skipped: [], patched: [], needsClaude: [], needsManual: [] };

    // Append requires a skill-shaped feature. A pre-skill feature (different
    // layout, no anchors) gets NO generated files — Claude edits it by hand,
    // matching that feature's own conventions.
    if (spec.mode === 'append') {
        const serviceFilePath = path.join(repo, 'src', 'features', f.featureDir, 'data', 'services', `${f.serviceClass}.ts`);
        if (!fs.existsSync(serviceFilePath)) {
            manifest.needsManual.push(
                `src/features/${f.featureDir} is not a skill-generated feature (no ${f.serviceClass}.ts at the expected path) — ` +
                `append everything by hand, matching that feature's own layout and conventions (even singular folder names). No files were created.`
            );
            fs.writeFileSync(path.join(repo, '.claude-skill-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
            console.log(JSON.stringify(summarizeManifest(manifest), null, 2));
            return 2;
        }
    }

    const writePlan = spec.mode === 'append' ? perEndpoint : new Map([...files, ...perEndpoint]);

    for (const [relative, content] of writePlan) {
        const absolute = path.join(repo, relative);
        if (fs.existsSync(absolute)) {
            manifest.skipped.push(relative);
            continue;
        }
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, content);
        manifest.created.push(relative);
    }

    if (spec.mode === 'append') {
        appendFeature(repo, spec, f, manifest);
    }

    for (const e of f.endpoints) {
        manifest.needsClaude.push(`src/features/${f.featureDir}/domain/use-cases/${e.useCase}.ts — fill execute() business rules${e.statusEnum ? ` + status derivation in ${e.mapper}.ts` : ''}`);
    }
    if (spec.mode === 'create') {
        manifest.needsClaude.push(`src/features/${f.featureDir}/presentation/translations/ar.ts — replace placeholder Arabic strings (use the user story's Arabic text when present)`);
    }
    if (f.mock) {
        manifest.needsClaude.push(`src/features/${f.featureDir}/data/services/${f.mockServiceClass}.ts — enrich the sample catalog to cover the story's filters/states/pagination, then remove the TODO(claude); the DI container registers this mock (swap comment inside) until the real API exists`);
    }

    fs.writeFileSync(path.join(repo, '.claude-skill-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(JSON.stringify(summarizeManifest(manifest), null, 2));
    return manifest.needsManual.length ? 2 : 0;
}

if (require.main === module) {
    process.exit(main());
}

const SKILL_VERSION = '1.14.2';

/**
 * On-disk directory for a feature name, RELATIVE to src/features (may contain a
 * separator). New features are kebab-case (`src/features/application-status`),
 * but pre-1.14.0 features are PascalCase, and some live one level down inside a
 * category directory (`Signup/EstablishmentSignup`,
 * `verificationFeatures/TaxStampValidation`) — SKILL.md Step 1 requires the
 * existence check to scan that level too. A resolution that misses the real
 * directory is worse than no check at all: every path-based audit check then
 * inspects an empty path and PASSes vacuously (live finding 2026-08-23,
 * EstablishmentSignup). Returns the kebab name when nothing is present (the
 * name a fresh scaffold would create).
 */
function resolveFeatureDir(repo, feature) {
    const featuresDir = path.join(repo, 'src', 'features');
    const candidates = [kebab(feature), pascal(feature)];
    for (const candidate of candidates) {
        if (fs.existsSync(path.join(featuresDir, candidate))) return candidate;
    }
    // one level of category nesting; a category dir is one that holds no
    // feature layer of its own (no data/ or domain/ child)
    if (fs.existsSync(featuresDir)) {
        for (const entry of fs.readdirSync(featuresDir, { withFileTypes: true })) {
            if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
            const categoryPath = path.join(featuresDir, entry.name);
            if (fs.existsSync(path.join(categoryPath, 'data')) || fs.existsSync(path.join(categoryPath, 'domain'))) continue;
            for (const candidate of candidates) {
                if (fs.existsSync(path.join(categoryPath, candidate))) return `${entry.name}/${candidate}`;
            }
        }
    }
    return candidates[0];
}

module.exports = { featureModel, buildFilePlan, testsDirName, validateSpec, pascal, camel, snakeUpper, kebab, resolveFeatureDir, queryKeyName, queryKeyValue, SKILL_VERSION };
