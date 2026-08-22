'use strict';
/**
 * Shared helpers for the skill's own test suite (node:test, stdlib only).
 *
 * `makeFixtureRepo()` builds a miniature zatcaReact-shaped repo in a temp dir:
 * the DI/i18n/config files mirror the real files' SHAPES (import styles,
 * `} as const;` closers, `this.config = { … };` block, 6 env files) so the
 * scripts' anchor-planting and insertion regexes are exercised for real.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPTS = path.join(__dirname, '..', 'scripts');

function makeTmpDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), `rca-${prefix}-`));
}

function write(repo, relative, content) {
    const absolute = path.join(repo, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, content);
}

function read(repo, relative) {
    return fs.readFileSync(path.join(repo, relative), 'utf8');
}

function exists(repo, relative) {
    return fs.existsSync(path.join(repo, relative));
}

/** Run a skill script as a CLI, the way Claude does. */
function runScript(script, args, options = {}) {
    const result = spawnSync('node', [path.join(SCRIPTS, script), ...args], {
        encoding: 'utf8',
        input: options.stdin,
        cwd: options.cwd,
    });
    return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/**
 * generate.js prints a compact summary (counts + needsClaude/needsManual);
 * the full file lists live in the on-disk manifest — read that for assertions.
 */
function readManifest(repo) {
    return JSON.parse(fs.readFileSync(path.join(repo, '.claude-skill-manifest.json'), 'utf8'));
}

function makeFixtureRepo() {
    const repo = makeTmpDir('repo');

    write(repo, 'src/core/di/tokens.ts', `import type { IHttpClient } from '@core/http/IHttpClient';
import type { IConfigService } from '@core/config/IConfigService';
import type { IUseCase, IUseCaseNoParams } from '@domain/shared/IUseCase';
import type { Result } from '@shared/types/Result';

export const TOKENS = {
    ConfigService: 'IConfigService',
    HttpClient: 'IHttpClient',
    ExistingUseCase: 'ExistingUseCase',
    ClashService: 'ILegacyClashService',
} as const;

export interface TokenRegistry {
    [TOKENS.ConfigService]: IConfigService;
    [TOKENS.HttpClient]: IHttpClient;
}
`);

    write(repo, 'src/core/di/container.ts', `import { container } from 'tsyringe';
import { TOKENS } from './tokens';
import type { IConfigService } from '@core/config/IConfigService';
import type { IHttpClient } from '@core/http/IHttpClient';

export function configureDependencies(): void {
    container.register(TOKENS.ConfigService, {
        useFactory: () => ({} as IConfigService),
    });
}
`);

    write(repo, 'src/core/localization/i18n.ts', `import i18n from 'i18next';
import en from './translations/en.json';
import ar from './translations/ar.json';
import { featureTranslationsFor } from './merger';

export default i18n;
`);

    // Mirrors the real app's merger.ts: TS barrels imported per feature,
    // registered by namespace in featureTranslations.
    write(repo, 'src/core/localization/merger.ts', `import { AppLanguage } from './i18n';
import account from '@features/account/presentation/translations';

const featureTranslations = {
    account,
} as const;

export const featureTranslationsFor = (language: AppLanguage) =>
    Object.fromEntries(
        Object.entries(featureTranslations).map(([namespace, byLanguage]) => [
            namespace,
            byLanguage[language],
        ])
    );
`);

    // Mirrors the real app's central react-query key registry.
    write(repo, 'src/data/services/keys.ts', `const QUERIES_KEYS = {
    BANNERS: 'banners',
    INTEGRATED_TARIFF_SECTIONS: 'integrated-tariff-sections',
} as const;

export default QUERIES_KEYS;
`);

    write(repo, 'src/core/config/IConfigService.ts', `export interface AppConfig {
    apiUrl: string;
    timeout: number;
}

export interface IConfigService {
    get(): AppConfig;
}
`);

    write(repo, 'src/core/config/ConfigService.ts', `import { IConfigService, AppConfig } from './IConfigService';

export class ConfigService implements IConfigService {
    private readonly config: AppConfig;

    constructor() {
        this.config = {
            apiUrl: process.env.EXPO_PUBLIC_API_URL || '',
            timeout: Number(process.env.EXPO_PUBLIC_TIMEOUT) || 60000,
        };
    }

    get(): AppConfig {
        return this.config;
    }
}
`);

    for (const file of ['.env', '.env.development', '.env.example', '.env.staging', '.env.preprod', '.env.production']) {
        write(repo, file, 'EXPO_PUBLIC_API_URL=https://app.example.test/api/\n');
    }

    // one pre-existing feature so duplicate-path detection has something to scan
    write(repo, 'src/features/legacy/data/endpoints.ts', `export const LEGACY_ENDPOINTS = {
    OLD_SCAN: '/v2/scancode/savedetails',
};
`);

    // a shared util so the reuse-first audit check has an inventory
    write(repo, 'src/shared/utils/dateFormat.ts', `export const formatNumericGregorianDate = (value) => value;
`);

    return repo;
}

/**
 * makeFixtureRepo + the navigation surface register-navigation.js edits,
 * mirroring the real files' SHAPES: RouteContract/Routes use the app's 2-space
 * indent; the page registry, SERVICES_DATA, and deep-linking map use 4-space.
 */
function makeNavFixtureRepo() {
    const repo = makeFixtureRepo();

    write(repo, 'src/core/navigation/routes/RouteContract.ts', `import type { Href } from 'expo-router';

type RouteDefinition<Params> = {
  toHref: Params extends undefined ? () => Href : (params: Params) => Href;
};

type RouteDefinitionStacks = {
  tabs: {
    root: RouteDefinition<undefined>;
  };
  serviceFlow: {
    run: RouteDefinition<{ serviceId: string; step?: number }>;
    integratedTariff: RouteDefinition<undefined>;
  };
};

const routeDefinitionStacks: RouteDefinitionStacks = {
  tabs: {
    root: {
      toHref: () => '/',
    },
  },
  serviceFlow: {
    run: {
      toHref: ({ serviceId, step }) => ({
        pathname: '/service-flow/[serviceId]',
        params: step ? { serviceId, step } : { serviceId },
      }),
    },
    integratedTariff: {
      toHref: () => '/service-flow/integrated-tariff',
    },
  },
};

export const routeDefinitions = {
  'tabs.root': routeDefinitionStacks.tabs.root,
  'serviceFlow.run': routeDefinitionStacks.serviceFlow.run,
  'serviceFlow.integratedTariff': routeDefinitionStacks.serviceFlow.integratedTariff,
};
`);

    write(repo, 'src/core/navigation/routes/Routes.ts', `import type { AppRoute } from './RouteContract';

export const Routes = {
  tabs: {
    root: (): AppRoute => ({ key: 'tabs.root' }),
  },
  serviceFlow: {
    run: (serviceId: string, step?: number): AppRoute => ({
      key: 'serviceFlow.run',
      params: step ? { serviceId, step } : { serviceId },
    }),
    integratedTariff: (): AppRoute => ({ key: 'serviceFlow.integratedTariff' }),
  },
};
`);

    write(repo, 'src/presentation/service-flow/screens/pages/index.ts', `import type { ComponentType } from 'react';
import { IntegratedTariffScreen } from '@features/integrated-tariff';

export type ServiceFlowPageProps = {
    initialStep?: number;
};

type ServiceFlowPageConfig = {
    component: ComponentType<ServiceFlowPageProps>;
    serviceId: string;
    titleKey: string;
    descriptionKey: string;
};

const registerServiceFlowPage = (
    aliases: string[],
    config: ServiceFlowPageConfig
): Record<string, ServiceFlowPageConfig> =>
    Object.fromEntries(aliases.map((alias) => [alias, config]));

const serviceFlowPages: Record<string, ServiceFlowPageConfig> = {
    ...registerServiceFlowPage(['integratedTariff', 'integrated-tariff'], {
        component: IntegratedTariffScreen,
        serviceId: 'integratedTariff',
        titleKey: 'serviceFlow.pages.integratedTariff.title',
        descriptionKey: 'serviceFlow.pages.integratedTariff.description',
    }),
};

export const getServiceFlowPage = (serviceId: string): ServiceFlowPageConfig | undefined =>
    serviceFlowPages[serviceId];
`);

    write(repo, 'src/presentation/services/models/servicesData.ts', `import { AppRoute } from '@core/navigation/routes/RouteContract';
import { Routes } from '@core/navigation/routes/Routes';

export type ServiceCost = 'paid' | 'free';
export type ServiceTypeKey = 'tax' | 'zakat' | 'realEstate' | 'customs';
export type ServiceUserType = 'citizen' | 'resident' | 'business' | 'retired';

const ALL_USER_TYPES: ServiceUserType[] = ['citizen', 'resident', 'business', 'retired'];

export const SERVICES_DATA = [
    {
        id: 'integrated-tariff',
        title: 'services.serviceIntegratedTariff.title',
        description: 'services.serviceIntegratedTariff.description',
        screen: Routes.serviceFlow.integratedTariff(),
        cost: 'free',
        serviceTypes: ['customs'] as ServiceTypeKey[],
        userTypes: ALL_USER_TYPES,
        addedAt: Date.UTC(2026, 3, 20),
        processingTimeMinutes: 10,
        fees: 0,
    },
] as const;
`);

    write(repo, 'src/core/deepLinking/DeepLinkingService.ts', `import type { AppRoute } from '../navigation/routes/RouteContract';
import { Routes } from '../navigation/routes/Routes';

const dedicatedServiceFlowRoutes: Record<string, () => AppRoute> = {
    'integrated-tariff': () => Routes.serviceFlow.integratedTariff(),
    integratedTariff: () => Routes.serviceFlow.integratedTariff(),
};

export const resolveDedicated = (serviceId: string): AppRoute | null => {
    const dedicatedRoute = dedicatedServiceFlowRoutes[serviceId];
    return dedicatedRoute ? dedicatedRoute() : null;
};
`);

    for (const lang of ['en', 'ar']) {
        write(repo, `src/core/localization/translations/${lang}.json`, JSON.stringify({
            common: { ok: lang === 'ar' ? 'حسنا' : 'OK' },
            services: {
                serviceIntegratedTariff: { title: 't', description: 'd' },
            },
        }, null, 4) + '\n');
    }

    return repo;
}

/** A minimal, valid create-mode spec the tests can clone and tweak. */
function baseSpec(overrides = {}) {
    return {
        feature: 'OrderTracking',
        mode: 'create',
        appHost: 'https://app.example.test/api/',
        endpoints: [
            {
                action: 'trackOrder',
                method: 'POST',
                path: '/v1/orders/track',
                pathParams: [],
                queryParams: [],
                hostType: 'external',
                baseUrl: {
                    envKey: 'EXPO_PUBLIC_ORDER_TRACKING_BASE_URL',
                    configField: 'orderTrackingBaseUrl',
                    devValue: 'https://partner.example.test/api',
                },
                headers: [
                    { name: 'Content-Type', value: 'application/json', source: 'literal' },
                    {
                        name: 'x-api-key',
                        value: 'fixture-api-key-123',
                        source: 'env',
                        envKey: 'EXPO_PUBLIC_ORDER_TRACKING_API_KEY',
                        configField: 'orderTrackingApiKey',
                    },
                    { name: 'Authorization', value: 'Bearer fixture', source: 'session' },
                ],
                requestSample: { OrderNumber: 'ORD-123', RequestedAt: '2025-01-01T00:00:00Z' },
                requestFieldSources: { OrderNumber: 'input', RequestedAt: 'timestamp' },
                responseSample: { OrderStatus: 'IN_TRANSIT', LastLocation: ' Riyadh ', UpdatedAt: '2025-01-02T08:00:00Z' },
                typeOverrides: {},
                dateFields: ['UpdatedAt'],
                statusEnum: null,
                userStory: 'Track an order by its number.',
                rules: ['order number required non-empty'],
            },
        ],
        ...overrides,
    };
}

function writeSpec(dir, spec, name = 'spec.json') {
    const specPath = path.join(dir, name);
    fs.writeFileSync(specPath, JSON.stringify(spec, null, 2));
    return specPath;
}

module.exports = { makeTmpDir, makeFixtureRepo, makeNavFixtureRepo, baseSpec, writeSpec, runScript, write, read, exists, readManifest, SCRIPTS };
