# APPEND.md — appending to an existing feature

Read this when Step 1 finds the feature already exists and the mode answer routes to an
endpoint append (backend/full). Design append (add/rework ONE screen) is DESIGN.md §6.

`audit.js --persist-spec` leaves `src/features/<feature-dir>/feature-spec.json` — load it FIRST for
full prior context (host types, provenance, enums) without re-asking.

**User story in append mode:** check `src/features/<feature-dir>/userStory/` right after loading
the spec. Story file(s) exist → at the story point of the intake sequence ask ONE question:
"use the existing story (<file names>) for the new endpoint(s), or write a new one?" (reading
the existing file(s) first so the reuse offer is informed). No directory → ask the usual
write/skip question. A NEW story → its own `.md` file per the naming rule (create the
directory if missing). Whichever story applies, the STORY IS THE CONTRACT rule holds.

| Target | Behavior |
|---|---|
| Skill-generated feature (anchors present) | Scripts insert at anchors + add missing imports; new per-endpoint files created; never overwrites |
| Pre-skill feature (no anchors, e.g. TaxStampValidation, account, integrated-tariff) | Scripts report NEEDS_MANUAL → YOU edit by hand, matching THAT feature's own conventions (even singular folder names) |
| Append turns same-host feature into mixed-host | Scripts detect + report — YOU patch the service ctor, its imports, and the DI registration args |
| New endpoint uses device provenance, repo lacks `getDeviceMetadata()` | Reported → add the private helper by hand |
| Anchor hand-deleted / same action twice | Reported → careful manual edit / skip or suffix |
| Translations | Append generates NO new keys (they are feature-level) — hand-add any new screen strings to the existing `en.ts`/`ar.ts`, never removing existing keys |
| User story | Existing `userStory/*.md` → offer reuse before asking for a new one; none → ask write/skip; a new story gets its own file — existing story files are never overwritten or deleted |
| Design append (add/rework ONE screen) | Ask which feature → load its spec's `design` block (or start one) → collect the screen unit (DESIGN.md Screen collection, one screen) → build + verify per DESIGN.md, integrating into the EXISTING controller/translations without touching other screens. Pre-skill features (integrated-tariff, …): hand-edit matching THAT feature's conventions |
