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

import PluginSettingsField, {
  PLUGIN_SETTINGS_FIELD_COMPONENT,
} from './plugin-settings-field.component'
import * as Aglyn from '@aglyn/aglyn'
import {
  FormRenderer,
  type FormRendererProps,
  FormSpy,
  type FormTemplateRenderProps,
  FIELD_MAP_BREAKPOINT_SPAN,
  FIELD_MAP_CHECKBOX,
  FIELD_MAP_COLOR_PICKER,
  FIELD_MAP_CSS_DIMENSION,
  FIELD_MAP_CSS_GRADIENT,
  FIELD_MAP_ICON_PICKER,
  simpleComponentMapper,
  useFormApi,
} from '@aglyn/shared-ui-jsx-forms'
import {
  getMdiIconPath,
  iconPathPropName,
  mdiContentSave,
} from '@aglyn/shared-data-mdi'
import {
  HelpTip,
  MdiIcon,
} from '@aglyn/shared-ui-jsx'
import {
  Alert,
  IconButton,
  NoSsr,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import MuiMenuItem from '@mui/material/MenuItem'
import { Grid } from '@mui/material'
import { observer } from 'mobx-react-lite'
import * as Besigner from '@aglyn/besigner'
import { forwardRef, memo, type SyntheticEvent, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AiAssistContext } from '../contexts/ai-assist-context'
import { BindingPickerContext } from '../contexts/binding-picker-context'
import { InsertTokenMenu } from './insert-token-menu.component'
import {
  TokenTextField,
  TOKEN_TEXT_FIELD_COMPONENT,
} from './token-text-field.component'
import {
  MarkdownAttributeField,
  MARKDOWN_ATTRIBUTE_FIELD_COMPONENT,
} from './markdown-attribute-field.component'
import {
  ScreenLinkField,
  SCREEN_LINK_FIELD_COMPONENT,
} from './screen-link-field.component'
import { besignerDocsUrl } from '../utils/docs-help'
import { numericTextValue } from '../utils/numeric-text-value'
import ElementInfoDetails from './element-info-details.component'
import useInsertTokenOptions from '../hooks/use-insert-token-options'
import {
  InteractionsContext,
  nodeElementSelector,
  type InteractionTriggerEvent,
} from '../contexts/interactions-context'
import { MediaPickerContext } from '../contexts/media-picker-context'
import { ComponentPromotionContext } from '../contexts/component-promotion-context'
import { InstanceAttrOverrides } from './instance-attr-overrides.component'
import useDeleteElementCallback from '../hooks/use-delete-element-callback'

// The AGL-567 debounce now lives in `../hooks/use-debounced-commit` so the
// draft snapshotter can share it (AGL-1256) without importing this form and
// its whole data-driven-forms dependency tree. Re-exported here because this
// is where every existing caller and test imports it from.
export {
  ATTRIBUTE_COMMIT_DEBOUNCE_MS,
  useDebouncedCommit,
} from '../hooks/use-debounced-commit'
import { useDebouncedCommit } from '../hooks/use-debounced-commit'

// Subscribes to form value changes via FormSpy and schedules a debounced
// commit when dirty. The spy is needed because MUI Select uses a Portal, so
// its onChange never bubbles through the <form> element as a DOM event.
const AutoSaveOnChange = memo(function AutoSaveOnChange({
  values,
  pristine,
  valid,
  onSchedule,
}: {
  values: unknown
  pristine: boolean
  valid: boolean
  onSchedule: () => void
}) {
  const isFirstRender = useRef(true)
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (!pristine && valid) {
      onSchedule()
    }
  }, [values]) // eslint-disable-line react-hooks/exhaustive-deps
  return null
})

/**
 * @TODO ⚠️ remove and reimplement following PR merge
 *   https://github.com/data-driven-forms/react-forms/pull/1218
 */
/**
 * Whether a node's text is FORMATTED — it carries a `html` prop the renderer
 * draws in preference to `children` (AGL-2486).
 *
 * An instance is excluded: its text rides `propValues`, not a `html` prop of
 * its own, so the question does not arise there.
 */
export function isFormattedText(
  node: Aglyn.NodeSchema<any> | undefined | null,
): boolean {
  if (!node) return false
  if (node.componentId === Aglyn.REUSABLE_INSTANCE_COMPONENT_ID) return false
  const html = (node.props as { html?: unknown } | undefined)?.html
  return typeof html === 'string' && html.length > 0
}

/**
 * The same props with the formatting dropped and the words kept
 * (AGL-2486).
 *
 * `children` is deliberately untouched. It already holds the plain reading
 * of the markup — and since `richTextToPlain` keeps line breaks, that
 * reading has the author's breaks in it — so the element goes on saying the
 * same thing in the same shape, in a form this panel can edit.
 */
export function withoutFormatting(
  props: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const next = { ...(props ?? {}) }
  delete next['html']
  return next
}

export const ElementPropsFormTemplate = forwardRef<
  any,
  FormTemplateRenderProps
>((props, ref) => {
  const { formFields, schema, ...rest } = props
  const { handleSubmit } = useFormApi()
  const { schedule, flush } = useDebouncedCommit(handleSubmit)
  return (
    <form
      ref={ref}
      onSubmit={handleSubmit}
      noValidate
      {...rest}
      // Focus leaving any field (clicking another node, tabbing away, pressing
      // Save) forces the pending debounced commit out immediately, so an edit
      // is never stranded in the debounce window while switching selection
      // (AGL-567). Placed after {...rest} so this handler always wins.
      onBlur={flush}
    >
      {schema.title}
      <Grid spacing={2} container>
        {formFields as unknown as JSX.Node}
      </Grid>
      <FormSpy subscription={{ values: true, pristine: true, valid: true }}>
        {({ values, pristine, valid }) => (
          <AutoSaveOnChange
            values={values}
            pristine={pristine}
            valid={valid}
            onSchedule={schedule}
          />
        )}
      </FormSpy>
      <FormSpy>
        {({ submitting, pristine, valid }) => (
          <Box sx={{ mt: 2 }}>
            <FormControl margin="normal" fullWidth>
              <Button
                color="primary"
                disabled={submitting || !valid || pristine}
                startIcon={<MdiIcon path={mdiContentSave.path} />}
                style={{ marginRight: 8 }}
                type="submit"
                variant="contained"
                fullWidth
              >
                Save Element
              </Button>
            </FormControl>
          </Box>
        )}
      </FormSpy>
    </form>
  );
})
ElementPropsFormTemplate.displayName = 'ElementPropsFormTemplate'
ElementPropsFormTemplate.aglyn = true

export interface ElementPropsFormProps
  extends Omit<FormRendererProps, 'schema' | 'componentMapper'> {
  node?: Aglyn.NodeSchema<any>
  /**
   * Supplied by the component, not the caller: `ElementPropsFormRaw` reads
   * `node.componentSchema` and ignores anything passed in, and the production
   * mount (`withLastSelectedNode(withTabPanelInner(...))`) passes neither. They
   * stayed required only because the interface extended `FormRendererProps`
   * wholesale, so any direct render was a type error for props the component
   * discards.
   */
  schema?: FormRendererProps['schema']
  componentMapper?: FormRendererProps['componentMapper']
}

// Attribute editors available to canvas component schemas: the simple set
// plus pickers components actually declare (icon picker AGL-146, checkbox
// AGL-162, color picker AGL-584 — the email blocks declare 5 color
// attributes and an unregistered type makes the form renderer throw,
// which blanked the email designer's whole attributes panel).
export const elementPropsComponentMapper = {
  ...simpleComponentMapper,
  [Aglyn.FieldComponentType.ICON_PICKER]: FIELD_MAP_ICON_PICKER,
  [Aglyn.FieldComponentType.CHECKBOX]: FIELD_MAP_CHECKBOX,
  [Aglyn.FieldComponentType.COLOR_PICKER]: FIELD_MAP_COLOR_PICKER,
  // Number + unit editor for CSS length attributes (AGL-1219): width,
  // height and friends were free text, so the author had to type the unit
  // and a bare `320` silently did nothing.
  [Aglyn.FieldComponentType.CSS_DIMENSION]: FIELD_MAP_CSS_DIMENSION,
  // Background fill editor for gradient-capable attributes (AGL-1331);
  // the Styles panel reaches it through the shared componentMapper.
  [Aglyn.FieldComponentType.CSS_GRADIENT]: FIELD_MAP_CSS_GRADIENT,
  // Per-breakpoint span/offset row for Grid cells (AGL-2486). Registered
  // here or the attributes memo's unknown-editor filter drops Span and
  // Offset from the panel entirely rather than throwing (AGL-584).
  [Aglyn.FieldComponentType.BREAKPOINT_SPAN]: FIELD_MAP_BREAKPOINT_SPAN,
  // Pill-rendering editor for token-capable free-text attributes
  // (AGL-586); the attributes memo rewrites TEXT_FIELD/TEXTAREA to it.
  [TOKEN_TEXT_FIELD_COMPONENT]: TokenTextField,
  // Screen picker + external-URL escape hatch for `Link`-typed component
  // props (AGL-1335), which were plain text boxes storing a raw path.
  [SCREEN_LINK_FIELD_COMPONENT]: ScreenLinkField,
  // The markdown-lite WYSIWYG for document-valued attributes (AGL-1616),
  // registered under BOTH the schema-declared type and the internal key so a
  // schema can ask for it directly and the memo below can rewrite to it.
  [Aglyn.FieldComponentType.MARKDOWN]: MarkdownAttributeField,
  [MARKDOWN_ATTRIBUTE_FIELD_COMPONENT]: MarkdownAttributeField,
  // A placed plugin's declared settings as real fields (AGL-1049); the
  // attributes memo rewrites the plugin's JSON attribute to it.
  [PLUGIN_SETTINGS_FIELD_COMPONENT]: PluginSettingsField,
}

