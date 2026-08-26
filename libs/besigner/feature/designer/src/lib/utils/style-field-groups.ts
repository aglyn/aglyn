/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { FieldComponentType } from '@aglyn/aglyn'
import { SX_SCHEME_DARK_KEY, type SxScheme } from '@aglyn/aglyn-node-renderer'
import {
  describeCssColorProblem,
  expandSxAliases,
} from '@aglyn/shared-data-enums'
import type {
  PresetChoiceOption,
  ThemeScaleOption,
} from '@aglyn/shared-ui-jsx-forms'
import { besignerDocsUrl } from './docs-help'
import { readSxValue, type SxBreakpoint, writeSxValue } from './responsive-sx'
import type { StyleThemeScales } from './theme-scale-options'

/**
 * First-class style controls beyond the base panel (AGL-540): layout,
 * colors, sizing, typography, borders & shadows, position & overflow, and
 * grid/flex-child fields, rendered as accordion groups in the styles
 * panel. Everything still writes through the responsive-sx pipeline, so
 * breakpoint scoping (AGL-333) applies to every field here.
 *
 * Consolidation (AGL-587): every style field has exactly one home. The
 * loose base form is gone — display/float live in Layout, color/
 * backgroundColor in Colors.
 *
 * The layout half was consolidated again in AGL-2486: `Flexbox & Grids`
 * and `Grid & Flex Child` were two sections describing the same two CSS
 * layout models, and every typed field of both now lives in one group
 * ({@link buildFlexGridGroup}) under the panel's alignment toggles.
 */
export interface StyleFieldGroup {
  $id: string
  label: string
  fields: Array<Record<string, unknown> & { name: string }>
}

/**
 * Fields that earn a per-field help tip (AGL-600, wired in AGL-1220).
 *
 * Deliberately NOT every described field. Every field's `description`
 * already renders as helper text UNDER its control, so a tooltip whose
 * excerpt IS that description is ~40 question marks that say nothing new
 * — and `FormFieldGrid` pins the icon at `top: -6, right: 0`, i.e. ON
 * the field's top border, where on a length field it lands right beside
 * the unit menu's caret and on a full-width select it floats detached
 * above the box. (Colour pickers do not forward `help` at all, so the
 * full set also left three ragged gaps.) Checked in the panel at its
 * real ~340px width before narrowing to this list.
 *
 * What a tip can say that the inline line cannot is the panel's one
 * genuine footgun: a bare NUMBER in these five fields is not pixels.
 * `borderRadius: 2` renders 8px (× `shape.borderRadius`), `gap: 2`
 * renders 16px (× the spacing unit), and `lineHeight: 1.5` is a ratio —
 * a silent 8× surprise no one-line example can warn about, and the exact
 * reason these five stayed free text while every other length became a
 * number box + unit picker (AGL-1219). All five are plain text boxes, so
 * the icon has the field's top-right corner to itself.
 */
const STYLE_FIELD_HELP: Record<string, { title: string; excerpt: string }> = {
  borderRadius: {
    title: 'Corner Radius',
    excerpt:
      'Pick a rounding preset, or Custom… for an exact value. In Custom, a bare number is a theme multiple, not pixels — 2 renders 8px (2 × the theme corner radius). Add a unit (8px, 50%) for an exact radius.',
  },
  gap: {
    title: 'Gap',
    excerpt:
      'A bare number is a theme multiple, not pixels — 2 renders 16px (2 × the theme spacing unit). Add a unit (16px, 1rem) for an exact gutter.',
  },
  rowGap: {
    title: 'Row Gap',
    excerpt:
      'A bare number is a theme multiple, not pixels — 2 renders 16px (2 × the theme spacing unit). Add a unit (16px, 1rem) for an exact gutter.',
  },
  columnGap: {
    title: 'Column Gap',
    excerpt:
      'A bare number is a theme multiple, not pixels — 2 renders 16px (2 × the theme spacing unit). Add a unit (16px, 1rem) for an exact gutter.',
  },
  lineHeight: {
    title: 'Line Height',
    excerpt:
      'A bare number is a ratio of the font size, not pixels — 1.5 renders one-and-a-half times the text size, and stays right when the font size changes. Add a unit (28px) to pin the line box.',
  },
}

/**
 * Marks every field in a group clearable (AGL-2486).
 *
 * A style field's empty state is a real authoring choice — it is what
 * "let the theme decide" looks like — and until this there was no click
 * anywhere in the panel that produced it. Colour fields had no empty
 * swatch, length fields re-adopted their unit the moment a number came
 * back, and selects only offered a Default option where one had been
 * hand-authored. Applied to the whole group rather than field by field
 * so a field added later cannot arrive one-way.
 */
function withFieldClear(group: StyleFieldGroup): StyleFieldGroup {
  return {
    ...group,
    fields: group.fields.map((field) => ({ clearable: true, ...field })),
  }
}

