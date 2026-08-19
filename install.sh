#!/usr/bin/env bash
# Universal installer for the react-clean-architecture Agent Skill.
#
#   ./install.sh claude                      # Claude Code, user-wide (~/.claude/skills)
#   ./install.sh claude --project <dir>      # Claude Code, one project (.claude/skills)
#   ./install.sh cursor                      # Cursor, user-wide (~/.cursor/skills)
#   ./install.sh cursor --project <dir>      # Cursor, one project (.cursor/skills + rule)
#   ./install.sh codex                       # Codex CLI, user-wide (~/.codex/skills + ~/.codex/AGENTS.md)
#   ./install.sh codex  --project <dir>      # Codex CLI, one project (.agent-skills + AGENTS.md)
#   ./install.sh agents --project <dir>      # any AGENTS.md-compatible agent (same as codex)
#   ./install.sh tools                       # ONLY install the simulator touch tools (idb) —
#                                            # for skills installed via npx skills / plugin
#                                            # marketplace / manual copy, which skip this script
#
# Add --copy to copy instead of symlink (Claude target only; others always copy).
# Add --no-tools to skip the idb simulator-touch-tool install (macOS only).
# Re-running is safe: links are refreshed, copies replaced, AGENTS.md updated in place.
set -euo pipefail

SKILL_NAME="react-clean-architecture"
# pwd -P: resolve symlinks — the skill dir is often a symlink (e.g. from
# ~/.claude/skills). Copying a symlink source would copy the LINK, and any
# later cleanup through it would mutate the real checkout.
SRC="$(cd "$(dirname "$0")/skills/$SKILL_NAME" && pwd -P)"
if [ ! -f "$SRC/SKILL.md" ]; then
  echo "error: $SRC/SKILL.md not found — run install.sh from the repo root" >&2
  exit 1
fi

TARGET="${1:-}"
PROJECT=""
COPY=0
TOOLS=1
shift || true
while [ $# -gt 0 ]; do
  case "$1" in
    --project)  PROJECT="$2"; shift 2 ;;
    --copy)     COPY=1; shift ;;
    --no-tools) TOOLS=0; shift ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

die() { echo "error: $*" >&2; exit 1; }

