# FORMS.md — `@shared/formBuilder` is the default for anything with inputs

Companion to [COMPONENTS.md](COMPONENTS.md). COMPONENTS.md answers *"which shared component
renders this element?"*; this file answers the question that comes **first** on any screen that
collects input: *"is this a form?"* — and if it is, the screen does not wire input components at
all. It hands a config array to the form builder.

Source of truth in the repo: `src/shared/formBuilder/` and its
`src/shared/formBuilder/HOW_TO_USE.md` (684 lines, the full API reference). This file is the
**decision procedure and the render/perf contract** — read HOW_TO_USE.md for exhaustive prop
tables, read this to decide what to build and how to wire it.

Reference implementations, all three live in the repo:

| Pattern | Where |
|---|---|
| Form builder inside a PageStepper flow (the default) | `src/features/BankAccountManagement/presentation/screens/` — `useAddIbanController.ts`, `addIban/useAddIbanFields.tsx`, `AddIbanScreen.tsx` |
| Multi-step form, one field config per step | `src/features/report/presentation/screens/SubmitReport/fields/*.ts` |
| Hand-wired escape hatch (draft refs, no form) | `src/presentation/account/screens/taxAccountLogin/` — `controller.ts` + `index.tsx` |

---

## 1. THE RULE (form-first gate, mandatory)

> **A screen that collects input for a submission is a form, and a form is a
> `FormFieldConfig[]` handed to `<FormBuilder />`. Hand-wiring `TextInput` /
> `DraftTextInput` / `DropdownInput` / `DatePicker` / `FileUpload` / `Checkbox` /
> `OptionGroup` into such a screen when the form builder covers the field type is a
> review-blocking violation** — the same class of finding as rebuilding a shared component.

"For a submission" is the test, not the field count: one field that is a step in a flow is a
form; three unrelated controls scattered through a settings screen are not.

Why it is a rule and not a preference: a hand-wired form has to re-solve six things the builder
already owns — per-field error state, blur validation timing, conditional visibility,
reset-on-change side effects, required-message i18n keys, and keystroke render isolation. Each
was a real defect fixed in the shared layer on 2026-08-31 (nine in total, including type-aware
resets, pruning errors of fields a `visibleWhen` flip hid, and dot-path defaults). A feature
that opts out inherits none of those fixes, nor the ones that land later.

Run this gate **in Step 2 of the per-screen build procedure** (DESIGN.md §2), before the
element→component table, because its answer changes what that table is for:

1. Does the screen collect input for a submission? → No: skip this file entirely, go straight
   to COMPONENTS.md.
2. → Yes: list every input element and map each one through §2's table below.
3. Every element maps to a field type → the screen is `<FormBuilder {...formProps} />` plus
   chrome. **You write no input JSX.**
4. Some element has no field type → §3's ladder decides between `type: 'custom'`, a shared
   component beside the form, and (last) the hand-wired fallback. Whatever you choose, the
   *rest* of the form still goes through the builder — a single unusual field never justifies
   hand-wiring the whole screen.

A single standalone input that is not part of a form — a search box in a list header, a filter
dropdown, a toggle in a settings row — is **not** a form. Use the shared component directly
(COMPONENTS.md). The gate is about forms, not about inputs.

---

## 2. Coverage — what the builder already renders

14 field types. If your element is in this table, it is a config entry, not JSX. The right-hand
column is what the builder renders internally, listed so you can check the component's own
gotchas in COMPONENTS.md — **never so you can render it yourself.**

| Element in the design | `type:` | Builder renders |
|---|---|---|
| Any text field (name, number, email, password, currency, phone) | `'text'` (+ `variant`) | `TextInput`, or `DraftTextInput` when `commitOnBlur: true` |
| Multi-line text / notes box | `'textarea'` | `TextInput` `variant='textarea'` |
| Select field (searchable, modal picker) | `'dropdown'` | `DropdownInput` trigger + ONE shared `Dropdown` modal hosted by `<FormBuilder>` for the whole form |
| Single-choice option list | `'radio'` | `OptionGroup` |
| Multi-choice option list | `'checkboxGroup'` | `OptionGroup` |
| Single checkbox (terms, opt-in) | `'checkbox'` | `Checkbox` |
| Date field (Gregorian/Hijri) | `'date'` | `DatePicker` |
| Attachment picker | `'fileUpload'` | `FileUpload` (you still supply `onBrowse`/`onRemoveFile`) |
| Section heading between field groups | `'section'` | `Label` |
| "Verified ✓" style inline status line | `'status'` | `Label` + `Icon` |
| Read-only label/value summary block | `'details'` | `CardDetails` + `Rows` |
| Inline action button inside the form (e.g. "Verify with Nafath") | `'action'` | `Button` |
| Nested/indented group of fields | `'group'` | `View` + recursive rendering |
| Anything else | `'custom'` | your render function — see §3 |

