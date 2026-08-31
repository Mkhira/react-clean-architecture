#!/usr/bin/env node
/**
 * setup-test-infra.js — make render tests possible in the target repo
 * (user decision 2026-08-19: automatic, not an offer).
 *
 * Ensures three things, idempotently:
 *   1. `@testing-library/react-native` is a devDependency — installs it with
 *      the repo's own package manager (yarn/pnpm/bun lockfile detection,
 *      npm otherwise) when missing.
 *   2. `jest.setup.js` exists at the repo root — creates the starter
 *      (gesture-handler / MMKV / reanimated / safe-area mocks, the verified
 *      zatcaReact set) only when absent; an existing file is NEVER touched.
 *   3. Jest is wired to it — appends `setupFilesAfterEnv` to the package.json
 *      `jest` block when that's where the config lives; a standalone
 *      jest.config.* is reported for a hand edit instead (rewriting arbitrary
 *      JS config is not this script's business).
 *
 * Usage:
 *   node setup-test-infra.js [--repo <path>] [--check]
 *   node setup-test-infra.js --help
 *       --check: report only (no install, no writes); exit 1 when something
 *                is missing. Used by docs/audit guidance.
 *
 * Prints a JSON report. Exit codes: 0 = ready, 1 = check-mode gaps,
 * 2 = install/wiring failed (the run continues with logic-level tests — the
 * final report must say so).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PACKAGE = '@testing-library/react-native';
const SETUP_FILE = 'jest.setup.js';

const HELP = `setup-test-infra.js — make render tests possible in the target repo.

Ensures, idempotently: ${PACKAGE} is a devDependency
(installed with the repo's own package manager), ${SETUP_FILE} exists at the
repo root (an existing one is never touched), and jest is wired to it via
setupFilesAfterEnv.

Usage:
  node setup-test-infra.js [--repo <path>] [--check]
      --repo <path>   the app repo (default: cwd)
      --check         report only — no install, no writes; exit 1 when
                      something is missing
  node setup-test-infra.js --help

Prints a JSON report. Exit codes: 0 = ready, 1 = check-mode gaps, 2 =
install/wiring failed (the run continues with logic-level tests — say so in the
final report).`;

const STARTER_SETUP = `/**
 * Jest setup — native-module mocks so presentation/component render tests
 * (@testing-library/react-native) run in Node without the native runtime.
 */

// Gesture handler ships its own jest setup (mocks RNGestureHandlerModule etc.)
import 'react-native-gesture-handler/jestSetup';

// MMKV storage: registers a fake MMKVNative native module
import 'react-native-mmkv-storage/jest/mmkvJestSetup.js';

// Reanimated ships a dedicated mock (animations resolve instantly)
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));

