# TOKEN_MAP.md — Figma → theme token mapping (zatcaReact)

Verified against `src/core/theme/baseStyles.ts` and live `get_variable_defs` pulls from the
Wave-2 Figma file. Frames are **375pt wide → 1:1 pt mapping, no scale factor**. Prefer the
Figma **variable name** when `get_design_context`/`get_variable_defs` provides one; fall back
to nearest-value mapping and note the original in a comment.

## Spacing (`theme.spacing`)
| px | token | Figma variable |
|---|---|---|
| 0 | `none` | `Global/spacing-none` |
| 2 | `xxs` | — |
| 4 | `xs` | `Global/spacing-xs` |
| 6 | `sm` | — |
| 8 | `md` | `Global/spacing-md` |
| 12 | `lg` | `Global/spacing-lg` |
| 16 | `xl` | `Global/spacing-xl` |
| 20 | `2xl` | — |
| 24 | `3xl` | `Global/spacing-3xl` |
| 32 | `4xl` | — |
| 40 | `5xl` | — |
| 48 | `6xl` | — |
| 160 | `full` | — |

## Border radius (`theme.borderRadius`)
| px | token | Figma variable |
|---|---|---|
| 0 | `none` | `Radius/radius-none` |
| 1 | `xxs` | — |
| 2 | `xs` | — |
| 4 | `sm` | `Radius/radius-sm` |
| 8 | `md` | — |
| 12 | `xm` | — |
| 16 | `lg` | — |
| 24 | `xl` | — |
| 28 | `2xl` | — |
| 36 | `3xl` | — |
| 9999 | `full` | `radius-full` |

## Typography
Font: IBM Plex Sans Arabic — `theme.typography.fontFamily.{regular,medium,semiBold,bold}`
(+ `saudiRiyal`). Figma text styles map to fontSize + lineHeight + fontFamily triples:

| Figma style | size/lh | fontSize token | lineHeight token |
|---|---|---|---|
| Text 2xs/* | 10/14 | `xxs` | `textXxs` |
| Text xs/* | 12/18 | `xs` | `textXs` |
| Text sm/* | 14/20 | `sm` | `textSm` |
| Text md/* | 16/24 | `md` | `textMd` |
| Text lg/* | 18/28 | `lg` | `textLg` |
| — | 20 | `xl` | — |
| — | 24 | `2xl` | `xl` (32 abs) |
| — | 30 | `3xl` | — |

Weight suffix → fontFamily: Regular → `regular`, Medium → `medium`, Semibold → `semiBold`,
Bold → `bold`. Prefer `Label` `type` presets (`defaultParagraph`, `cardTitle`, `h1Header`,
`h2Header`, `labelName`, `fieldLabelName`, `fieldInput`) and override family/size via style
only when the design deviates.

## Sizes
- `theme.size.icon`: none 2 · xxs 4 · xs 12 · sm 16 · smd 18 · md 20 · lg 24 · xl 28 ·
  2xl 32 · 3xl 48 · 4xl 56
- `theme.size.parts`: default 44 · xs 12 · sm 14 · md 16 · lg 18 · xl 20 · 2xl 24 · 3xl 28 ·
  4xl 32 · 5xl 36 · 6xl 40 · 7xl 44 · 8xl 48 · 9xl 52 · 10xl 56

## Colors
~124 keys in `lightTheme.ts`/`darkTheme.ts` (parallel palettes, same shape; never define a
color for one mode only). Verified Figma-variable → token pairs:

| Figma variable | hex | theme token |
|---|---|---|
| `Text/text-default` | #161616 | `colors.text` |
| `Text/text-secondary-paragraph` | #6c737f | `colors.textPrimaryParagraph` family |
| `Border/border-neutral-primary` | #d2d6db | `colors.borderNeutralPrimary` |
| `Border/border-neutral-secondary` | #e5e7eb | `colors.borderNeutralSecondary` |
| `Tag/tag-text-success` | #085d3a | `colors.tag.success.text` |
| `Tag/tag-background-success-light` | #ecfdf3 | `colors.tag.success.background` |
| `Tag/tag-border-success-light` | #abefc6 | `colors.tag.success.border` |
| `Form/field-*` | — | `colors.inputColors.*` |
| (primary) | #1B8354 | `colors.primary` |

Unmapped colors: grep the hex in `src/core/theme/lightTheme.ts` first; only if absent pick
the semantically-nearest token group (`tag`, `card`, `inputColors`, `icon`, `services`, …).

## Misc
- `borderWidth.thin` for 1px hairlines; `theme.opacity`, `theme.zIndex`, `theme.shadows` as
  named tiers.
- RTL: logical props (`start`/`end`, `marginEnd`, `paddingStart`) + `theme.isRTL` for
  direction-dependent icons (`arrowLeft` ↔ `arrowRight`); layout enum helpers
  (`theme.flexDirection.row`, `theme.alignItems.center`, `theme.textAlign.left`, `flex1`).
- Theme pipeline: base → remote overrides → font scale (`App-FontScale`, ±2px/step) →
  `isRTL`. Dark colors live entirely in `darkTheme.ts` — tokens make dark mode free.
