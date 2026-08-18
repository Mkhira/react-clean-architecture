
# Shared Components Dictionary (`@shared/components`)

Source of truth: `src/shared/components/` (atomic design: `ui/atoms`, `ui/molecules`, `ui/organisms`, plus root `PriceTag.tsx`). Always import from the barrel `@shared/components`; inside `ui/` itself only relative imports are allowed (barrel causes require cycles). Atoms may not import molecules/organisms; molecules may import atoms only; organisms may import both. No business logic/API/navigation inside shared UI; theme tokens only, no hardcoded style values. After adding/moving a component run `node scripts/fix-component-exports.mjs && node scripts/generate-components-barrel.mjs && node scripts/fix-ui-internal-imports.mjs`.


**Correction (verified 2026-08-16):** internal file layout is MIXED, not uniform — some components use `Name/index.tsx` + `types.ts` + `styles.ts` (Label, LinearGradientCard), others use `Name/Name.tsx` + `Name.types.ts` + `Name.styles.ts(x)` + `index.ts` barrel (StepperActions, DropdownItem, Card). Don't assume paths — the props/behavior/exports info below is verified, but locate files with a glob when editing. Spot-checked claims confirmed: `previoudButtonDisabled` typo (StepperActions.tsx:31), `LinearGradiantCard` typo alias (LinearGradientCard/index.ts:1), `showCheckIcon` accepted-unused (DropdownItem).

## Quick lookup — "I need X → use Y"