# Never let an install destination destroy the skill source itself — e.g.
# running `./install.sh claude` from a checkout that already lives at
# ~/.claude/skills/react-clean-architecture, or a dest that is (or contains)
# a symlink back to the source.
guard_dest() { # $1 = destination dir
  local resolved
  if [ -e "$1" ] || [ -L "$1" ]; then
    resolved="$(cd "$1" 2>/dev/null && pwd -P || true)"
    [ "$resolved" = "$SRC" ] && die "destination $1 resolves to the skill source — nothing to do (already installed here)"
  fi
  case "$SRC/" in "$1"/*) die "destination $1 contains the skill source" ;; esac
}

need_project() {
  [ -n "$PROJECT" ] || die "this target needs --project <dir>"
  [ -d "$PROJECT" ] || die "no such directory: $PROJECT"
  PROJECT="$(cd "$PROJECT" && pwd)"
}

install_copy() { # $1 = destination dir
  guard_dest "$1"
  rm -rf "$1"
  mkdir -p "$(dirname "$1")"
  cp -R "$SRC" "$1"
  # paranoia: never clean through a link — only a real, independent directory
  [ -L "$1" ] && die "copy produced a symlink at $1 — aborting before cleanup"
  [ -d "$1/.git" ] && [ ! -L "$1/.git" ] && rm -rf "$1/.git"
  echo "copied  → $1"
}

install_link_or_copy() { # $1 = destination dir
  if [ "$COPY" = 1 ]; then install_copy "$1"; return; fi
  guard_dest "$1"
  mkdir -p "$(dirname "$1")"
  rm -rf "$1"
  ln -s "$SRC" "$1"
  echo "linked  → $1"
}

# idb (Facebook's iOS debug bridge) gives the design lane real touch injection
# on the iOS simulator (`idb ui tap x y`) — without it, verification falls back
# to screenshot-only + temp-code tricks. Installed automatically (user decision
# 2026-08-19); every step is non-fatal so a tool failure never breaks the skill
# install itself. Skip with --no-tools.
install_touch_tools() {
  [ "$TOOLS" = 1 ] || { echo "tools   → skipped (--no-tools)"; return 0; }
  [ "$(uname -s)" = "Darwin" ] || { echo "tools   → skipped (idb is macOS-only)"; return 0; }
  if command -v idb >/dev/null 2>&1; then
    echo "tools   → idb already installed"
    return 0
  fi
  echo "tools   → installing idb (simulator touch injection; may take a few minutes)…"
  # -- the companion (native daemon) --
  if command -v brew >/dev/null 2>&1; then
    if ! brew list idb-companion >/dev/null 2>&1; then
      # idb-companion lives in Facebook's tap, not homebrew-core
      brew tap facebook/fb >/dev/null 2>&1 || echo "tools   → WARN: brew tap facebook/fb failed" >&2
      brew install facebook/fb/idb-companion || echo "tools   → WARN: brew install idb-companion failed" >&2
    fi
  else
    # No Homebrew — and Homebrew itself is NEVER auto-installed (that means
    # piping a remote script with admin rights; an installer must not do that
    # silently). Instead: Facebook publishes a prebuilt universal companion on
    # every GitHub release — download it to ~/.local (user-writable, no sudo).
    echo "tools   → Homebrew not found; using the prebuilt companion from the GitHub release"
    COMPANION_HOME="$HOME/.local/idb-companion"
    # note the underscore: the release archive ships bin/idb_companion, and the
    # python client searches PATH for exactly "idb_companion"
    COMPANION_BIN="$COMPANION_HOME/idb-companion.universal/bin/idb_companion"
    if [ ! -x "$COMPANION_BIN" ]; then
      TMP_DL="$(mktemp -d)"
      if curl -fsSL -o "$TMP_DL/idb-companion.tar.gz" \
           https://github.com/facebook/idb/releases/latest/download/idb-companion.universal.tar.gz \
         && mkdir -p "$COMPANION_HOME" \
         && tar -xzf "$TMP_DL/idb-companion.tar.gz" -C "$COMPANION_HOME"; then
        :
      else
        echo "tools   → WARN: companion download/extract failed (network?) — install by hand:" >&2
        echo "          https://github.com/facebook/idb/releases (idb-companion.universal.tar.gz)" >&2
      fi
      rm -rf "$TMP_DL"
    fi
    if [ -x "$COMPANION_BIN" ]; then
      # wrapper, not a symlink: the binary locates its Frameworks/ relative to
      # its own real path, so it must be exec'd at its extracted location
      mkdir -p "$HOME/.local/bin"
      printf '#!/bin/sh\nexec "%s" "$@"\n' "$COMPANION_BIN" > "$HOME/.local/bin/idb_companion"
      chmod +x "$HOME/.local/bin/idb_companion"
    fi
  fi
  # pipx's default interpreter can be a broken Homebrew python (seen live:
  # python@3.14 failing platform.mac_ver()) — retry pinned to the system python
  pipx_install_fb_idb() {
    pipx install fb-idb >/dev/null 2>&1 \
      || pipx install --python /usr/bin/python3 fb-idb >/dev/null 2>&1 \
      || pipx upgrade fb-idb >/dev/null 2>&1
  }
  if command -v pipx >/dev/null 2>&1; then
    pipx_install_fb_idb || echo "tools   → WARN: pipx install fb-idb failed" >&2
  elif brew install pipx >/dev/null 2>&1 && command -v pipx >/dev/null 2>&1; then
    pipx ensurepath >/dev/null 2>&1 || true
    pipx_install_fb_idb || echo "tools   → WARN: pipx install fb-idb failed" >&2
  elif command -v python3 >/dev/null 2>&1; then
    python3 -m pip install --user fb-idb >/dev/null 2>&1 \
      || echo "tools   → WARN: pip install fb-idb failed" >&2
  else
    echo "tools   → WARN: no pipx/python3 — install fb-idb by hand: pipx install fb-idb" >&2
  fi
  if command -v idb >/dev/null 2>&1; then
    echo "tools   → idb ready (design lane will verify with real taps)"
  elif [ -x "$HOME/.local/bin/idb" ] || ls "$HOME"/Library/Python/*/bin/idb >/dev/null 2>&1; then
    # installed, just not on PATH in this shell (pipx → ~/.local/bin;
    # `pip --user` on Apple's framework python → ~/Library/Python/<ver>/bin)
    echo "tools   → idb installed but not on PATH yet — add to your shell profile:"
    echo "            export PATH=\"\$HOME/.local/bin:\$HOME/Library/Python/*/bin:\$PATH\""
  else
    echo "tools   → WARN: idb client not installed — design lane falls back to screenshot-only." >&2
    echo "          Manual: pipx install fb-idb   (or: python3 -m pip install --user fb-idb)" >&2
  fi
}

