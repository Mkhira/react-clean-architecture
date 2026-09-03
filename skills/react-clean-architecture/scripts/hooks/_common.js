'use strict';
/**
 * _common.js — shared plumbing for the skill's Claude Code hooks.
 *
 * Every hook is a plain Node script: JSON on stdin, JSON on stdout (exit 0)
 * or a message on stderr (exit 2 = block). Zero dependencies, like the rest
 * of scripts/. None of them do anything unless a skill run is in progress —
 * "in progress" means `.claude-skill-manifest.json` exists in the session cwd
 * (generate.js / register-navigation.js write it; the run deletes it at the
 * end). Outside a run they exit 0 silently, so the hooks cost nothing in an
 * unrelated session.
 */
const fs = require('fs');
const path = require('path');

const MANIFEST_FILE = '.claude-skill-manifest.json';
const BASELINE_FILE = '.claude-skill-tsc-baseline.json';

/** Skill directory (…/skills/react-clean-architecture), symlinks resolved. */
const SKILL_DIR = path.resolve(__dirname, '..', '..');

/** Read all of stdin as JSON; `{}` when empty or malformed (never throw in a hook). */
function readStdin() {
    let raw = '';
    try {
        raw = fs.readFileSync(0, 'utf8');
    } catch {
        return {};
    }
    if (!raw.trim()) return {};
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

function readJson(file) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
}

/** Every feature-spec.json under src/features (one nested category level). */
function listPersistedSpecs(repo) {
    const root = path.join(repo, 'src', 'features');
    const found = [];
    let entries;
    try {
        entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
        return found;
    }
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = path.join(root, entry.name);
        const direct = path.join(dir, 'feature-spec.json');
        if (fs.existsSync(direct)) {
            found.push(direct);
            continue;
        }
        let nested = [];
        try {
            nested = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            continue;
        }
        for (const sub of nested) {
            const candidate = path.join(dir, sub.name, 'feature-spec.json');
            if (sub.isDirectory() && fs.existsSync(candidate)) found.push(candidate);
        }
    }
    return found;
}

/**
 * Locate the run's resume artifacts.
 *   null                      → no manifest, not a skill run
 *   { manifestPath, manifest, specPath, spec }
 *     manifest: parsed object or null (unreadable)
 *     specPath: the manifest's `spec` (generate.js records the input path;
 *               audit.js --persist-spec rewrites it to the persisted copy), else
 *               src/features/<featureDir>/feature-spec.json, else the newest
 *               persisted spec written after the manifest — or null when none
 *               of those exists on disk.
 */
function findRun(cwd) {
    const repo = cwd || process.cwd();
    const manifestPath = path.join(repo, MANIFEST_FILE);
    if (!fs.existsSync(manifestPath)) return null;
    const manifest = readJson(manifestPath);
    const candidates = [];
    if (manifest && typeof manifest.spec === 'string') candidates.push(path.resolve(repo, manifest.spec));
    if (manifest && typeof manifest.featureDir === 'string') {
        candidates.push(path.join(repo, 'src', 'features', manifest.featureDir, 'feature-spec.json'));
    }
    let specPath = candidates.find((file) => fs.existsSync(file)) || null;
    if (!specPath) {
        let manifestMtime = 0;
        try {
            manifestMtime = fs.statSync(manifestPath).mtimeMs;
        } catch {
            manifestMtime = 0;
        }
        const newer = listPersistedSpecs(repo)
            .map((file) => ({ file, mtime: fs.statSync(file).mtimeMs }))
            .filter((entry) => entry.mtime >= manifestMtime - 1000)
            .sort((a, b) => b.mtime - a.mtime);
        specPath = newer.length ? newer[0].file : null;
    }
    return { repo, manifestPath, manifest, specPath, spec: specPath ? readJson(specPath) : null };
}

/** Screen progress from a spec's design block: { total, verified, pending }. */
function screenProgress(spec) {
    const screens = spec && spec.design && Array.isArray(spec.design.screens) ? spec.design.screens : [];
    const verified = screens.filter((s) => s && s.status === 'verified').length;
    return { total: screens.length, verified, pending: screens.length - verified };
}

/**
 * Text of the last assistant turn in a Claude Code transcript (JSONL, one
 * message per line). Sidechain (subagent) lines are skipped. Reads only the
 * tail of the file — transcripts get big. '' when unavailable.
 */
function lastAssistantText(transcriptPath, tailBytes = 512 * 1024) {
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return '';
    let fd;
    try {
        fd = fs.openSync(transcriptPath, 'r');
        const size = fs.fstatSync(fd).size;
        const start = Math.max(0, size - tailBytes);
        const buffer = Buffer.alloc(size - start);
        fs.readSync(fd, buffer, 0, buffer.length, start);
        const lines = buffer.toString('utf8').split('\n');
        if (start > 0) lines.shift(); // first line is a partial record
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim();
            if (!line) continue;
            let record;
            try {
                record = JSON.parse(line);
            } catch {
                continue;
            }
            if (record.type !== 'assistant' || record.isSidechain) continue;
            const content = record.message && record.message.content;
            if (typeof content === 'string') return content;
            if (!Array.isArray(content)) continue;
            const text = content.filter((block) => block && block.type === 'text').map((block) => block.text).join('\n');
            if (text.trim()) return text;
            // a pure tool_use turn: keep walking back to the last thing the user actually read
        }
        return '';
    } catch {
        return '';
    } finally {
        if (fd !== undefined) fs.closeSync(fd);
    }
}

/** Stop is the moment the hooks must not fight: the skill's own pauses and questions. */
const PAUSE_MARKERS = [
    'please run **`',                // compaction pause ("please run **`/compact`**")
    'Good moment to free up context',
    'correct, or edit #',            // DESIGN.md screen-collection confirmation
    'next curl, or done?',           // INTAKE.md multi-endpoint loop
    'next screen, or done?',         // DESIGN.md screen-collection loop
    'continue anyway',               // dirty-tree offer (SKILL.md Step 1)
];

function isLegitimateStop(text) {
    if (!text) return true; // nothing to judge — never block blind
    const lower = text.toLowerCase();
    if (PAUSE_MARKERS.some((marker) => lower.includes(marker.toLowerCase()))) return true;
    // A question to the user anywhere in the closing lines ("What are we
    // building? 1. Full · 2. Backend only …") — the skill asks dozens per run.
    const closing = text.split('\n').map((line) => line.trim()).filter(Boolean).slice(-3).join('\n');
    return closing.includes('?');
}

function emit(json) {
    process.stdout.write(JSON.stringify(json) + '\n');
}

function block(message) {
    process.stderr.write(message + '\n');
    process.exitCode = 2;
}

module.exports = {
    MANIFEST_FILE,
    BASELINE_FILE,
    SKILL_DIR,
    PAUSE_MARKERS,
    readStdin,
    readJson,
    findRun,
    listPersistedSpecs,
    screenProgress,
    lastAssistantText,
    isLegitimateStop,
    emit,
    block,
};
