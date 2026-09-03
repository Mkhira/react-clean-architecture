# REVIEW.md — the conventions PR reviewers enforce (SKILL.md Step 4b)

Read this before you hand-write anything — the use-case rules in Step 5.3, every screen in
the design lane, every component and controller. `audit.js`'s `review-conventions` check
enforces the mechanical ones; the rest are on you.

## Review conventions (mandatory for everything you hand-write)

Every rule below comes from a real PR review round on this repo — each one was raised by a
human reviewer against skill-generated code. `audit.js`'s `review-conventions` check
enforces the mechanical ones; the rest are on you. Apply them to hand-written code in
Steps 5–8b and to any screen you build in the design lane.

**Single source of truth for enums.** A status/type value list lives in
`domain/constants/<featureCamel>.ts` and NOWHERE else. The entity union derives from it
(`(typeof VALUES)[number]`), mappers validate against it, mock catalogs iterate it, and
filter/tab options map over it. If you catch yourself typing the same
`['DRAFT', 'SUBMITTED', …]` a second time — in a mapper, a mock, a controller, a card
component — import it instead. This applies to any repeated literal set, not just statuses.

**Errors reuse `AppError`.** `src/shared/types/errors.ts` owns the code union
(`NETWORK_ERROR | AUTH_ERROR | TIMEOUT | VALIDATION_ERROR`). Never invent feature codes
(`HTTP_ERROR`, `PARSE_ERROR`) and never widen with `Omit<AppError, 'code'>`. Map real
failures onto the existing four: a malformed payload is `VALIDATION_ERROR`, a bad HTTP
response is `NETWORK_ERROR`. A genuinely new code goes into `AppError` itself, where every
feature shares it — and that is a core edit, so ask first.

**Mappers are plain functions.** A mapper file exports `to<Entity>(dto)` for the response
and `to<Action>RequestDTO(input)` for the request — `toGetApplicationStatusListResult`,
`toTaxpayerLoginRequestDTO` — never a `<Action>Mapper = { toDomain, toDTO }` object. Nine of
the repo's twelve feature mapper directories use the function form; the object form the skill
generated before 1.20.0 was hand-converted by reviewers. Sub-mappers (`toXItem`, `toXMeta`)
are top-level functions in the same file; `cleanString` stays mapper-local.

**The errors file aliases the shared union.** `export type <FEATURE>_ERROR_CODES =
INFRA_ERROR_CODES` (from `@shared/types/errors`), `export type <Feature>Error = AppError`, a
`create<Feature>Error` factory, a `readonly <FEATURE>_ERROR_CODES[]` values array and an
`is<Feature>Error` guard. Do not derive the union from a local `as const satisfies` array —
it drifts from `AppError` the day a code is added there.

**Optional query params are optional in the type.** When the API tolerates a missing query
param, the spec marks it `{ "name": "status", "type": "string", "optional": true }` and the
generated `query: { status?: string }` / input type say so; callers never pad with empty
strings. A required-typed param the callers omit is exactly the kind of hand edit that later
blocks `migrate-feature.js` (signature drift).

**Never swallow a failure.** Every `catch` that converts to `Result.err` logs first via the
injected `ILogger` (`this.logger.exception(...)`). Use cases take the logger as a
constructor arg; `register-di.js` wires it through `withLogger`.

**Presentation file placement.** Magic numbers, key arrays, debounce delays, tag/variant
maps → `presentation/constants.ts`. Prop and state types → `presentation/types.ts`. Data
fetching, derived values, `renderItem`/`keyExtractor`/`pagination` memos, and every
handler → the controller; screens receive finished values and render them. A screen that
computes anything beyond JSX has logic in the wrong file.

**Forms go through the form builder.** Any screen with inputs uses `@shared/formBuilder`:
config array in a memoised `use<Flow>Fields` hook, `useFormBuilder` in the controller,
`<FormBuilder {...formProps} />` in the screen with zero input JSX. Field-dependent behaviour
is `visibleWhen` / `disabled(values)` / `visibleWhen` variants — not a config rebuilt from the
host, and not host state. Render contract: `subscribeHost: false` on a screen with chrome,
`commitOnBlur: true` on free-text fields, `getValues()`/`getErrors()` in handlers instead of
the render snapshot, the PageStepper store written once per step boundary. Full rules and the
escape-hatch ladder: [FORMS.md](FORMS.md). Reviewers have rejected hand-wired forms on the same
grounds as hand-rebuilt shared components.

**No dead modules.** Never leave a placeholder file nothing imports — reviewers flag it
immediately ("this is not used at all"). Create `constants.ts` / `types.ts` when there is
real content for them, not preemptively.

**Theme tokens only in styles.** No raw numbers or RN keyword strings in a `styles.ts`:
`flex: theme.flex1`, `display: theme.display.none`, `flexDirection: theme.flexDirection.row`,
spacing/radius/typography from their scales. If a token genuinely doesn't exist, ADD it to
`src/core/theme/baseStyles.ts` and the `Theme` type in `src/core/theme/types.ts`, then use
it — that is the reviewers' stated preference over a raw value.

**Text uses `Label` presets.** Prefer `<Label type="…">` (`defaultParagraph`, `cardTitle`,
`h1Header`, `h2Header`, `labelName`, `fieldLabelName`, `fieldInput`) over restating
`fontSize`/`lineHeight` in a style. Override in the style only the property no preset
carries (e.g. a SemiBold weight at a size no type provides) and say why in a comment.

**One translation object per service.** The service's title/description live at
`services.<camel>.*` and the page registry points there. Never add a second copy under
`serviceFlow.pages.<camel>` — two objects drift apart and reviewers reject the duplicate.