| Need | Component |
|---|---|
| Text (any) | `Label` (type presets; never raw RN Text) |
| SVG icon | `Icon` (registry `src/assets/icons/index.ts`) |
| Button (all kinds) | `Button` / `IconButton` / `TextButton` (molecules/ButtonVariants) |
| Small status chip | `Tag` (5 semantic variants) |
| Removable filter pill | `Chip` (`hasTrailIcon` + `onClose`) |
| Callout/notice banner in a card | `CardTag`; app-level banner → `InlineAlert` (+ provider) |
| Toast "Copied" feedback | `Toast` + `useToast`; copy-to-clipboard → `CopyIcon` |
| Line / spacer | `Divider` (`type='line'` vs `'spacing'`) |
| Screen container | `BaseScreen`; service-flow screens use `PageStepper` (@core/app) instead |
| Screen header | `PageHeader` (`main`/`focus`/`secondary`) |
| Any bottom sheet or full-screen overlay | `BottomSheetModal` (+ `useBottomSheetModal`) |
| Modal with title + actions | `Modal` (organism, named export only) |
| Leave-flow confirmation | `CloseService` |
| Text field (all variants incl. search) | `TextInput` (`variant='search'` etc.) |
| Select field trigger | `DropdownInput` → opens `Dropdown` (organism) |
| Option row in custom list | `DropdownItem` |
| Radio/checkbox single | `Radio` / `Checkbox` (controlled) |
| Radio/checkbox group (filter/sort sheets) | `OptionGroup<T>` (generic) |
| Ready-made filter+sort triggers & sheets | `Filtration` |
| Segmented control | `ContentSwitcher`; tabs → `Tab`/`TabList` |
| On/off switch | `TogglePill`; row with toggle → `ListItem`/`MenuItem` `withToggle` |
| Selectable card (radio/checkbox) | `Card variant='selectable'`; plain container card → `Card showActions={false} showIcon={false}` |
| Label/value rows | `CardDetailsRow` (`Rows`); collapsible card wrapper → `CardDetails` |
| Empty state | `EmptyView`; status result → `CardStatus`; fatal error screen → `ErrorView` |
| Loading | global `setLoader` (@core/loader) for blocking; `Loader` for local |
| Step footer (next/prev/submit) | `StepperActions` (via PageStepper `footerActions`) |
| Step ring "2 of 4" | `ProgressIndicator` |
| Gradient hero/banner card | `LinearGradiantCard` (typo'd alias is the common import) / `LinearGradientBackground` |
| Date picking (Gregorian/Hijri) | `DatePicker` |
| Collapsible sections | `Accordion` / `AccordionList` |
| Horizontal card carousel | `Carousel` (`CarouselWrapper<T>`) |
| Data table | `Table<T>` (no virtualization) |
| File upload UI | `FileUpload` (presentational only — wire picker yourself) |
| QR scan | `QRCodeScanner` / `EInvoiceQrCodeModal` + `decodeZatcaQrTlv` |
| PDF display | `PdfViewer` (dev build) |
| Barcode render | `Barcode` (Code 128) |
| Price with SAR glyph | `PriceTag` |
| Star rating | `Rating` |
| Tooltip popover | `Tooltip` |
| Language selector card | `LanguageCard`; font size control → `FontScalePicker` |
| Apple Wallet pass | `AppleWalletButton` (iOS-only, safe to always render) |
| Nafath verification sheet | `NafathVerificationModal` (presentational) |
| Help-center link line | `HelpCenterText` (DI/nav-coupled) |
| Tab bar for expo-router | `CustomTabBar` |
| Star/step dots (feature-local) | no shared one — integrated-tariff built its own `ProgressDots` |

## Atoms

### Barcode — atom
**Purpose:** Renders a Code 128 barcode image generated on-device from a string value.
**Exports:** `Barcode` (default + named), `BarcodeProps`, `BarcodeGenerationOptions`, `BarcodeSourceState`, `useBarcodeSource`, `generateCode128BarcodeUri`, `buildCode128Options`.
**Key props:**
- `value: string` — **required**; text encoded into the barcode.
- `foregroundColor: string ('#000000')` — bar color; `backgroundColor: string ('transparent')`.
- `height: number (56)` — height of container and image.
- `style` (container) / `imageStyle` overrides.
**Behavior & gotchas:** Wraps `@bwip-js/react-native` (`code128`, scale 3, bar height 12, no text/padding). Async generation via `useBarcodeSource`: `ActivityIndicator` while loading, renders **nothing on error** (error stored but ignored). Image full-width `resizeMode="contain"`. Regenerates only on `value`/color changes.
**Usage:**
```tsx
<Barcode value="INV-2026-000123" height={64} foregroundColor={theme.colors.text} />
```

### Button (BaseButton) — atom
**Purpose:** Variant-agnostic pressable engine that the concrete `Button` (molecules/ButtonVariants) configures via an injected palette resolver. You almost never use BaseButton directly — use the molecule `Button`.
**Exports:** `BaseButton`, `BaseButtonProps`. The end-user `Button`/`ButtonProps` live in molecules/ButtonVariants.
**Key props:** (`BaseButtonProps = Omit<ButtonProps,'variant'> & {resolvePalette, variantType}`)
- `resolvePalette: (state, colors) => ButtonPalette` — **required**; `{backgroundColor, borderColor, textColor}` per `{isDisabled, isPressed, iconOnly}`.
- `variantType: ButtonVariant` — **required**; `'primary' | 'secondary' | 'outline' | 'text' | 'iconSolid' | 'iconOutline'`.
- `label: string ('Button')`; `onPress?`; `size: 'sm' | 'md' | 'lg' | 'xl' ('md')`.
- `disabled (false)`, `loading (false)`, `fullWidth (false)`, `iconOnly (false)`.
- `icon / leftIcon / rightIcon: IconProps` — discriminated union: `iconOnly: true` requires `icon` and forbids `label`/`leftIcon`/`rightIcon`.
- `accessibilityLabel?` (defaults to `label`), `style`, `labelStyle`, `testID`.
**Behavior & gotchas:** Wraps `Pressable`; palette recomputed on press state. `loading` swaps content for `ActivityIndicator` and disables. `accessibilityRole="button"`, `accessibilityState={{disabled, busy}}`. Composes `Icon` + `Label`; icon colors forced to palette text color.
**Usage:**
```tsx
<Button variant="primary" size="lg" label={t('common.save')} fullWidth onPress={save} loading={isSaving} />
```

### Divider — atom
**Purpose:** Dual-mode: invisible layout spacer or hairline divider line with optional centered title.
**Exports:** `Divider` (default + named), `DividerProps`.
**Key props:**
- `type: 'line' | 'spacing' ('spacing')`.
- `size: number (theme.spacing.xl)` — spacer size (spacing mode only).
- `isHorizontal?: boolean` — spacing mode: `true` = width spacer, else height; line mode defaults to horizontal line.
- `lineProps?: { color?, containerStyle?, lineStyle?, title?, titleProps? }` — `color` defaults to `theme.colors.cardDetails.borderColor`; `title` renders a centered `Label` (textSecondary, medium) between two segments; `titleProps: LabelProps`.
**Behavior & gotchas:** Line drawn as border + background on a zero-size flexed View (avoids Android hollow-border bug). `lineContainer` has `flex: 1` so line stretches. Vertical lines via `isHorizontal={false}`.
**Usage:**
```tsx
<Divider size={theme.spacing.lg} />
<Divider type="line" lineProps={{ color: theme.colors.borderNeutralPrimary }} />
<Divider type="line" lineProps={{ title: t('common.or') }} />
```

### Icon — atom
**Purpose:** Renders an SVG icon from the central icon registry with unified size/color and optional circular halo.
**Exports:** `Icon` (named only — no default), `IconProps` (extends `SvgProps`).
**Key props:**
- `name: IconName` — **required**; key of the `icons` map in `src/assets/icons/index.ts`. Examples: `home`, `search`, `share`, `currency`, `link`, `close`, `arrowLeft`, `qrCode`, `calculator`, `faceId`.
- `size?: number (theme.spacing['3xl'] ?? 24)` — width and height; `width`/`height` override per axis.
- `color / fill / stroke` — resolved with fallbacks (`color ?? fill ?? stroke`, etc.).
- `withHalo: boolean` + `haloStyle` — circular View wrapper (`size + spacing.lg`).
**Behavior & gotchas:** Returns `null` silently for unknown names (no warning). Remaining `SvgProps` spread onto the SVG. New icons are added in `src/assets/icons/index.ts`.
**Usage:**
```tsx
<Icon name="share" size={theme.size.icon.md} color={theme.colors.text} />
<Icon name="informationCircle" withHalo haloStyle={{ backgroundColor: theme.colors.neutral100 }} />
```

### Label — atom
**Purpose:** Theme-aware text primitive (the app's `Text` replacement) with typography presets, required/error states, and currency formatting.
**Exports:** default aliased as `Label`, `Text`; `LabelProps`, `TextProps`, `TextType`; helpers `labelStyles`, `getTextStyleByType`, `getTextBaseStyle`.
**Key props:** (extends RN `TextProps`)
- `children` — **required**.
- `type: TextType ('defaultParagraph')` — `'defaultParagraph' | 'cardTitle' | 'h1Header' | 'h2Header' | 'labelName' | 'fieldLabelName' | 'fieldInput'`.
- `color?: StringTextColorKeys ('text')` — theme color keys containing "text" (`text`, `textSecondary`, `textError`, …).
- `required (false)` — prepends red `*` in a row wrapper; `requiredIndicatorColor?` overrides.
- `error (false)` — switches to `textError` unless `color` explicitly passed.
- `isCurrency (false)` — formats via `formatCurrencyDisplay` + appends currency symbol.
- `containerStyle?` — forces the row-wrapper View.
**Behavior & gotchas:** `React.memo`'d. Always `allowFontScaling={false}`. Sets `writingDirection` per `theme.isRTL`, `includeFontPadding: false`. On Android appends invisible U+00A0 to string children (Arabic last-word clipping bug). Skips wrapper View when neither `required` nor `containerStyle`.
**Usage:**
```tsx
<Label type="h1Header">{t('home.title')}</Label>
<Label type="fieldLabelName" required error={hasError}>{t('form.amount')}</Label>
<Label isCurrency>{total}</Label>
```

### LinearGradientBackground — atom
**Purpose:** SVG-based linear-gradient fill layer (absolute-fill by default), no native gradient dependency.
**Exports:** `LinearGradientBackground` (default + named), `LinearGradientBackgroundProps`, `GradientPoint`, `buildGradientId`, `defaultGradientStyle`, `toOffsets`.
**Key props:**
- `colors: string[]` — **required** (empty → `['transparent']`).
- `locations?: number[]` — 0–1 stops; must match `colors` length and range, else evenly distributed.
- `x1/y1 ('0%'/'0%')`, `x2/y2 ('100%'/'100%')` — direction (default diagonal TL→BR).
- `gradientId?` — auto-generated unique id if omitted; `borderRadius?` (Rect rx/ry); `opacity?`.
- `style?` — **replaces** the default `absoluteFill` entirely (not merged).
**Behavior & gotchas:** Wraps `react-native-svg`. `pointerEvents="none"` — touches pass through. Parent needs `overflow: 'hidden'` + radius for rounded corners.
**Usage:**
```tsx
<View style={{ borderRadius: 12, overflow: 'hidden' }}>
  <LinearGradientBackground colors={['#1B8354', '#14573A']} borderRadius={12} />
  <Content />
</View>
```

### Link — atom
**Purpose:** Pressable text link with internal/external types, inline/standalone variants, pressed/visited/disabled states.
**Exports:** `Link` (default + named), `LinkProps`, `LinkType`, `LinkState`, `LinkVariant`, `LinkPalette`, `getLinkPalette`, `getIconSize`.
**Key props:**
- `label: string` — **required** (also default accessibility label).
- `type: 'internal' | 'external' ('internal')` — external shows `link` icon (standalone only).
- `variant: 'standalone' | 'inline' ('standalone')` — inline always underlined, no `alignSelf: flex-start`.
- `visited (false)`, `disabled (false)`, `onPress?`, `numberOfLines (1)`, `style?: TextStyle`.
**Behavior & gotchas:** `React.memo`'d. State precedence: disabled > pressed > visited > default. Palette is **hardcoded hex per theme** (light `#1B8354`, dark `#FFFFFF`), not tokens. `accessibilityRole="link"`. Does **not** call `Linking.openURL` — handle navigation in `onPress`. 14px/lh 20 text, 16px icon.
**Usage:**
```tsx
<Link label={t('sla.title')} type="external" onPress={() => Linking.openURL(url)} />
<Link label={t('auth.forgot')} variant="inline" onPress={onForgot} />
```

### ShareButton — atom
**Purpose:** Preconfigured square icon-only share button (solid surface, share icon) delegating to the Button molecule.
**Exports:** `ShareButton` (default + named), `getShareButtonProps` helper.
**Key props:** `handleShare: () => void` — **required**; the only prop.
**Behavior & gotchas:** Wrapper over molecule `Button` with fixed `variant='iconSolid'`, `size='lg'`, `iconOnly`, icon `share` at `theme.size.icon.md`. Fixed square (`theme.size.parts.default`), `borderRadius.sm`, no border; background `neutral100` (light) / `button.secondaryBackgroundDefault` (dark). `getShareButtonProps(theme, handleShare)` reusable elsewhere.
**Usage:**
```tsx
<ShareButton handleShare={() => Share.share({ message: url })} />
```

### Tag — atom
**Purpose:** Small status/category chip with five semantic color variants.
**Exports:** `Tag` (default + named), `TagProps`, `TagVariant`, `TagPalette`, `getTagPalette`.
**Key props:**
- `label: string` — **required**; single line (`numberOfLines={1}`).
- `variant: TagVariant ('neutral')` — `'neutral' | 'info' | 'warning' | 'success' | 'destructive'`; colors from `theme.colors.tag[variant]`.
- `leftIcon? / rightIcon?: React.ReactNode` — rendered elements, **not** IconProps.
- `accessibilityLabel?` (defaults to label), `style?`, `labelStyle?`, `testID?`.
**Behavior & gotchas:** Plain `View` + RN `Text` (not Label). `row-reverse` when RTL. `alignSelf: 'flex-start'` — hugs content. 12px medium/lh 18, 1px border, 4px radius. Use `getTagPalette(variant, theme)` to match custom icon colors. Integrated-tariff overrides label to 10px semibold via `labelStyle` (see `createTariffTagLabelStyle`).
**Usage:**
```tsx
<Tag label={t('invoice.approved')} variant="success" />
<Tag label={node.code} variant="neutral" labelStyle={tagLabelStyle} />
```

### TogglePill — atom
**Purpose:** Animated on/off switch (controlled) with disabled, RTL, and custom-color support.
**Exports:** `TogglePill` (default + named), `TogglePillProps`, `TogglePillCustomColors`.
**Key props:**
- `value: boolean` — **required**; controlled state.
- `onPress: () => void` — **required**; component does not flip itself.
- `isDisabled (false)`; `width? (parts['9xl'] ?? 52)`, `height? (parts['4xl'] ?? 32)`, `thumbSize?`.
- `customColors?: TogglePillCustomColors` — per-state track/border/thumb overrides.
**Behavior & gotchas:** `react-native-reanimated` (250ms, `Easing.out(Easing.circle)`) animates only thumb `translateX` — colors are plain styles (dodges Reanimated Android `interpolateColor` NaN bug #6821). Track forces `direction: 'ltr'`; RTL handled by inverting travel math. `accessibilityRole="switch"`, hitSlop `spacing.sm`.
**Usage:**
```tsx
<TogglePill value={enabled} onPress={() => setEnabled(v => !v)} />
```

### PriceTag — (root-level component)
**Purpose:** SAR amount next to the currency glyph icon, stable ordering in RTL and LTR.
**Exports:** `PriceTag` (default + named), `PriceTagProps` — from `src/shared/components/PriceTag.tsx` (not in atoms barrel; still exported by main barrel).
**Key props:**
- `value: number` — **required**; formatted via `formatAmount` from `@shared/utils/currencyFormat`.
- `emphasis (false)` — bumps sm/medium → md/semiBold.
- `textStyle?`; `iconSize? (theme.size.icon.sm)`.
**Behavior & gotchas:** Composes `Icon name="currency"` + `Label type="defaultParagraph"` (`allowFontScaling={false}`). `row-reverse` when RTL, `pointerEvents="none"`. Does not use Label's `isCurrency` — formats inline.
**Usage:**
```tsx
<PriceTag value={1250.75} />
<PriceTag value={grandTotal} emphasis iconSize={theme.size.icon.md} />
```

## Molecules

### Accordion — molecule
**Purpose:** Collapsible section with animated chevron for progressive disclosure.
**Exports:** `Accordion` (named + default), `AccordionProps`. (`AccordionListProps`/`AccordionListItem` exist in types.ts but are NOT re-exported.)
**Key props:**
- `title: string` — **required**; `children` — **required** (plain strings auto-wrapped in styled `Label`).
- `defaultExpanded (false)` — uncontrolled; `expanded?` + `onToggle?: (expanded) => void` — controlled mode when `expanded !== undefined`.
- `disabled (false)`; `focused?` — force focused visual; `iconPosition: 'leading' | 'trailing' ('trailing')`; `headerAccessory?: ReactNode` (trailing slot when icon leading).
- `animated (true)`; `showTopBorder (true)`; `iconSize? (theme.spacing.md)`; `style/contentStyle/headerStyle/testID`.
**Behavior & gotchas:** `Icon` (`arrowDown`) rotates 180° via reanimated `withTiming` (250ms). Palette from `theme.colors.accordion`; focused replaces top border with full border. RTL via `writingDirection` + logical padding. a11y: `role="button"`, `accessibilityState.expanded`.
**Usage:**
```tsx
<Accordion title={t('faq.q1')} defaultExpanded onToggle={log}>Long text…</Accordion>
```

### AppleWalletButton — molecule
**Purpose:** iOS-only black "Add to Apple Wallet" button; adds a pass, alerts on failure.
**Exports:** `AppleWalletButton` (default + named). `AppleWalletButtonProps` NOT barrel-exported.
**Key props:**
- `title: string` / `subtitle: string` — **required** stacked lines.
- `walletPassBase64?` / `walletPassUrl?` — pass source; disabled if both missing.
- `disabled (false)`; `alertTitle?` (defaults i18n `eDeclarations.status.appleWallet`); `testID?`.
**Behavior & gotchas:** Returns `null` on non-iOS or when `canAddPassToAppleWallet()` false — safe to render unconditionally. Uses `@shared/utils/appleWallet`; statuses `unavailable`/`unsupported`/`failed` → `Alert.alert`; `added`/`cancelled` silent. `Icon appleWallet` + `Label`; background `theme.colors.text`, inverse text.
**Usage:**
```tsx
<AppleWalletButton title={t('wallet.addTo')} subtitle={t('wallet.appleWallet')} walletPassBase64={pass?.base64} />
```

### BaseScreen — molecule
**Purpose:** Standard screen container with theme background + default padding, optionally scrollable.
**Exports:** `BaseScreen` (default + named), `BaseScreenProps`.
**Key props:**
- `children?`; `scrollable?` — wraps in `ScrollView` (indicators hidden); `scrollProps?: ScrollViewProps`; `scrollRef?`.
- `containerStyle?` — merged after defaults.
- `backgroundColor?` — **declared but ignored by implementation**; override via `containerStyle`.
**Behavior & gotchas:** Defaults `flex:1`, `paddingHorizontal: spacing.xl`, `paddingVertical: spacing['3xl']`, bg `mainBackground`. No SafeArea handling.
**Usage:**
```tsx
<BaseScreen scrollable scrollProps={{ contentContainerStyle: { paddingBottom: 24 } }}><Content /></BaseScreen>
```

### BottomSheetModal — molecule
**Purpose:** Themed RN `Modal` as bottom sheet (or full screen) with handle, title header, close button, optional keyboard avoidance. Heavily used for every sheet AND full-screen overlays.
**Exports:** `BottomSheetModal`, `useBottomSheetModal`, `BottomSheetModalProps`, `UseBottomSheetModalOptions`, `UseBottomSheetModalReturn`.
**Key props:**
- `visible: boolean` — **required**, controlled; `onClose: () => void` — **required** (back button, backdrop, close button); `children` — **required**.
- `fullScreen (false)` — opaque full-screen surface (no backdrop, no keyboard avoidance, top padding = `insets.top`). This is how integrated-tariff hosts its search "screen".
- `closeOnBackdropPress (true)`; `showHandle (true)`; `showCloseButton (true)`; `animationType ('slide')`.
- `title?` — centered header; header renders if `title` or `showCloseButton`.
- `avoidKeyboard (false)` — `KeyboardAvoidingView` (`behavior="padding"` both platforms), gated by Keyboard listener (Android edge-to-edge stale-padding workaround).
- `closeButtonAccessibilityLabel?` (i18n default); `containerStyle`, `titleStyle`, `handleStyle`, `overlayProps` (backdrop Pressable), `contentProps` (sheet Pressable), `testID`.
**Behavior & gotchas:** Core RN `Modal`, no 3rd-party sheet lib; safe-area insets. Sheet content is a `Pressable` with `stopPropagation` — this competes with inner ScrollView gestures; opt out with `contentProps={{ onStartShouldSetResponder: () => false }}` (see NotesSheet in integrated-tariff). Max height `theme.bottomSheet.maxHeight`. Close button = `IconButton iconSolid sm`. Hook `useBottomSheetModal({initialVisible, onOpen, onClose})` → `{visible, open, close, toggle, setVisible}`.
**Usage:**
```tsx
const sheet = useBottomSheetModal();
<BottomSheetModal visible={sheet.visible} onClose={sheet.close} title={t('filters')} avoidKeyboard>
  <FilterForm />
</BottomSheetModal>
```

### Button / ButtonVariants — molecule
**Purpose:** The app's button family (solid, outline, text, icon-only) over shared `BaseButton`.
**Exports:** `Button` (also default + `ButtonVariants` alias), `TextButton`, `IconButton`; `ButtonProps`, `ButtonVariant`, `ButtonSize`, `ButtonPalette`, `ButtonSizeStyle`; style helpers `buildButtonContainerStyle`, `buildButtonLabelStyle`, `getButtonSizeStyle`; re-exports `StepperActions`.
**Key props (`ButtonProps`):**
- `variant: 'primary' | 'secondary' | 'outline' | 'text' | 'iconSolid' | 'iconOutline' ('primary')`.
- `size: 'sm' | 'md' | 'lg' | 'xl' ('md')` — `xl` is a FAB preset.
- `label?: string ('Button')` — **beware fallback label if omitted**.
- `onPress?`; `disabled (false)`; `loading (false)` — spinner replaces content + disables.
- `iconOnly? (false)` — with `iconOnly: true`, `icon: IconProps` required, `label`/`leftIcon`/`rightIcon` forbidden.
- `leftIcon?/rightIcon?: IconProps`; `fullWidth (false)`; `accessibilityLabel?`, `style?`, `labelStyle?`, `testID?`.
**Behavior & gotchas:** Per-variant palette resolvers (`iconSolid` reuses secondary palette, `iconOutline` reuses outline). `IconButton` = `iconOnly` forced; `TextButton` = `variant="text"`. Icon-only gets square minWidth=minHeight, zero horizontal padding. `leftIcon` is SOURCE-order leading slot — native RTL mirroring flips it visually in Arabic.
**Usage:**
```tsx
<Button label={t('common.save')} variant="primary" size="lg" fullWidth onPress={save} loading={saving} />
<IconButton icon={{ name: 'close', size: 16 }} variant="iconSolid" size="sm" onPress={dismiss} />
```

### Card — molecule
**Purpose:** Design-system card: default content card with action buttons, or selectable card with radio/checkbox.
**Exports:** `Card` (default + named); `CardProps`, `DefaultCardProps`, `SelectableCardProps`, `SelectableCardControlType`.
**Key props (shared):** `title?` (single line); `description?`; `children?`; `showIcon? (true)` — leading `checkmarkCircle` in circular container; `style?`, `testID?`.
**Default variant (`variant?: 'default'`):**
- `showActions (true)` — **actions show by default**; outline + primary button row.
- `primaryActionLabel ('Action')`, `secondaryActionLabel ('Action')`, `onPrimaryActionPress?`, `onSecondaryActionPress?`.
**Selectable variant (`variant: 'selectable'` — required discriminant):**
- `controlType: 'radio' | 'checkbox'` — **required**; `selected: boolean` — **required**, controlled; `onSelect: (selected: boolean) => void` — **required**.
- `focused (false)`; `disabled (false)`.
**Behavior & gotchas:** Internal `BaseCardShell` (a `Pressable`) composing `Icon` + `Label`. Radio taps fire `onSelect(true)` only when not already selected; checkbox toggles. Integrated-tariff uses `<Card showActions={false} showIcon={false}>` + custom children + style overrides (border/radius) as a plain container with `onSelect` press — common pattern. a11y: `accessibilityState={{selected, disabled}}`.
**Usage:**
```tsx
<Card variant="selectable" controlType="radio" title={t('plan.basic')}
  selected={plan === 'basic'} onSelect={() => setPlan('basic')} />
<Card showActions={false} showIcon={false} onSelect={onPress} style={styles.card}>{children}</Card>
```

### CardDetailsRow — molecule
**Purpose:** Label/value detail rows (name left, value right) inside cards.
**Exports:** `Row`, `Rows`, `CardDetailsRow` (alias of `Rows`); `RowProps`, `RowsProps`. No default export.
**Key props (`RowProps`):**
- `name: string` — **required** (`labelName`, textSecondary); `value: string` — **required**, right-aligned medium.
- `rightAction?: ReactNode` — trailing node (e.g. `CopyIcon`); `isLast?` (set automatically by `Rows`); `containerSpacing? (spacing.md)`; `numberOfLines?`; style overrides.
**`RowsProps`:** `data: RowProps[]` — **required**; `containerSpacing?`.
**Behavior & gotchas:** Value column `flex: 1`, `textAlign: right` (**physical**, not logical). Keys are array indices.
**Usage:**
```tsx
<CardDetailsRow data={[
  { name: t('invoice.number'), value: inv.number, rightAction: <CopyIcon value={inv.number} /> },
  { name: t('invoice.date'), value: inv.date },
]} />
```

### CardStatus — molecule
**Purpose:** Centered status block (halo icon + title + description) for success/failure/no-result.
**Exports:** `CardStatus` (default). `CardStatusProps` NOT barrel-exported.
**Key props:**
- `status: 'success' | 'failed' | 'noResponse' ('success')` — picks `checkmarkCircle2`/`cancelCircle`/`searchRemove` + colors.
- `title?`; `description?`; `iconProps?` (spread last, overrides per-status icon); `gap? (spacing.sm)`; `containerStyle?`.
**Behavior & gotchas:** Wrapper around `EmptyView` + `Divider` + `Label`. Halo `size.parts['10xl']`.
**Usage:**
```tsx
<CardStatus status="failed" title={t('scan.invalid')} description={t('scan.tryAgain')} />
```

### CardTag — molecule
**Purpose:** Bordered, tinted callout/banner row (info/warning/…) with optional icons, title, description.
**Exports:** `CardTag` (default). `CardTagProps` NOT barrel-exported.
**Key props:**
- `variant: TagVariant ('info')` — drives `theme.colors.tag[variant]`.
- `title?` + `titleLabelProps?`; `description?` + `descriptionLabelProps?`.
- `leadingIconProps?` (tinted variant text color, `icon.lg`) + container style; `trailingIconProps?` (`icon.md`).
- `onPress?` — root is `TouchableOpacity` (activeOpacity 0.7), disabled when absent.
**Behavior & gotchas:** Spacing via horizontal `Divider`s, not `gap`; an `lg` divider renders even with no leading icon. Description Label has no default color — pass `descriptionLabelProps` to tint.
**Usage:**
```tsx
<CardTag variant="warning" leadingIconProps={{ name: 'infoCircle' }} title={t('vat.notice')} description={t('vat.noticeBody')} />
```

### Checkbox — molecule
**Purpose:** Controlled checkbox with animated check, optional label + description.
**Exports:** `Checkbox` (default + named), `CheckboxProps`.
**Key props:**
- `isChecked (false)` — fully controlled; `onToggle?: (newCheckedState: boolean) => void` — receives inverted value.
- `isDisabled (false)`; `label?: ReactNode` (max 2 lines, medium); `description?`; style overrides; `testID?`.
**Behavior & gotchas:** Check animates opacity/scale via reanimated (150ms); bypassed when disabled. Palette `theme.colors.checkbox.{default|checked|disabled}`. Text container `minWidth: 0` (Android multi-line shrink). `role="checkbox"`. Box `size.parts['2xl']`, `borderRadius.xs`.
**Usage:**
```tsx
<Checkbox isChecked={agreed} onToggle={setAgreed} label={t('terms.accept')} />
```

### Chip — molecule
**Purpose:** Medium pill chip for filters/tags with neutral/primary palettes, selected/disabled states, optional dismiss icon.
**Exports:** `Chip` (default + named), `ChipProps`, `ChipVariant`.
**Key props:**
- `label: string` — **required** (default a11y label).
- `variant: 'neutral' | 'primary' ('neutral')`; `isSelected (false)`; `isDisabled (false)`.
- `hasTrailIcon (false)` — trailing `cancel` icon in its own Pressable; `onPress?` — body; `onClose?` — trail icon.
**Behavior & gotchas:** Palette priority disabled → pressed → selected → default from `theme.colors.chipNeutral/chipPrimary/chipDisable`. Trail dismiss independent of body handler, has hitSlop; a11y label `Remove ${label}` (not localized). Pill height `size.parts['2xl']`, full radius.
**Usage:**
```tsx
<Chip label={t('filters.paid')} hasTrailIcon onClose={remove} />
```

### ContentSwitcher — molecule
**Purpose:** Horizontal segmented control of mutually exclusive options.
**Exports:** `ContentSwitcher` (named + default); `ContentSwitcherProps`, `ContentSwitcherItem`, `ContentSwitcherItemPosition`, `ContentSwitcherPalette`; `getContentSwitcherPalette`.
**Key props:**
- `items: ContentSwitcherItem[]` — **required**; each `{key, label, disabled?}`.
- `selectedKey: string` — **required**, controlled; `onItemChange: (key) => void` — **required**.
- `style?`; `testID?` (items get `` `${testID}-${item.key}` ``).
**Behavior & gotchas:** Fully controlled. Corner radius via container `overflow: hidden` (iOS RTL corner bug workaround); 0.5px separator uses logical `borderStart*`. Palette `theme.colors.contentSwitcher`. a11y `tablist`/`tab`. Container `alignSelf: flex-start` — stretch via `style`.
**Usage:**
```tsx
<ContentSwitcher items={[{key:'a',label:t('tabA')},{key:'b',label:t('tabB')}]} selectedKey={view} onItemChange={setView} />
```

### CopyIcon — molecule
**Purpose:** Tap-to-copy icon → clipboard + confirmation toast.
**Exports:** `CopyIcon` (default, `React.memo`). `CopyIconProps` NOT barrel-exported.
**Key props:**
- `value: string` — **required**; copied via `expo-clipboard`.
- `message?` / `title?` — toast text priority: message → title → i18n `copyIcon.message`.
- `iconProps?` — spread last; can override name/size/color/onPress.
**Behavior & gotchas:** Single `Icon` (`copy`, `icon.default`, `size.icon.md`, physical `marginLeft: spacing.xs`). Requires `ToastProvider` (`useToast`).
**Usage:**
```tsx
<CopyIcon value={invoice.uuid} message={t('common.copied')} />
```

### DropdownInput — molecule
**Purpose:** Read-only pressable field with chevron that opens a dropdown/sheet picker.
**Exports:** `DropdownInput` (default + named); `DropdownInputProps`, `PressedContainerStyleParams`, `PressedInputStyleParams`.
**Key props:** (extends `BaseInputProps` minus text-editing props)
- `value?` — selected label; `placeholder?` — shown when no value.
- `onPress?` — open picker; fires only when `!disabled && !readOnly`.
- `onPressIn?/onPressOut?`; `disabled?`, `readOnly? (true)`, `containerStyle?`, `inputStyle?`, plus inherited BaseInput props (label, error…).
**Behavior & gotchas:** Wraps `BaseInput` in a `Pressable`; inner `pointerEvents="none"` — one tap target, `accessibilityRole="button"`. Value rendered via placeholder-overlay Label so long values ellipsize; `accessibilityValue` carries real value. Chevron `arrowDown` `size.icon.xs`. Pressed colors from `theme.colors.dropdownInput`.
**Usage:**
```tsx
<DropdownInput label={t('form.city')} placeholder={t('form.selectCity')} value={city?.name} onPress={citySheet.open} />
```

### DropdownItem — molecule
**Purpose:** Single option row for dropdown lists with selected highlight.
**Exports:** `DropdownItem` (default + named); `DropdownItemProps`, `DropdownItemStyleParams`.
**Key props:** (extends `PressableProps` minus onPress)
- `label: string` — **required**; `onPress: () => void` — **required**.
- `selected (false)` — rounded highlighted background.
- `showCheckIcon (true)` — **accepted but unused: no check icon is ever rendered**.
- `containerStyle?`, `labelStyle?`; `disabled` feeds a11y state.
**Behavior & gotchas:** Pressed feedback via `opacity.subtle`; minHeight + padding lets two-line labels grow. Composes only `Label`.
**Usage:**
```tsx
<DropdownItem label={o.name} selected={o.id === value} onPress={() => pick(o.id)} />
```

### EmptyView — molecule
**Purpose:** Centered empty-state block with halo icon, title, description, extra children.
**Exports:** `EmptyView` (named only, `React.memo`; no default), `EmptyViewProps`.
**Key props:**
- `title?` (`h1Header`, centered, semiBold); `description?` (`labelName`, centered).
- `withIcon (true)` — halo icon; default `rowDelete`, `size.icon.xl`, halo `4xl`.
- `iconProps?` (spread last); `titleLabelProps?/descriptionLabelProps?`; `style?`; `children?` — after description.
**Behavior & gotchas:** Halo bg adapts to dark mode (`alphaWhite20` vs `backgroundNeutral50`). `paddingVertical: spacing['4xl']`. Base of `CardStatus`. Integrated-tariff passes description as children Label instead of `description` prop — both work.
**Usage:**
```tsx
<EmptyView title={t('list.empty')} iconProps={{ name: 'searchRemove' }} />
```

### ErrorView — molecule
**Purpose:** Full-flex fallback error screen with emoji, message, optional retry.
**Exports:** `ErrorView` (named only), `ErrorViewProps`.
**Key props:**
- `message ('Something went wrong.')` — **default + "Oops!"/"Try Again" strings are hard-coded English (not localized)**.
- `onRetry?` — renders primary `md` "Try Again" Button.
**Behavior & gotchas:** `flex: 1`, centered — replaces screen content, not inline.
**Usage:**
```tsx
if (error) return <ErrorView message={t('errors.loadFailed')} onRetry={refetch} />;
```

### FontScalePicker — molecule
**Purpose:** Self-contained control stepping the app-wide font scale via ThemeContext.
**Exports:** `FontScalePicker` (named). No prop types.
**Key props:** none — reads `fontScale`/`setFontScale` from `useThemeContext()`.
**Behavior & gotchas:** Clamps 0–3 (`FontScale` type); −/+ disable at bounds. Raw SVG assets + `Label`. Theme-token styled.
**Usage:**
```tsx
<FontScalePicker />
```

### InlineAlert — molecule
**Purpose:** Semantic inline banner (info/success/warning/error) with icon, title, message, link, ≤2 actions, dismiss.
**Exports:** `InlineAlert`; `InlineAlertProps`, `BannerType`, `BannerOptions`, `BannerState`, `InlineAlertAction`, `InlineAlertContextValue`, `InlineAlertPalette`, `InlineAlertStyleConfig`.
**Key props:**
- `banner?: BannerState | null` — external state; falls back to `BannerStateContext` from `@shared/providers/InlineAlertProvider`; renders `null` when both empty.
- `onClose?` — defaults to context `clearBanner`; `style/titleStyle/messageStyle`, `testID`.
- `BannerState`: `title?`, `message?`, `type` **required** (`'destructive' | 'info' | 'success' | 'warning' | 'default'`), `link?`, `actions?: InlineAlertAction[]`, `hideClose?`.
**Behavior & gotchas:** Normal usage context-driven: `showBanner(title, options)`; component is just the renderer. Only first 2 non-empty actions render (text Buttons). Icon map: destructive/info→`informationCircle`, success→`tick`, warning→`warning`, default→`helpCircle`. Side accent border RTL-aware. Palette `theme.colors.inlineAlert.*`.
**Usage:**
```tsx
showBanner('Saved', { type: 'success', message: t('common.saved') });
<InlineAlert />  // renderer mounted near screen top
```

### LanguageCard — molecule
**Purpose:** Selectable language card (flag + label + radio) for language pickers.
**Exports:** `LanguageCard` (default + named). `LanguageCardProps` NOT barrel-exported.
**Key props (all required):** `selected: boolean`; `label: string` (`cardTitle`); `flag: ReactNode`; `onPress: () => void` (card + inner Radio).
**Behavior & gotchas:** Composes `Radio` + `Label`; fully controlled. `flex: 1` — stretches in a row. Border `primaryLight` selected / `borderSubtle` otherwise.
**Usage:**
```tsx
<LanguageCard label="العربية" flag={<SaudiFlag />} selected={lang==='ar'} onPress={() => setLang('ar')} />
```

### LinearGradientCard — molecule
**Purpose:** Decorative gradient card surface with the ZATCA cut-out icon pattern behind children.
**Exports:** default + named `LinearGradientCard` AND typo'd alias `LinearGradiantCard` (same component — integrated-tariff uses the typo'd name). `LinearGradiantCardProps` NOT barrel-exported.
**Key props:**
- `children?`; `height: number (108)` / `aspectRatio: number (81/107)` — pass both, or omit `height`.
- `isDynamicHeight? (true)` — recomputes pattern width + `minHeight` from measured layout.
- `colors?: string[]` — defaults `theme.colors.services.shipmentTracking.linearGradient.{firstColor,secondColor}`.
- `containerStyle?`; `backgroundIconProps?: IconProps` — spread onto background Icon (default `zatcaCuttedIcon`; integrated-tariff overrides to `zakatLogomark` + `aspectRatio: 81/222`).
**Behavior & gotchas:** Wraps `LinearGradientBackground` + `Icon`; `onLayout` resize. Lays children out in a **centered row** — inner block needs `flex: 1` to span full width. Watch spelling: props type is `LinearGradiantCardProps`.
**Usage:**
```tsx
<LinearGradiantCard aspectRatio={81/222} backgroundIconProps={{ name: 'zakatLogomark' }}>
  <View style={{ flex: 1 }}>{content}</View>
</LinearGradiantCard>
```

### ListItem — molecule
**Purpose:** Flexible list row: title/subtitle, leading/trailing icons or nodes, press, optional toggle.
**Exports:** default `React.memo(ListItem)` + unmemoized named; `ListItemProps`, `ListItemStyleConfig`, `ListItemPalette`.
**Key props:**
- `title: string` — **required** (`cardTitle`, also a11y label); `subtitle?`.
- `leadingIcon?: IconName` / `leading?: ReactNode` (icon wins); trailing priority: `withToggle` > `trailingIcon` > `trailingArrow` > `trailing`.
- `onPress?`; `disabled? (false)`; `withToggle? (false)` + `toggleValue? (false)` + `onToggle?: (value) => void` — whole row toggles.
- `containerStyle`, `titleStyle`, `subtitleStyle`, `accessibilityHint`.
**Behavior & gotchas:** Pressed feedback is color-based (palette per press state), not opacity. `trailingArrow` flips to `arrowLeft` in RTL. a11y role `switch`/`button`/`none` + `checked` state.
**Usage:**
```tsx
<ListItem title={t('account.title')} leadingIcon="user" trailingArrow onPress={openAccount} />
```

### Loader — molecule
**Purpose:** Loading state with custom animated arc spinner + optional message, inline or full-screen backdrop.
**Exports:** `Loader`; `LoaderProps`, `LoaderSize` (declared, unused).
**Key props:**
- `fullScreen? (true)` — `absoluteFill`; container **always paints `modalBackdrop` background + `zIndex.modal`** even inline — override via `containerStyle`.
- `message?` (+ `messageProps?`); `spinnerProps?` — `color (primary)`, `size (parts.default ?? 44)`, `strokeWidth`, `duration (900)`, `arcOpacity (0.2)`, `arcLengthRatio (0.25)`, `initialRotation (-90)`.
**Behavior & gotchas:** Custom reanimated + SVG spinner, not `ActivityIndicator`. NOTE: feature screens usually use the global `setLoader({isLoading})` from `@core/loader/LoaderContext` instead of rendering this directly.
**Usage:**
```tsx
{isLoading && <Loader message={t('common.loading')} />}
```

### MenuItem — molecule
**Purpose:** Single-line menu row (title only) with icons/arrow/toggle — menu-flavored sibling of ListItem.
**Exports:** default `React.memo(MenuItem)` + named; `MenuItemProps`, `MenuItemVariant`, `MenuItemPalette`, `MenuItemStyleConfig`.
**Key props:**
- `title: string` — **required**.
- `variant? ('default')` — `'default' | 'leading-icon' | 'leading-trailing' | 'trailing-only'`; **note**: `'leading-icon'` suppresses the trailing side, `'trailing-only'` suppresses the leading side; `'leading-trailing'` ≈ `'default'`.
- Same leading/trailing/toggle/onPress model as ListItem.
**Behavior & gotchas:** Same interaction model as ListItem; icons `size.icon.lg`; arrow flips in RTL; memoized.
**Usage:**
```tsx
<MenuItem title={t('settings.title')} leadingIcon="cog" trailingArrow onPress={openSettings} />
<MenuItem title={t('notifications')} withToggle toggleValue={enabled} onToggle={setEnabled} />
```

### OptionGroup — molecule
**Purpose:** Generic radio or checkbox group rendering a titled column of Radio/Checkbox molecules over typed values. The building block for filter/sort sheets.
**Exports:** default `React.memo(OptionGroup) as typeof OptionGroup` (generic preserved) + named; `OptionGroupProps<T>`, `RadioOptionGroupProps<T>`, `CheckboxOptionGroupProps<T>`, `OptionProps<T>`.
**Key props:** discriminated union on `type`; `T` compared with `===`/`includes` — use primitives or stable refs:
- `type?: 'radio' (default) | 'checkbox'` — radio: `value?: T`, `onChange?: (value: T) => void`; checkbox: `value?: T[]`, `onChange?: (value: T[]) => void`.
- `options: OptionProps<T>[]` — **required**; each is `RadioProps & {value: T}` (supports `label`, `description`, `disabled`, `error`, styles per option).
- `title?: LabelProps` — `title.children` is the text; `titleStyle?`; `disabled? (false)` — disables all; `style?`, `itemStyle?`.
- `layout?: 'row' | 'column'` — **declared but ignored** (always column). Group-level `error?` also declared but never rendered.
**Behavior & gotchas:** Radio fully controlled. Checkbox keeps internal state: taps toggle locally, `onChange` fires post-commit via effect; parent `value` changes sync in without re-firing (checkbox `value` = sync source, not strict controlled). Keys are `String(option.value)` — ensure uniqueness.
**Usage:**
```tsx
<OptionGroup<string> type="checkbox" title={{ children: t('filter.searchIn') }}
  options={sections.map(s => ({ label: s.name, value: s.id }))}
  value={sectionIds} onChange={setSectionIds} />
```

### ProgressIndicator — molecule
**Purpose:** Circular step-progress ring ("2 of 4") with previous/title/description/next labels for multi-step flows.
**Exports:** `ProgressIndicator`; `ProgressIndicatorVariant` enum; `ProgressIndicatorProps` + circle types.
**Key props:**
- `currentStep: number` (zero-based) + `totalSteps: number` — **required**, clamped; ring shows `currentStep + 1` of total.
- `variant?: ProgressIndicatorVariant` — `Default`, `WithNext`, `WithDescription`, `TitleOnly`; falls back to deprecated `showNextStep? (false)` / `showDescription? (true)`.
- `stepTitle?`, `stepDescription?`, `previousStepLabel?` (only when description visible and `currentStep > 0`), `nextStepLabel?`; `animationDuration?`.
**Behavior & gotchas:** i18n keys `progressIndicator.*` must exist. Center label renders Latin digits in explicit LTR row (avoids Arabic-Indic digits/bidi). Reanimated + SVG ring; `progressbar` a11y; colors `theme.colors.progressIndicator.{track,filledTrack}`.
**Usage:**
```tsx
<ProgressIndicator currentStep={1} totalSteps={4} stepTitle={t('flow.step2')} variant={ProgressIndicatorVariant.WithNext} nextStepLabel={t('flow.step3')} />
```

### Radio — molecule
**Purpose:** Single controlled radio row with optional label, description, error.
**Exports:** default `React.memo(Radio)` + named; `RadioProps`.
**Key props:**
- `selected? (false)` — controlled; `onSelect?: () => void` — parent flips state.
- `label?: ReactNode`; `description?`; `error?: string` — error icon + red label, **hidden while disabled**.
- `disabled? (false)`; `customSurfaceColor?`; `style?`, `labelStyle?`, `descriptionStyle?`.
**Behavior & gotchas:** Press shows halo ring (internal `isPressing`), not opacity. No accessibilityRole set — rely on OptionGroup/labels for semantics.
**Usage:**
```tsx
<Radio selected={selected} onSelect={() => onSelect(node)} label={t('type.individual')} />
```

### Rating — molecule
**Purpose:** Star rating display/input with partial fills, RTL-aware fill direction, animated.
**Exports:** default `memo(Rating)`; `RatingProps`.
**Key props:**
- `userRating?` / `average? (0)` — displayed value `userRating ?? average`.
- `maxRating? (5)`; `readonly? (false)`; `allowHalf? (false)` — round to 0.5; `onRate?: (rating) => void`.
**Behavior & gotchas:** Fixed star size `size.parts['4xl']`, gap `spacing.xs`; colors `theme.colors.ratingStar`. SVG-mask fills, reanimated 250ms; fill expands RTL when `theme.isRTL`. Fractions supported (`average={3.5}`). `accessibilityRole="adjustable"`.
**Usage:**
```tsx
<Rating average={4.3} readonly />
<Rating userRating={rating} allowHalf onRate={setRating} />
```

### StepperActions — molecule
**Purpose:** Bottom action row for multi-step flows: previous/next morphing into submit on the last step. The footer used by PageStepper `footerActions`.
**Exports:** `StepperActions` (default + named); `StepperActionsProps`.
**Key props:**
- `currentStep` (zero-based) + `totalSteps` — **required**; last step when `currentStep >= totalSteps - 1`.
- `onIncrement` — **required** (next on non-last); `onDecrement` — **required**; `onSubmit?` — last-step press; **throws `Error('onSubmit is function was not sent')` if last-step next pressed without it**.
- Labels (i18n defaults are counter-intuitive, verbatim): `submitButtonLabel (t('serviceFlow.next'))` = **last-step** button text; `nextButtonLabel (t('serviceFlow.submit'))` = non-last next label; `previousButtonLabel (t('serviceFlow.previous'))`.
- `showPreviousButton? (true)` — only when not first step; `forceShowPreviousButton? (false)` — render even on step 0.
- `nextButtonDisabled? (false)`; `previoudButtonDisabled? (false)` — **note the typo, really spelled `previoud…`**.
- `prevButtonProps?/nextButtonProps?: ButtonProps` — **FULL REPLACEMENT semantics**: the default button (variant/size/fullWidth/onPress/label) is discarded; you must supply your own `label` + `onPress` + `style: {flex: 1}` (the internal handlers are NOT wired in). Only `*ButtonDisabled` still overrides `disabled`. (Integrated-tariff's `navigationPathButtonProps` documents this trap.)
- `children?` — rendered above the button row; `containerStyle?`, `buttonContainerStyle?`.
**Behavior & gotchas:** Wraps `Button` (previous = outline, next = primary, both `lg fullWidth`); top border + `3xl` top padding; RTL-safe row.
**Usage:**
```tsx
<StepperActions currentStep={step} totalSteps={4}
  onIncrement={() => setStep(s => s+1)} onDecrement={() => setStep(s => s-1)}
  onSubmit={handleSubmit} nextButtonDisabled={!isValid} />
```

### Tab / TabList — molecule
**Purpose:** Horizontal tab item (`Tab`, ≤6 tabs) and scrollable strip (`TabList`, >6) with green selection indicator.
**Exports:** `Tab` (named + default), `TabList`; `TabItemProps`, `TabListProps`, `TabItem`, `TabState`, `TabPalette`; `getTabPalette`, `getTabListItemPalette`.
**Key props:** `Tab`: `label` **required**; `isSelected? (false)`; `isDisabled? (false)`; `onPress?`. `TabList`: `tabs: TabItem[]` (`{key, label, disabled?}`) + `selectedKey` + `onTabChange` — **all required**; `scrollable? (false)`.
**Behavior & gotchas:** Fully controlled. Labels `fieldLabelName`, `numberOfLines={1}`, `allowFontScaling={false}`. a11y `tab`/`tablist`. TabList draws full-width divider with the selected indicator overlaying.
**Usage:**
```tsx
<TabList tabs={[{key:'all',label:t('tabs.all')},{key:'active',label:t('tabs.active')}]} selectedKey={tab} onTabChange={setTab} />
```

### TextInput — molecule
**Purpose:** Variant-dispatching text field (default/search/phone/card/currency/email/password/textarea) on a shared themed BaseInput.
**Exports:** `TextInput`, `BaseInput`, `TextInputVariant` enum, `TEXT_INPUT_VARIANT_VALUES`, style creators; `AppTextInputProps`, `TextInputVariantValue`, `SearchInputProps`, `ActionButton`, `IconType`, `BaseInputProps`.
**Key props:** `AppTextInputProps = BaseInputProps & {...}`; `BaseInputProps` extends RN `TextInputProps` (value/onChangeText/placeholder/keyboardType/multiline pass through).
- `variant? ('default')` — `'default' | 'search' | 'phone-number' | 'card-number' | 'currency' | 'price-amount' | 'email-username' | 'password' | 'textarea'`.
- BaseInput: `label?`, `required? (false)`, `helperText?`, `errorText?`, `hasError? (false)`, `readOnly? (false)`, `disabled? (false)`, `showHelperIcon? (true)`, `prefix?: ReactNode`, `leftAccessory?/rightAccessory?`, `fixedDirection?` (forces LTR — phone/card), `isFocused?/isContainerPressed?`, many style overrides (`wrapperStyle`, `containerStyle`, `inputContainerStyle`, `inputStyle`, …).
- Variant extras: `searchProps?` (`leftActions?: ActionButton[]`, `rightIcon?`, `onRightIconPress?`); `withSearchInputIcon?: boolean`; `cardProps?` (brand detect); currency: `currencies?/selectedCurrency?/defaultCurrencyCode?/onCurrencyChange?/pricePrefix?`; `phonePrefix?`; password: `hidePasswordByDefault?/onTogglePasswordVisibility?`; textarea: `rows?/minHeight?/maxHeight?/resizeMode?/showVerticalScrollbar?`.
**Behavior & gotchas:** `onChangeText` output normalized to Western digits. Placeholder is a custom overlay Label, not native (shown only while empty). Error text replaces helper. State colors from `theme.colors.inputColors` (error > disabled > focused > pressed). CurrencyInputVariant `require`d lazily (Dropdown↔Currency cycle). `fixedDirection` pins LTR in Arabic.
**Usage:**
```tsx
<TextInput variant="search" withSearchInputIcon value={query} placeholder={t('search')}
  onChangeText={setQuery} returnKeyType="search" onSubmitEditing={submit} />
<TextInput label={t('form.email')} variant="email-username" required value={email} onChangeText={setEmail} errorText={errors.email} />
```

### Toast — molecule
**Purpose:** Compact dark auto-dismissing feedback bubble ("Copied") near screen top.
**Exports:** `Toast` (default + named); `ToastProps`, `ToastState`, `ToastOptions`, `ToastContextValue`.
**Key props:**
- `toast?: ToastState | null` — external `{message}`; falls back to `ToastStateContext` from `@shared/providers/ToastProvider`; null if message empty.
- `style?`, `messageStyle?`, `testID?`.
**Behavior & gotchas:** Use via provider: `showToast(message, {duration})` (default 2000ms); provider owns the timer. Absolutely positioned (`top: spacing.xl`, `zIndex.toast`), `pointerEvents="box-none"`; logical start/end (RTL automatic).
**Usage:**
```tsx
const { showToast } = useToast();
showToast(t('common.copied'));
<Toast />  // renderer mounted once per screen/layout
```

### Tooltip — molecule
**Purpose:** Tap-triggered popover tooltip with title/description, optional inline icon, customizable trigger.
**Exports:** `Tooltip` (named + default); `TooltipProps`. Wraps `react-native-popover-view`.
**Key props:**
- `title?` / `description?` (`labelName` Labels).
- `placement? ('AUTO')` — popover-view Placement keys (`TOP`, `BOTTOM`, `LEFT`, `RIGHT`, `AUTO`, …).
- `children?` — custom trigger; default trigger is a `questionMark` Icon (`triggerIcon?: IconProps` config).
- `showIcon? (false)` + `icon?: IconProps` — leading icon inside the popover.
**Behavior & gotchas:** Non-AUTO placements passed as `[Placement[p], Placement.AUTO]` — AUTO fallback prevents a re-measure freeze near screen edges; array memoized. Trigger renders via stable `from` callback reading color from a ref (else entrance animation restarts). Open state internal (uncontrolled). RTL-aware.
**Usage:**
```tsx
<Tooltip title={t('vat.tooltipTitle')} description={t('vat.tooltipBody')} placement="TOP" />
```

## Organisms

### Accordion (organism barrel) / AccordionList — organism
**Purpose:** `organisms/Accordion` just re-exports the **molecule** Accordion (same name, no alias). `AccordionList` coordinates a group with single- or multi-expand.
**Exports:** `Accordion` (re-export), `AccordionList` (default + named); `AccordionListProps`, `AccordionListItem` (`{key, title, content: ReactNode, disabled?}`).
**Key props (AccordionList):**
- `items: AccordionListItem[]` — **required**.
- `allowMultiple (false)`; `defaultExpandedKeys ([])` — uncontrolled; `expandedKeys?` — controlled when defined; `onExpandedKeysChange?`.
- `style`, `contentStyle` (forwarded per Accordion), `testID` (items get `` `${testID}-${key}` ``).
**Behavior & gotchas:** Maps to molecule Accordions in controlled mode. Single-expand: opening one replaces the whole key array. No internal scrolling.
**Usage:**
```tsx
<AccordionList allowMultiple defaultExpandedKeys={['1']}
  items={[{ key: '1', title: t('faq.q1'), content: t('faq.a1') }]} />
```

### CardDetails — organism
**Purpose:** Themed card with title/description header, divider, arbitrary body, optionally collapsible.
**Exports:** `CardDetails` (default only). **`CardDetailsProps` NOT barrel-exported.**
**Key props:**
- `title?`, `description?` (+ styles); `headerChildren?` — custom header only when neither title/description set.
- `expandable (false)`; `expanded (true)` — **initial state only** (seeds useState, not controlled); `onToggle?: () => void` (no argument).
- `containerStyle?`; `dividerColor? (theme.colors.cardDetails.borderColor)`; `children?` — hidden when collapsed.
**Behavior & gotchas:** Whole card is a `Pressable` (disabled unless expandable) — **any tap inside toggles it; watch nested touchables**.
**Usage:**
```tsx
<CardDetails title={t('invoice.details')} expandable>
  <CardDetailsRow data={rows} />
</CardDetails>
```

### Carousel — organism
**Purpose:** Generic horizontal snap carousel (FlatList wrapper) with spacing/snapping defaults and optional title.
**Exports:** `Carousel` (barrel default alias), `CarouselWrapper` (named, generic `<T>`); `CarouselWrapperProps<T>`, `CarouselRenderParams<T>`.
**Key props:**
- `data: T[]`, `keyExtractor`, `renderCarouselItem: ({item, index, itemWidth}) => ReactElement` — **required**.
- `itemWidth?: number | ((screenWidth) => number)` (default `Math.min(351, screenWidth)`); `itemGap? (spacing.md)`; `edgePadding? (spacing.xl)`.
- `title?` (`cardTitle` above the list); style overrides; `listProps?` — FlatListProps passthrough.
**Behavior & gotchas:** `snapToInterval = itemWidth + itemGap`, `decelerationRate="fast"`. Sets `writingDirection` per RTL. Pure layout — cards are yours.
**Usage:**
```tsx
<CarouselWrapper title={t('home.discoverMore')} data={items} keyExtractor={i => i.id}
  renderCarouselItem={({ item, itemWidth }) => <ServiceCard item={item} width={itemWidth} />} />
```

### CloseService — organism
**Purpose:** "Leave the service?" confirmation bottom sheet: colored icon circle, title, description, confirm/dismiss.
**Exports:** `CloseService` (default + named); `CloseServiceProps`, `CloseServiceAction`.
**Key props:**
- `visible`, `onClose`, `title` — **required**; `description?`.
- `confirmAction: CloseServiceAction` — **required** (`{label, onPress, backgroundColor?, textColor?, style?, labelStyle?, testID?}`); `dismissAction?` — empty label hides the button.
- `iconName ('closeService')`, `iconColor?`, `iconSize (24)`, `circleColor?`, `circleSize (56)`; `showCloseButton (true)`; `closeOnBackdropPress (true)`.
**Behavior & gotchas:** BottomSheetModal + text-variant Buttons with hand-painted backgrounds. Actions row explicitly `rowReverse` in RTL. **Action presses do NOT auto-close — call `onClose` yourself.**
**Usage:**
```tsx
<CloseService visible={show} onClose={hide} title={t('closeService.title')}
  confirmAction={{ label: t('common.leave'), onPress: leaveFlow }}
  dismissAction={{ label: t('common.stay'), onPress: hide }} />
```

### CustomTabBar — organism
**Purpose:** Custom bottom tab bar renderer for expo-router tabs (active indicator + themed icons/labels).
**Exports:** `CustomTabBar` (default only). Takes `BottomTabBarProps` from expo-router.
**Key props:** none user-facing — wired via navigator `tabBar` option. Reads `options.title` (**routes without `title` are skipped entirely**) and `options.tabBarIcon?.({color, focused, size})`.
**Behavior & gotchas:** Emits `tabPress` (respects `defaultPrevented`) before navigate. Active tint `primary` + indicator; inactive `textSecondary`. Coupled to expo-router JS tabs.
**Usage:**
```tsx
<Tabs tabBar={(props) => <CustomTabBar {...props} />}>
  <Tabs.Screen name="home" options={{ title: t('tabs.home'), tabBarIcon: HomeIcon }} />
</Tabs>
```

### DatePicker — organism
**Purpose:** Bottom-sheet wheel date picker (day/month/year) supporting Gregorian AND Hijri calendars.
**Exports:** `DatePicker` (default + named); `DatePickerProps`, `CalendarMode` (`'GREGORIAN' | 'HIJRI'`), `DatePart`, `WheelOption`; whole controller module (`useDatePickerController`, `formatDateValue`, Hijri conversion helpers, `DEFAULT_DATE_FORMAT`, …).
**Key props:**
- `visible`, `onClose` — **required**; `value?: Date` (omitted → today clamped).
- `onChange?: (date: Date, formattedDate: string, calenderMode: CalendarMode) => void` — fires **only on Select**; `date` always Gregorian JS Date, `formattedDate` in active calendar.
- `minDate?/maxDate?` (defaults ±100 years; swapped if inverted); `title?` (i18n default), `selectLabel?`; `dateFormat ('dd/MM/yyyy')` — tokens `d dd M MM MMM MMMM yy yyyy`.
- `calendar ('GREGORIAN')` — initial mode, re-applied on each open; `showCalendarToggle (true)`; `disabled (false)`.
**Behavior & gotchas:** Composes organism Modal → BottomSheetModal + TogglePill + custom WheelColumn (ScrollView + reanimated, Android momentum workarounds). Hijri conversion is arithmetic (tabular Islamic calendar), not `Intl`. Month labels follow `theme.isRTL`, **not** i18n locale. Draft clamped continuously; mode switch converts draft; closing discards; nothing commits until Select.
**Usage:**
```tsx
<DatePicker visible={open} onClose={() => setOpen(false)} value={date}
  calendar="HIJRI" onChange={(d) => setDate(d)} />
```

### Dropdown — organism
**Purpose:** Modal option picker (bottom sheet or full screen) with optional search, flat/sectioned lists, loading + empty states.
**Exports:** `Dropdown` (default + named); `DropdownProps`, `DropdownOption` (`{label, value}`), `DropdownSection`, `SectionListOptionsType`, `ListType`, `DropdownPresentation`, `DropdownSearchProps`, `OptionsType`.
**Key props:**
- `visible`, `onClose`, `onSelect: (option: DropdownOption) => void` — **required**.
- `options` — **required**, discriminated by `listType`: `'normal'` (default) → `DropdownOption[]`; `'section'` → `{title, data: DropdownOption[]}[]`.
- `selectedOption?` — matched by `value`; `title?`; `searchable (false)`; `searchPlaceholder?` (i18n default); `presentation: 'bottom-sheet' | 'full-screen' ('bottom-sheet')`; `isLoading (false)`.
**Behavior & gotchas:** Selecting calls `onSelect` **then auto-closes**. Search clears when `visible` goes false. **Returns `null` when not visible** (Android dismissed-Modal reopen fix). Sectioned mode collapses empty-filtered sections so the empty view shows. `avoidKeyboard` only when searchable + bottom-sheet. Pair with `DropdownInput` as the trigger field.
**Usage:**
```tsx
<DropdownInput label={t('form.city')} value={selected?.label} onPress={() => setOpen(true)} />
<Dropdown visible={open} title={t('form.selectCity')} searchable options={cities}
  selectedOption={selected} onSelect={setSelected} onClose={() => setOpen(false)} />
```

### FileUpload — organism
**Purpose:** File-upload UI for single (inline browse) or multiple (dashed drop zone) with per-file uploading/uploaded/error states.
**Exports:** `FileUpload` (default + named, memoized); `getFileUploadPalette`; `FileUploadProps`, `UploadedFile`, `FileUploadMode` (`'single' | 'multiple'`), `FileUploadState`, `FileUploadPalette`.
**Key props:**
- `mode ('single')`; `label?`, `description?`, `required (false)`.
- `files: UploadedFile[] ([])` — `{id, name, uri, type?, size?, status: 'uploading' | 'uploaded' | 'error', errorMessage?}`.
- `onBrowse?` — tap on browse/drop zone; `onRemoveFile?: (fileId) => void`.
- `disabled (false)`; `hasError (false)`; `errorText?`; `browseLabel?` (i18n default); `acceptedTypes?` — helper text ("csv, pdf, png, jpeg").
**Behavior & gotchas:** **Purely presentational — no document picker**; wire `onBrowse` to expo-document-picker yourself and own `files` state. Error visual auto-derives from `hasError || errorText || any file error`. Custom SVG dashed border + spinner. Single mode hides browse once a file exists. Names truncate `ellipsizeMode="middle"`.
**Usage:**
```tsx
<FileUpload mode="multiple" label={t('form.uploadFiles')} acceptedTypes="csv, pdf"
  files={files} onBrowse={pickDocument} onRemoveFile={id => setFiles(f => f.filter(x => x.id !== id))} />
```

### Filtration — organism
**Purpose:** Filter & Sort toolkit: trigger button(s) opening two bottom sheets of radio/checkbox/chips sections; reports selections on Apply.
**Exports:** `Filtration` (default + named); `FiltrationSectionBlock`, `FilterSheetVariant`, `SortSheetVariant`, `createFiltrationStyles`, `useFiltrationController`; types `FiltrationProps`, `FiltrationSection`, `FiltrationOption`, `FiltrationSelections`, + more.
**Key props:**
- `filterSections?` / `sortSections?: FiltrationSection[]` — section = `{id, title, selectionType: 'radio' | 'checkbox' | 'chips', options: {key, value, label?}[], allowMultiSelection?, defaultSelectedKeys?, exclusiveSelectionKey?}`; omitting one hides that trigger/sheet.
- `onApplyFilter?/onApplySort?: (selections) => void` — `Record<sectionId, {keys: string[], values: (string|number)[]}>`, fired on Apply then closes.
- `triggerVariant: 'inner' | 'main' ('inner')` — inner = two square icon buttons; main = one pill with Filter|Sort halves (needs both section sets).
- `triggerSize: 'regular' | 'large' ('regular')`; `showHeader (true)` — set false for toolbar-only; `leadingSlot?` — e.g. search input beside triggers (only when `showHeader={false}`); label overrides (default i18n `menu.*`).
**Behavior & gotchas:** State fully internal (`useFiltrationController`), surfaced only via Apply. **Memoize section arrays** — state re-initializes on identity change. `exclusiveSelectionKey` implements "All" semantics (checkbox all-toggle; chips mutually exclusive, never empty). Sort Apply disabled while any sort section empty. Renders via BottomSheetModal + Chip + OptionGroup.
**Usage:**
```tsx
<Filtration showHeader={false}
  filterSections={filterSections} sortSections={sortSections}
  onApplyFilter={sel => refetch(sel.status.values)} onApplySort={sel => setSort(sel.date.values[0])} />
```

### HelpCenterText — organism
**Purpose:** One-line "need help?" prompt with inline link navigating to the Help tab.
**Exports:** `HelpCenterText` (default + named). No props.
**Behavior & gotchas:** Hardcoded to i18n keys `eInvoiceValidation.supportPrompt/supportCenter`. Resolves `INavigationService` from DI and calls `navigation.reset(Routes.tabs.help())` — **resets the stack**, not a push. Not usable in isolation.
**Usage:**
```tsx
<HelpCenterText />
```

### Modal — organism
**Purpose:** General-purpose bottom-sheet/full-screen modal with title, description, scrollable content, primary/secondary actions.
**Exports:** `Modal` (named only — **no default**); `BaseModalProps`, `BaseModalVariant` (`'placeholder' | 'text'`).
**Key props:**
- `visible` + `setVisible: Dispatch<SetStateAction<boolean>>` — **required** (closing calls `onClose?.()` then `setVisible(false)`); `children` — **required**.
- `variant ('text')` — text renders `description` above content; placeholder renders centered `placeholderLabel` box when no children.
- `title?`, `description?`, `placeholderLabel?`; `primaryButtonLabel?/secondaryButtonLabel?` — buttons render only when labels set (primary/outline, `lg fullWidth`).
- `onPrimaryPress?/onSecondaryPress?`; `closeOnPrimaryPress (false)`; `closeOnSecondaryPress (false)`; `onClose?`; `closeOnBackdropPress (true)`; `showCloseButton?`; `fullScreen (false)`; `scrollContent (true)`.
**Behavior & gotchas:** Composes BottomSheetModal (handle always shown) + Buttons. **Action presses do NOT close unless `closeOn*Press`.** Base layer under DatePicker and QrCodeScanner modal.
**Usage:**
```tsx
<Modal visible={open} setVisible={setOpen} title={t('confirm.title')}
  primaryButtonLabel={t('common.confirm')} onPrimaryPress={submit} closeOnPrimaryPress
  secondaryButtonLabel={t('common.cancel')} closeOnSecondaryPress>
  <SummaryContent />
</Modal>
```

### NafathVerificationModal — organism
**Purpose:** Nafath identity-verification bottom sheet: two-digit code, expiry countdown, open/cancel actions.
**Exports:** `NafathVerificationModal` (default + named); `NafathVerificationModalProps`.
**Key props (all required):** `visible`; `onClose`; `onOpenNafathApp`; `randomNumber: string`; `countdownLabel`; `countdownTitle`; `title`; `description`; `openButtonLabel`; `cancelButtonLabel`.
**Behavior & gotchas:** Fully controlled/presentational — no timer, no Nafath API, no deep-linking; parent owns countdown. All strings are props (no internal i18n).
**Usage:**
```tsx
<NafathVerificationModal visible={show} onClose={cancel} randomNumber="42"
  countdownTitle={t('nafath.expiresIn')} countdownLabel="01:59"
  title={t('nafath.title')} description={t('nafath.desc')}
  openButtonLabel={t('nafath.openApp')} cancelButtonLabel={t('common.cancel')}
  onOpenNafathApp={openDeepLink} />
```

### PageHeader — organism
**Purpose:** Screen header, three layouts: main (left title + actions), focus (X + centered title), secondary (back arrow + centered title); status-bar spacing + bottom divider.
**Exports:** `PageHeader` (default + named); `PageHeaderProps` (discriminated union), `PageHeaderType`, `HeaderAction`, `ActionsProps`, `BadgeProps`.
**Key props:**
- `type: 'main' | 'focus' | 'secondary' ('main')` — value is `'focus'`, not "focused".
- `title ('')`; `titleLabelProps?: LabelProps`.
- `actions: ActionsProps ([])` — max 3 `{icon: IconProps, onPress?, badgeProps?: {value, …}}`; badge caps at `99+`.
- focus only: `onClosePress?` (default `navigation.back()`), `hideCloseButton? (false)`. secondary only: `onBackPress?` (default `navigation.back()`), `hideBackButton? (false)`.
- `containerStyle?`, `actionsContainerStyle?`, `hideHeader (false)` — only safe-area spacer.
**Behavior & gotchas:** Uses `useAppNavigation()` (expo-router) — navigation-coupled defaults. **Actions' `onPress` is attached to the Icon, not the wrapping touchable — only the icon itself is tappable.** Back arrow flips per RTL. Title typography per type: main `fontSize.xl` semiBold; focus/secondary `sm` semiBold. (PageStepper's `headerConfig` maps onto this — e.g. `{type: 'focus', title}`.)
**Usage:**
```tsx
<PageHeader title={t('home.title')} actions={[{ icon: {name:'notification'}, onPress: openNotifs, badgeProps: {value: unread} }]} />
<PageHeader type="secondary" title={t('invoice.details')} onBackPress={goBack} />
```

### PdfViewer — organism
**Purpose:** Full-window PDF renderer for local or remote files.
**Exports:** `PdfViewer` (default + named); `PdfViewerProps`.
**Key props:**
- `uri: string` — **required**; `onError?`; `onLoadComplete?: (numberOfPages) => void`; `style?`.
**Behavior & gotchas:** Wraps **react-native-pdf** (native module — dev build, not Expo Go). Forces `useWindowDimensions()` size onto the native view (`flex: 1` alone unreliable). No paging/zoom/password props.
**Usage:**
```tsx
<PdfViewer uri={invoicePdfUrl} onLoadComplete={setPageCount} onError={() => showToast(t('pdf.loadError'))} />
```

### QrCodeScanner — organism
**Purpose:** Camera QR/DataMatrix scanner with dark scan-frame overlay, permission handling, full-screen modal variant, ZATCA TLV decoder.
**Exports:** `QRCodeScanner` (barrel default alias; also `QrCodeScanner`), `EInvoiceQrCodeModal` / `VatQrCodeModal` (aliases of the same internal QRCodeModal), `decodeZatcaQrTlv(qrData): TlvDecoded`; `QRCodeScannerProps`, `TlvTag`, `TlvDecoded`, `TlvDecodeError`.
**Key props:** Scanner: `onBarcodeScanned: (result: BarcodeScanningResult) => void` — **required**; `barcodeTypes: 'qr' | 'datamatrix' ('qr')`. Modal: `visible` + `setVisible` + `qrCodeScannerProps` — **required**; `pageHeaderProps?` (defaults focus header, X closes).
**Behavior & gotchas:** Wraps **expo-camera** (dev build + permission config). Auto-requests permission; ungranted → PermissionDenied view (re-request, then `Linking.openSettings()`). **Scans once per mount — the `scanned` flag never resets; remount to scan again.** `decodeZatcaQrTlv` parses ZATCA e-invoice TLV tags 1–9 (seller, VAT number, timestamp, totals).
**Usage:**
```tsx
<EInvoiceQrCodeModal visible={scanOpen} setVisible={setScanOpen}
  qrCodeScannerProps={{ barcodeTypes: 'qr',
    onBarcodeScanned: ({ data }) => { setScanOpen(false); handle(decodeZatcaQrTlv(data)); } }} />
```

### Table — organism
**Purpose:** Generic horizontally scrollable data table with fixed-width columns, styled header, optional swipe-hint row.
**Exports:** `Table` (named + default, generic `<T>`); `TableProps<T>`, `TableColumn<T>`.
**Key props:**
- `columns: TableColumn<T>[]` — **required**; `{key, title, width?, align? ('center'), getValue?: (row, i) => string, renderCell?: (row, i) => ReactNode}` (`renderCell` wins).
- `data: T[]` + `keyExtractor` — **required**; `columnsToShow?` — first N only; `columnWidth (160)` — fallback width.
- `hint?` — info row above table; `showHint?` (defaults true when hint provided); style overrides.
**Behavior & gotchas:** Plain Views in a horizontal ScrollView — **no virtualization**, keep rows modest. RTL: first column starts right, scroll reveals leftward (native mirroring). Cells `numberOfLines={3}` (headers 2).
**Usage:**
```tsx
<Table columns={[
  { key: 'name', title: t('table.item'), width: 200, getValue: r => r.name },
  { key: 'fee', title: t('table.fee'), renderCell: r => <PriceTag value={r.fee} /> },
]} data={rows} keyExtractor={r => r.id} hint={t('table.swipeHint')} />
```