// Safe-area: official mock provides zero insets + static frame
jest.mock('react-native-safe-area-context', () =>
    require('react-native-safe-area-context/jest/mock').default
);
`;

/** yarn/pnpm/bun by lockfile; npm otherwise (a missing package-lock still means npm). */
function detectPackageManager(repo) {
    if (fs.existsSync(path.join(repo, 'yarn.lock'))) return { cmd: 'yarn', args: ['add', '--dev', PACKAGE] };
    if (fs.existsSync(path.join(repo, 'pnpm-lock.yaml'))) return { cmd: 'pnpm', args: ['add', '--save-dev', PACKAGE] };
    if (fs.existsSync(path.join(repo, 'bun.lockb')) || fs.existsSync(path.join(repo, 'bun.lock'))) {
        return { cmd: 'bun', args: ['add', '--dev', PACKAGE] };
    }
    return { cmd: 'npm', args: ['install', '--save-dev', '--no-audit', '--no-fund', PACKAGE] };
}

function readPackageJson(repo) {
    const file = path.join(repo, 'package.json');
    if (!fs.existsSync(file)) return null;
    const raw = fs.readFileSync(file, 'utf8');
    return { file, raw, json: JSON.parse(raw) };
}

function hasLibrary(pkgJson) {
    return Boolean(pkgJson.dependencies?.[PACKAGE] || pkgJson.devDependencies?.[PACKAGE]);
}

/** Where jest config lives: 'package.json' | a jest.config.* filename | null. */
function jestConfigLocation(repo, pkgJson) {
    for (const name of ['jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.cjs', 'jest.config.json']) {
        if (fs.existsSync(path.join(repo, name))) return name;
    }
    if (pkgJson.jest) return 'package.json';
    return null;
}

function setupWired(repo, pkgJson, location) {
    if (location === 'package.json') {
        return (pkgJson.jest?.setupFilesAfterEnv ?? []).some((entry) => entry.includes(SETUP_FILE));
    }
    if (location) {
        return fs.readFileSync(path.join(repo, location), 'utf8').includes(SETUP_FILE);
    }
    return false;
}

function main() {
    const argv = process.argv.slice(2);
    if (argv.includes('--help') || argv.includes('-h')) {
        console.log(HELP);
        return 0;
    }
    const repoIndex = argv.indexOf('--repo');
    const repo = repoIndex >= 0 ? path.resolve(argv[repoIndex + 1]) : process.cwd();
    const checkOnly = argv.includes('--check');

    const pkg = readPackageJson(repo);
    if (!pkg) {
        console.error(`setup-test-infra.js: no package.json at ${repo}`);
        return 2;
    }

    const report = {
        library: hasLibrary(pkg.json) ? 'present' : 'missing',
        setupFile: fs.existsSync(path.join(repo, SETUP_FILE)) ? 'present' : 'missing',
        wiring: 'missing',
        actions: [],
        needsManual: [],
    };
    const configLocation = jestConfigLocation(repo, pkg.json);
    if (setupWired(repo, pkg.json, configLocation)) report.wiring = 'present';

    if (checkOnly) {
        const ready = report.library === 'present' && report.setupFile === 'present' && report.wiring === 'present';
        console.log(JSON.stringify({ ...report, ready }, null, 2));
        return ready ? 0 : 1;
    }

    let failed = false;

    // 1. the library
    if (report.library === 'missing') {
        const pm = detectPackageManager(repo);
        const result = spawnSync(pm.cmd, pm.args, { cwd: repo, encoding: 'utf8', shell: false });
        if (result.status === 0) {
            report.library = 'installed';
            report.actions.push(`${pm.cmd} installed ${PACKAGE} as a devDependency`);
        } else {
            failed = true;
            report.needsManual.push(
                `install failed (${pm.cmd} exit ${result.status}): ${(result.stderr || result.stdout || '').trim().split('\n').slice(-3).join(' / ')} — install ${PACKAGE} by hand; ship logic-level tests meanwhile and SAY SO in the report`
            );
        }
    }

    // 2. the setup file — created only when absent, never overwritten
    if (report.setupFile === 'missing') {
        fs.writeFileSync(path.join(repo, SETUP_FILE), STARTER_SETUP);
        report.setupFile = 'created';
        report.actions.push(`created ${SETUP_FILE} (gesture-handler/MMKV/reanimated/safe-area mocks) — extend it if render tests hit other native modules`);
    }

    // 3. the wiring
    if (report.wiring === 'missing') {
        if (configLocation === 'package.json' || configLocation === null) {
            // re-read: the install step may have rewritten package.json
            const fresh = readPackageJson(repo);
            fresh.json.jest = fresh.json.jest ?? {};
            fresh.json.jest.setupFilesAfterEnv = [
                ...(fresh.json.jest.setupFilesAfterEnv ?? []),
                `<rootDir>/${SETUP_FILE}`,
            ];
            const indent = /^(\s+)"/m.exec(fresh.raw)?.[1] ?? '  ';
            const trailing = fresh.raw.endsWith('\n') ? '\n' : '';
            fs.writeFileSync(fresh.file, JSON.stringify(fresh.json, null, indent) + trailing);
            report.wiring = 'wired';
            report.actions.push(`package.json jest.setupFilesAfterEnv → <rootDir>/${SETUP_FILE}`);
        } else {
            report.needsManual.push(
                `${configLocation} exists — add setupFilesAfterEnv: ['<rootDir>/${SETUP_FILE}'] to it by hand (this script never rewrites JS config files)`
            );
        }
    }

    console.log(JSON.stringify(report, null, 2));
    return failed ? 2 : 0;
}

if (require.main === module) {
    // NOT process.exit(): stdout writes to a PIPE are asynchronous and exiting
    // truncates what is still buffered (found 2026-09-01 in components.js, which
    // lost ~10KB off a 76KB --all through a captured pipe while a file redirect
    // looked perfect). Compact stdout hides it; verbatim failure output would not.
    process.exitCode = main();
}

module.exports = { detectPackageManager, jestConfigLocation, STARTER_SETUP, PACKAGE };