/**
 * A number-typed field persists a NUMBER, not the text that was typed.
 *
 * Every control in this panel can only hand back a string, and for a prop
 * the renderer reads as a number that changes what the value DOES: MUI
 * renders `size: 24` as 24px and passes the string `'24'` through verbatim,
 * where it is not CSS and the declaration is dropped — the icon silently
 * goes back to its default size. Clearing the box to retype the same number
 * is enough to do it.
 *
 * Gated on the field's declared `type: 'number'` rather than on the value's
 * shape, which is how the styles panel decides ({@link numericTextValue}):
 * every value there is CSS, while an attribute holds arbitrary authored
 * content, and a Text element reading `2026` is text that must stay text.
 *
 * Implemented as final-form's `parse` rather than data-driven-forms'
 * `dataType`, which converts the same way but ALSO attaches a pattern
 * validator. These fields are token-capable, so a `{{var:id}}` binding —
 * legitimate in a numeric prop — would make the form invalid, and this
 * panel's autosave only commits while it is valid: every attribute on the
 * element would stop saving, with nothing on screen to say so.
 */
export function withNumericValueParse<T extends Record<string, unknown>>(
  field: T,
): T {
  if (field['type'] !== 'number') return field
  return {
    ...field,
    FieldProps: {
      ...((field['FieldProps'] as Record<string, unknown>) ?? {}),
      parse: numericTextValue,
    },
  }
}

/**
 * One Attributes field per prop a reusable component declares (AGL-1247),
 * so the same hero can carry different copy on eleven pages instead of
 * being copied onto each.
 *
 * Fields are named for the `propValues.<name>` path the graft reads, so the
 * form round-trips them through final-form's nested-path handling with no
 * flatten/unflatten step. A name that is not an identifier is skipped
 * rather than rendered as a field that could not save.
 */
export function buildInstancePropFields(
  declared: Aglyn.ReusableComponentProp[] | undefined,
  tokenOptions?: unknown,
  tokenLabelContext?: unknown,
): Array<Record<string, unknown>> {
  if (!declared?.length) return []
  return declared
    .filter((prop) => Aglyn.COMPONENT_PROP_NAME_PATTERN.test(prop?.name ?? ''))
    .map((prop) => {
      const base = {
        name: `${Aglyn.REUSABLE_INSTANCE_PROP_VALUES_KEY}.${prop.name}`,
        label: prop.label || prop.name,
        // The definition's default shows as the field's placeholder, which
        // is literally true: leave the field empty and that is what the
        // page renders.
        placeholder: prop.defaultValue,
        ...(prop.defaultValue && {
          description: `Defaults to "${prop.defaultValue}"`,
        }),
      }
      switch (prop.type) {
        case 'boolean':
          return { ...base, component: Aglyn.FieldComponentType.CHECKBOX }
        case 'number':
          return {
            ...base,
            component: Aglyn.FieldComponentType.TEXT_FIELD,
            type: 'number',
          }
        case 'href':
          // The screen picker the Button's own "Link to screen" field uses
          // (AGL-1335). A `Link` prop was a text box at both ends, so nine
          // live CTAs stored the literal `/pricing` and a rename of that
          // screen would have broken all nine silently — the exact
          // regression the prop introduced against the field it replaced.
          return {
            ...base,
            component: SCREEN_LINK_FIELD_COMPONENT,
            // The default travels under its own key, and the generic
            // `Defaults to "…"` text is dropped: the picker names it
            // itself, resolving a screen reference to the screen's NAME.
            // `defaultValue` is NOT the key to use — data-driven-forms
            // treats that as an initial value, which would persist the
            // component's default onto every instance that touched it.
            propDefault: prop.defaultValue,
            description: undefined,
          }
        case 'richText':
        case 'text':
        case 'image':
        default:
          // Token-capable, so an override can itself carry a `{{var:id}}`:
          // the graft substitutes first and the binding resolver runs after
          // it, so those still resolve.
          return {
            ...base,
            component: TOKEN_TEXT_FIELD_COMPONENT,
            multiline: prop.type === 'richText',
            tokenOptions,
            tokenLabelContext,
          }
      }
    })
}

/**
 * What a "Browse media" pick should ALSO write for `alt` (AGL-1896).
 *
 * The DAM has stored per-asset alt text since AGL-173 and nothing ever read
 * it back, so an author placing the same logo on eight pages typed its alt
 * eight times — and a field that must be retyped per placement is a field
 * that ships blank, on the customer's published site.
 *
 * Exported and pure so the decision is testable on real inputs; the handler
 * that calls it is inside a component wired to the live canvas.
 *
 * Two narrowings, both deliberate:
 *
 * * **`src` only.** The Browse button is offered on every media-ish
 *   attribute — `poster`, `background`, `thumbnail`, `logo`. A poster
 *   frame's description is not the element's alt text, and no attribute
 *   pairing anywhere says which of those an `alt` belongs to. Guessing would
 *   put the wrong sentence on the element and look like a bug.
 * * **Only where the SCHEMA declares an `alt`.** Read off the element's own
 *   attributes rather than assumed, so a component without one is never
 *   handed a prop its renderer would drop on the floor.
 *
 * Returns `{}` — not `{ alt: undefined }` — whenever nothing should change,
 * because the caller spreads the result into a props object that
 * `updateNodeProps` REPLACES wholesale. An `alt` key present with an
 * undefined value is indistinguishable from an authored empty alt to
 * everything downstream, and would silently clear one.
 */
export function inheritedAltPatch(options: {
  /** The attribute the Browse button was pressed for. */
  propName: string
  /** Whether this element's schema declares an `alt` attribute at all. */
  declaresAlt: boolean
  /** The node's CURRENT props, snapshotted from the canvas. */
  props?: Record<string, unknown> | null
  /** The chosen DAM asset's own stored alt. */
  assetAlt?: unknown
}): { alt?: string } {
  const { propName, declaresAlt, props, assetAlt } = options ?? ({} as never)
  if (!declaresAlt || propName !== 'src') return {}
  const alt = Aglyn.inheritedMediaAlt({
    placementAlt: props?.['alt'],
    // The author's explicit "screen readers should skip this" (AGL-1305).
    // `image.tsx` forces `alt=""` over any alt text when it is on, so
    // inheriting into such a node writes text the renderer discards.
    decorative: props?.['decorative'],
    assetAlt,
  })
  return alt ? { alt } : {}
}

/**
 * The two visibility fields every node inside a component definition gets
 * (AGL-1314), so "this part is optional" is something an author declares by
 * clicking rather than something the component hard-codes.
 *
 * Token-capable, because the value that decides is almost always the
 * definition's own `{{prop.*}}`: `hideIf` takes a `boolean` prop ("Hide the
 * mockup"), `hideUnless` takes the prop that would have supplied the
 * content ("no link, no button" — AGL-1348).
 *
 * Offered ONLY where `{{prop.*}}` exists — inside a component editor,
 * signalled by `BindingPickerContext.componentProps` exactly as the insert
 * picker uses it. On an ordinary screen the directive is inert (the graft
 * is the only thing that evaluates it), and a field that silently does
 * nothing is worse than no field.
 */
export function buildVisibilityFields(
  tokenOptions?: unknown,
  tokenLabelContext?: unknown,
): Array<Record<string, unknown>> {
  const field = (name: string, label: string, description: string) => ({
    name,
    label,
    description,
    // Same tooltip treatment the schema attributes get (AGL-600); this
    // list never reaches the `withAttributeHelp` map above.
    help: { title: label, excerpt: description },
    component: TOKEN_TEXT_FIELD_COMPONENT,
    tokenOptions,
    tokenLabelContext,
  })
  return [
    field(
      Aglyn.NODE_HIDE_IF_PROP,
      'Hide when',
      'Remove this element (and everything inside it) from pages where ' +
        'this value is on. Usually a property of this component, e.g. ' +
        '{{prop.hideMedia}}.',
    ),
    field(
      Aglyn.NODE_HIDE_UNLESS_PROP,
      'Hide unless',
      'The reverse: remove this element from pages that leave this value ' +
        'empty. Point it at the property that fills the element — a button ' +
        'bound to {{prop.ctaLink}} then disappears instead of shipping a ' +
        'link with nowhere to go.',
    ),
  ]
}

