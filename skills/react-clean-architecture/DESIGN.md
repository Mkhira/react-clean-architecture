# DESIGN.md — the design lane (Figma → screens → verified on device)

Runs in **full** mode (after backend generate/register/audit) and **design-only** mode.
Inputs: the spec's `design` block (fileKey + per-screen node IDs + flow transitions,
collected in SKILL.md Step 2c), the user story, and the service-card values (defaults
unless the user edited them). Reference implementation for every convention:
`src/features/integrated-tariff/presentation` in the target repo.

References shipped with this skill:
- [TOKEN_MAP.md](TOKEN_MAP.md) — Figma px/hex/variable → theme token mapping (verified values)
- [COMPONENTS.md](COMPONENTS.md) — every `@shared/components` component: props, variants,
  gotchas, usage. **Read the relevant entries BEFORE picking components — never re-read the
  component sources first.**

## 0. Ground rules (apply to every screen)

- **Arabic-first**: frames are Arabic RTL, 375pt wide → Figma pt map 1:1 to theme tokens.
  Verify pixel accuracy in Arabic; English must mirror correctly via logical properties.
- **Theme tokens only** — no hardcoded px/hex. Map via TOKEN_MAP.md; when a raw value has no
  exact token, use the nearest and note the original in a comment.
- **Ignore `hidden="true"` nodes** in Figma metadata — they are unused variant layers.
- **DIRECTION: trust ONLY rendered screenshots, never metadata order.** The app runs with
  `I18nManager` RTL on, so in any `flexDirection: 'row'` the FIRST child renders RIGHTMOST.
  Meanwhile `get_metadata` x-coordinates and the `get_design_context` HTML child order are
  INCONSISTENT for RTL auto-layout frames — some frames report logical order, some report
  final visual positions — so neither source can decide left/right. Procedure: for EVERY
  horizontal group (stat boxes, tag rows, tile grids, header action icons, legend rows,
  carousel item order), call `get_screenshot` on the group's node (or read it in the
  full-frame render) and place the child that appears RIGHTMOST first in the RN row; leave
  a comment. Carousels: the card fully visible in the frame render is item 1. During §3
  verification, compare every row's left/right order against the Figma render — not just
  colors and spacing. Shared components taking actions/items arrays follow the same rule
  (first array entry renders rightmost). Two more RTL traps: (1) RN SWAPS `textAlign:
  'left'/'right'` under RTL — never use physical textAlign to pin text to an edge; use
  layout (`justifyContent: 'space-between'`, wrapper Views) instead. (2) `alignItems`/
  `justifyContent` `flex-start`/`flex-end` are LOGICAL: in RTL `flex-start` is the physical
  RIGHT — to anchor content to the right edge (Arabic reading edge), use `flexStart`,
  never `flexEnd`.
- **STORY IS THE CONTRACT** (SKILL.md): states Figma doesn't draw (loading, error, empty,
  MSG-xx messages) come from the user story + the codebase patterns below. Figma-vs-story
  conflicts → ask the user, never resolve silently.
- **REUSE-FIRST**: shared components (COMPONENTS.md) → feature-local components → only then
  new code. New generic pieces are **always feature-local** (`presentation/components/…`) —
  never silently added to `@shared/components`.
- If the Figma MCP tools require their prerequisite skills (`figma-design-to-code` before
  `get_design_context`), invoke those skills first.

## 1. Mock vs real API (decided once per feature, before building)

**Spec has `mock: true`** (SKILL.md Step 2's mock-backend lane) → the decision is already
made: generate.js emitted `data/services/<Feature>MockService.ts` and the container serves
it — screens wire through the normal `queries.ts` hooks and never know they're mocked. SKIP
this section's question entirely; your job here is only to make sure the mock catalog is rich
enough for what the screens show (every filter option, status, multiple pages).

Otherwise ask ONLY: **"Is the BFF endpoint ready — should screens call the real API, or mock
the backend for now?"** Real → wire the generated repository/use cases directly (full mode
already has them). Not ready → set `mock: true` in the spec and follow SKILL.md's mock lane:
the mock seam is the SERVICE interface (`<Feature>MockService implements I<Feature>Service`,
registered in the container with a swap comment) so the real mappers/entities stay exercised —
**never** a repository-level adapter or controller-level sample data when a backend slice
exists. **Design-only mode with no backend slice: SKIP the question entirely** — there is no
service interface to mock; use static typed sample data in the controller with
`// TODO(claude): replace with queries.ts wiring` markers; if the user wants real API wiring,
tell them to rerun the skill in backend/full mode. Design-append where the persisted spec
already records the wiring decision: don't re-ask.

## 2. Per-screen build procedure (in the user's collection order)