Everything below is **config, not host code** — using host state for any of these is the most
common way features lose the render guarantees in §4:

| Behaviour | Config |
|---|---|
| Show/hide a field on another field's value | `visibleWhen:` `{ field, equals }` · `{ field, notEquals }` · `{ field, in: [...] }` · `{ field, notEmpty: true }` · `{ field, empty: true }` · `(values) => boolean` |
| Label/helper/maxLength that follows another field's value | several configs sharing one `name`, each with its own `key` + `visibleWhen` (see `ID_NUMBER_VARIANTS` in `useAddIbanFields.tsx`) |
| Disable until a prerequisite arrives | `disabled: (values) => !values.formGuid` |
| Clear dependent fields when a parent changes | `resetFieldsOnChange: ['city']` (type-aware: `''` / `false` / `[]`) |
| React to a committed change (lookup, analytics) | `onFieldChange: (value, values) => void` |
| Per-keystroke formatting | `formatText: formatIbanInputDigits` |
| Validation | `required`, `validation: { preset }` or `{ presets: [...] }` (44 built-ins — see §6), `minLength`/`maxLength`, `validate: (v, values) => true \| string` |
| When errors appear | form-level `validateOn: 'submit' \| 'blur' \| 'change'` (default `'submit'`), or per field `validateOnBlur` / `validateOnChange` |
| Message text | i18n keys — `messageKey`, `messageKeys`, `messageParams`, `requiredMessage` |

---

## 3. The ladder (what to do when the builder does not cover it)

Take the FIRST rung that fits. Every rung down costs something; say in a comment which rung you
took and why.

**Rung 1 — a field type exists.** Config entry. Done. This is the answer ~95% of the time,
including for fields that look custom: a label that changes with another field is `visibleWhen`
variants; a field that needs a lookup on blur is `commitOnBlur` + `onFieldChange`; a field
disabled until an upload finishes is `disabled: (values) => …`.

**Rung 2 — the element belongs to the form but no field type renders it** (a bank card that
appears under the IBAN input once the bank resolves, a signature pad, a map picker):
`type: 'custom'` with a feature-local component.

```ts
{
    key: 'bank-card',
    type: 'custom',
    // `values` is the live snapshot; this render runs on every form commit.
    render: ({ values }) => <BankCard bankName={values.bankName} bankId={values.bankId} />,
    visibleWhen: (values) => isLookupDone(values) && hasTrimmedBankName(values),
}
```

**Cost, state it in the comment:** a custom field subscribes to the WHOLE form snapshot by
contract, so it re-renders on every commit anywhere in the form — the only field type that
does. Keep the rendered component `React.memo`'d and cheap, or push the value through
`visibleWhen` instead so the field simply mounts/unmounts.

**Rung 3 — the element is not a form field at all** (a hero image, an info banner, a pledge
checkbox that lives in the PageStepper footer, a "need help?" link): it is chrome. Render it
with the shared component **beside** `<FormBuilder />`, not inside it, and keep its state out of
the form values. AddIban does exactly this with its pledge checkbox — it lives in the footer and
in the PageStepper store, never in `AddIbanFormValues`.

**Rung 4 — the screen genuinely cannot be a form.** Real cases: fields whose values must never
enter a store (a password the controller keeps in a ref and encrypts on submit), or a
login/auth screen whose "form" is three inputs and a verification round-trip that reshapes the
screen. Then use the **login pattern** — and only then:

```ts
// src/presentation/account/screens/taxAccountLogin/controller.ts (reference)
const tinRef = React.useRef('');
const passwordRef = React.useRef('');
// Commits write only the refs — no React state — so neither typing nor moving
// focus between fields re-renders the screen. Submit/validate read the refs,
// never render-time values.
```

with `DraftTextInput` (`value` stays the initial text, `onDraftChange` + `onCommit` write the
refs) and a small `fieldErrors` state object that is the ONLY thing a keystroke can touch —
cleared on the first non-empty keystroke, set on submit. Anything less than this loses the
render profile the builder gives you for free. **Write a comment on the controller saying why
rung 4 was taken**; a reviewer will ask.

---

## 4. Render & performance contract (the part that is easy to lose)