/**
 * The animation fields every element gets (AGL-2486).
 *
 * Presets rather than a keyframes box, because the audience includes people
 * who have never written CSS: an author picks "Slide up", "on scroll into
 * view", and adjusts a few obvious knobs. The knobs named — duration,
 * delay, easing — plus stagger, and this is that list and nothing more. There
 * is deliberately no keyframe editor and no general trigger picker; the
 * things that are NOT offered (the distance a slide travels, the difference
 * between a transition and a keyframe run, arbitrary curves) are decided for
 * the author, and an author who needs them has the sx tab.
 *
 * Easing is a named list, never a `cubic-bezier()` text box. That keeps the
 * curve out of author free-text — the id becomes a class and the curve is
 * looked up in the tenant's own stylesheet — so there is nothing here for the
 * sx sanitizer to have to catch.
 *
 * "Stagger children" is the one control that changes WHAT animates rather
 * than how: the element stops animating and its children animate in
 * sequence instead. It reads as a switch rather than a separate "Stagger"
 * preset because stagger is orthogonal to fade/slide/zoom — a "Stagger"
 * preset would have had to answer "stagger which animation?".
 *
 * Offered on every element, unlike the visibility directives above, because an
 * animation is meaningful on any node on any screen — there is no context in
 * which the field would be inert.
 *
 * The "None" option carries a real value, never `''` (AGL-1451/AGL-1191): an
 * empty value cannot persist, so an author who picked a preset could never
 * turn it back off.
 *
 * The dependent fields are gated on the PRESET rather than on "not none", so
 * an element that has never been animated shows one dropdown and nothing else.
 * `is` takes the explicit list; a `notMatch` against `'none'` would be true for
 * the undefined case too and would show all five fields on every element.
 */
export function buildAnimationFields(): Array<Record<string, unknown>> {
  const animated = {
    when: Aglyn.NODE_ANIMATION_PROP,
    is: Aglyn.ANIMATION_PRESETS.filter(
      (preset) => preset !== Aglyn.ANIMATION_NONE,
    ),
  }
  // Stagger is an entrance idea. Named rather than inlined twice so the
  // switch and its step field can never drift apart and leave a step control
  // visible for a trigger that ignores it.
  const staggerable = {
    when: Aglyn.NODE_ANIMATION_TRIGGER_PROP,
    is: ['scroll', 'load'],
  }
  const help = (label: string, description: string) => ({
    label,
    description,
    // Same tooltip treatment the schema attributes get (AGL-600); this list
    // never reaches the `withAttributeHelp` map above.
    help: { title: label, excerpt: description },
  })
  return [
    {
      name: Aglyn.NODE_ANIMATION_PROP,
      ...help(
        'Animation',
        'Adds movement to this element. Motion is skipped automatically for ' +
          'visitors who have asked their device to reduce it.',
      ),
      component: Aglyn.FieldComponentType.SELECT,
      options: [
        { value: Aglyn.ANIMATION_NONE, label: 'None' },
        { value: 'fade', label: 'Fade in' },
        { value: 'slide-up', label: 'Slide up' },
        { value: 'slide-down', label: 'Slide down' },
        { value: 'slide-left', label: 'Slide left' },
        { value: 'slide-right', label: 'Slide right' },
        { value: 'zoom-in', label: 'Zoom in' },
        { value: 'zoom-out', label: 'Zoom out' },
      ],
    },
    {
      name: Aglyn.NODE_ANIMATION_TRIGGER_PROP,
      ...help(
        'Plays',
        'When the animation runs. "On scroll into view" is the usual choice ' +
          'for anything below the top of the page.',
      ),
      component: Aglyn.FieldComponentType.SELECT,
      condition: animated,
      initialValue: Aglyn.ANIMATION_DEFAULT_TRIGGER,
      options: [
        { value: 'scroll', label: 'On scroll into view' },
        { value: 'load', label: 'On page load' },
        { value: 'hover', label: 'On hover' },
      ],
    },
    {
      name: Aglyn.NODE_ANIMATION_DURATION_PROP,
      ...help(
        'Duration (ms)',
        `How long the animation takes, in milliseconds. ${Aglyn.ANIMATION_DEFAULT_DURATION_MS} is a ` +
          `natural default; anything over ${Aglyn.ANIMATION_MAX_DURATION_MS} is capped.`,
      ),
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
      condition: animated,
      initialValue: Aglyn.ANIMATION_DEFAULT_DURATION_MS,
    },
    {
      name: Aglyn.NODE_ANIMATION_DELAY_PROP,
      ...help(
        'Delay (ms)',
        'How long to wait before starting. Stagger a row of cards by giving ' +
          'each one a slightly larger delay.',
      ),
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
      condition: animated,
      initialValue: Aglyn.ANIMATION_DEFAULT_DELAY_MS,
    },
    {
      name: Aglyn.NODE_ANIMATION_EASE_PROP,
      ...help(
        'Easing',
        'The shape of the motion — whether it eases off as it arrives, moves ' +
          'at one steady speed, or travels a little past its mark and comes ' +
          'back to it.',
      ),
      component: Aglyn.FieldComponentType.SELECT,
      condition: animated,
      initialValue: Aglyn.ANIMATION_DEFAULT_EASE,
      options: [
        { value: 'smooth', label: 'Smooth' },
        { value: 'steady', label: 'Steady' },
        { value: 'gentle-start', label: 'Gentle start' },
        { value: 'gentle-end', label: 'Gentle end' },
        { value: 'gentle-both', label: 'Gentle start and end' },
        // The LABEL changed, the value did not (AGL-2486). `overshoot` is the
        // stored id: it is written into `aglynAnimationEase` on every node
        // that uses it, published as the `aglyn-anim-ease--overshoot` class,
        // and keyed in `EASE_CURVES`. Renaming the value would silently drop
        // the easing from every document already using it, which is why only
        // the human-facing string here moves.
        { value: 'overshoot', label: 'Settles into place' },
      ],
    },
    {
      name: Aglyn.NODE_ANIMATION_STAGGER_PROP,
      ...help(
        'Stagger children',
        'Animate the things inside this element one after another, instead ' +
          'of animating the element as a whole. Turn this on for a row of ' +
          'cards or a list.',
      ),
      component: Aglyn.FieldComponentType.SWITCH,
      // Not offered for hover: a hover effect has to reverse the moment the
      // pointer leaves, and a staggered one would strand half a row.
      condition: [animated, staggerable],
    },
    {
      name: Aglyn.NODE_ANIMATION_STAGGER_STEP_PROP,
      ...help(
        'Stagger step (ms)',
        `How much later each one starts than the one before it. ` +
          `${Aglyn.ANIMATION_DEFAULT_STAGGER_STEP_MS} is a natural default; ` +
          `anything over ${Aglyn.ANIMATION_MAX_STAGGER_STEP_MS} is capped, ` +
          `because this gap multiplies down the row.`,
      ),
      component: Aglyn.FieldComponentType.TEXT_FIELD,
      type: 'number',
      // `is` accepts the string form too: a switch that has been round-tripped
      // through a text-shaped store comes back as `'true'`, and a step field
      // that silently stopped appearing would be blamed on the switch.
      condition: [animated, staggerable, { when: Aglyn.NODE_ANIMATION_STAGGER_PROP, is: [true, 'true'] }],
      initialValue: Aglyn.ANIMATION_DEFAULT_STAGGER_STEP_MS,
    },
    {
      name: Aglyn.NODE_ANIMATION_REPEAT_PROP,
      ...help(
        'Replay each time',
        'Play the animation again every time the element scrolls back into ' +
          'view, instead of only the first time.',
      ),
      component: Aglyn.FieldComponentType.SWITCH,
      // Both conditions must hold: DDF ANDs an array of conditions. Replay is
      // meaningless for the other two triggers — a page loads once, and hover
      // is a transition that already reverses.
      condition: [
        animated,
        { when: Aglyn.NODE_ANIMATION_TRIGGER_PROP, is: 'scroll' },
      ],
    },
  ]
}

/**
 * The list each entity picker DISPLAYS, keyed by the attribute type a
 * component schema declares.
 *
 * One table rather than two switches, because the demand signal and the
 * option list have to agree about which list a picker means. When they
 * disagreed the failure was silent and total: the panel would open a
 * listener on one collection and read its options out of another, and the
 * dropdown stayed empty on a site full of data.
 *
 * `DATASET_FIELD_SELECT` is deliberately absent. Its options are the model
 * fields of the dataset an ANCESTOR chose, so it needs the dataset list to
 * resolve against but is not itself a picker OF datasets — it asks for the
 * list below and renders its own options.
 */
export const ENTITY_PICKER_KINDS: Readonly<
  Partial<Record<Aglyn.FieldComponentType, Aglyn.EntityPickerKind>>
> = {
  [Aglyn.FieldComponentType.PRODUCT_SELECT]: 'products',
  [Aglyn.FieldComponentType.COLLECTION_SELECT]: 'collections',
  [Aglyn.FieldComponentType.CATEGORY_SELECT]: 'categories',
  [Aglyn.FieldComponentType.DATASET_SELECT]: 'datasets',
  [Aglyn.FieldComponentType.FORM_SELECT]: 'forms',
}

/** Where an author makes more of each kind, named in the empty picker. */
const ENTITY_PICKER_ORIGIN: Readonly<
  Record<
    Aglyn.EntityPickerKind,
    { singular: string; plural: string; page: string }
  >
