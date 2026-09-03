'use strict';
/**
 * Tests for scripts/hooks/* — the skill-scoped Claude Code hooks (v1.19.0).
 *
 * The properties that matter: every hook is inert outside a skill run (no
 * manifest → exit 0, no output), the compaction pair only cares about whether
 * the spec is on disk, the Stop gate never fights the skill's own pauses or a
 * question to the user, and the self-update guard blocks exactly the commands
 * SKILL.md forbids. Each case drives the script through stdin, the way Claude
 * Code does.
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { runScript, makeTmpDir, write, makeFixtureRepo, baseSpec, writeSpec } = require('./helpers.js');
const { violation } = require('../scripts/hooks/guard-self-update.js');
const { shouldFormat } = require('../scripts/hooks/format-feature-file.js');
const { isLegitimateStop, findRun, lastAssistantText } = require('../scripts/hooks/_common.js');

const SKILL_DIR = path.join(__dirname, '..');

function hook(name, input, env) {
    return runScript(path.join('hooks', name), [], { stdin: JSON.stringify(input), cwd: input.cwd, env });
}

function transcript(dir, texts) {
    const file = path.join(dir, 'transcript.jsonl');
    const lines = texts.map((text, i) =>
        JSON.stringify(
            typeof text === 'string'
                ? { type: 'assistant', uuid: String(i), message: { role: 'assistant', content: [{ type: 'text', text }] } }
                : text
        )
    );
    fs.writeFileSync(file, lines.join('\n') + '\n');
    return file;
}

function manifest(repo, extra = {}) {
    write(repo, '.claude-skill-manifest.json', JSON.stringify({ feature: 'OrderTracking', featureDir: 'order-tracking', mode: 'create', created: [], patched: [], ...extra }));
}

// ----------------------------------------------------------- inert -------

for (const name of ['pre-compact.js', 'post-compact.js', 'stop-gate.js']) {
    test(`${name} is silent when no skill run is in progress`, () => {
        const cwd = makeTmpDir('nohook');
        const { status, stdout, stderr } = hook(name, { cwd, trigger: 'manual', transcript_path: '/nowhere' });
        assert.equal(status, 0);
        assert.equal(stdout, '');
        assert.equal(stderr, '');
    });
}

test('every hook survives empty and malformed stdin', () => {
    for (const name of ['pre-compact.js', 'post-compact.js', 'stop-gate.js', 'guard-self-update.js', 'format-feature-file.js']) {
        for (const stdin of ['', 'not json']) {
            const r = runScript(path.join('hooks', name), [], { stdin, cwd: makeTmpDir('junk') });
            assert.equal(r.status, 0, `${name} with stdin ${JSON.stringify(stdin)}: ${r.stderr}`);
        }
    }
});

// ----------------------------------------------------- pre-compact -------

test('pre-compact blocks a manual compaction when the run has no spec on disk', () => {
    const repo = makeTmpDir('pc');
    manifest(repo, { spec: '/scratch/that/was/deleted/spec.json' });
    const { status, stdout } = hook('pre-compact.js', { cwd: repo, trigger: 'manual' });
    assert.equal(status, 0);
    const out = JSON.parse(stdout);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /persist/i);
    assert.match(out.reason, /feature-spec\.json/);
});

test('pre-compact allows compaction when the manifest names a spec that exists', () => {
    const repo = makeTmpDir('pc');
    const specPath = writeSpec(makeTmpDir('scratch'), baseSpec());
    manifest(repo, { spec: specPath });
    const { status, stdout } = hook('pre-compact.js', { cwd: repo, trigger: 'manual' });
    assert.equal(status, 0);
    assert.equal(stdout, '');
});

test('pre-compact finds the persisted feature-spec.json by featureDir when the manifest has no spec key', () => {
    const repo = makeTmpDir('pc');
    manifest(repo);
    write(repo, 'src/features/order-tracking/feature-spec.json', JSON.stringify(baseSpec()));
    const { stdout } = hook('pre-compact.js', { cwd: repo, trigger: 'manual' });
    assert.equal(stdout, '');
});

test('pre-compact finds a design record written after the manifest (design-only lane, nested category dir)', () => {
    const repo = makeTmpDir('pc');
    write(repo, '.claude-skill-manifest.json', JSON.stringify({ feature: 'TaxStamp', mode: 'design', created: [], patched: [] }));
    write(repo, 'src/features/verificationFeatures/tax-stamp/feature-spec.json', JSON.stringify({ feature: 'TaxStamp', design: { screens: [] } }));
    const run = findRun(repo);
    assert.ok(run.specPath && run.specPath.endsWith(path.join('tax-stamp', 'feature-spec.json')));
    assert.equal(hook('pre-compact.js', { cwd: repo, trigger: 'manual' }).stdout, '');
});

// ---------------------------------------------------- post-compact -------

test('post-compact re-injects spec + manifest paths and screen progress', () => {
    const repo = makeTmpDir('post');
    manifest(repo);
    write(repo, 'src/features/order-tracking/feature-spec.json', JSON.stringify({
        ...baseSpec(),
        design: { screens: [{ name: 'A', status: 'verified' }, { name: 'B', status: 'pending' }, { name: 'C', status: 'generated' }] },
    }));
    const { status, stdout } = hook('post-compact.js', { cwd: repo, trigger: 'manual' });
    assert.equal(status, 0);
    const out = JSON.parse(stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, 'PostCompact');
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.match(ctx, /spec=src\/features\/order-tracking\/feature-spec\.json/);
    assert.match(ctx, /manifest=\.claude-skill-manifest\.json/);
    assert.match(ctx, /feature=OrderTracking mode=create/);
    assert.match(ctx, /2 pending \/ 1 verified of 3/);
    assert.doesNotMatch(ctx, /NOT on disk/);
});

test('post-compact says so when the spec is missing', () => {
    const repo = makeTmpDir('post');
    manifest(repo);
    const out = JSON.parse(hook('post-compact.js', { cwd: repo }).stdout);
    assert.match(out.hookSpecificOutput.additionalContext, /NOT on disk/);
    assert.match(out.hookSpecificOutput.additionalContext, /spec=\(not on disk\)/);
});

// ------------------------------------------------ guard-self-update ------

test('guard-self-update blocks the commands SKILL.md forbids', () => {
    const real = SKILL_DIR;
    for (const cmd of [
        `cd ${real} && git pull`,
        `git -C ${path.resolve(real, '..', '..')} pull --rebase`,
        'git -C ~/ReactNative/react-clean-architecture checkout main',
        'claude plugin update react-clean-architecture',
        '/plugin update react-clean-architecture',
        '/plugin marketplace update react-clean-architecture',
        'npx skills@latest add Mkhira/react-clean-architecture',
        'cd ~/ReactNative/react-clean-architecture && ./install.sh claude',
    ]) {
        assert.ok(violation(cmd), `should block: ${cmd}`);
    }
});

test('guard-self-update lets the target repo\'s own git and everything else through', () => {
    for (const cmd of [
        'git status --porcelain',
        'git pull',
        'git checkout -- src/core/di/container.ts',
        'git fetch origin && git rebase origin/main',
        `node ${SKILL_DIR}/scripts/check-update.js`,
        `node ${SKILL_DIR}/scripts/generate.js spec.json`,
        'npx tsc --noEmit',
        'echo "git pull in the skill dir is forbidden by react-clean-architecture"', // mentions the name, not a git mutator
        '',
    ]) {
        assert.equal(violation(cmd), null, `should allow: ${cmd}`);
    }
});

test('guard-self-update exits 2 with the SKILL.md rule on stderr, 0 otherwise', () => {
    const blocked = hook('guard-self-update.js', { cwd: makeTmpDir('g'), tool_name: 'Bash', tool_input: { command: '/plugin update react-clean-architecture' } });
    assert.equal(blocked.status, 2);
    assert.match(blocked.stderr, /never update the skill yourself/);
    assert.equal(blocked.stdout, '');
    const allowed = hook('guard-self-update.js', { cwd: makeTmpDir('g'), tool_name: 'Bash', tool_input: { command: 'git status' } });
    assert.equal(allowed.status, 0);
    assert.equal(allowed.stderr, '');
});

test('guard-self-update recognises the CLAUDE_SKILL_DIR symlink path too', () => {
    const link = makeTmpDir('link');
    const r = hook('guard-self-update.js', { cwd: link, tool_input: { command: `git -C ${link} pull` } }, { CLAUDE_SKILL_DIR: link });
    assert.equal(r.status, 2);
});

// ------------------------------------------------------- stop-gate -------

test('isLegitimateStop: pauses and questions are never blocked, a plain report is judged', () => {
    assert.equal(isLegitimateStop('Good moment to free up context — please run **`/compact`**, then say **continue**.'), true);
    assert.equal(isLegitimateStop('Screen summary above — correct, or edit #N / edit card?'), true);
    assert.equal(isLegitimateStop('Captured. **next curl, or done?**'), true);
    assert.equal(isLegitimateStop('**What are we building?** 1. Full · 2. Backend only · 3. Design only'), true);
    assert.equal(isLegitimateStop('Tree is dirty. Continue anyway?'), true);
    assert.equal(isLegitimateStop(''), true);
    assert.equal(isLegitimateStop('Done. Files created: 14. Tokens added: 3.'), false);
});

test('stop-gate allows the skill\'s own compaction pause even with work left', () => {
    const repo = makeTmpDir('stop');
    manifest(repo);
    write(repo, 'src/features/order-tracking/feature-spec.json', JSON.stringify(baseSpec()));
    write(repo, '.claude-skill-tsc-baseline.json', '{}');
    write(repo, 'src/features/order-tracking/data/mappers/OrderMapper.ts', '// TODO(claude): status derivation\n');
    const t = transcript(repo, ['Audit PASSED. Good moment to free up context — please run **`/compact`**, then say **continue**.']);
    const r = hook('stop-gate.js', { cwd: repo, transcript_path: t, stop_hook_active: false });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
});

test('stop-gate blocks a final report with working files, TODO(claude) and drift left', () => {
    const repo = makeFixtureRepo();
    manifest(repo);
    write(repo, 'src/features/order-tracking/feature-spec.json', JSON.stringify(baseSpec()));
    write(repo, '.claude-skill-tsc-baseline.json', '{}');
    write(repo, 'src/features/order-tracking/data/mappers/OrderMapper.ts', '// TODO(claude): status derivation — map the flags\n');
    write(repo, 'src/shared/components/ui/atoms/NotInDictionary/index.tsx', 'export const NotInDictionary = () => null;\n');
    const t = transcript(repo, [
        { type: 'user', message: { role: 'user', content: 'go' } },
        'Feature OrderTracking is done. Files created: 14. Tokens added: 3.',
        { type: 'assistant', isSidechain: true, message: { role: 'assistant', content: [{ type: 'text', text: 'subagent noise?' }] } },
    ]);
    const r = hook('stop-gate.js', { cwd: repo, transcript_path: t, stop_hook_active: false });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /\.claude-skill-tsc-baseline\.json/);
    assert.match(out.reason, /TODO\(claude\) still in: src\/features\/order-tracking\/data\/mappers\/OrderMapper\.ts/);
    assert.match(out.reason, /COMPONENTS\.md drift: \d+/);
});

test('stop-gate keeps the working files out of the list while screens are still pending', () => {
    const repo = makeTmpDir('stop');
    manifest(repo);
    write(repo, 'src/features/order-tracking/feature-spec.json', JSON.stringify({ ...baseSpec(), design: { screens: [{ name: 'A', status: 'pending' }] } }));
    write(repo, '.claude-skill-tsc-baseline.json', '{}');
    const t = transcript(repo, ['Screen A built and verified on the simulator. Moving on.']);
    const r = hook('stop-gate.js', { cwd: repo, transcript_path: t });
    assert.equal(r.stdout, '', r.stdout);
});

test('stop-gate lets a clean finish stop, and never loops (stop_hook_active)', () => {
    const repo = makeTmpDir('stop');
    manifest(repo);
    write(repo, 'src/features/order-tracking/feature-spec.json', JSON.stringify(baseSpec()));
    write(repo, '.claude-skill-tsc-baseline.json', '{}');
    const t = transcript(repo, ['Final report: everything is done.']);
    const looped = hook('stop-gate.js', { cwd: repo, transcript_path: t, stop_hook_active: true });
    assert.equal(looped.stdout, '');
    fs.unlinkSync(path.join(repo, '.claude-skill-tsc-baseline.json'));
    fs.unlinkSync(path.join(repo, '.claude-skill-manifest.json'));
    const clean = hook('stop-gate.js', { cwd: repo, transcript_path: t });
    assert.equal(clean.stdout, '');
});

test('lastAssistantText reads only the tail of a big transcript and skips tool-only turns', () => {
    const dir = makeTmpDir('tr');
    const filler = Array.from({ length: 3000 }, (_, i) => `old assistant line ${i} ${'x'.repeat(300)}`);
    const t = transcript(dir, [
        ...filler,
        'The real last message?',
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] } },
    ]);
    assert.equal(lastAssistantText(t), 'The real last message?');
    assert.equal(lastAssistantText('/does/not/exist'), '');
});

// ---------------------------------------------- format-feature-file ------

test('format-feature-file only touches feature/service-flow TS files inside the repo', () => {
    const repo = '/repo';
    assert.equal(shouldFormat('/repo/src/features/order-tracking/domain/use-cases/TrackOrder.ts', repo), true);
    assert.equal(shouldFormat('src/features/order-tracking/presentation/screens/A.tsx', repo), true);
    assert.equal(shouldFormat('/repo/app/service-flow/order-tracking.tsx', repo), true);
    assert.equal(shouldFormat('/repo/src/features/order-tracking/feature-spec.json', repo), false);
    assert.equal(shouldFormat('/repo/src/core/di/container.ts', repo), false);
    assert.equal(shouldFormat('/elsewhere/src/features/x/a.ts', repo), false);
    assert.equal(shouldFormat(undefined, repo), false);
});

test('format-feature-file is a no-op (exit 0, silent) outside the paths and dry-runs inside', () => {
    const repo = makeTmpDir('fmt');
    const out = hook('format-feature-file.js', { cwd: repo, tool_name: 'Write', tool_input: { file_path: path.join(repo, 'src/core/x.ts') } });
    assert.equal(out.status, 0);
    assert.equal(out.stdout, '');
    const dry = hook('format-feature-file.js', { cwd: repo, tool_name: 'Edit', tool_input: { file_path: path.join(repo, 'src/features/a/b.tsx') } }, { RCA_HOOK_DRY_RUN: '1' });
    assert.equal(dry.stdout, 'would format src/features/a/b.tsx\n');
});

// ---------------------------------------------------------- wiring -------

test('SKILL.md wires all five hooks and every command points at an existing script', () => {
    const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
    const frontmatter = skill.split('\n---\n')[0];
    assert.match(frontmatter, /^hooks:\n/m);
    for (const event of ['PreToolUse', 'PostToolUse', 'Stop']) {
        assert.match(frontmatter, new RegExp(`^  ${event}:\\n`, 'm'), `${event} not wired`);
    }
    // compaction events are not dispatched to skill hooks (2.1.259) — they live in hooks/hooks.json
    assert.doesNotMatch(frontmatter, /^  (PreCompact|PostCompact):/m);
    const commands = [...frontmatter.matchAll(/command: '(for d in [^\n]*?exit 0)'/g)].map((m) => m[1]);
    assert.equal(commands.length, 3, 'three self-locating hook commands');
    for (const command of commands) {
        const rel = command.match(/exec node "\$d\/(scripts\/hooks\/[a-z-]+\.js)"/)[1];
        assert.ok(fs.existsSync(path.join(SKILL_DIR, rel)), `${rel} missing`);
        // Claude Code does NOT expand ${CLAUDE_SKILL_DIR} inside hook commands (2.1.259) —
        // a plugin install gets CLAUDE_PLUGIN_ROOT, a symlink/copy install gets nothing
        assert.doesNotMatch(command, /CLAUDE_SKILL_DIR/);
        assert.match(command, /CLAUDE_PLUGIN_ROOT:\+\$CLAUDE_PLUGIN_ROOT\/skills\/react-clean-architecture/);
        assert.match(command, /\$CLAUDE_PROJECT_DIR\/\.claude\/skills\/react-clean-architecture/);
        assert.match(command, /\$HOME\/\.claude\/skills\/react-clean-architecture/);
    }
});

test('the plugin hooks.json carries the compaction pair, manual-only, pointing at existing scripts', () => {
    const file = path.join(SKILL_DIR, '..', '..', 'hooks', 'hooks.json');
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(Object.keys(json.hooks).sort(), ['PostCompact', 'PreCompact']);
    assert.equal(json.hooks.PreCompact[0].matcher, 'manual', 'only manual compactions may be refused');
    for (const event of ['PreCompact', 'PostCompact']) {
        for (const group of json.hooks[event]) {
            for (const hook of group.hooks) {
                assert.equal(hook.type, 'command');
                const rel = hook.command.match(/\$\{CLAUDE_PLUGIN_ROOT\}\/(skills\/react-clean-architecture\/scripts\/hooks\/[a-z-]+\.js)/)[1];
                assert.ok(fs.existsSync(path.join(SKILL_DIR, '..', '..', rel)), `${rel} missing`);
            }
        }
    }
});

test('the frontmatter hook command finds the skill for a plugin install, a user symlink, and neither', () => {
    const { execSync } = require('child_process');
    const skill = fs.readFileSync(path.join(SKILL_DIR, 'SKILL.md'), 'utf8');
    const command = skill.match(/command: '(for d in [^\n]*?pre-compact\.js[^\n]*?exit 0)'/)[1];
    const repo = makeTmpDir('resolve');
    manifest(repo, { spec: '/nowhere/spec.json' }); // run in progress, spec missing → the hook blocks
    const stdin = JSON.stringify({ cwd: repo, trigger: 'manual' });
    const run = (env) => execSync(`sh -c '${command.replace(/'/g, "'\\''")}'`, { input: stdin, env, encoding: 'utf8', cwd: repo });

    // 1. plugin install: CLAUDE_PLUGIN_ROOT/skills/react-clean-architecture
    const pluginRoot = makeTmpDir('plugin');
    fs.mkdirSync(path.join(pluginRoot, 'skills'), { recursive: true });
    fs.symlinkSync(SKILL_DIR, path.join(pluginRoot, 'skills', 'react-clean-architecture'));
    assert.match(run({ PATH: process.env.PATH, HOME: makeTmpDir('home'), CLAUDE_PROJECT_DIR: repo, CLAUDE_PLUGIN_ROOT: pluginRoot }), /"decision":"block"/);

    // 2. user-scoped symlink: $HOME/.claude/skills/react-clean-architecture, no plugin variable
    const home = makeTmpDir('home');
    fs.mkdirSync(path.join(home, '.claude', 'skills'), { recursive: true });
    fs.symlinkSync(SKILL_DIR, path.join(home, '.claude', 'skills', 'react-clean-architecture'));
    assert.match(run({ PATH: process.env.PATH, HOME: home, CLAUDE_PROJECT_DIR: repo }), /"decision":"block"/);

    // 3. nothing installed where the command looks → silent exit 0, never a broken session
    assert.equal(run({ PATH: process.env.PATH, HOME: makeTmpDir('home'), CLAUDE_PROJECT_DIR: repo }), '');
});

test('generate.js records the spec path in the manifest and audit.js repoints it on persist', () => {
    const gen = fs.readFileSync(path.join(SKILL_DIR, 'scripts', 'generate.js'), 'utf8');
    assert.match(gen, /spec: path\.resolve\(specPath\)/);
    const audit = fs.readFileSync(path.join(SKILL_DIR, 'scripts', 'audit.js'), 'utf8');
    assert.match(audit, /manifest\.spec = relative/);
});