For each screen unit (screen + its sheets/dropdowns/state frames):

1. **Fetch**: `get_design_context` + `get_screenshot` for the screen node; metadata for
   component/state nodes. Use `get_variable_defs` values when present — variable names map
   ~1:1 to theme tokens (see TOKEN_MAP.md).
2. **Plan — MANDATORY REUSE GATE (do this BEFORE writing any component file):** build an
   explicit element→component table for the screen: every visual element (cards, rows,
   sheets, chips, inputs, headers, collapsibles, carousels…) is mapped to a shared
   component via COMPONENTS.md's quick-lookup, and for anything not obviously covered,
   `ls src/shared/components/ui/{atoms,molecules,organisms}` and read the matching
   COMPONENTS.md entry before deciding — COMPONENTS.md is a snapshot; the directory
   listing is the live truth (a component present in the repo but missing from
   COMPONENTS.md means COMPONENTS.md must be regenerated, not that the component is fair
   game to rebuild). Only elements with NO shared match become feature-local components,
   and each new feature-local component's doc comment must name what was checked (e.g.
   "no shared match: CardDetails covers collapse but not X"). Rebuilding behavior a
   shared component already provides (collapsible card = CardDetails, label/value rows =
   Rows/CardDetailsRow, sheets = BottomSheetModal, etc.) is a review-blocking violation.
3. **Generate** into `src/features/<Feature>/presentation/`:
   - Feature-local components: one folder each — `index.tsx` + `styles.ts` + `types.ts`
     (types.ts holds `<Component>Props` with one-line JSDoc per field; styles.ts exports
     `createStyles = (theme: Theme) => StyleSheet.create({...})`).
   - Screens: `screens/<name>/index.tsx` (+ styles.ts/types.ts) or extend the starter
     `screens/<Feature>Screen.tsx` as the flow host.
   - **Controller** (`controller.ts`): ALL UI state + handlers; screens stay prop-driven with
     zero business logic. Server state ONLY through `queries.ts` hooks (never useState).
     Level/step derivation logic belongs in a domain use case, not the controller.
   - **Hooks rules**: `useEffect` only for side effects that leave React (global loader sync
     `setLoader({isLoading})` + a cleanup-only release effect; `setMessagePopup` on error;
     settled-empty popups gated on `isSuccess && !isFetching && length === 0`; reset-on-open
     for sheets). `useMemo` for derived data, `createStyles(theme)`, and prop objects.
     `useCallback` for every handler passed down; refs + functional updaters when a callback
     must stay referentially stable.
   - **Flow shell**: service flows live in ONE PageStepper screen with state-switched views
     (`detailsNode ? <Details/> : <Browse/>`), sheets as siblings via `BottomSheetModal`;
     footer buttons via the controller's `footerActions: StepperActionsProps` (mind the
     StepperActions traps in COMPONENTS.md). **Footerless screens** (the design has no
     bottom buttons — e.g. a pure list/browse screen): PageStepper ALWAYS renders its
     default "التالي" footer, so hide it with a partial override cast —
     `footerActions={{ containerStyle: styles.hiddenFooter } as StepperActionsProps}` with
     `hiddenFooter: { display: 'none' }` in styles.ts. The cast is safe: PageStepper spreads
     the override over its own step handlers (verified pattern, ApplicationStatus).
   - **Paginated lists (List organism + react-query)**: when search/filter state changes the
     query input, a cached page can answer INSTANTLY and swap the dataset within a single
     render — FlashList then keeps the STALE row layout while the pager shows the new totals
     (live bug: 2 rows next to a 4-page pager, self-healing on page change). Fix: remount the
     List on context change — controller returns
     ``listContextKey: `${search}|${statusCsv ?? ''}|…`}`` (every query param EXCEPT the page
     number) and the screen passes `key={listContextKey}` on `<List>`; page changes keep the
     key so paging never remounts. Pair it with the settled-empty gate
     (`showEmptyState: isSuccess && !isFetching && length === 0`) and
     `ListEmptyComponent={showEmptyState ? undefined : null}` — List renders its default
     EmptyView unless the prop is strictly `!== undefined`, so `null` suppresses the
     empty-state flash while a fetch is in flight (see COMPONENTS.md → List).
   - **Flow transitions** (`design.transitions` from Step 2c): every recorded edge becomes a
     REAL handler — never a TODO. `presentation: "push"` → a state-switched view inside the
     flow host (integrated-tariff pattern) or a pushed route when the target is a standalone
     screen; `"sheet"`/`"modal"` → a `BottomSheetModal`/`Modal` sibling opened by the
     trigger's handler. The screen described as main hosts the flow; per-edge triggers live
     in the controller (`handleOpen<Target>`), and verification (§3) must exercise each edge
     once — tap/deep-drive from → to and screenshot the target too.
   - **Translations**: add keys to `translations/ar.ts` + `en.ts` — Arabic seeded from the
     Figma frame text and the user story (MSG-xx tables become error keys), English drafted;
     both flagged as placeholders for Corporate Communication.
   - **Icons**: missing from `src/assets/icons`? Export the SVG from Figma
     (`download_assets`), save as `src/assets/icons/<kebab>.svg`, add the import +
     `camelName:` entry in `src/assets/icons/index.ts`. Never leave a TODO icon.
   - **Append anchors**: end every generated `controller.ts` return object, `styles.ts`
     object, and translations objects with a `// <design-lane:...>` line comment (e.g.
     `// <design-lane:controller-return>`) so design-append can insert mechanically later.