/**
 * Makes every field hold its value the way the DOCUMENT holds it
 * (AGL-2486, items 9 and 10 together).
 *
 * Item 10 made a purely numeric value store as a NUMBER, which is what
 * gives `gap: 2` its meaning of 16px. But a form control hands back
 * whatever its own input produces — text from a box, the option's own
 * value from a preset menu — so the form's copy of a stored `2` was
 * sometimes `'2'` and sometimes `2`. react-final-form's definition of
 * DIRTY is exactly that inequality, and item 9's re-seed spares dirty
 * fields so it cannot eat characters mid-word. A numeric field was
 * therefore permanently dirty and permanently spared: the canvas rolled
 * back on an undo and the panel did not. Two fixes, each right on its own,
 * cancelling.
 *
 * `parse` runs on the way IN, before the value reaches form state, so the
 * form and the document agree by construction and "dirty" means what it
 * says — for every control, including ones added later. It is the same
 * function the merge writes through, so there is exactly one answer in the
 * panel to "what type is this value", rather than one per control.
 *
 * Applied to the whole group for the same reason `clearable` is: a field
 * added later cannot arrive with the old behaviour.
 */
function withStoredValueParse(group: StyleFieldGroup): StyleFieldGroup {
  return {
    ...group,
    fields: group.fields.map((field) => ({
      ...field,
      FieldProps: {
        ...((field['FieldProps'] as Record<string, unknown>) ?? {}),
        parse: normalizeStyleValue,
      },
    })),
  }
}

/** Attaches {@link STYLE_FIELD_HELP} to a group's fields, each with a
 * Deep link into the responsive-styling docs. */
function withStyleFieldHelp(group: StyleFieldGroup): StyleFieldGroup {
  return {
    ...group,
    fields: group.fields.map((field) => {
      const help = STYLE_FIELD_HELP[field.name]
      return help && !field['help']
        ? {
            ...field,
            help: {
              ...help,
              href: besignerDocsUrl('responsiveStyling', '#style-groups'),
            },
          }
        : field
    }),
  }
}

const textField = (
  name: string,
  label: string,
  description: string,
  extra?: Record<string, unknown>,
) => ({
  component: FieldComponentType.TEXT_FIELD,
  name,
  label,
  description,
  ...extra,
})

/**
 * ROW RHYTHM (AGL-2486, Zach 2026-08-22).
 *
 * panels, and neither was wrong on its own — the difference was two things
 * this file controls and nothing else does.
 *
 * **1. Orphaned half-width fields.** `Z-Index` and `Opacity` each sat alone
 * in the left column with the entire right half of the row empty, because
 * they were declared `half` next to a full-width neighbour. A half-width
 * field is a promise that something shares its row; when nothing does, the
 * group gains a row of dead space for no information. So the rule is now:
 * **every run of consecutive half-width fields has EVEN length.** It is
 * enforced by a spec over the built groups rather than by review, because
 * the failure is invisible in the source — you have to look at the
 * neighbours, and neighbours change.
 *
 * **2. Helper text that wraps to three and four lines.** `half` is
 * `{ xs: 12, sm: 6 }` and `sm` is a VIEWPORT breakpoint, so on any desktop
 * it is permanently active however narrow the docked panel is — about
 * 170px per column. "Stacking order for positioned elements — a theme
 * layer, or a raw number." took four lines there and made one field as tall
 * as a pair. So a half-width field's description is capped at
 * {@link HALF_WIDTH_DESCRIPTION_LIMIT} characters, which is two lines at
 * that width, and the spec fails the build if one grows past it. The longer
 * explanation goes where there is room for it: the tooltip and the docs.
 *
 * A full-width field is never an orphan and has a whole row to wrap in, so
 * it carries no length cap — that is what it is FOR, and it is the right
 * home for a control with three sub-controls (see {@link dimensionField})
 * or a genuinely long caption (Background Fill's url() egress warning).
 */
const half = { FormFieldGridProps: { size: { xs: 12, sm: 6 } } }

/**
 * Longest description a HALF-width field may carry: two lines at the ~170px
 * a half column gets in the docked panel. Measured against the panel's own
 * 0.75rem caption type, not guessed.
 */
export const HALF_WIDTH_DESCRIPTION_LIMIT = 52

/**
 * A border editor: thickness box + line-style picker (AGL-2486). Replaces
 * the free-text shorthand box an author had to type `1px solid` into.
 *
 * The PERSISTED value is unchanged — still one CSS shorthand string — so
 * every existing document renders exactly as before, and a value the pair
 * cannot model (`1px solid #f00`, `thin dashed`) falls back to a raw text
 * box inside the same control rather than being clobbered.
 */
const borderField = (
  name: string,
  label: string,
  description: string,
  extra?: Record<string, unknown>,
) => ({
  component: FieldComponentType.CSS_BORDER,
  name,
  label,
  description,
  ...extra,
})

/**
 * A named-preset picker with a Custom… escape hatch (AGL-2486) — corner
 * radius, drop shadow and font family.
 *
 * `choices` come from the SITE theme where the property has one
 * ({@link StyleThemeScales}), so the recommended answer is the first one in
 * reach rather than advice in a helper line. An empty list still leaves a
 * usable control: the Custom… entry and the raw box are always there.
 */
const presetField = (
  name: string,
  label: string,
  description: string,
  choices: PresetChoiceOption[],
  extra?: Record<string, unknown>,
) => ({
  component: FieldComponentType.PRESET_CHOICE,
  name,
  label,
  description,
  choices,
  ...extra,
})

