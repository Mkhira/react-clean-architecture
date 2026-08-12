#!/usr/bin/env node
/**
 * generate.js — scaffold a clean-architecture feature from feature-spec.json.
 * Node stdlib only. Templates mirror the zatcaReact repo's VERIFIED patterns:
 * Result.ok/err, AppError-style typed error objects, ApiResponse `.data`,
 * useResolve controllers, cleanString/formatDateTimeDateMonthYear mappers.
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
        useCase: `${ActionPascal}UseCase`,
        mapper: `${ActionPascal}Mapper`,
        returnType: hasResponse ? `${ActionPascal}Result` : 'void',
    };
}

function featureModel(spec) {
    const feature = pascal(spec.feature);
    const endpoints = spec.endpoints.map((endpoint) => endpointModel(spec, endpoint));
    return {
        feature,
        featureCamel: camel(spec.feature),
        FEATURE_SNAKE: snakeUpper(spec.feature),
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

function entityFile(f, e) {
    const parts = [];
    if (e.statusEnum) {
        const union = e.statusEnum.values.map((value) => `'${value}'`).join(' | ');
        parts.push(`export type ${e.statusType} = ${union};`);
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

    const fieldExpr = (key, value, source, dotPath) => {
        if (dateFields.includes(dotPath)) return `formatDateTimeDateMonthYear(${source}.${key})`;
        if (typeof value === 'string' || value === null) {
            const override = (e.typeOverrides ?? {})[dotPath] ?? '';
            if (/date/.test(override)) return `formatDateTimeDateMonthYear(${source}.${key})`;
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
                lines.push(`        ${name}: ${source}.${key} ${nullable ? `? ${childFn}(${source}.${key}) : null` : `!= null ? ${childFn}(${source}.${key}) : null`},`);
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
                `        // TODO(claude): status derivation — map the response flags to ${e.statusEnum.values.map((v) => `'${v}'`).join(' | ')}`,
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
        needsDate = /formatDateTimeDateMonthYear\(/.test(body + mappingHelpers.join(''));
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
    if (needsDate) importLines.push(`import { formatDateTimeDateMonthYear } from '@shared/utils/dateFormat';`);

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
    if (e.hasBody) return [`payload: ${e.requestDTO}`];
    const args = e.pathParams.map((p) => `${camel(p.name)}: ${p.type || 'string'}`);
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

function appServiceMethod(f, e) {
    const args = serviceMethodArgs(e).join(', ');
    const urlExpr = endpointUrlExpr(f, e);
    const generic = e.hasResponse ? e.responseDTO : 'void';
    const config = e.queryParams.length ? ', { params: query }' : '';
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
        ? `        const response = ${call};\n        return ${e.mapper}.toDomain(response.data);`
        : `        ${call};`;
    return `    async ${e.actionCamel}(${args}): Promise<${e.returnType}> {\n${body}\n    }`;
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
            throw ${f.errorFactory}('PARSE_ERROR', \`\${action} response was not valid JSON\`, error);
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
            throw ${f.errorFactory}('HTTP_ERROR', \`\${action} HTTP \${response.status}: \${text}\`);
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
${requestLines.join('\n')}${resultSection}
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
    imports.push(`import type { ${f.serviceInterface} } from '../../domain/IServices/${f.serviceInterface}';`);
    imports.push(`import { ${f.FEATURE_SNAKE}_ENDPOINTS } from '../endpoints/endpoints';`);
    if (f.hasExternal) imports.push(`import { ${f.errorFactory} } from '../../domain/errors/${f.errorType}';`);
    for (const e of f.endpoints) {
        const dtoNames = [e.hasBody ? e.requestDTO : null, e.hasResponse ? e.responseDTO : null].filter(Boolean);
        if (dtoNames.length) imports.push(`import type { ${dtoNames.join(', ')} } from '../dtos/${e.ActionPascal}DTO';`);
        if (e.hasResponse) {
            imports.push(`import type { ${e.entity} } from '../../domain/entities/${e.entity}';`);
            imports.push(`import { ${e.mapper} } from '../mappers/${e.mapper}';`);
        }
    }

    const helpers = f.hasExternal ? `${externalServiceHelpers(f)}\n\n` : '';

    return `${[...new Set(imports)].join('\n')}

export class ${f.serviceClass} implements ${f.serviceInterface} {
    constructor(${ctorParams.length ? `\n        ${ctorParams.join(',\n        ')},\n    ` : ''}) {}

${helpers}${methods.join('\n\n')}

    // <create-feature:methods>
}
`;
}

function repositoryMethod(f, e) {
    const inputArg = e.inputFields.length ? `input: ${e.input}` : '';
    let callArgs;
    if (e.hasBody) {
        callArgs = 'payload';
    } else {
        const args = e.pathParams.map((p) => `input.${camel(p.name)}`);
        if (e.queryParams.length) {
            args.push(`{ ${e.queryParams.map((p) => `${camel(p.name)}: input.${camel(p.name)}`).join(', ')} }`);
        }
        callArgs = args.join(', ');
    }

    if (e.hasBody) {
        const deviceLine = e.usesDevice ? `        const device = await this.getDeviceMetadata();\n` : '';
        const deviceArg = e.usesDevice ? ', device' : '';
        return `    async ${e.actionCamel}(${inputArg}): Promise<${e.returnType}> {
${deviceLine}        const payload = ${e.mapper}.toDTO(input${deviceArg});
        return this.apiService.${e.actionCamel}(payload);
    }`;
    }
    return `    async ${e.actionCamel}(${inputArg}): Promise<${e.returnType}> {
        return this.apiService.${e.actionCamel}(${callArgs});
    }`;
}

function repositoryFile(f) {
    const imports = [
        `import type { ${f.repositoryInterface} } from '../../domain/IRepositories/${f.repositoryInterface}';`,
        `import type { ${f.serviceInterface} } from '../../domain/IServices/${f.serviceInterface}';`,
    ];
    for (const e of f.endpoints) {
        const names = [e.hasResponse ? e.entity : null, e.inputFields.length ? e.input : null].filter(Boolean);
        if (names.length) imports.push(`import type { ${names.join(', ')} } from '../../domain/entities/${e.entity}';`);
        if (e.hasBody) imports.push(`import { ${e.mapper} } from '../mappers/${e.mapper}';`);
    }
    if (f.usesDevice) {
        imports.push(`import { getDeviceInfo } from '@shared/utils/deviceInfo/deviceInfo';`);
        imports.push(`import type { DeviceMetadata } from '../dtos/${f.endpoints.find((e) => e.usesDevice).ActionPascal}DTO';`);
    }

    const deviceHelper = f.usesDevice
        ? `
    private async getDeviceMetadata(): Promise<DeviceMetadata> {
        const deviceInfo = await getDeviceInfo();

        return {
            id: deviceInfo.deviceID,
            name: deviceInfo.deviceName,
            os: deviceInfo.platFrom,
            osVersion: deviceInfo.osVersion,
            language: deviceInfo.language,
        };
    }
`
        : '';

    return `${[...new Set(imports)].join('\n')}

export class ${f.repositoryClass} implements ${f.repositoryInterface} {
    constructor(private readonly apiService: ${f.serviceInterface}) {}
${deviceHelper}
${f.endpoints.map((e) => repositoryMethod(f, e)).join('\n\n')}

    // <create-feature:methods>
}
`;
}

function serviceInterfaceFile(f) {
    const imports = [];
    const signatures = f.endpoints.map((e) => {
        const args = serviceMethodArgs(e).join(', ');
        if (e.hasBody) imports.push(`import type { ${e.requestDTO} } from '../../data/dtos/${e.ActionPascal}DTO';`);
        if (e.hasResponse) imports.push(`import type { ${e.entity} } from '../entities/${e.entity}';`);
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

// Single source of truth for this feature's error codes — the union type and
// the runtime guard both derive from it, so adding a code is a one-line change.
export const ${f.errorCodeValues} = [
    'NETWORK_ERROR',
    'HTTP_ERROR',
    'PARSE_ERROR',
    'VALIDATION_ERROR',
] as const;

export type ${f.errorCodes} = (typeof ${f.errorCodeValues})[number];

export type ${f.errorType} = Omit<AppError, 'code'> & {
    code: ${f.errorCodes};
};

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
import type { ${f.repositoryInterface} } from '../IRepositories/${f.repositoryInterface}';
${entityImports.length ? `import type { ${entityImports.join(', ')} } from '../entities/${e.entity}';\n` : ''}import { ${f.errorFactory}, ${f.errorGuard}, type ${f.errorType} } from '../errors/${f.errorType}';

${storyComment}export class ${e.useCase} implements ${implementsClause} {
    constructor(private readonly repository: ${f.repositoryInterface}) {}

    async execute(${executeArg}): Promise<${resultType}> {
${rulesComment}        try {
${callLine}
        } catch (error) {
            if (${f.errorGuard}(error)) {
                return Result.err(error);
            }
            return Result.err(${f.errorFactory}('NETWORK_ERROR', '${e.actionCamel} failed', error));
        }
    }
}
`;
}

// ---------------------------------------------------- presentation files ----

function controllerFile(f) {
    const first = f.endpoints[0];
    const others = f.endpoints.slice(1);

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
${others.map((e) => `    // const ${e.actionCamel}UseCase = useResolve(TOKENS.${e.useCase});`).join('\n')}${others.length ? '\n' : ''}    const theme = useTheme();
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
            logger.error('${first.actionCamel} failed', outcome.error);
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
import { Text, View } from 'react-native';
import { useController } from './${f.featureCamel}Controller';

export default function ${f.feature}Screen() {
    const { styles, t } = useController();

    return (
        <View style={styles.container}>
            <Text>{t('${f.featureCamel}.title')}</Text>
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
        container: {
            flex: 1,
            backgroundColor: theme.colors.background,
            padding: theme.spacing.md,
        },
    });
`;
}

function presentationTypesFile(f) {
    return `export type ${f.feature}FormValues = Record<string, unknown>;
`;
}

function translationsEn(f) {
    return JSON.stringify(
        {
            title: titleWords(f.feature),
            errors: {
                network: 'Something went wrong. Please try again.',
                validation: 'Please check your input and try again.',
            },
        },
        null,
        4
    ) + '\n';
}

function translationsAr(f) {
    // Values are filled from the user story's Arabic strings when available —
    // Claude replaces these placeholders right after generation.
    return JSON.stringify(
        {
            title: titleWords(f.feature),
            errors: {
                network: 'حدث خطأ ما، يرجى المحاولة مرة أخرى.',
                validation: 'يرجى التحقق من البيانات المدخلة والمحاولة مرة أخرى.',
            },
        },
        null,
        4
    ) + '\n';
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
            asserts.push(`        expect(${accessor}.${name}).toBe(formatDateTimeDateMonthYear(${sampleAccessor}.${quoteKey(key)}));`);
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
    if (needsDateImport) imports.push(`import { formatDateTimeDateMonthYear } from '@shared/utils/dateFormat';`);

    // dateFormat.ts imports the @shared/components barrel, which drags
    // native-only modules into jest — the date helpers under test never touch it
    const barrelMock = (e.dateFields ?? []).length
        ? `\njest.mock('@shared/components', () => ({}));\n`
        : '';

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

    return `import { ${e.useCase} } from '../domain/usecases/${e.useCase}';
import { ${f.errorFactory} } from '../domain/errors/${f.errorType}';
import { Result } from '@shared/types/Result';
import type { ${f.repositoryInterface} } from '../domain/IRepositories/${f.repositoryInterface}';

const makeRepository = (overrides: Partial<${f.repositoryInterface}> = {}): ${f.repositoryInterface} =>
    ({
        ${e.actionCamel}: jest.fn().mockResolvedValue(${fakeResult}),
        ...overrides,
    }) as ${f.repositoryInterface};

describe('${e.useCase}', () => {
    it('returns ok when the repository succeeds', async () => {
        const useCase = new ${e.useCase}(makeRepository());

        const outcome = await useCase.execute(${executeArg});

        expect(Result.isOk(outcome)).toBe(true);
    });

    it('returns the feature error when the repository throws one', async () => {
        const repository = makeRepository({
            ${e.actionCamel}: jest.fn().mockRejectedValue(${f.errorFactory}('NETWORK_ERROR', 'boom')),
        } as Partial<${f.repositoryInterface}>);
        const useCase = new ${e.useCase}(repository);

        const outcome = await useCase.execute(${executeArg});

        expect(Result.isErr(outcome)).toBe(true);
        if (Result.isErr(outcome)) {
            expect(outcome.error.code).toBe('NETWORK_ERROR');
        }
    });
${rulesTodo}});
`;
}

// -------------------------------------------------------------- assembly ----

function buildFilePlan(spec, f) {
    const base = path.join('src', 'features', f.feature);
    const files = new Map();

    // feature-level files (create mode only)
    files.set(path.join(base, 'data', 'endpoints', 'endpoints.ts'), endpointsFile(f));
    files.set(path.join(base, 'data', 'services', `${f.serviceClass}.ts`), serviceFile(f));
    files.set(path.join(base, 'data', 'repositories', `${f.repositoryClass}.ts`), repositoryFile(f));
    files.set(path.join(base, 'domain', 'IServices', `${f.serviceInterface}.ts`), serviceInterfaceFile(f));
    files.set(path.join(base, 'domain', 'IRepositories', `${f.repositoryInterface}.ts`), repositoryInterfaceFile(f));
    files.set(path.join(base, 'domain', 'errors', `${f.errorType}.ts`), errorsFile(f));
    files.set(path.join(base, 'presentation', `${f.featureCamel}Controller.ts`), controllerFile(f));
    files.set(path.join(base, 'presentation', `${f.featureCamel}Screen.tsx`), screenFile(f));
    files.set(path.join(base, 'presentation', 'styles.ts'), stylesFile());
    files.set(path.join(base, 'presentation', 'types.ts'), presentationTypesFile(f));
    files.set(path.join(base, 'presentation', 'translations', 'en.json'), translationsEn(f));
    files.set(path.join(base, 'presentation', 'translations', 'ar.json'), translationsAr(f));
    files.set(path.join(base, 'presentation', 'components', '.gitkeep'), '');
    files.set(path.join(base, 'presentation', 'screens', '.gitkeep'), '');
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
        perEndpoint.set(path.join(base, 'domain', 'usecases', `${e.useCase}.ts`), useCaseFile(f, e));
        if (e.hasResponse || e.hasBody) {
            perEndpoint.set(path.join(base, '__tests__', `${e.mapper}.test.ts`), mapperTestFile(f, e));
        }
        perEndpoint.set(path.join(base, '__tests__', `${e.useCase}.test.ts`), useCaseTestFile(f, e));
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
    const dtoNames = [e.hasBody ? e.requestDTO : null, e.hasResponse ? e.responseDTO : null].filter(Boolean);
    if (dtoNames.length) imports.push(`import type { ${dtoNames.join(', ')} } from '../dtos/${e.ActionPascal}DTO';`);
    if (e.hasResponse) {
        imports.push(`import type { ${e.entity} } from '../../domain/entities/${e.entity}';`);
        imports.push(`import { ${e.mapper} } from '../mappers/${e.mapper}';`);
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
    if (e.hasBody) imports.push(`import { ${e.mapper} } from '../mappers/${e.mapper}';`);
    return imports;
}

function interfaceEndpointImports(f, e, forService) {
    const imports = [];
    if (forService) {
        if (e.hasBody) imports.push(`import type { ${e.requestDTO} } from '../../data/dtos/${e.ActionPascal}DTO';`);
        if (e.hasResponse) imports.push(`import type { ${e.entity} } from '../entities/${e.entity}';`);
    } else {
        const names = [e.inputFields.length ? e.input : null, e.hasResponse ? e.entity : null].filter(Boolean);
        if (names.length) imports.push(`import type { ${names.join(', ')} } from '../entities/${e.entity}';`);
    }
    return imports;
}

function appendFeature(repo, spec, f, manifest) {
    const base = path.join(repo, 'src', 'features', f.feature);
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
        {
            file: path.join(base, 'domain', 'IServices', `${f.serviceInterface}.ts`),
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

    // a new device-using endpoint needs the repository's getDeviceMetadata helper
    const repositoryFilePath = path.join(base, 'data', 'repositories', `${f.repositoryClass}.ts`);
    if (f.usesDevice && fs.existsSync(repositoryFilePath)) {
        const content = fs.readFileSync(repositoryFilePath, 'utf8');
        if (!content.includes('getDeviceMetadata')) {
            manifest.needsManual.push(`${path.relative(repo, repositoryFilePath)}: new endpoint uses device provenance but the repository lacks getDeviceMetadata() — add the private helper (mirror an existing skill-generated repository) + the getDeviceInfo/DeviceMetadata imports by hand`);
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
    }
}

// ------------------------------------------------------------ validation ----

const SUPPORTED_METHODS = new Set(['GET', 'POST', 'PUT', 'DELETE']);

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
    }
    return problems;
}

// ------------------------------------------------------------------ main ----

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
    const { files, perEndpoint } = buildFilePlan(spec, f);
    const manifest = { feature: f.feature, mode: spec.mode, created: [], skipped: [], patched: [], needsClaude: [], needsManual: [] };

    // Append requires a skill-shaped feature. A pre-skill feature (different
    // layout, no anchors) gets NO generated files — Claude edits it by hand,
    // matching that feature's own conventions.
    if (spec.mode === 'append') {
        const serviceFilePath = path.join(repo, 'src', 'features', f.feature, 'data', 'services', `${f.serviceClass}.ts`);
        if (!fs.existsSync(serviceFilePath)) {
            manifest.needsManual.push(
                `src/features/${f.feature} is not a skill-generated feature (no ${f.serviceClass}.ts at the expected path) — ` +
                `append everything by hand, matching that feature's own layout and conventions (even singular folder names). No files were created.`
            );
            fs.writeFileSync(path.join(repo, '.claude-skill-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
            console.log(JSON.stringify(manifest, null, 2));
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
        manifest.needsClaude.push(`src/features/${f.feature}/domain/usecases/${e.useCase}.ts — fill execute() business rules${e.statusEnum ? ` + status derivation in ${e.mapper}.ts` : ''}`);
    }
    if (spec.mode === 'create') {
        manifest.needsClaude.push(`src/features/${f.feature}/presentation/translations/ar.json — replace placeholder Arabic strings (use the user story's Arabic text when present)`);
    }

    fs.writeFileSync(path.join(repo, '.claude-skill-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(JSON.stringify(manifest, null, 2));
    return manifest.needsManual.length ? 2 : 0;
}

if (require.main === module) {
    process.exit(main());
}

module.exports = { featureModel, buildFilePlan };