> = {
  products: {
    singular: 'product',
    plural: 'products',
    page: 'the Products page',
  },
  collections: {
    singular: 'collection',
    plural: 'collections',
    page: 'the Collections page',
  },
  categories: {
    singular: 'category',
    plural: 'categories',
    page: 'the Categories page',
  },
  datasets: {
    singular: 'dataset',
    plural: 'datasets',
    page: 'the Data page',
  },
  forms: { singular: 'form', plural: 'forms', page: 'the Forms page' },
}

/**
 * The label on an entity picker's empty first option.
 *
 * An empty dropdown and a broken dropdown look identical, and an author who
 * cannot tell them apart goes looking for a form they already made. So the
 * four reasons a picker has nothing say four different things, and only the
 * settled one claims anything about the site.
 */
export function entityPickerPlaceholder(
  kind: Aglyn.EntityPickerKind,
  state: Aglyn.EntityListState,
  count: number,
): string {
  if (count > 0) return 'None'
  const { plural, page } = ENTITY_PICKER_ORIGIN[kind]
  switch (state) {
    case 'error':
      return `Could not load ${plural} — reopen this panel to try again`
    case 'loading':
      return `Loading ${plural}…`
    case 'unavailable':
      return `This editor cannot list ${plural}`
    default:
      return `No ${plural} yet — add one on ${page}`
  }
}

/**
 * What a picker owes the reader about the list it is showing.
 *
 * A browse window is a PAGE of the site's catalog, and a page that does not
 * say so is the silent-truncation defect: "not in the picker" and "does not
 * exist" are the same absence to look at, and only one of them is a fact
 * about their site. The inbox's form filter carries the same sentence for the
 * same reason.
 *
 * Two sentences, because the second half is only true for a kind whose
 * documents carry the name-search keys. A picker that promised to search the
 * whole catalog and then searched 25 rows would be a worse lie than saying
 * nothing.
 */
export function entityPickerBrowseNotice(
  kind: Aglyn.EntityPickerKind,
  context: Aglyn.EntityPickerContextValue | undefined,
): string | undefined {
  if (!context?.truncated?.[kind]) return undefined
  const { plural } = ENTITY_PICKER_ORIGIN[kind]
  const first = `Showing the first ${Aglyn.ENTITY_PICKER_BROWSE_LIMIT} ${plural} — this site has more. `
  return context.searchable?.[kind]
    ? `${first}Type to search all of them.`
    : `${first}Typing narrows these ${Aglyn.ENTITY_PICKER_BROWSE_LIMIT} only.`
}

/**
 * What the dropdown says when the reader's typing matches nothing it holds.
 *
 * On a truncated list that cannot be searched on the server, "no match" is a
 * statement about the WINDOW and must not be read as one about the site —
 * this is where an author concludes a form they already made does not exist
 * and makes a second one.
 */
export function entityPickerNoMatchText(
  kind: Aglyn.EntityPickerKind,
  context: Aglyn.EntityPickerContextValue | undefined,
): string {
  const { plural } = ENTITY_PICKER_ORIGIN[kind]
  if (context?.truncated?.[kind] && !context?.searchable?.[kind]) {
    return `No match in the first ${Aglyn.ENTITY_PICKER_BROWSE_LIMIT} ${plural} — this site has more.`
  }
  return `No ${plural} match.`
}

/**
 * The extra option a picker needs when its stored value is not in the window.
 *
 * The counterpart to {@link Aglyn.unresolvedScreenOption}, and it exists for
 * the same reason: a picker whose value matches no option renders BLANK, which
 * reads as "nothing chosen" on an element that is bound. An author repairs
 * that by choosing again — which is how a correct reference gets replaced with
 * a different one.
 *
 * Returns the stored value UNCHANGED as the option's value. Naming a
 * selection must never rewrite it.
 *
 * A value nothing has answered for yet shows as the raw id, NOT as a warning.
 * Flashing "unavailable" over every live reference for the beat before the
 * keyed read lands would teach authors to ignore the one warning that means
 * something — the same call `unavailableScreenLabel` makes.
 *
 * The exception is a picker that has settled and has no way to look anything
 * up. There is no answer coming, so the raw value is all there will ever be,
 * and left unmarked it would read as a resolved name — which is exactly what
 * a free-text caption stored where an id belongs looks like.
 */
export function entitySelectionOption(
  context: Aglyn.EntityPickerContextValue | undefined,
  kind: Aglyn.EntityPickerKind,
  value: unknown,
): { value: string; label: string } | undefined {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id) return undefined
  if ((context?.[kind] ?? []).some((entity) => entity.id === id)) {
    return undefined
  }
  const resolved = context?.resolved?.[kind]?.[id]
  if (resolved) return { value: id, label: resolved.label }
  const { singular } = ENTITY_PICKER_ORIGIN[kind]
  if (resolved === null) {
    return { value: id, label: `⚠ Unavailable ${singular} (${id}) — deleted` }
  }
  const settledWithNoLookup =
    Aglyn.entityListState(context, kind) === 'ready' && !context?.resolve
  return {
    value: id,
    label: settledWithNoLookup ? `⚠ Unrecognized ${singular} (${id})` : id,
  }
}

/**
 * An entity picker rendered as the SELECT the form renderer knows how to
 * draw, resolved against whatever the surface's picker context can offer.
 *
 * Three things this must not do, each of which renders as something other
 * than a broken picker.
 *
 * Every option carries the entity's ID, never its label. The label is
 * resolved fresh at edit time and a rename moves it; the id is the whole
 * reference, and for a form it is the difference between one submission list
 * and two (`docs/specs/reusable-forms.md` §2c).
 *
 * The field is decided by the attribute's own TYPE, not by whether a list
 * happens to have arrived. Keying off the list meant a surface with no picker
 * context dropped the attribute from the panel entirely — no control, no
 * explanation, indistinguishable from a component that simply has no such
 * setting. A picker with nothing to offer must still be a picker, and must
 * say what is wrong.
 *
 * And the STORED VALUE is offered whether or not the browse window contains
 * it, which is what lets that window be a console page rather than hundreds
 * of documents. A picker that took its options and its current selection from
 * one list needs the list wide enough to hold whatever an author picked last
 * month, and past that width renders a bound element as unbound anyway. The
 * selection is a keyed read; this is where its answer is offered.
 */
export function buildEntityPickerField<
  T extends Aglyn.AglynAttributeSchema,
>(
  field: T,
  kind: Aglyn.EntityPickerKind,
  context: Aglyn.EntityPickerContextValue | undefined,
  value?: unknown,
) {
  const entities = context?.[kind] ?? []
  const selected = entitySelectionOption(context, kind, value)
  const notice = entityPickerBrowseNotice(kind, context)
  const search = context?.search
  return {
    ...field,
    component: Aglyn.FieldComponentType.SELECT,
    // The dropdown's input is read-only without this, so a list of any size
    // could only be scrolled. Narrowing 25 rows by typing is the cheapest
    // half of reaching past them.
    isSearchable: true,
    ...(search
      ? {
          // `onSearchInput` and NOT `onInputChange`: the latter is owned by
          // `@data-driven-forms/common/select`, which assigns it after
          // spreading the field's props, so a handler declared here would be
          // overwritten before the mapper saw it — and a dropped handler is
          // invisible, since the dropdown still opens and still filters.
          //
          // Only a typed character asks for anything. A `reset` fires when
          // the field takes its own value back on mount and when a choice is
          // made, and treating those as a query would spend a search read on
          // opening the panel — the read this whole arc is about not making.
          onSearchInput: (text: string, reason?: string) => {
            if (reason && reason !== 'input') return
            search(kind, text)
          },
        }
      : {}),
    ...(notice ? { helperText: notice } : {}),
    noOptionsText: () => entityPickerNoMatchText(kind, context),
    options: [
      {
        value: '',
        label: entityPickerPlaceholder(
          kind,
          Aglyn.entityListState(context, kind),
          entities.length,
        ),
      },
      ...[...entities]
        .sort((a, b) => a.label.localeCompare(b.label))
        .map((entity) => ({ value: entity.id, label: entity.label })),
      ...(selected ? [selected] : []),
    ],
  }
}

/**
 * Which entity lists a node's attributes will need (AGL-703).
 *
 * The provider that owns those lists reads them from Firestore, and it used
 * to read all four the moment the besigner opened — up to 300 products, 200
 * catalog collections, 200 categories and 200 datasets — for pickers most
 * editing sessions never open. This is the demand signal that replaced that:
 * a node whose schema declares the picker.
 *
 * `DATASET_FIELD_SELECT` asks for `datasets` and not for some list of its
 * own, which is the one mapping worth stating: its options are the model
 * fields of the dataset an ANCESTOR chose, so it cannot resolve one without
 * the dataset list to resolve it against.
 *
 * Exported for the test that pins the mapping — a picker silently missing
 * from {@link ENTITY_PICKER_KINDS} renders as a permanently empty dropdown,
 * which looks exactly like a site with no products.
 */