/**
 * A length field: number box + unit picker (AGL-1219) instead of a
 * free-text box the author has to type `px` into. The PERSISTED value is
 * unchanged — still one CSS string in `sx` — so this is purely an input
 * affordance and nothing downstream has to know about it. Anything the
 * control cannot model (`calc(100% - 2rem)`, `min-content`, MUI's
 * `maxWidth: 'sm'` breakpoint key) falls back to a text box holding the
 * raw string, so no existing value is destroyed.
 *
 * Not every length is one of these. Fields whose NUMBER means a theme
 * multiple — `borderRadius` (× `shape.borderRadius`), `gap`/`rowGap`/
 * `columnGap` (× the spacing unit) — stay free text: a stored `gap: 2` is
 * 16px, and a px picker would show "2" and turn the next nudge into 3px.
 * `lineHeight` stays free text for the same reason (a unitless 1.5 is the
 * normal value, and a unit picker would push `px` onto it).
 */
const dimensionField = (
  name: string,
  label: string,
  description: string,
  extra?: Record<string, unknown>,
) => {
  /**
   * A field carrying a theme scale AS WELL AS a unit takes the whole row
   * (AGL-2486, Zach 2026-08-23).
   *
   * Font Size showed `2.:` — the value truncated to nothing. The row holds
   * three controls: the number, the theme-scale picker and the unit
   * picker. The two pickers claim ~140px of fixed width between them, and
   * `half` gives the whole field about 156px inside a 375px docked panel,
   * so the number box — the only one with no width of its own — was left
   * with single digits.
   *
   * The half-width itself is the trap. `half` is `{ xs: 12, sm: 6 }`, and
   * `sm` is a VIEWPORT breakpoint: on any desktop it is permanently active
   * regardless of how narrow the panel is, so a rule that reads like
   * "two-up only when there is room" has in fact always been "two-up". A
   * three-control field never fitted; nothing measured it.
   *
   * This is keyed on the SHAPE, not on the field name, so the next field
   * given `scaleOptions` gets the row it needs without anyone remembering.
   */
  const hasScale = Array.isArray((extra as any)?.scaleOptions)
    ? (extra as any).scaleOptions.length > 0
    : false
  return {
    component: FieldComponentType.CSS_DIMENSION,
    name,
    label,
    description,
    ...extra,
    ...(hasScale ? { FormFieldGridProps: { size: { xs: 12 } } } : {}),
  }
}

/**
 * Sizing keys read their bare numbers through MUI's `sizingTransform`,
 * where a number in (0, 1] is a FRACTION of the parent — `width: 0.5`
 * renders 50%, not 0.5px (AGL-1219).
 */
const muiSizing = { numberAs: 'mui-sizing' as const }

/**
 * Rejects a colour-field value that CSS would drop (AGL-1331).
 *
 * Every field in this panel applies live, on a debounce, and
 * `ElementStylesFormTemplate` only schedules that commit while the form is
 * `valid` — so returning a message here means the value is shown as an
 * error under the field and NEVER reaches `sx`. That is the whole point:
 * before this, a gradient typed into Background Color was accepted, stored
 * as `background-color: linear-gradient(…)`, dropped by the CSS parser, and
 * the element just went transparent with nothing to explain it.
 *
 * Rejecting rather than silently re-routing the value to `backgroundImage`
 * is deliberate. These fields commit per KEYSTROKE, so a router would fire
 * on `linear-gradient(2` and every prefix after it, moving half-typed
 * values into a different sx key while the field the author is typing in
 * blanks itself — a second kind of vanishing. A validator is inert until
 * the value is complete, and its message names the field that CAN hold a
 * gradient.
 */
const colorFieldValidator = (value: unknown) => describeCssColorProblem(value)

/** A colour picker field, with the value guard every one of them needs. */
const colorField = (
  name: string,
  label: string,
  description: string,
  presetColors: string[],
  extra?: Record<string, unknown>,
) => ({
  component: FieldComponentType.COLOR_PICKER,
  name,
  label,
  description,
  presetColors,
  validate: [colorFieldValidator],
  // Show the message as soon as the value is invalid, not on blur. Every
  // control in this panel applies live and an author typically moves
  // straight to the canvas, so a touched-gated error would keep the value
  // silently uncommitted for exactly as long as the old bug kept it
  // silently dropped. It also explains an ALREADY-broken stored value the
  // moment the field is opened.
  validateOnMount: true,
  ...extra,
})

/**
 * A field offering a THEME SCALE while still accepting any raw value
 * (AGL-2486, item 12). The stored value is a theme token path
 * (`fontWeightBold`, `appBar`) that MUI's sx system resolves itself, or
 * whatever the author typed — see `ThemeScaleField`.
 */
const themeScaleField = (
  name: string,
  label: string,
  description: string,
  scaleOptions: ThemeScaleOption[],
  extra?: Record<string, unknown>,
) => ({
  component: FieldComponentType.THEME_SCALE,
  name,
  label,
  description,
  scaleOptions,
  ...extra,
})