These are the principles applied in login and Add-IBAN. They are not optimisations to add later
— a form that skips them re-renders the entire screen on every keystroke, and PageStepper flows
make that visible on device.

**4.1 The host opts out of form renders.**

```ts
const form = useFormBuilder<AddIbanFormValues>({ fields, defaultValues, subscribeHost: false });
```

Without it, the component calling `useFormBuilder` re-renders once per commit — on a PageStepper
screen that is the whole shell, header and footer. With it, a commit re-renders the edited field
only. The trade-off is absolute and must be respected: `form.values` / `form.errors` /
`form.isValid` are now snapshots of the render that produced them. Read state through:

- `getValues()` / `getErrors()` / `checkValid()` in handlers and effects;
- `form.subscribe(listener)` to push derived state elsewhere without rendering (AddIban drives
  its footer submit button this way);
- `useFormStoreSelector(form.store, (s) => s.values.formGuid)` when the host truly must render
  for exactly one value.

**4.2 The `fields` array identity is the whole ballgame.** A `fields` array rebuilt every render
invalidates every memoised field and undoes everything else here. Build it in a dedicated
`use<Flow>Fields.tsx` hook wrapped in `React.useMemo`, with **only** stable inputs in the
dependency list — `t`, option arrays, and `useCallback`'d handlers. Nothing that changes on a
keystroke may be a dependency. If a field must follow a form value, that is `visibleWhen` /
`disabled(values)` / a `visibleWhen` variant — never a rebuild from the host.

**4.3 Free-text fields commit on blur.** `commitOnBlur: true` renders `DraftTextInput`:
keystrokes stay inside the leaf and the form hears the field once, on blur. Use it for every
free-text field in a flow. Trade-off: `visibleWhen`, `isValid` and `onFieldChange` lag until
blur; `validate()` / `validateFields()` / `flushDrafts()` commit still-focused drafts first, so
submit handlers must read `getValues()` **after** the call, never the render-time `values`.

**4.4 Uncontrolled mode; write the store at boundaries only.** In a PageStepper flow seed with
`defaultValues: store.formData` (or `reset(prefilled)` when async data lands) and on Next/Submit
do `validate()` → `setFormData(getValues())` **once**. Passing `values: store.formData` +
`onValuesChange: store.setFormData` writes the store on every keystroke and re-renders every
subscriber of `formData` — footer, header, sibling steps. The builder already gives each field
its own subscription; the store gains nothing from intermediate values.

**4.5 Controlled mode must take the errors.** If you pass `errors`, the parent owns the error map
and the builder stops writing to the store — every message its own validation produced is
dropped. Pass `onErrorsChange` too, always.

**4.6 Stable references around the form.** Module-scope constants for empty fallbacks
(`const NO_ITEMS: never[] = []` — an inline `?? []` mints a new array every render and defeats
every memo downstream); destructure only `mutateAsync` from a mutation, never the whole object,
or every pending/success flip rebuilds your handlers; memoise `footerActions`, `headerConfig`
and any prop object handed to a `React.memo` child (AddIbanScreen memoises all three).