export function entityKindsForAttributes(
  attributes: readonly Aglyn.AglynAttributeSchema[] | undefined,
): Aglyn.EntityPickerKind[] {
  const kinds = new Set<Aglyn.EntityPickerKind>()
  for (const field of attributes ?? []) {
    if (field.component === Aglyn.FieldComponentType.DATASET_FIELD_SELECT) {
      kinds.add('datasets')
      continue
    }
    const kind = ENTITY_PICKER_KINDS[field.component]
    if (kind) kinds.add(kind)
  }
  return [...kinds]
}

const ElementPropsFormRaw = forwardRef<any, ElementPropsFormProps>(
  (props, ref) => {
    const { node, ...rest } = props
    const schema = node?.componentSchema
    const nodeProps = node?.props
    const deleteElementCallback = useDeleteElementCallback()
    const rawAttributes = schema?.attributes
    // Screen-select fields can't carry static options (the host's screens
    // are only known at edit time), so resolve them here from the routing
    // map + labels the console provides via ScreenLinkContext. Entity
    // pickers (AGL-343/344) resolve the same way from EntityPickerContext.
    const { screens, labels } = useContext(Aglyn.ScreenLinkContext)
    const entityOptions = useContext(Aglyn.EntityPickerContext)
    /**
     * Ask for the entity lists this node's pickers will actually show
     * (AGL-703).
     *
     * The provider used to read all four collections when the besigner
     * opened — up to 900 documents on a site with a catalog — for pickers
     * most editing sessions never open. Moving a heading does not need the
     * product list.
     *
     * The demand signal is the node's own schema, which is already scanned
     * twice below for exactly this kind of question (`wantsNodes`,
     * `hasDatasetFieldSelect`). `DATASET_FIELD_SELECT` asks for `datasets`
     * too: its options come from the chosen dataset's model, so it cannot
     * resolve one without the list.
     */
    const requestEntities = entityOptions.request
    useEffect(() => {
      if (!requestEntities) return
      for (const kind of entityKindsForAttributes(rawAttributes)) {
        requestEntities(kind)
      }
    }, [rawAttributes, requestEntities])
    /**
     * Learn the name of the entity this node is ALREADY bound to.
     *
     * The browse list is a page now, so it answers this only by luck. A keyed
     * read answers it always, and asking for one is gated hard: only for a
     * node that carries a value, only once the browse read has settled
     * without supplying it, and never twice for the same id. A site whose
     * catalog fits in the window makes no such read at all.
     */
    const resolveEntity = entityOptions.resolve
    useEffect(() => {
      if (!resolveEntity) return
      for (const field of rawAttributes ?? []) {
        const kind = ENTITY_PICKER_KINDS[field.component]
        if (!kind) continue
        const id = Aglyn.entityValueNeedsResolution(
          entityOptions,
          kind,
          nodeProps?.[field.name],
        )
        if (id) resolveEntity(kind, id)
      }
    }, [rawAttributes, nodeProps, entityOptions, resolveEntity])

    // Canvas-node options for NODE_SELECT attributes (AGL-557): every
    // other element on the canvas, labeled by component name + a text
    // snippet, with a short id suffix to tell repeats apart. The edited
    // node itself is excluded (revealing yourself is never meaningful).
    const nodeOptions = useMemo(() => {
      const wantsNodes = (rawAttributes ?? []).some(
        (field) =>
          field.component === Aglyn.FieldComponentType.NODE_SELECT,
      )
      if (!wantsNodes) return []
      const canvasNodes = (Aglyn.canvas.toJSON().nodes ?? {}) as Record<
        string,
        any
      >
      return Object.entries(canvasNodes)
        .filter(([id]) => id && id !== node?.$id)
        .map(([id, candidate]) => {
          const displayName =
            Aglyn.components.getSchema(candidate?.componentId)
              ?.displayName ??
            candidate?.componentId ??
            'Element'
          const text =
            typeof candidate?.props?.children === 'string'
              ? candidate.props.children.trim().slice(0, 24)
              : ''
          return {
            value: id,
            label: `${displayName}${text ? ` "${text}"` : ''} · ${id.slice(
              0,
              6,
            )}`,
          }
        })
        .sort((a, b) => a.label.localeCompare(b.label))
    }, [rawAttributes, node?.$id])
    // Dataset-field selects (AGL-556) list the model fields of the nearest
    // ancestor's chosen dataset (e.g. the form field's parent form). The
    // ancestor persists the dataset id; legacy nodes carrying only a name
    // resolve it by matching the current display labels.
    const hasDatasetFieldSelect = (rawAttributes ?? []).some(
      (field) =>
        field.component === Aglyn.FieldComponentType.DATASET_FIELD_SELECT,
    )
    const ancestorDatasetId = useMemo(() => {
      if (!hasDatasetFieldSelect || !node?.$id) return undefined
      const nodes = Aglyn.canvas.toJSON().nodes as Record<string, any>
      let current = nodes[node.$id]
      for (let hops = 0; current && hops < 100; hops += 1) {
        const props = current.props ?? {}
        if (typeof props.datasetId === 'string' && props.datasetId) {
          return props.datasetId as string
        }
        if (typeof props.datasetName === 'string' && props.datasetName) {
          const byLabel = (entityOptions.datasets ?? []).find(
            (dataset) => dataset.label === props.datasetName,
          )
          if (byLabel) return byLabel.id
        }
        current = current.parentId ? nodes[current.parentId] : undefined
      }
      return undefined
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasDatasetFieldSelect, node, entityOptions.datasets])
    // Insert-picker options + pill display-name inputs (AGL-583/586),
    // assembled from this node's ancestor context — shared with the
    // inline text editor via the extracted hook.
    const { options: insertOptions, labelContext: tokenLabelContext } =
      useInsertTokenOptions(node)
    // Re-render when the installed-plugin set changes (AGL-1030).
    const knownPluginInstallsVersion = useSyncExternalStore(
      Aglyn.subscribeKnownPluginInstalls,
      Aglyn.getKnownPluginInstallsVersion,
      Aglyn.getKnownPluginInstallsVersion,
    )

    /**
     * Whether this element's text is FORMATTED, i.e. it carries a `html`
     * prop that the renderer draws in preference to `children` (AGL-2486).
     *
     * When it does, the two fields disagree about which one is the content:
     * the canvas draws `html`, and this panel's Text field edits `children`,
     * so typing here changes a prop nothing renders. The field appears to do
     * nothing, which is the worst of the three possible behaviours.
     *
     * The alternative considered and rejected was letting a plain edit
     * silently clear `html`. Its failure mode is typing one character and
     * losing every link in the paragraph, with no sign until the damage is
     * done. Merging plain text back into markup was rejected too: mapping
     * arbitrary text onto a marked-up tree has no correct answer once the
     * edit is structural. So the canvas owns formatted text, this field
     * shows it read-only and says why, and dropping the formatting is an
     * explicit, undoable act — see {@link handleRemoveFormatting}.
     */
    const hasFormattedText = isFormattedText(node)

    const attributes = useMemo(() => {
      // Every described attribute gets a help tooltip beside the field
      // (AGL-600) — the definition's own description, no docs link since
      // attributes are component-specific.
      const withAttributeHelp = <T extends Aglyn.AglynAttributeSchema>(
        field: T,
      ): T =>
        field.description && !field['help']
          ? {
              ...field,
              help: {
                title: field['label'] ?? field.name,
                excerpt: field.description,
              },
            }
          : field

      return (rawAttributes ?? []).map(withAttributeHelp).map((field) => {
        if (field.component === Aglyn.FieldComponentType.SCREEN_SELECT) {
          const options = [
            { value: '', label: 'None (use external URL)' },
            ...Object.entries(screens ?? {})
              .sort(([, a], [, b]) => a.localeCompare(b))
              .map(([screenId, path]) => ({
                value: screenId,
                label: `${labels?.[screenId] ?? screenId} (${
                  path === '/' ? '/' : `/${path}`
                })`,
              })),
          ]
          // A stored target the host no longer has renders as a BLANK
          // picker, which reads as "no link set" while the element still
          // behaves as linked (AGL-1893). Naming it is the only way the
          // author finds out before publishing rather than after.
          const stranded = Aglyn.unresolvedScreenOption(
            nodeProps?.[field.name],
            screens,
          )
          if (stranded && !options.some((o) => o.value === stranded.value)) {
            options.push(stranded)
          }
          return {
            ...field,
            component: Aglyn.FieldComponentType.SELECT,
            options,
          }
        }
        if (field.component === Aglyn.FieldComponentType.PLUGIN_SETTINGS) {
          // Rendered by a bespoke editor rather than expanded into N fields
          // here: the settings live in ONE stored JSON attribute, and the
          // editor reads the sibling `listingId` to know which manifest's
          // props to offer. Expanding in this memo would need the field list
          // to change identity whenever the selection did, which is exactly
          // the render-loop shape the panel avoids elsewhere.
          return {
            ...field,
            component: PLUGIN_SETTINGS_FIELD_COMPONENT,
          }
        }
        if (field.component === Aglyn.FieldComponentType.PLUGIN_SELECT) {
          // Installed plugins (AGL-1030), from the set the console publishes
          // for the drawer — host and org pins both, host winning where it
          // shadows. No extra read: the pins already carry the display name.
          const installs = Aglyn.getKnownPluginInstalls()
          return {
            ...field,
            component: Aglyn.FieldComponentType.SELECT,
            options: [
              {
                value: '',
                label: installs.length
                  ? 'None'
                  : 'No plugins installed for this site',
              },
              ...installs.map((install) => ({
                value: install.listingId,
                label:
                  install.displayName ??
                  /* An install with no name is still choosable — better a raw
                     id in one option than a plugin that cannot be placed. */
                  install.listingId,
              })),
            ],
          }
        }
        if (field.component === Aglyn.FieldComponentType.NODE_SELECT) {
          // Canvas-element picker (AGL-557), resolved above.
          return {
            ...field,
            component: Aglyn.FieldComponentType.SELECT,
            options: [{ value: '', label: 'None' }, ...nodeOptions],
          }
        }
        if (
          field.component === Aglyn.FieldComponentType.DATASET_FIELD_SELECT
        ) {
          // Model order, never alphabetized — it mirrors the schema dialog.
          const modelFields = ancestorDatasetId
            ? entityOptions.datasetFields?.[ancestorDatasetId] ?? []
            : []
          return {
            ...field,
            component: Aglyn.FieldComponentType.SELECT,
            options: [
              {
                value: '',
                label: modelFields.length
                  ? 'None (match by field name)'
                  : 'No dataset selected on the form',
              },
              ...modelFields.map((modelField) => ({
                value: modelField.id,
                label: modelField.label,
              })),
            ],
          }
        }
        // Id-based entity pickers (AGL-343/344), including the Form
        // element's `formId`. Recognised by the attribute's declared type,
        // so a surface whose picker context is missing renders a picker
        // that SAYS so instead of one that is not there.
        const entityKind = ENTITY_PICKER_KINDS[field.component]
        if (entityKind) {
          // The stored value travels with the field: a selection outside the
          // browse window is offered from its own keyed read, so a bound
          // element never renders as unbound.
          return buildEntityPickerField(
            field,
            entityKind,
            entityOptions,
            nodeProps?.[field.name],
          )
        }
        // Formatted text is owned by the canvas (AGL-2486). Shown, with
        // the reason, rather than silently editable into a prop the
        // renderer ignores.
        if (field.name === 'children' && hasFormattedText) {
          return {
            ...field,
            component: TOKEN_TEXT_FIELD_COMPONENT,
            multiline: true,
            isReadOnly: true,
            description:
              'This text is formatted — double-click the element on the ' +
              'canvas to edit it. Remove formatting to edit it here.',
            tokenOptions: insertOptions,
            tokenLabelContext,
          }
        }
        if (
          (field.component === Aglyn.FieldComponentType.TEXT_FIELD ||
            field.component === Aglyn.FieldComponentType.TEXTAREA) &&
          !(field as any).isReadOnly
        ) {
          // Token-capable free-text fields (children, href, src, …)
          // render through the pill editor (AGL-586): stored `{{...}}`
          // tokens display as named colored pills, the {x} adornment
          // inserts at the caret (AGL-583), and raw {{...}} typing keeps
          // working (it materializes into a pill on blur).
          return {
            ...field,
            component: TOKEN_TEXT_FIELD_COMPONENT,
            multiline:
              field.component === Aglyn.FieldComponentType.TEXTAREA,
            tokenOptions: insertOptions,
            tokenLabelContext,
          }
        }
        return field
      }).filter((field) => {
        // Unknown editor types must degrade to a skipped attribute, never
        // kill the whole form: the renderer throws on unregistered
        // components, which blanked the email designer's attributes panel
        // when COLOR_PICKER wasn't mapped (AGL-584).
        const known = (field.component as string) in elementPropsComponentMapper
        if (!known && process.env.NODE_ENV !== 'production') {
          console.warn(
            `[ElementPropsForm] attribute "${field.name}" uses unregistered ` +
              `editor "${field.component}" — skipped; register it in ` +
              'elementPropsComponentMapper.',
          )
        }
        return known
      })
    }, [
      hasFormattedText,
      rawAttributes,
      screens,
      labels,
      // Read by the Screen pickers to name a target the map has lost
      // (AGL-1893). Safe as a dependency: the form owns the values the
      // author is typing, so this object's identity moves when a different
      // node is selected or a save commits — not on every keystroke.
      nodeProps,
      entityOptions,
      nodeOptions,
      // The installed-plugin set arrives from a live subscription and can land
      // after this memo first ran (AGL-1030) — without it the picker would sit
      // on "No plugins installed for this site" until the panel remounted.
      knownPluginInstallsVersion,
      ancestorDatasetId,
      insertOptions,
      tokenLabelContext,
    ])

    // Reusable-component flows (AGL-35): actions appear only when the host
    // app provides callbacks; locked nodes (layout chrome) never promote.
    const { onPromote, onDemote, onEditComponent, definitions } = useContext(
      ComponentPromotionContext,
    )
    const isInstance =
      node?.componentId === Aglyn.REUSABLE_INSTANCE_COMPONENT_ID
    const unlocked = Besigner.dnd.canDragNode(node)

    const instancePropFields = useMemo(() => {
      if (!isInstance) return []
      const refId = (node?.props as { refId?: string } | undefined)?.refId
      return buildInstancePropFields(
        refId ? definitions?.[refId]?.props : undefined,
        insertOptions,
        tokenLabelContext,
      )
    }, [
      isInstance,
      node,
      definitions,
      insertOptions,
      tokenLabelContext,
    ])

    // Visibility directives (AGL-1314), inside a component editor only —
    // `componentProps` is the same "am I editing a definition" signal the
    // insert picker keys `{{prop.*}}` off.
    const { componentProps: editedComponentProps } =
      useContext(BindingPickerContext)
    const visibilityFields = useMemo(
      () =>
        editedComponentProps
          ? buildVisibilityFields(insertOptions, tokenLabelContext)
          : [],
      [editedComponentProps, insertOptions, tokenLabelContext],
    )

    // Element animation (AGL-2486). Static, so it is built once rather than
    // per render; unlike the visibility directives it is offered everywhere.
    const animationFields = useMemo(() => buildAnimationFields(), [])

    const formFieldSchema = useMemo(
      () =>
        [
          ...attributes,
          ...instancePropFields,
          ...visibilityFields,
          ...animationFields,
        ].map(withNumericValueParse),
      [attributes, instancePropFields, visibilityFields, animationFields],
    )

    // Image-typed declared props get the same library browse button the
    // component's own media attributes get (AGL-341).
    const instanceMediaProps = useMemo(() => {
      if (!isInstance) return []
      const refId = (node?.props as { refId?: string } | undefined)?.refId
      const declared = refId ? definitions?.[refId]?.props : undefined
      return (declared ?? [])
        .filter(
          (prop) =>
            prop?.type === 'image' &&
            Aglyn.COMPONENT_PROP_NAME_PATTERN.test(prop.name ?? ''),
        )
        .map((prop) => ({
          name: prop.name,
          label: prop.label || prop.name,
        }))
    }, [isInstance, node, definitions])

    // AI copy assist (AGL-89, widened by AGL-130): text-editable elements
    // and any element declaring text attributes, when the host app
    // provides the rewrite callback.
    const { onRewrite } = useContext(AiAssistContext)
    const textEditable =
      ((schema?.flags?.textEditable ?? Aglyn.FEATURE_FLAG.DISABLED) &
        Aglyn.FEATURE_FLAG.ENABLED) !==
      0
    const hasTextAttributes = (schema?.attributes ?? []).some(
      (field) =>
        field.component === Aglyn.FieldComponentType.TEXT_FIELD ||
        field.component === Aglyn.FieldComponentType.TEXTAREA,
    )

    // Insert binding (AGL-100): appends a {{token}} to the element text.
    // Variable/function docs come from the host app; the commit spreads
    // current props — updateNodeProps REPLACES the props object.
    const { variables: bindingVariables, functions: bindingFunctions } =
      useContext(BindingPickerContext)
    const [bindingAnchor, setBindingAnchor] = useState<HTMLElement | null>(
      null,
    )
    // Friendly summary of bound string props (AGL-193): id tokens display
    // as current names; missing referents surface in warning color.
    const boundPropSummaries = useMemo(() => {
      const summaries: Array<{
        prop: string
        display: string
        missing: boolean
      }> = []
      for (const [key, value] of Object.entries(nodeProps ?? {})) {
        if (typeof value !== 'string' || !Aglyn.hasBindings(value)) continue
        const display = Aglyn.displayBindingTokens(
          value,
          (bindingVariables ?? {}) as any,
          (bindingFunctions ?? {}) as any,
        )
        summaries.push({
          prop: key,
          display,
          missing: display.includes(Aglyn.MISSING_BINDING_LABEL),
        })
      }
      return summaries
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(nodeProps ?? {}), bindingVariables, bindingFunctions])

    const handleInsertBinding = useCallback(
      (token: string) => {
        setBindingAnchor(null)
        const current = (Aglyn.canvas.toJSON().nodes as Record<string, any>)[
          node?.$id
        ]
        const text =
          typeof current?.props?.children === 'string'
            ? (current.props.children as string)
            : ''
        Aglyn.canvas.updateNodeProps(node, {
          ...current?.props,
          children: text ? `${text} ${token}` : token,
        })
      },
      [node],
    )

    // Browse media (AGL-106): elements with a `src` attribute can pick an
    // asset from the host's media library; the commit spreads current props
    // (updateNodeProps REPLACES the props object).
    const { onPickMedia } = useContext(MediaPickerContext)
    // Interactions (AGL-258): element-scoped automations + section A/B.
    const interactions = useContext(InteractionsContext)
    const nodeSelector = node?.$id ? nodeElementSelector(node.$id) : ''
    const nodeAutomations = (interactions.automations ?? []).filter(
      (automation) => automation.selector === nodeSelector,
    )
    const nodeExperiment = (interactions.sectionExperiments ?? []).find(
      (experiment) => experiment.nodeId === node?.$id,
    )
    // Media-bearing attributes (AGL-341): every image/media URL field gets
    // a library browse button; the text field itself stays as the manual
    // URL escape hatch.
    const mediaAttributes = useMemo(
      () =>
        (rawAttributes ?? []).filter(
          (field: any) =>
            field?.component === Aglyn.FieldComponentType.TEXT_FIELD &&
            typeof field?.name === 'string' &&
            /^(src|poster)$|(image|logo|avatar|media|thumbnail|photo|background)(Url)?$/i.test(
              field.name,
            ),
        ),
      [rawAttributes],
    )
    /**
     * True when this element declares an `alt` attribute of its own — Image
     * and Email image today. Read off the SCHEMA rather than assumed, so a
     * component without one is never handed a prop its renderer would drop.
     */
    const declaresAlt = useMemo(
      () => (rawAttributes ?? []).some((field: any) => field?.name === 'alt'),
      [rawAttributes],
    )
    /**
     * Drops the formatting and keeps the words (AGL-2486).
     *
     * Destructive to formatting and labelled as such. It is ONE
     * `updateNodeProps`, so it is one undo entry — undo restores the markup,
     * not merely the text, which is what makes offering it honest.
     *
     * `children` is left exactly as it is: since the projection keeps line
     * breaks it already holds the plain reading of the markup, so the
     * element goes on saying the same thing in the same shape.
     */
    const handleRemoveFormatting = useCallback(() => {
      if (!node?.$id) return
      const current = (Aglyn.canvas.toJSON().nodes as Record<string, any>)[
        node.$id
      ]
      Aglyn.canvas.updateNodeProps(node, withoutFormatting(current?.props))
    }, [node])

    const handleBrowseMedia = useCallback(
      (propName: string) => () => {
        // Written through verbatim: the host app decides the persisted form
        // (today a media reference — AGL-1215), the renderer resolves it.
        onPickMedia?.((value, asset) => {
          const current = (
            Aglyn.canvas.toJSON().nodes as Record<string, any>
          )[node?.$id]
          Aglyn.canvas.updateNodeProps(node, {
            ...current?.props,
            [propName]: value,
            ...inheritedAltPatch({
              propName,
              declaresAlt,
              props: current?.props,
              assetAlt: asset?.alt,
            }),
            // The asset's own pixel size, so the published `<img>` can
            // reserve its box before the bytes arrive (AGL-2486). Gated on
            // the component id inside the helper: an element whose renderer
            // does not read these would spread them onto the DOM.
            ...Aglyn.intrinsicMediaSize({
              componentId: node?.componentId,
              propName,
              assetWidth: asset?.width,
              assetHeight: asset?.height,
            }),
          })
        })
      },
      [onPickMedia, node, declaresAlt],
    )

    // The same picker for an instance's image-typed declared prop, writing
    // into the nested `propValues` object (AGL-1247). Both levels are
    // spread because `updateNodeProps` REPLACES the props object rather
    // than merging into it.
    const handleBrowseInstanceMedia = useCallback(
      (propName: string) => () => {
        if (!node?.$id) return
        onPickMedia?.((value) => {
          const current = (
            Aglyn.canvas.toJSON().nodes as Record<string, any>
          )[node.$id]
          Aglyn.canvas.updateNodeProps(node, {
            ...current?.props,
            [Aglyn.REUSABLE_INSTANCE_PROP_VALUES_KEY]: {
              ...current?.props?.[Aglyn.REUSABLE_INSTANCE_PROP_VALUES_KEY],
              [propName]: value,
            },
          })
        })
      },
      [onPickMedia, node],
    )

    /**
     * Hang the media browser off the FIELDS it fills (AGL-2236).
     *
     * The picker has existed since AGL-341, but as full-width buttons after
     * the form — below `Save Element`, past every attribute the element
     * declares. The `src` field's own helper text says to "Pick from your
     * media library with 'Browse media'", so an author who read it looked
     * beside the field, found nothing, and concluded the only way to change
     * an image was to hand-type a `media:org:…/…` reference. Attaching the
     * control to the field makes the instruction true.
     *
     * Only fields the token editor renders get one: a read-only attribute
     * keeps no picker, because a control that writes an unwritable field is
     * the same class of lie this issue is about.
     */
    const fieldsWithMediaPickers = useMemo(() => {
      if (!onPickMedia) return formFieldSchema
      const browse = new Map<string, () => void>()
      for (const field of mediaAttributes) {
        browse.set(field.name, handleBrowseMedia(field.name))
      }
      for (const field of instanceMediaProps) {
        browse.set(
          `${Aglyn.REUSABLE_INSTANCE_PROP_VALUES_KEY}.${field.name}`,
          handleBrowseInstanceMedia(field.name),
        )
      }
      if (!browse.size) return formFieldSchema
      return formFieldSchema.map((field: any) =>
        browse.has(field.name) &&
        field.component === TOKEN_TEXT_FIELD_COMPONENT
          ? { ...field, onBrowseMedia: browse.get(field.name) }
          : field,
      )
    }, [
      formFieldSchema,
      mediaAttributes,
      instanceMediaProps,
      onPickMedia,
      handleBrowseMedia,
      handleBrowseInstanceMedia,
    ])

    // The field names whose value is a number, instance overrides included
    // under the `propValues.` path the schema names them by.
    const numericFieldNames = useMemo(
      () =>
        new Set(
          formFieldSchema
            .filter((field: any) => field?.type === 'number')
            .map((field: any) => field.name as string),
        ),
      [formFieldSchema],
    )

    const handleFormCancel = useCallback((e: SyntheticEvent, reason?: string) => {}, [])
    const handleElementSave = useCallback(
      (values: Record<string, unknown>) => {
        // Hand-typed {{name}} tokens normalize to their rename-safe
        // {{var:id}} form at save (AGL-186); unknown names pass through.
        const normalizeToken = (value: unknown) =>
          typeof value === 'string' && Aglyn.hasBindings(value)
            ? Aglyn.normalizeBindingTokens(
                value,
                (bindingVariables ?? {}) as any,
                (bindingFunctions ?? {}) as any,
              )
            : value
        // Numbers typed as text are converted by the field's own `parse`
        // (see `withNumericValueParse`) — repeated here because a document
        // authored before that landed carries the string, and an untouched
        // field never parses. The element goes on rendering at its default
        // until something rewrites the prop, so the next commit does.
        const normalizeNumeric = (name: string, value: unknown) =>
          numericFieldNames.has(name) ? numericTextValue(value) : value
        const normalized: Record<string, unknown> = { ...values }
        for (const [key, value] of Object.entries(values)) {
          normalized[key] = normalizeNumeric(key, normalizeToken(value))
        }
        // A component instance's overrides sit one level down (AGL-1247),
        // so the walk above skips them — normalize inside, or a hand-typed
        // {{name}} in an override would persist in its rename-unsafe form.
        const overrides = values[Aglyn.REUSABLE_INSTANCE_PROP_VALUES_KEY]
        if (overrides && typeof overrides === 'object') {
          const nextOverrides: Record<string, unknown> = {}
          for (const [key, value] of Object.entries(overrides)) {
            nextOverrides[key] = normalizeNumeric(
              `${Aglyn.REUSABLE_INSTANCE_PROP_VALUES_KEY}.${key}`,
              normalizeToken(value),
            )
          }
          normalized[Aglyn.REUSABLE_INSTANCE_PROP_VALUES_KEY] = nextOverrides
        }
        // Denormalize each picked icon's SVG path next to its id (AGL-1212).
        // The catalog is ~2.9 MB and only picker surfaces load it, so a render
        // surface that had to look the id up got `DEFAULT_ICON` — a real path,
        // so every published icon painted a "help" glyph. Resolving here means
        // the id stays the source of truth while the path travels with the
        // document. This runs where the picker already loaded the catalog; a
        // miss writes `undefined` and leaves the renderer's own fallback.
        for (const attribute of node?.componentSchema?.attributes ?? []) {
          if (attribute.component !== Aglyn.FieldComponentType.ICON_PICKER) {
            continue
          }
          const pathProp = iconPathPropName(attribute.name)
          if (pathProp === attribute.name) continue
          const pickedId = normalized[attribute.name]
          normalized[pathProp] =
            typeof pickedId === 'string' ? getMdiIconPath(pickedId) : undefined
        }
        Aglyn.canvas.updateNodeProps(node, normalized)
      },
      [node, bindingVariables, bindingFunctions, numericFieldNames],
    )

    return (
      <>
        <NoSsr>
          <FormRenderer
            componentMapper={elementPropsComponentMapper}
            onCancel={handleFormCancel}
            onSubmit={handleElementSave}
            initialValues={nodeProps}
            schema={{ fields: fieldsWithMediaPickers }}
            {...rest}
          >
            {({ formFields, schema, ...rest }) => (
              <>
                {/* Text-capable elements only (AGL-2167): the Text
                    attribute here and double-click-to-edit on the canvas
                    are the same value, which is the single thing about
                    this panel that surprises people. */}
                {textEditable || hasTextAttributes ? (
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'flex-end',
                      // The pull-up closes the gap under a row that holds
                      // only the help icon, which is shorter than the line
                      // box it sits in. `Remove formatting` is a full-height
                      // Button, so the same -8px drives its label into the
                      // outlined field's notch and overprints the `Text`
                      // legend (AGL-2486) — found while capturing the docs
                      // shot of this exact control.
                      mb: hasFormattedText ? 0 : -1,
                    }}
                  >
                    {/* The escape hatch beside the read-only field
                        (AGL-2486). Named for what it DOES — it throws the
                        formatting away — and it is one `updateNodeProps`,
                        so a single undo brings the markup back. */}
                    {hasFormattedText ? (
                      /* A warning-coloured button named for a deletion has to
                         say WHAT it deletes before it is pressed, not after
                         (AGL-2486). The words and the line breaks survive —
                         which is the half an author actually worries about —
                         so the tooltip leads with that, then names what goes,
                         then says it is undoable. Without it the only way to
                         find out is to press it. */
                      <Tooltip
                        title={
                          'Keeps every word and line break. Removes bold, ' +
                          'italic, underline, links and lists, so the text ' +
                          'becomes editable in this field. One undo brings ' +
                          'the formatting back.'
                        }
                      >
                        <Button
                          size="small"
                          color="warning"
                          onClick={handleRemoveFormatting}
                          sx={{ mr: 'auto', textTransform: 'none' }}
                        >
                          {'Remove formatting'}
                        </Button>
                      </Tooltip>
                    ) : null}
                    {/* The help tip follows the state the author is IN: with
                        formatted text the live question is what the greyed
                        field and that button mean, so it deep-links there
                        rather than to the section's opening paragraph. */}
                    {hasFormattedText ? (
                      <HelpTip
                        title="This text is formatted"
                        excerpt="Formatted text is edited on the canvas — double-click the element. Remove formatting to edit it in this field instead; the words and line breaks are kept."
                        href={besignerDocsUrl(
                          'textEditing',
                          '#text-field-read-only',
                        )}
                        sx={{ fontSize: '0.9em' }}
                      />
                    ) : (
                      <HelpTip
                        title="Editing text"
                        excerpt="The Text attribute and double-clicking the element on the canvas edit the same value. Rich text is opt-in per element."
                        href={besignerDocsUrl(
                          'textEditing',
                          '#the-text-attribute',
                        )}
                        sx={{ fontSize: '0.9em' }}
                      />
                    )}
                  </Box>
                ) : null}
                <ElementPropsFormTemplate
                  formFields={formFields}
                  schema={schema}
                  {...rest}
                />

                {/* Per-instance ATTRIBUTE overrides (AGL-1899), the
                    attribute-side twin of the Styles panel's override
                    section. Rendered OUTSIDE `ElementPropsFormTemplate` —
                    which is the `<form>` — because it runs a form of its own:
                    nesting them would produce invalid markup and a submit
                    from the inner one would be the outer one's submit.

                    It writes `node.attrOverrides`, a first-class node field,
                    and reads its values from the component DEFINITION rather
                    than from this node's props, so it shares no value plumbing
                    with the form above and cannot become a second writer on
                    anything the form above owns. */}
                {isInstance ? (
                  <InstanceAttrOverrides
                    node={node}
                    componentMapper={elementPropsComponentMapper}
                  />
                ) : null}

                {boundPropSummaries.length ? (
                  <Box sx={{ mt: 2 }}>
                    <Box
                      component="span"
                      sx={{
                        fontSize: 12,
                        color: 'text.secondary',
                        textTransform: 'uppercase',
                        letterSpacing: 0.5,
                      }}
                    >
                      {'Bindings on this element'}
                      {/* AGL-2167. A summary in warning color is the only
                          signal that a referent went missing, and nothing
                          here says what to do about it. */}
                      <HelpTip
                        title="Bindings on this element"
                        excerpt="Each row is a bound attribute, shown with its current value. A row in warning color means the variable or function it points at no longer exists."
                        href={besignerDocsUrl('bindings', '#where-used--safety')}
                        sx={{ ml: 0.25, fontSize: '0.9em' }}
                      />
                    </Box>
                    {boundPropSummaries.map((summary) => (
                      <Box
                        key={summary.prop}
                        sx={{
                          display: 'flex',
                          gap: 1,
                          fontSize: 13,
                          mt: 0.5,
                          color: summary.missing
                            ? 'warning.main'
                            : 'text.primary',
                        }}
                      >
                        <Box component="span" sx={{ color: 'text.secondary' }}>
                          {summary.prop}
                        </Box>
                        <Box
                          component="span"
                          sx={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {summary.display}
                        </Box>
                      </Box>
                    ))}
                  </Box>
                ) : null}
                {insertOptions.length && textEditable ? (
                  <FormControl margin="none" fullWidth>
                    <Button
                      color="primary"
                      onClick={(event) =>
                        setBindingAnchor(event.currentTarget)
                      }
                      sx={{ mt: 2 }}
                      fullWidth
                    >
                      Insert binding
                    </Button>
                    {/* Element-level picker (AGL-100), now serving the
                        full catalog (AGL-583); appends to the text. */}
                    <InsertTokenMenu
                      anchorEl={bindingAnchor}
                      open={Boolean(bindingAnchor)}
                      onClose={() => setBindingAnchor(null)}
                      options={insertOptions}
                      onInsert={handleInsertBinding}
                    />
                  </FormControl>
                ) : null}
                {/* The "Browse media" buttons that used to sit here — after
                    the form, below Save Element — now ride on the fields
                    themselves as end adornments (AGL-2236). See
                    `fieldsWithMediaPickers`. */}
                {/* Interactions moved to their own panel tab.
                    They are not attributes: a behaviour authored in a
                    dialog rather than a field, and sitting below every
                    declared attribute put them under the fold on anything
                    with more than a handful. See
                    `element-interactions-form.component.tsx`. */}
                {(node?.props as any)?.repeatDataset ? (
                  <FormControl margin="none" fullWidth>
                    {/* Repeat badge (AGL-168): make dataset-driven
                        duplication visible where props are edited. */}
                    <Alert severity="info" sx={{ mt: 2 }}>
                      {'Repeats over dataset "' +
                        String((node?.props as any).repeatDataset) +
                        '" — children render once per record on the live site.'}
                    </Alert>
                  </FormControl>
                ) : null}
                {onRewrite && (textEditable || hasTextAttributes) ? (
                  <FormControl margin="none" fullWidth>
                    <Button
                      color="primary"
                      onClick={() => onRewrite(node)}
                      sx={{ mt: 2 }}
                      fullWidth
                    >
                      Rewrite with AI
                    </Button>
                  </FormControl>
                ) : null}
                {onPromote && !isInstance && unlocked ? (
                  <FormControl margin="none" fullWidth>
                    <Button
                      color="primary"
                      onClick={() => onPromote(node)}
                      sx={{ mt: 2 }}
                      fullWidth
                    >
                      Save as reusable component
                    </Button>
                  </FormControl>
                ) : null}
                {/* Edit component (AGL-1303): navigation, not a mutation of
                    THIS document, so unlike Detach it is not gated on the
                    node being unlocked — locked layout-chrome instances
                    need it most. */}
                {onEditComponent && isInstance ? (
                  <FormControl margin="none" fullWidth>
                    <Button
                      color="primary"
                      onClick={() => onEditComponent(node)}
                      sx={{ mt: 2 }}
                      fullWidth
                    >
                      Edit component
                    </Button>
                  </FormControl>
                ) : null}
                {onDemote && isInstance && unlocked ? (
                  <FormControl margin="none" fullWidth>
                    <Button
                      color="primary"
                      onClick={() => onDemote(node)}
                      sx={{ mt: 2 }}
                      fullWidth
                    >
                      Detach from component
                    </Button>
                  </FormControl>
                ) : null}
                <FormControl margin="none" fullWidth>
                  <Button
                    onClick={() => deleteElementCallback(node)}
                    sx={{ mt: 2, color: 'error.main' }}
                    fullWidth
                  >
                    Delete Element
                  </Button>
                </FormControl>
                {/* What this element IS: the component's own
                    description and the node's ids, in two collapsed
                    accordions. They were a tab of their own, which cost every
                    reader a third of the panel's header for reference detail
                    most of them never open. Last, and closed, so they cost
                    nothing until wanted. */}
                <ElementInfoDetails node={node} />
              </>
            )}
          </FormRenderer>
        </NoSsr>
      </>
    )
  },
)
ElementPropsFormRaw.displayName = 'ElementPropsForm'
ElementPropsFormRaw.aglyn = true

export const ElementPropsForm = observer(ElementPropsFormRaw)
export default ElementPropsForm