const selectField = (
  name: string,
  label: string,
  description: string,
  values: string[],
  extra?: Record<string, unknown>,
) => ({
  component: FieldComponentType.SELECT,
  name,
  label,
  description,
  options: [
    { value: '', label: 'Default' },
    ...values.map((value) => ({ value, label: value })),
  ],
  ...extra,
})

/**
 * The `url()` egress warning, appended to the Background Fill description
 * (AGL-1737) — the "warn" half of AGL-1725's warn-and-disclose decision,
 * reaching the Styles panel at last. The control's Custom CSS mode holds a
 * non-gradient value (`url(…)`) as a raw string, so an author can type an
 * off-site image here; the wording mirrors the Custom HTML component's
 * `css` attribute so the same egress reads the same way everywhere the
 * author can create it. Hosts are deliberately NOT blocked — the site
 * owner is the controller for their own visitors (see `author-css.ts`) —
 * which is exactly why the author has to be told what the url() does.
 */
const BACKGROUND_FILL_URL_EGRESS =
  ' Custom CSS here can also hold an image url() — one pointing off ' +
  'your site makes every visitor’s browser contact that host, which ' +
  'sees their IP address and which page they are on. Insecure http:// ' +
  'URLs are not loaded.'

/** Panel context a few fields word themselves against (AGL-1338). */
export interface StyleFieldGroupOptions {
  /**
   * The panel is editing a component INSTANCE's override slice rather
   * than a node's own sx (AGL-1332). Only the Background Fill control
   * cares so far, and it cares a lot: an unset field there means "the
   * component's own fill keeps painting", not "nothing paints", so the
   * unset choice has to be named for what it does.
   */
  isInstanceOverride?: boolean
  /**
   * The site theme's own scales for the three fields that had no connection
   * to it (AGL-2486, item 12): font size, font weight and z-index. Built
   * from the live theme by {@link buildStyleThemeScales}, so a host that
   * retuned its type scale offers its own values. Absent (a spec, a theme
   * still loading) simply means no scale is offered — every one of these
   * fields still takes a raw value.
   */
  themeScales?: StyleThemeScales
}

/**
 * Builds the style accordion groups. `presetColors` feeds the color
 * pickers with the site theme's palette, mirroring the base styles form.
 */
export function buildStyleFieldGroups(
  presetColors: string[],
  options?: StyleFieldGroupOptions,
): StyleFieldGroup[] {
  return styleFieldGroups(presetColors, options)
    .map(withStyleFieldHelp)
    .map(withFieldClear)
    .map(withStoredValueParse)
}