4. **Tests**: controller-hook tests (derived state, handlers, terminal/branch logic) AND
   component render tests (`@testing-library/react-native`) into the feature's `test/` dir.
   The infra is guaranteed by SKILL.md Step 1.5 (`setup-test-infra.js` auto-installs the
   library and wires `jest.setup.js`) — render tests are REQUIRED, not optional; skip them
   ONLY if that install failed, and say so in the report. RTL v14: `render()` is **async** —
   always `await render(...)`; native-module mocks live in the repo's `jest.setup.js`.
   Components needing theme/i18n get a feature-local render wrapper (REUSE-FIRST: check
   `src/shared/testing/` before writing one). Priority render cases: the empty/loading gate
   (never show the empty view while fetching), status-variant mapping on tags, RTL-direction
   props, and one screen smoke render.
5. **Verify** (section 3) → **checkpoint** (section 4) → next screen.

## 3. Verification loop (iOS simulator)

**Preflight (once per run): touch injection.** Check `command -v idb` — if missing, also try
`export PATH="$HOME/.local/bin:$PATH"` first (pipx installs there and fresh shells may lack
it). The skill's installer auto-installs idb (brew `facebook/fb/idb-companion` + pipx
`fb-idb`); when present, verification is INTERACTIVE — drive the UI with real taps instead
of temp-code tricks:

- `idb list-targets` → confirm the booted simulator; commands target it automatically.
- `idb ui tap <x> <y>` (points, origin top-left) — tap buttons, filter icons, pager numbers.
  Get coordinates from the screenshot you just took (screenshot px ÷ scale = points).
- `idb ui text '<text>'` after tapping an input — type into search fields;
  `idb ui key 40` = return.
- Use taps to exercise EVERY `design.transitions` edge and every interactive state
  (sheets open via the real trigger, filters actually applied, pagination actually paged —
  the ApplicationStatus pagination bug was only reachable through a 3-tap sequence).

idb missing (installer skipped/failed) → fall back to the temp-edit tricks (auto-open sheets
via `initialVisible: true`, forced page size, etc. — ALWAYS reverted after screenshots) and
note "screenshot-only verification" in the checkpoint + final report.

Per screen, after generation compiles (`npx tsc --noEmit` clean vs baseline):

1. Build/launch: booted simulator + `npx expo run:ios` (or relaunch the installed dev build:
   `xcrun simctl launch booted com.zatca.app`). Metro: plain `npx expo start` — the repo's
   `start:dev` script passes `--env-file`, which this CLI rejects; Expo auto-loads `.env` +
   `.env.development` anyway. **Stale-bundle trap**: an app launched before Metro was ready
   runs the OLD embedded bundle (new routes 404 into the generic scaffold with a fallback
   service id) — after Metro prints "Waiting on", TERMINATE and relaunch the app, then wait
   for Metro's "Bundled … (N modules)" line before navigating/screenshotting. Deep link
   directly to the flow with `xcrun simctl openurl booted "zatca://service-flow/<id>"`.
2. Navigate to the screen (registration in section 5 makes it tappable from the Services
   tab). Login-required features: apply the user's access token via the auth session
   (`saveAccessToken`/`setAuthToken`; MMKV key `authToken`) — runtime only, never in a file.
3. Screenshot: `xcrun simctl io booted screenshot <scratch>/<screen>-ar-light.png`; toggle
   dark mode in-app (Menu → theme TogglePill, persisted `App-Theme`) and screenshot again.
   Compare BOTH against the Figma screenshot; fix diffs (spacing, order, wrapping, colors)
   and re-verify.
4. RTL nuance: the app defaults to Arabic; if the language was switched, `I18nManager`
   direction fully applies on the NEXT launch — relaunch before judging RTL layout. English
   check: one mirror sanity pass per screen (not pixel-level).

## 4. Checkpoint (per screen, before the next)