write_agents_block() { # $1 = AGENTS.md path, $2 = skill dir (relative to project)
  local file="$1" rel="$2"
  local begin="<!-- BEGIN ${SKILL_NAME} skill -->"
  local end="<!-- END ${SKILL_NAME} skill -->"
  local tmp; tmp="$(mktemp)"
  if [ -f "$file" ]; then
    awk -v b="$begin" -v e="$end" '$0==b{skip=1} !skip{print} $0==e{skip=0}' "$file" > "$tmp"
  else
    : > "$tmp"
  fi
  cat >> "$tmp" <<EOF
$begin
## Skill: ${SKILL_NAME}

When the user asks to create/scaffold a feature, add an endpoint to a feature,
or build Figma screens for a feature, READ AND FOLLOW \`${rel}/SKILL.md\`
step by step (it links DESIGN.md, SPEC_FORMAT.md and AUDIT.md as needed).
Run its Node scripts from the repository root exactly as SKILL.md instructs —
do not re-implement what the scripts already do.
$end
EOF
  mv "$tmp" "$file"
  echo "updated → $file"
}

# touch tools first (valid targets only) — non-fatal, see install_touch_tools
case "$TARGET" in
  claude|cursor|codex|agents|tools) install_touch_tools ;;
esac

case "$TARGET" in
  tools)
    # tools-only run: skill files untouched (for npx-skills/plugin/manual installs)
    ;;

  claude)
    if [ -n "$PROJECT" ]; then
      need_project
      install_link_or_copy "$PROJECT/.claude/skills/$SKILL_NAME"
    else
      install_link_or_copy "$HOME/.claude/skills/$SKILL_NAME"
    fi
    echo "done. Claude Code discovers the skill automatically (SKILL.md frontmatter)."
    ;;

  cursor)
    if [ -z "$PROJECT" ]; then
      install_copy "$HOME/.cursor/skills/$SKILL_NAME"
      echo "done. Cursor discovers user-wide skills in ~/.cursor/skills (Agent Skills format)."
      exit 0
    fi
    need_project
    DEST="$PROJECT/.cursor/skills/$SKILL_NAME"
    install_copy "$DEST"
    mkdir -p "$PROJECT/.cursor/rules"
    cat > "$PROJECT/.cursor/rules/$SKILL_NAME.mdc" <<EOF
---
description: Scaffold clean-architecture features (backend slice from a curl, Figma screens via the design lane). Apply when the user asks to create/scaffold a feature, add an endpoint, or build feature screens from Figma.
alwaysApply: false
---

READ AND FOLLOW \`.cursor/skills/$SKILL_NAME/SKILL.md\` step by step.
It is the single source of truth for the workflow (intake → spec → generate →
register → audit → design lane). Run its Node scripts from the repo root as
instructed — never re-implement what the scripts do. In flat-text UIs, ask the
intake questions as plain numbered questions, ONE per message.
EOF
    echo "updated → $PROJECT/.cursor/rules/$SKILL_NAME.mdc"
    echo "done. Cursor picks the rule up on the next Agent request."
    ;;

  codex|agents)
    if [ -z "$PROJECT" ]; then
      install_copy "$HOME/.codex/skills/$SKILL_NAME"
      write_agents_block "$HOME/.codex/AGENTS.md" "$HOME/.codex/skills/$SKILL_NAME"
      echo "done. Codex CLI reads ~/.codex/AGENTS.md globally and will route to the skill."
      exit 0
    fi
    need_project
    DEST="$PROJECT/.agent-skills/$SKILL_NAME"
    install_copy "$DEST"
    write_agents_block "$PROJECT/AGENTS.md" ".agent-skills/$SKILL_NAME"
    echo "done. Codex CLI (and any AGENTS.md-compatible agent) will route to the skill."
    ;;

  *)
    sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