function styleFieldGroups(
  presetColors: string[],
  options?: StyleFieldGroupOptions,
): StyleFieldGroup[] {
  return [
    {
      $id: 'layout',
      label: 'Layout',
      fields: [
        {
          component: FieldComponentType.SELECT,
          name: 'display',
          label: 'Display Variant',
          // Was "The display property specifies the display behavior (the
          // type of rendering box) of an element." — a restatement of the
          // CSS spec that tells an author nothing they can act on.
          description: 'How this element flows on the page.',
          ...half,
          options: [
            { value: '', label: 'Default' },
            { value: 'block', label: 'Block' },
            { value: 'inline', label: 'Inline' },
            { value: 'content', label: 'Contents' },
            { value: 'list-item', label: 'List Item' },
            { value: 'inline-block', label: 'Inline Block' },
            { value: 'flex', label: 'Flex' },
            { value: 'inline-flex', label: 'Inline Flex' },
            { value: 'grid', label: 'Grid' },
            { value: 'inline-grid', label: 'Inline Grid' },
            { value: 'table', label: 'Table' },
            { value: 'inline-table', label: 'Inline Table' },
            { value: 'table-caption', label: 'Table Caption' },
            { value: 'table-column', label: 'Table Column' },
            { value: 'table-column-group', label: 'Table Column Group' },
            { value: 'table-cell', label: 'Table Cell' },
            { value: 'table-row', label: 'Table Row' },
            { value: 'table-row-group', label: 'Table Row Group' },
            { value: 'table-header-group', label: 'Table Header Group' },
            { value: 'table-footer-group', label: 'Table Footer Group' },
            { value: 'none', label: 'None' },
            { value: 'initial', label: 'Initial' },
            { value: 'unset', label: 'Unset' },
          ],
        },
        {
          component: FieldComponentType.SELECT,
          name: 'float',
          label: 'Float',
          description: 'Let text wrap around this element.',
          ...half,
          options: [
            { value: '', label: 'Default' },
            {
              value: 'inherit',
              label: 'Inherit',
              description: 'The element inherits the float value of its parent',
            },
            {
              value: 'none',
              label: 'None',
              description:
                'The element does not float (will be displayed just where it occurs in the text)',
            },
            {
              value: 'left',
              label: 'Left',
              description: 'The element floats to the left of its container',
            },
            {
              value: 'right',
              label: 'Right',
              description: 'The element floats to the right of its container',
            },
          ],
        },
      ],
    },
    {
      $id: 'colors',
      label: 'Colors',
      fields: [
        colorField(
          'color',
          'Text Color',
          'The color of the text inside.',
          presetColors,
          half,
        ),
        colorField(
          'backgroundColor',
          'Background Color',
          'A solid color behind the content.',
          presetColors,
          half,
        ),
        // Gradient backgrounds (AGL-1331). A separate field rather than a
        // mode of Background Color, because they are different CSS
        // properties: this one writes `backgroundImage`, which paints OVER
        // the solid colour, so an author can keep a solid fallback under a
        // gradient. Solid here writes `none` — an explicit "paint no
        // image", which is what lets ONE instance of a component whose
        // default IS a gradient go back to a flat band (AGL-1338).
        {
          component: FieldComponentType.CSS_GRADIENT,
          name: 'backgroundImage',
          label: 'Background Fill',
          description:
            (options?.isInstanceOverride
              ? 'Inherited keeps the fill the component paints. Solid ' +
                'replaces it with the Background Color above — that is how ' +
                'one placement drops a gradient the component sets. A ' +
                'gradient here paints this instance only.'
              : 'Solid paints no image and lets the Background Color above ' +
                'show. A gradient paints over it — set the angle and the ' +
                'color stops, and bind any stop to a theme color so it ' +
                'follows the palette.') + BACKGROUND_FILL_URL_EGRESS,
          // On an instance the unset state is not "nothing", it is "the
          // component's fill" — and saying so is half the AGL-1338 fix:
          // the control read as already-Solid, so choosing Solid changed
          // nothing and looked like a broken field.
          unsetLabel: options?.isInstanceOverride ? 'Inherited' : 'Default',
          presetColors,
        },
      ],
    },
    {
      $id: 'sizing',
      label: 'Sizing',
      fields: [
        dimensionField('width', 'Width', 'How wide the element is.', {
          ...muiSizing,
          ...half,
        }),
        dimensionField('height', 'Height', 'How tall the element is.', {
          ...muiSizing,
          ...half,
        }),
        dimensionField('minWidth', 'Min Width', 'Never narrower than this.', {
          ...muiSizing,
          ...half,
        }),
        dimensionField('maxWidth', 'Max Width', 'Never wider than this.', {
          ...muiSizing,
          ...half,
        }),
        dimensionField('minHeight', 'Min Height', 'Never shorter than this.', {
          ...muiSizing,
          ...half,
        }),
        dimensionField('maxHeight', 'Max Height', 'Never taller than this.', {
          ...muiSizing,
          ...half,
        }),
      ],
    },
    {
      $id: 'typography',
      label: 'Typography',
      fields: [
        // Text Style leads the group because it is the one pick that can be
        // RIGHT on its own (Zach 2026-08-25). Every field under it sets a
        // single property, so matching the theme by hand meant five correct
        // picks in a row; `typography: 'h2'` applies the face, size, weight,
        // line height, letter spacing and casing the host defined, and keeps
        // following them when the host retunes its scale. The fields below
        // still work — they now read as adjustments ON a text style rather
        // than as the only way to describe one.
        presetField(
          'typography',
          'Text Style',
          'A complete text style from the theme — sets face, size, weight and spacing together. Adjust individual properties below.',
          options?.themeScales?.typographyVariant ?? [],
        ),
        // The face comes FIRST, and it is a picker (AGL-2486, Zach
        // 2026-08-23: *"font family should be a selection and then option
        // for custom"*). It was a free-text box carrying the advice
        // "Prefer theme typography when possible" — advice with no way to
        // act on it. The site theme's own faces lead the list, each row
        // renders its own name in its own face, and a hand-typed stack
        // still opens the control in its custom state holding that value.
        presetField(
          'fontFamily',
          'Font Family',
          'The typeface. The theme’s own fonts are listed first.',
          options?.themeScales?.fontFamily ?? [],
          { previewKind: 'font' },
        ),
        // Number + unit AND the theme's type scale (AGL-2486). Picking
        // `h4.fontSize` stores that token path, which MUI resolves against
        // `theme.typography` at render — so the heading keeps moving with
        // the type scale instead of being pinned to the pixels it had on
        // the day it was styled. A raw length is still one keystroke away.
        // Full width is forced by `dimensionField`: three controls in one
        // row never fitted a half column.
        dimensionField(
          'fontSize',
          'Font Size',
          'How big the text is — or a size from the theme’s type scale.',
          { scaleOptions: options?.themeScales?.fontSize ?? [] },
        ),
        // The theme's named weights first, then the CSS ladder, and any raw
        // value typed straight in (AGL-2486). `fontWeightBold` follows a
        // host that decides its bold is 600; `700` means exactly 700.
        themeScaleField(
          'fontWeight',
          'Font Weight',
          'How bold the text is.',
          options?.themeScales?.fontWeight ?? [],
          half,
        ),
        textField(
          'lineHeight',
          'Line Height',
          'Space between lines of text.',
          half,
        ),
        dimensionField(
          'letterSpacing',
          'Letter Spacing',
          'Space between letters.',
          half,
        ),
        selectField(
          'textTransform',
          'Text Transform',
          'Force capitals or lower case.',
          ['none', 'uppercase', 'lowercase', 'capitalize'],
          half,
        ),
        selectField(
          'textDecoration',
          'Text Decoration',
          'A line under, over or through the text.',
          ['none', 'underline', 'overline', 'line-through'],
          half,
        ),
        // Italic for a whole ELEMENT (Zach 2026-08-25). It existed only in
        // the inline text editor, which styles a selection inside a run — so
        // there was no way to italicise a caption, a label or a quote block
        // as a whole without hand-writing sx. `fontStyle` is one of MUI's
        // theme-backed typography keys and was the last one this group did
        // not offer.
        selectField(
          'fontStyle',
          'Font Style',
          'Italic or upright.',
          ['normal', 'italic', 'oblique'],
          half,
        ),
      ],
    },
    {
      $id: 'borders',
      label: 'Borders & Shadows',
      fields: [
        // A border is three obvious choices — how thick, what kind of
        // line, what colour — and until AGL-2486 the panel asked for all
        // three as CSS shorthand grammar typed into a text box. Thickness
        // and line style are now the control; the colour sits beside it,
        // where it has to live for a THEME colour to resolve (MUI reads
        // `borderColor` against the palette, and the shorthand's colour
        // slot is plain CSS that would drop a token on the floor).
        borderField(
          'border',
          'Border',
          'A line around the whole element.',
          half,
        ),
        colorField(
          'borderColor',
          'Border Color',
          'What color that line is.',
          presetColors,
          half,
        ),
        // Per-side borders (AGL-1199). A divider under a bar, a rule
        // between columns and a left accent rail are all far more common
        // than a box outlined on four sides, and the shorthand above
        // cannot express any of them — `border` writes all four.
        borderField(
          'borderTop',
          'Border Top',
          'A line along the top edge only.',
          half,
        ),
        borderField(
          'borderRight',
          'Border Right',
          'A line along the right edge only.',
          half,
        ),
        borderField(
          'borderBottom',
          'Border Bottom',
          'A line along the bottom edge only.',
          half,
        ),
        borderField(
          'borderLeft',
          'Border Left',
          'A line along the left edge only.',
          half,
        ),
        presetField(
          'borderRadius',
          'Corner Radius',
          'How rounded the corners are.',
          options?.themeScales?.cornerRadius ?? [],
          half,
        ),
        borderField(
          'outline',
          'Outline',
          'A ring drawn outside the border.',
          half,
        ),
        // The shadow control no longer sends the author somewhere else to
        // type CSS: the presets say what they look like and Custom… is in
        // this control. Full width because the preset names are sentences
        // ("Lifted — floats a little"), which is the point of them.
        presetField(
          'boxShadow',
          'Shadow',
          'A soft shadow that lifts the element off the page.',
          options?.themeScales?.shadow ?? [],
          { previewKind: 'shadow' },
        ),
      ],
    },
    {
      $id: 'position',
      label: 'Position & Overflow',
      fields: [
        // Full width because it is the master control the four offsets
        // depend on, and because its caption has to say so.
        selectField(
          'position',
          'Position',
          'How the element is placed. The four offsets below only apply once this is something other than Static.',
          ['static', 'relative', 'absolute', 'fixed', 'sticky'],
        ),
        dimensionField('top', 'Top', 'Distance from the top edge.', half),
        dimensionField('right', 'Right', 'Distance from the right edge.', half),
        dimensionField(
          'bottom',
          'Bottom',
          'Distance from the bottom edge.',
          half,
        ),
        dimensionField('left', 'Left', 'Distance from the left edge.', half),
        // Z-Index and Opacity were the two fields Zach pointed at: each sat
        // alone in the left column with the whole right half of its row
        // empty. They are a PAIR now, and the long explanation of what a
        // stacking layer is moved to the docs where there is room for it.
        themeScaleField(
          'zIndex',
          'Z-Index',
          'Which element sits in front.',
          options?.themeScales?.zIndex ?? [],
          half,
        ),
        textField('opacity', 'Opacity', '0 is invisible, 1 is solid.', {
          type: 'number',
          ...half,
        }),
        selectField(
          'overflow',
          'Overflow',
          'Content that does not fit.',
          ['visible', 'hidden', 'clip', 'scroll', 'auto'],
          half,
        ),
        selectField(
          'cursor',
          'Cursor',
          'Pointer shape on hover.',
          ['default', 'pointer', 'text', 'move', 'grab', 'not-allowed'],
          half,
        ),
      ],
    },
  ]
}

