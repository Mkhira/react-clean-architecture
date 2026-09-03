#!/usr/bin/env node
'use strict';
/**
 * guard-self-update.js — PreToolUse hook (matcher: Bash).
 *
 * SKILL.md "Update check": "Never update the skill yourself — no git pull, no
 * /plugin update, no re-running install.sh. It is their install; the command
 * is theirs to run, between runs." An update mid-run swaps the scripts under a
 * half-finished feature. This blocks exactly those commands, mechanically:
 *
 *   - git pull/fetch/checkout/switch/reset/rebase/merge that names the skill's
 *     directory (real path, the CLAUDE_SKILL_DIR symlink path, or the clone's
 *     root), or runs with -C / cd into it
 *   - `claude plugin update`, `/plugin update`, `/plugin marketplace update`
 *   - `npx skills … add … react-clean-architecture`
 *   - the skill's install.sh
 *
 * Everything else — including git in the target repo — passes untouched.
 * Active whenever the hook is loaded (it does not need a manifest: the rule
 * holds between runs too).
 */
const path = require('path');
const { readStdin, SKILL_DIR, block } = require('./_common.js');

function skillPaths() {
    const paths = new Set([SKILL_DIR, path.resolve(SKILL_DIR, '..', '..')]);
    if (process.env.CLAUDE_SKILL_DIR) paths.add(path.resolve(process.env.CLAUDE_SKILL_DIR));
    return [...paths];
}

// `git` in command position only (start, or after && ; | ( or sudo) — a quoted
// mention inside an echo is not a mutation.
const GIT_MUTATORS = /(^|[;&|(]\s*|\bsudo\s+)git\s+(-C\s+\S+\s+)?(pull|fetch|checkout|switch|reset|rebase|merge)\b/;

function violation(command) {
    if (!command) return null;
    if (/(^|\s|\/)plugin\s+(marketplace\s+)?update\b/.test(command)) return 'plugin update';
    if (/\bnpx\s+skills\b[^|;&]*\badd\b[^|;&]*react-clean-architecture/.test(command)) return 'npx skills add';
    const mentionsSkill =
        skillPaths().some((p) => command.includes(p)) ||
        /react-clean-architecture/.test(command);
    if (mentionsSkill && /\binstall\.sh\b/.test(command)) return 'install.sh';
    if (mentionsSkill && GIT_MUTATORS.test(command)) return 'git update of the skill clone';
    return null;
}

function main() {
    const input = readStdin();
    const command = input.tool_input && typeof input.tool_input.command === 'string' ? input.tool_input.command : '';
    const hit = violation(command);
    if (!hit) return;
    block(
        `react-clean-architecture SKILL.md: never update the skill yourself (${hit}). ` +
        'Tell the user the update command check-update.js printed and let them run it between runs; continue on the installed version.'
    );
}

if (require.main === module) main();
module.exports = { violation, GIT_MUTATORS };