Show the user: the Figma vs simulator screenshots (light + dark), a short list of decisions
and deviations (nearest-token substitutions, states inferred from the story, icons added),
and anything that needs their eyes. Wait for their go-ahead, then continue to the next screen
in order.

## 5. Navigation registration (once per feature, before first verification)

The design lane REGISTERS the feature (decision: auto-register; backend-only mode never does
this). For id `my-flow`, page key `myFlow`:

1. `src/core/navigation/routes/RouteContract.ts` — 3 edits: `myFlow` in the `serviceFlow`
   type block; its `toHref: () => '/service-flow/my-flow'`; the `'serviceFlow.myFlow'` entry
   in the flat `routeDefinitions` map.
2. `src/core/navigation/routes/Routes.ts` — `Routes.serviceFlow.myFlow()` builder.
3. `app/service-flow/my-flow.tsx` — dedicated Expo Router file rendering the feature screen
   (dedicated-file pattern, like integrated-tariff). Use an `as Href` cast until the next
   `expo start` regenerates typed routes.
4. `src/presentation/service-flow/screens/pages/index.ts` —
   `registerServiceFlowPage(['myFlow', 'my-flow'], { component, serviceId, titleKey,
   descriptionKey })`.
5. `src/presentation/services/models/servicesData.ts` — the SERVICES_DATA entry from the
   spec's `design.serviceCard` (Step 2c defaults unless the user edited them:
   `screen: Routes.serviceFlow.myFlow()`, cost, serviceTypes, userTypes, fees,
   processingTimeMinutes, `requiresAuth`, `addedAt: Date.UTC(...)` today). This alone puts
   the card on the Services tab + details screen.
6. `src/core/localization/translations/{en,ar}.json` — `services.<featureCamel>.title/
   description` for the card; `serviceFlow.pages.<featureCamel>.*` if the generic host is
   ever used. Feature-namespace strings live in the feature's own translations barrel, merged
   via merger.ts — register-di.js wires that in backend/full modes; **in design-only mode add
   the merger.ts import + `featureTranslations` entry BY HAND** (register-di never runs).
7. `src/core/deepLinking/DeepLinkingService.ts` — add both aliases to
   `dedicatedServiceFlowRoutes`.
8. Home shortcut — ONLY if the user explicitly asked for one: hand-edit the Home components
   (`src/presentation/home/…`); Home cards are hardcoded and nothing there is automatic.
9. Feature slice: `presentation/routes.ts` exporting `<FEATURE>_SERVICE_ID` /
   `<FEATURE>_PAGE_KEY` + a typed route builder; export the screen + routes from the feature
   `index.ts` barrel.

All these files go into the manifest's `patched` list (append them by hand to
`.claude-skill-manifest.json`) so rollback covers them. **Design-only mode has no manifest**
(generate.js never ran) — create one at the repo root as
`{"feature": "<Feature>", "mode": "design", "created": [], "patched": []}` and record the
lane's files there, so aborting still has a rollback map.

## 6. Design append (add/rework one screen later)

Load the persisted spec's `design` block first — full-mode features persist it via
`audit.js --persist-spec`; design-only features persist a hand-written
`feature-spec.json` (`{feature, skillVersion, design}` only, per SKILL.md Step 1b) right
after screen collection. After each design run, update the block's screen `status` values
and the persisted file so the record stays current. **Collection for design-append = Step 2c
item 1 ONLY (one screen unit) plus a one-row summary** — reuse the persisted `serviceCard`
silently and skip the §1 mock question whenever the wiring decision already exists in the
persisted spec. Collect the one screen unit (SKILL.md Step
2c, single iteration), then integrate: new state/handlers into the existing controller at the
`// <design-lane:*>` anchors (hand-edit if the feature predates them), new keys appended to
the existing translations (never remove keys), new components in their own folders. Existing
screens must not change behavior — verify the new screen AND smoke-check one existing screen.
Pre-skill features (integrated-tariff, account, …): everything by hand, matching THAT
feature's own conventions.

## 7. Definition of done (per feature)

- Every collected screen built, verified (AR light + dark, EN mirror), and checkpointed.
- `npx tsc --noEmit` clean vs baseline; feature jest suites (controller + component tests)
  green; audit re-run passes (backend/full modes — in design-only mode audit never runs:
  the tsc diff + jest suites stand in for it).
- Working files cleaned up LAST: delete `.claude-skill-tsc-baseline.json` and
  `.claude-skill-manifest.json` from the repo root only now — the design lane needed both
  (AUDIT.md's cleanup is deferred to here in full/design modes).
- Navigation registered; service card visible on the Services tab; deep-link aliases work.
- No TODO(claude) left except ones the user explicitly deferred; translations flagged for
  Corporate Communication in the final report.