/**
 * The typed fields of the single Flexbox & Grid section (AGL-2486).
 *
 * The panel used to answer "how do I lay this out?" in two places. A
 * `Flexbox & Grids` accordion held the alignment toggles and the gaps; a
 * separate `Grid & Flex Child` accordion, four sections further down, held
 * the track lists, the item placement and the flex-child sizing. Both were
 * about the same two CSS layout models, neither was complete, and their
 * names did not divide the properties the way the names suggested:
 * `alignSelf` and `justifySelf` are per-ITEM properties and lived in the
 * container section, while `gridTemplateColumns` is a CONTAINER property
 * and lived in the child one.
 *
 * So they are one section now, in reading order: how the container spaces
 * its children (the gaps), what tracks it defines (the grid template), and
 * where this element sits inside its own parent (placement and flex
 * sizing). The alignment toggles render above these, from the panel — they
 * are icon-button groups rather than schema fields and they read far better
 * than the free-text equivalents would.
 *
 * Every property both sections carried is still here; the whole point is
 * that nothing had to be dropped to stop saying it twice.
 */
export function buildFlexGridGroup(
  options?: StyleFieldGroupOptions,
): StyleFieldGroup {
  const group = withFieldClear(
    withStyleFieldHelp({
      $id: 'flex-grid',
      label: 'Flexbox & Grid',
      fields: [
        // Container: the gutters between children, on the SPACING ladder
        // (Zach 2026-08-25). These were free-text boxes, which reads as a CSS
        // length question and gets answered with one — but MUI runs all three
        // through the same `createUnaryUnit(theme, 'spacing')` as margin and
        // padding, so `2` follows the host's unit and `'16px'` does not. Same
        // rungs the box styler already offers, so the two controls agree.
        presetField(
          'gap',
          'Gap',
          'Space between the children, in both directions.',
          options?.themeScales?.gap ?? [],
        ),
        presetField(
          'rowGap',
          'Row Gap',
          'Space between rows.',
          options?.themeScales?.gap ?? [],
          half,
        ),
        presetField(
          'columnGap',
          'Column Gap',
          'Space between columns.',
          options?.themeScales?.gap ?? [],
          half,
        ),
        // Container: the grid it defines for them.
        textField(
          'gridTemplateColumns',
          'Grid Columns',
          'The columns this element lays its children out in — e.g. repeat(3, 1fr) for three equal ones.',
        ),
        textField(
          'gridTemplateRows',
          'Grid Rows',
          'The rows this element lays its children out in — e.g. auto 1fr auto.',
        ),
        selectField(
          'gridAutoFlow',
          'Grid Auto Flow',
          'The order children fill the grid in.',
          ['row', 'column', 'dense', 'row dense', 'column dense'],
        ),
        // Child: where THIS element sits in its own parent's layout.
        textField('gridColumn', 'Grid Column', 'Which columns it spans.', half),
        textField('gridRow', 'Grid Row', 'Which rows it spans.', half),
        // Per-item flex sizing (AGL-587): grow/shrink/basis/order live
        // together — they all describe this element as a flex/grid child.
        textField('flexGrow', 'Flex Grow', 'Share of spare space it takes.', {
          type: 'number',
          ...half,
        }),
        textField(
          'flexShrink',
          'Flex Shrink',
          'How readily it gives space back.',
          { type: 'number', ...half },
        ),
        dimensionField(
          'flexBasis',
          'Flex Basis',
          'Its size before growing or shrinking.',
          half,
        ),
        textField('order', 'Order', 'Where it sits among its siblings.', {
          type: 'number',
          ...half,
        }),
      ],
    }),
  )
  return withStoredValueParse(group)
}