**4.7 Keep non-form state out of form values.** Store-owned UI (a footer pledge checkbox, a
success payload, an attachment upload's busy flag) subscribes with a slice selector where it
renders. Putting it in the form values makes every field's store notify carry it.

**Verified guarantees** (form-builder test suite — `src/shared/formBuilder/__tests__/`, which
is gitignored per repo policy, so it exists only where it was written): a commit
re-renders only the edited field, siblings 0, host 0 with `subscribeHost: false`; an error write
re-renders only its target field; `validate()` re-renders only fields that gained errors; a
`visibleWhen` reveal mounts the new field without touching untouched siblings.

---

## 5. File layout for a feature with a form

```
presentation/
  screens/
    <Flow>Screen.tsx            # PageStepper/BaseScreen shell + <FormBuilder {...formProps} />
    use<Flow>Controller.ts      # useFormBuilder, handlers, submit, store writes
    <flow>/
      use<Flow>Fields.tsx       # the memoised FormFieldConfig[] (one per step if multi-step)
      constants.ts              # max lengths, helper-key maps, option-key arrays
      helpers.ts                # pure mapping helpers (values ⇄ DTO, label formatting)
  components/                   # feature-local components used by `type: 'custom'` fields
  types.ts                      # <Flow>FormValues + DEFAULT_<FLOW>_FORM_VALUES
```

Multi-step: one `fields/<step>Fields.ts` per step (see `SubmitReport/fields/`), one
`useFormBuilder` per step controller, and the PageStepper store as the only thing that spans
steps.

`<Flow>FormValues` is a typed interface in `presentation/types.ts` next to its
`DEFAULT_..._FORM_VALUES` constant — never an inline literal, and never `any`.

---

## 6. Validation rules

- **Never write an inline regex.** Use `validation.preset` — 44 built-ins, and the names are
  domain-specific, so grep the `BuiltInValidatorPreset` union in
  `src/shared/formBuilder/types/FormFieldConfig.ts` rather than guessing: identity
  (`nationalId`, `iqama`, `nationalIdOrIqama`, `gccId`, `entityId`, `identityDocument`,
  `bankIdNumber`, `idNumberExactTen`), business (`tin`, `taxId`, `cr`, `crTenDigits`,
  `saudiIban`, `vatCertificateNumber`, `reportNumber`, `hyphenatedReference`), contact
  (`email`, `mobile`, `defendantMobile`, `otpMinLength`), dates (`futureDate`, `pastDate`,
  `notFutureDate`, `dateOfBirthPast`, `issueDateNotPast`, `issueDateNotFuture`,
  `expiryAfterIssueDate`, `tripDateFuture`, `invalidDate`), numbers/lengths
  (`positiveNumber`, `positiveInteger`, `numbersOnly`, `alphaNumeric`, `exactLength`,
  `minTrimmedLength`, `quantityGreaterThanZero`, `goodsValueGreaterThanZero`,
  `invalidNumber`) and form-shape (`required`, `mustBeTrue`, `attachmentsMin`,
  `attachmentsExact`, `mapLocationSelected`). If a genuinely new pattern is needed, add it to
  `@shared/utils/regex.ts`, and add the preset to the builder
  (`validation/builtInValidators.ts` + `validation/validationMessageKeys.ts` in lockstep) rather
  than hand-rolling it in the feature.
- **Messages are i18n keys**, resolved by the builder. Reuse `common.validation.*` first; a
  service-specific message goes under the feature namespace and is pointed at with `messageKey`.
  MSG-xx tables from the user story become those keys.
- **Cross-field rules are config**, not handler code — two presets read another field:
  `validation: { preset: 'bankIdNumber', idTypeField: 'idType' }` and
  `{ preset: 'expiryAfterIssueDate', compareDateField: 'issueDate' }`. Anything else
  cross-field goes through `validate: (value, values) => true | string`, which receives the
  whole values object.
- **Server-side errors** go in with `form.setError(name, message)` after the mutation rejects —
  the field renders it like any other error and clears it on the next edit.
- **Timing:** default `validateOn: 'submit'` is right for most flows. Use `'blur'` when the
  design shows errors before submit; use `validateOnChange` per field only for a field with an
  expensive downstream effect that must not fire on a bad value (Add-IBAN's `idNumber`).
  `validateOn: 'change'` on a field that is NOT `commitOnBlur` validates on every keystroke —
  that is a deliberate choice, not a default.

---

## 7. Tests for a form screen

Alongside the usual controller-hook and render tests (DESIGN.md §2.4):

- **Field config test** — the config array is a pure function of its inputs: assert
  `visibleWhen` outcomes for the branching values, and that the array identity is stable across
  a re-render with unchanged inputs.
- **Controller test** — `validate()` blocks submit with the expected error keys; a successful
  submit calls the mutation with the mapped DTO built from `getValues()`.
- **Render test** — the conditional field appears only after the trigger value is set.

---

## 8. Form checklist (per screen)

- [ ] Form-first gate run: every input element mapped to a field type in §2's table
- [ ] Screen contains **no input JSX** — only `<FormBuilder {...formProps} />` plus chrome
- [ ] Anything off-table resolved through §3's ladder, with the rung named in a comment
- [ ] `useFormBuilder({ …, subscribeHost: false })` on any screen with real chrome
- [ ] `fields` built in a memoised `use<Flow>Fields` hook with only stable deps
- [ ] Free-text fields are `commitOnBlur: true`
- [ ] Handlers read `getValues()` / `getErrors()`, never the render snapshot
- [ ] Uncontrolled mode; PageStepper store written once per step boundary
- [ ] Controlled mode (if used) passes `onErrorsChange`
- [ ] No inline regex; messages are i18n keys under `common.validation.*` or the feature namespace
- [ ] Conditional behaviour expressed as `visibleWhen` / `disabled(values)` / variants, not host rebuilds
- [ ] Non-form UI state kept out of the form values