/** Field names owned by a group — the only keys its save may touch. */
export function styleGroupFieldNames(group: StyleFieldGroup): string[] {
  return group.fields.map((field) => field.name)
}

/**
 * The sx partial a group save is allowed to produce: exactly its own
 * field names. Keys owned by other groups (or by the custom-CSS editor)
 * never appear, so one group's auto-save can never clear another's
 * values (AGL-540).
 */
export function computeStylePartial(
  fieldNames: readonly string[],
  values: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const partial: Record<string, unknown> = {}
  for (const name of fieldNames) {
    partial[name] = values?.[name]
  }
  return partial
}

/** Picks a group's own values out of the effective sx value map. */
export function pickStyleValues(
  fieldNames: readonly string[],
  values: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const picked: Record<string, unknown> = {}
  for (const name of fieldNames) {
    if (values && values[name] !== undefined) picked[name] = values[name]
  }
  return picked
}

/**
 * Style fields that carry a COLOR and therefore scope to the artboard's
 * color scheme (AGL-588): while the canvas previews DARK, edits to these
 * fields write into the sx dark slice so light keeps its own values.
 * Everything else (spacing, sizing, layout…) is scheme-agnostic and
 * always writes the base, no matter which scheme is previewed.
 */
export const SCHEME_SCOPED_STYLE_FIELDS = [
  'color',
  'backgroundColor',
  'borderColor',
  // A gradient IS colour (AGL-1331), so it scopes like the rest. Its
  // token-bound stops already follow the palette per scheme on their own;
  // this is what lets an author give dark its own gradient outright.
  'backgroundImage',
] as const

const schemeScopedFields: ReadonlySet<string> = new Set(
  SCHEME_SCOPED_STYLE_FIELDS,
)

/** Whether edits to this style field scope to the previewed color scheme. */
export function isSchemeScopedStyleField(name: string): boolean {
  return schemeScopedFields.has(name)
}

/**
 * The sx scope one field's edit targets: color-bearing fields follow the
 * previewed scheme; everything else stays scheme-agnostic (base writes).
 */
function fieldSxScheme(
  name: string,
  scheme: SxScheme | null | undefined,
): SxScheme | null {
  return scheme === 'dark' && isSchemeScopedStyleField(name) ? 'dark' : null
}

/**
 * A value that is ENTIRELY a number — the only shape stored as a number.
 *
 * Deliberately narrower than `Number()` would accept: no exponent form, no
 * `Infinity`, no hex. Those parse to a number and are not CSS anyway, so
 * converting them would only make the stored value harder to read back
 * than the text the author actually typed.
 */
const NUMERIC_STYLE_VALUE = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/

/**
 * What a control's emitted value is STORED as (AGL-2486).
 *
 * The panel's free-text fields can only hand back a string, and for the
 * fields whose bare number is a theme multiple that silently changes the
 * value's MEANING. `borderRadius: 2` renders 8px because MUI multiplies a
 * NUMBER by `shape.borderRadius`; the string `'2'` is passed through
 * verbatim as `border-radius: 2` and dropped by the CSS parser. Same for
 * `gap`/`rowGap`/`columnGap` against the spacing unit, and for
 * `lineHeight`, where a unitless number is a ratio. Open the field on a
 * node carrying the theme default, retype the same number, and the value
 * is gone — with nothing anywhere to report it.
 *
 * The rule is the VALUE's shape, not a list of field names, and it is
 * enforced here rather than in each control: this is the merge every
 * control in the panel writes through, so a field added later cannot
 * arrive with the old behaviour. Anything carrying a non-numeric character
 * (`8px`, `50%`, `1rem`, `span 2`) is what the author wrote and stays a
 * string.
 *
 * Empty — including whitespace — clears. `0` does NOT: it is falsy and it
 * is a legitimate radius, opacity and flex-grow, and `strictNullChecks` is
 * off repo-wide, so the emptiness test is spelled out rather than left to
 * a falsy check.
 */
function normalizeStyleValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const text = value.trim()
  if (text === '') return undefined
  if (!NUMERIC_STYLE_VALUE.test(text)) return value
  const numeric = Number(text)
  return Number.isFinite(numeric) ? numeric : value
}

/**
 * Merges a partial of style values into an sx object at the active
 * breakpoint + scheme scope (AGL-333 / AGL-588). Unchanged values are
 * skipped so effective (inherited) readings never get pinned into a
 * breakpoint or scheme slice by round-tripping through a form. Empty
 * strings clear, and purely numeric text is stored as a NUMBER — see
 * {@link normalizeStyleValue}.
 */
export function applyStylePartialToSx(
  sx: Record<string, any> | undefined,
  partial: Record<string, unknown>,
  breakpoint: SxBreakpoint | null,
  scheme: SxScheme | null,
): Record<string, any> {
  // Alias keys the edit collides with are rewritten to the longhands this
  // panel owns, FIRST and in place (AGL-2207). Without it, writing a field
  // whose value is stored under an alias appends a second declaration and
  // CLEARING that field deletes the longhand while the alias underneath
  // keeps painting — the value comes straight back and no click in the
  // product removes it. Scoped to the keys being edited, and to the same
  // scheme slice, so an unrelated edit never rewrites a key the author did
  // not touch.
  let next: Record<string, any> = {
    ...expandSxAliases((sx ?? {}) as Record<string, any>, {
      only: Object.keys(partial),
      deep: true,
    }),
  }
  for (const [key, value] of Object.entries(partial)) {
    const normalized = normalizeStyleValue(value)
    const fieldScheme = fieldSxScheme(key, scheme)
    if (readSxValue(next, key, breakpoint, fieldScheme) === normalized) continue
    next = writeSxValue(next, key, normalized, breakpoint, fieldScheme)
  }
  return next
}

/**
 * Effective scalar style values at the active breakpoint + scheme scope
 * — feeds the styles panel's forms and controls. Color-bearing fields
 * resolve through the dark slice while the artboard previews dark
 * (falling back to base where no override exists — exactly what
 * renders); everything else reads the base. Responsive objects resolve
 * to their active slice; nested objects are skipped.
 */
export function computeEffectiveStyleValues(
  sx: Record<string, any> | undefined,
  breakpoint: SxBreakpoint | null,
  scheme: SxScheme | null,
): Record<string, any> {
  // MUI's system-prop aliases resolve to the longhands this panel's fields
  // are named for (AGL-2207) — a preset's `py: 4` or `bgcolor` renders, and
  // without this reaches no control at all: the Padding box and the
  // Background Color field simply read empty on a node that demonstrably
  // has the value. The expansion keeps key ORDER, which is what makes it a
  // renaming of what already renders rather than a restyle.
  const source = expandSxAliases((sx ?? {}) as Record<string, any>, {
    deep: true,
  })
  const keys = new Set(Object.keys(source))
  keys.delete(SX_SCHEME_DARK_KEY)
  if (scheme === 'dark') {
    for (const key of Object.keys(
      (source[SX_SCHEME_DARK_KEY] ?? {}) as Record<string, any>,
    )) {
      keys.add(key)
    }
  }
  const out: Record<string, any> = {}
  for (const key of keys) {
    const value = readSxValue(
      source,
      key,
      breakpoint,
      fieldSxScheme(key, scheme),
    )
    if (value !== undefined && typeof value !== 'object') out[key] = value
  }
  return out
}
