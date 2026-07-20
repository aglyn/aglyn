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

import * as Aglyn from '@aglyn/aglyn'
import { BoxStyler, Measurements } from '../box-styler'
import {
  ButtonGroupFormControl,
  ToggleButtonFormControl,
} from '../form-fields'
import { FieldComponentType } from '@aglyn/aglyn'
import { useAglynSiteTheme } from '@aglyn/aglyn-node-renderer'
import {
  ICON_VARIANT_ALIGN_CENTER,
  ICON_VARIANT_ALIGN_JUSTIFY,
  ICON_VARIANT_ALIGN_LEFT,
  ICON_VARIANT_ALIGN_RIGHT,
  ICON_VARIANT_CSS_INHERIT,
} from '@aglyn/shared-data-enums'
import {
  alignContentCenterIcon,
  alignContentEndIcon,
  alignContentSpaceAroundIcon,
  alignContentSpaceBetweenIcon,
  alignContentSpaceEvenlyIcon,
  alignContentStartIcon,
  alignContentStretchIcon,
  alignItemsCenterIcon,
  alignItemsFlexEndIcon,
  alignItemsFlexStartIcon,
  alignItemsStretchIcon,
  alignSelfCenterIcon,
  alignSelfFlexEndIcon,
  alignSelfFlexStartIcon,
  alignSelfStretchIcon,
  flexDirectionIcon,
  flexNowrapIcon,
  flexWrapIcon,
  justifyContentCenterIcon,
  justifyContentFlexEndIcon,
  justifyContentFlexStartIcon,
  justifyContentSpaceAroundIcon,
  justifyContentSpaceBetweenIcon,
} from '@aglyn/shared-svg-icons'
import {
  componentMapper,
  FormRenderer,
  type FormRendererProps,
} from '@aglyn/shared-ui-jsx-forms'
import { Container, MdiIcon } from '@aglyn/shared-ui-jsx'
import { useHostThemeDocument } from '@aglyn/shared-ui-theme'
import { objectFlatten } from '@aglyn/shared-util-vendor'
import {
  Chip,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Switch,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from '@mui/material'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import { action } from 'mobx'
import { observer } from 'mobx-react-lite'
import {
  type ChangeEvent,
  forwardRef,
  type SyntheticEvent,
  useCallback,
  useMemo,
} from 'react'
import useAglynBesignerFlag from '../hooks/use-aglyn-besigner-flag'
import useDeleteElementCallback from '../hooks/use-delete-element-callback'
import {
  canvasSchemeToSxScheme,
  deviceFlagToBreakpoint,
} from '../utils/responsive-sx'
import {
  applyStylePartialToSx,
  buildFlexGapGroup,
  buildStyleFieldGroups,
  computeEffectiveStyleValues,
  computeStylePartial,
  pickStyleValues,
  styleGroupFieldNames,
} from '../utils/style-field-groups'
import {
  readHiddenBands,
  VISIBILITY_BAND_LABELS,
  VISIBILITY_BANDS,
  writeHiddenBand,
} from '../utils/visibility-styles'
import { Accordion } from './accordion-list.component'
import CustomCssForm from './custom-css-form.component'
import ElementClassesField from './element-classes-field.component'
import ElementStylesFormTemplate from './element-styles-form-template.component'

const alignItems: ButtonGroupFormControl = {
  name: 'alignItems',
  label: 'Align items',
  helperText:
    'The CSS align-items property sets the align-self value on all direct children as a group. In Flexbox, it controls the alignment of items on the Cross Axis. In Grid Layout, it controls the alignment of items on the Block Axis within their grid area.',
  options: [
    {
      value: 'center',
      label: 'Center',
      icon: {
        viewBox: '0 0 13 13',
        component: alignItemsCenterIcon,
      },
    },
    {
      value: 'flex-end',
      label: 'Flex end',
      icon: {
        viewBox: '0 0 13 13',
        component: alignItemsFlexEndIcon,
      },
    },
    {
      value: 'flex-start',
      label: 'Flex start',
      icon: {
        viewBox: '0 0 13 13',
        component: alignItemsFlexStartIcon,
      },
    },
    {
      value: 'stretch',
      label: 'Stretch',
      icon: {
        viewBox: '0 0 13 13',
        component: alignItemsStretchIcon,
      },
    },
  ],
}

const alignContent: ButtonGroupFormControl = {
  name: 'alignContent',
  label: 'Align content',
  helperText:
    "The CSS align-content property sets the distribution of space between and around content items along a flexbox's cross-axis or a grid's block axis.",
  options: [
    {
      value: 'center',
      label: 'Center',
      icon: {
        viewBox: '0 0 13 13',
        component: alignContentCenterIcon,
      },
    },
    {
      value: 'end',
      label: 'End',
      icon: {
        viewBox: '0 0 13 13',
        component: alignContentEndIcon,
      },
    },
    {
      value: 'space-around',
      label: 'Space around',
      icon: {
        viewBox: '0 0 13 13',
        component: alignContentSpaceAroundIcon,
      },
    },
    {
      value: 'space-between',
      label: 'Space between',
      icon: {
        viewBox: '0 0 13 13',
        component: alignContentSpaceBetweenIcon,
      },
    },
    {
      value: 'space-evenly',
      label: 'Space evenly',
      icon: {
        viewBox: '0 0 13 13',
        component: alignContentSpaceEvenlyIcon,
      },
    },
    {
      value: 'start',
      label: 'Start',
      icon: {
        viewBox: '0 0 13 13',
        component: alignContentStartIcon,
      },
    },
    {
      value: 'stretch',
      label: 'Stretch',
      icon: {
        viewBox: '0 0 13 13',
        component: alignContentStretchIcon,
      },
    },
  ],
}

const alignSelf: ButtonGroupFormControl = {
  name: 'alignSelf',
  label: 'Align self',
  helperText:
    "The align-self CSS property overrides a grid or flex item's align-items value. In Grid, it aligns the item inside the grid area. In Flexbox, it aligns the item on the cross axis.",
  options: [
    {
      value: 'center',
      label: 'Center',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfCenterIcon,
      },
    },
    {
      value: 'end',
      label: 'End',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfFlexEndIcon,
      },
    },
    {
      value: 'start',
      label: 'Start',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfFlexStartIcon,
      },
    },
    {
      value: 'stretch',
      label: 'Stretch',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfStretchIcon,
      },
    },
  ],
}

const flexWrap: ButtonGroupFormControl = {
  name: 'flexWrap',
  label: 'Flex wrap',
  helperText:
    'The flex-wrap CSS property sets whether flex items are forced onto one line or can wrap onto multiple lines. If wrapping is allowed, it sets the direction that lines are stacked.',
  options: [
    {
      value: 'nowrap',
      label: 'No wrap',
      icon: {
        viewBox: '0 0 13 13',
        component: flexNowrapIcon,
      },
    },
    {
      value: 'wrap',
      label: 'Wrap',
      icon: {
        viewBox: '0 0 13 13',
        component: flexWrapIcon,
      },
    },
    {
      value: 'wrap-reverse',
      label: 'Wrap reverse',
      icon: {
        viewBox: '0 0 13 13',
        component: flexWrapIcon,
      },
    },
  ],
}

const flexDirection: ButtonGroupFormControl = {
  name: 'flexDirection',
  label: 'Flex direction',
  helperText:
    'The flex-direction CSS property sets how flex items are placed in the flex container defining the main axis and the direction (normal or reversed).',
  options: [
    {
      value: 'column',
      label: 'Column',
      icon: {
        viewBox: '0 0 13 13',
        component: flexDirectionIcon,
      },
    },
    {
      value: 'column-reverse',
      label: 'Column reverse',
      icon: {
        viewBox: '0 0 13 13',
        component: flexDirectionIcon,
        sx: { transform: 'rotate(-180deg)' },
      },
    },
    {
      value: 'row',
      label: 'Row',
      icon: {
        viewBox: '0 0 13 13',
        component: flexDirectionIcon,
        sx: { transform: 'rotate(-90deg)' },
      },
    },
    {
      value: 'row-reverse',
      label: 'Row reverse',
      icon: {
        viewBox: '0 0 13 13',
        component: flexDirectionIcon,
        sx: { transform: 'rotate(90deg)' },
      },
    },
  ],
}

const justifyItems: ButtonGroupFormControl = {
  name: 'justifyItems',
  label: 'Justify items',
  helperText:
    'The CSS justify-items property defines the default justify-self for all items of the box, giving them all a default way of justifying each box along the appropriate axis.',
  options: [
    {
      value: 'center',
      label: 'Center',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfCenterIcon,
      },
    },
    {
      value: 'end',
      label: 'End',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfFlexEndIcon,
      },
    },
    {
      value: 'start',
      label: 'Start',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfFlexStartIcon,
      },
    },
    {
      value: 'stretch',
      label: 'Stretch',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfStretchIcon,
      },
    },
  ],
}

const justifyContent: ButtonGroupFormControl = {
  name: 'justifyContent',
  label: 'Justify content',
  helperText:
    'The CSS justify-content property defines how the browser distributes space between and around content items along the main-axis of a flex container, and the inline axis of a grid container.',
  options: [
    {
      value: 'center',
      label: 'Center',
      icon: {
        viewBox: '0 0 13 13',
        component: justifyContentCenterIcon,
      },
    },
    {
      value: 'flex-end',
      label: 'Flex end',
      icon: {
        viewBox: '0 0 13 13',
        component: justifyContentFlexEndIcon,
      },
    },
    {
      value: 'flex-start',
      label: 'Flex start',
      icon: {
        viewBox: '0 0 13 13',
        component: justifyContentFlexStartIcon,
      },
    },
    {
      value: 'space-around',
      label: 'Space around',
      icon: {
        viewBox: '0 0 13 13',
        component: justifyContentSpaceAroundIcon,
      },
    },
    {
      value: 'space-between',
      label: 'Space between',
      icon: {
        viewBox: '0 0 13 13',
        component: justifyContentSpaceBetweenIcon,
      },
    },
  ],
}

const justifySelf: ButtonGroupFormControl = {
  name: 'justifySelf',
  label: 'Justify self',
  helperText:
    'The CSS justify-self property sets the way a box is justified inside its alignment container along the appropriate axis.',
  options: [
    {
      value: 'center',
      label: 'Center',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfCenterIcon,
      },
    },
    {
      value: 'end',
      label: 'End',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfFlexEndIcon,
      },
    },
    {
      value: 'start',
      label: 'Start',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfFlexStartIcon,
      },
    },
    {
      value: 'stretch',
      label: 'Stretch',
      icon: {
        viewBox: '0 0 13 13',
        component: alignSelfStretchIcon,
      },
    },
  ],
}

const TextAlignToggleButtonGroup = (props: { onChange: (e: SyntheticEvent, value: string) => void; value: string; field: { component?: FieldComponentType; name: string; label: string; exclusive?: boolean; options: { value: string; icon: string; label: string }[]; description?: string } }) => {
  const { onChange, value, field } = props

  return (
    <FormControl fullWidth>
      <FormLabel htmlFor={field.name} sx={{ marginBottom: 1 }}>
        {field.label}
      </FormLabel>
      <div>
        <ToggleButtonGroup
          id={field.name}
          value={value || ''}
          size="small"
          color="secondary"
          onChange={onChange}
          fullWidth
          exclusive
        >
          {field.options.map((option) => (
            <ToggleButton key={option.value} value={option.value}>
              <Tooltip key={option.value} title={option.label}>
                <MdiIcon path={option.icon} fontSize="inherit" />
              </Tooltip>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </div>
      <FormHelperText>{field.description}</FormHelperText>
    </FormControl>
  )
}

export interface ElementStylesFormProps extends FormRendererProps {
  node?: Aglyn.NodeSchema
}

/**
 * The styles panel (AGL-587 consolidation): every control applies
 * immediately through {@link ElementStylesFormTemplate} or a direct
 * `applyStyleValues` call — no per-group "Save Element" buttons — and
 * every style field has exactly one home:
 *
 * - Flexbox & Grids: container toggles + the gap controls.
 * - Visibility: device-band switches.
 * - Layout / Colors / Sizing / Typography / Borders & Shadows /
 *   Position & Overflow / Grid & Flex Child: the accordion field groups
 *   from `buildStyleFieldGroups`.
 * - Top level: breakpoint chip, BoxStyler, and the text-align toggle.
 */
const ElementStylesForm = observer(
  forwardRef<any, ElementStylesFormProps>((props, ref) => {
    const { node } = props
    const deleteElementCallback = useDeleteElementCallback()
    const nodeSx = node?.sx
    const hostThemeDoc = useHostThemeDocument()
    const siteTheme = useAglynSiteTheme({ theme: hostThemeDoc })

    const presetColors = useMemo(
      () =>
        Object.entries(objectFlatten(siteTheme.palette))
          .map(([, value]) => String(value))
          .filter((color) => Boolean(color.match(/^(rgb|#)/)?.[0])),
      [siteTheme],
    )
    // Accordion field groups (AGL-540/587): layout, colors, sizing,
    // typography, borders & shadows, position & overflow, grid/flex-child.
    const styleGroups = useMemo(
      () => buildStyleFieldGroups(presetColors),
      [presetColors],
    )
    // Container gap controls, rendered inside Flexbox & Grids (AGL-587).
    const gapGroup = useMemo(() => buildFlexGapGroup(), [])

    // Breakpoint-scoped editing (AGL-333): when the artboard preview is a
    // device size, style edits write into that breakpoint's slice of the
    // responsive sx value; fluid preview edits the base.
    const [devicePreview] = useAglynBesignerFlag('devicePreview')
    const activeBreakpoint = deviceFlagToBreakpoint(devicePreview)

    // Scheme-scoped colors (AGL-588): while the artboard previews the
    // DARK scheme, color-bearing fields write into the sx dark slice and
    // read through it; light preview edits the base (light IS the base).
    // Non-color fields stay scheme-agnostic either way.
    const [canvasScheme] = useAglynBesignerFlag('canvasScheme')
    const activeScheme = canvasSchemeToSxScheme(canvasScheme)

    /**
     * Merges style values into node.sx at the active breakpoint + scheme
     * scope. Unchanged values are skipped so effective (inherited)
     * readings never get pinned into a slice by round-tripping through a
     * form.
     */
    const applyStyleValues = useCallback(
      (partial: Record<string, unknown>) => {
        action(() => {
          if (!node) return
          node.sx = applyStylePartialToSx(
            (node.sx ?? {}) as Record<string, any>,
            partial,
            activeBreakpoint,
            activeScheme,
          ) as any
        })()
      },
      [node, activeBreakpoint, activeScheme],
    )

    // Effective scalar values at the active breakpoint + scheme — feeds
    // the form and controls; responsive objects resolve to their active
    // slice, color fields through the dark slice while previewing dark.
    const effectiveValues = useMemo(
      () =>
        computeEffectiveStyleValues(
          nodeSx as Record<string, any>,
          activeBreakpoint,
          activeScheme,
        ),
      [nodeSx, activeBreakpoint, activeScheme],
    )

    /**
     * Scoped group save (AGL-540): a group's auto-apply may only write
     * its own field names, so it can never clear values owned by other
     * groups or by the custom-CSS editor.
     */
    const handleGroupSave = useCallback(
      (fieldNames: string[]) => (values: Record<string, unknown>) => {
        applyStyleValues(computeStylePartial(fieldNames, values))
      },
      [applyStyleValues],
    )

    const handleBoxStylerChange = useCallback(
      (dimensions: Measurements) => {
        applyStyleValues(dimensions as Record<string, unknown>)
      },
      [applyStyleValues],
    )

    const boxMeasurements = {
      marginTop: effectiveValues['marginTop'] ?? undefined,
      marginLeft: effectiveValues['marginLeft'] ?? undefined,
      marginRight: effectiveValues['marginRight'] ?? undefined,
      marginBottom: effectiveValues['marginBottom'] ?? undefined,
      paddingTop: effectiveValues['paddingTop'] ?? undefined,
      paddingLeft: effectiveValues['paddingLeft'] ?? undefined,
      paddingRight: effectiveValues['paddingRight'] ?? undefined,
      paddingBottom: effectiveValues['paddingBottom'] ?? undefined,
    }

    const handleTextAlignChange = useCallback(
      (e, value: string) => {
        applyStyleValues({ textAlign: value || undefined })
      },
      [applyStyleValues],
    )

    const handleFlexboxChange = useCallback(
      (name: string) => (e, value: string) => {
        applyStyleValues({ [name]: value || undefined })
      },
      [applyStyleValues],
    )

    // Responsive visibility (AGL-562): band toggles write display:none
    // under range-scoped media keys — independent of the artboard's
    // breakpoint scope, since each band is absolute.
    const hiddenBands = readHiddenBands(nodeSx as Record<string, any>)
    const handleVisibilityChange = useCallback(
      (band: (typeof VISIBILITY_BANDS)[number]) =>
        (event: ChangeEvent<HTMLInputElement>) => {
          action(() => {
            if (!node) return
            node.sx = writeHiddenBand(
              (node.sx ?? {}) as Record<string, any>,
              band,
              event.target.checked,
            ) as any
          })()
        },
      [node],
    )

    // Re-seeds a group form's initial values when the selection or the
    // artboard scope changes (AGL-540/588).
    const formSeedKey =
      `${node?.$id ?? ''}:${activeBreakpoint ?? 'base'}` +
      `:${activeScheme ?? 'light'}`

    return (
      <>
        <Container gutterY={[1]} dense>
          <Tooltip
            title={
              activeBreakpoint
                ? `Edits apply from the ${activeBreakpoint.toUpperCase()} ` +
                  'breakpoint up. Switch the artboard preview to Fluid ' +
                  'Responsive to edit the base styles.'
                : 'Edits apply at every screen size. Switch the artboard ' +
                  'preview to a device size to style that breakpoint only.'
            }
          >
            <Chip
              size="small"
              color={activeBreakpoint ? 'secondary' : 'default'}
              label={
                activeBreakpoint
                  ? `Styling breakpoint: ${activeBreakpoint.toUpperCase()}`
                  : 'Styling: all screen sizes'
              }
            />
          </Tooltip>
          {/* Scheme scope chip (AGL-588): only the non-default (dark)
              preview shows it — color edits become dark-only overrides
              while the rest of the panel keeps editing shared values. */}
          {activeScheme === 'dark' ? (
            <Tooltip
              title={
                'The artboard is previewing the dark scheme: text, ' +
                'background, and border color edits apply to dark mode ' +
                'only. Other styles still apply to both schemes. Switch ' +
                'the artboard back to light to edit the base colors.'
              }
            >
              <Chip
                size="small"
                color="secondary"
                variant="outlined"
                sx={{ ml: 1 }}
                label="Styling: dark scheme"
              />
            </Tooltip>
          ) : null}
        </Container>
        <Container gutterY={[2]} dense>
          <BoxStyler
            measurements={boxMeasurements}
            onChange={handleBoxStylerChange}
          />
        </Container>
        <Container gutterY={[2]} dense>
          <TextAlignToggleButtonGroup
            onChange={handleTextAlignChange}
            value={effectiveValues['textAlign']}
            field={{
              component: FieldComponentType.TOGGLE_BUTTON,
              name: 'textAlign',
              label: 'Text Alignment',
              description:
                'Sets the horizontal alignment of the inline-level content inside a block element or table-cell box.',
              exclusive: true,
              options: [
                {
                  value: 'inherit',
                  icon: ICON_VARIANT_CSS_INHERIT.path,
                  label: 'Inherit',
                },
                {
                  value: 'left',
                  icon: ICON_VARIANT_ALIGN_LEFT.path,
                  label: 'Left',
                },
                {
                  value: 'center',
                  icon: ICON_VARIANT_ALIGN_CENTER.path,
                  label: 'Center',
                },
                {
                  value: 'right',
                  icon: ICON_VARIANT_ALIGN_RIGHT.path,
                  label: 'Right',
                },
                {
                  value: 'justify',
                  icon: ICON_VARIANT_ALIGN_JUSTIFY.path,
                  label: 'Justify',
                },
              ],
            }}
          />
        </Container>

        <Accordion summary="Flexbox & Grids" sx={{ mb: 2 }}>
          <ToggleButtonFormControl
            onChange={handleFlexboxChange(alignItems.name)}
            schema={alignItems}
          />
          <ToggleButtonFormControl
            onChange={handleFlexboxChange(alignContent.name)}
            schema={alignContent}
          />
          <ToggleButtonFormControl
            onChange={handleFlexboxChange(alignSelf.name)}
            schema={alignSelf}
          />
          <ToggleButtonFormControl
            onChange={handleFlexboxChange(flexWrap.name)}
            schema={flexWrap}
          />
          <ToggleButtonFormControl
            onChange={handleFlexboxChange(flexDirection.name)}
            schema={flexDirection}
          />
          <ToggleButtonFormControl
            onChange={handleFlexboxChange(justifyItems.name)}
            schema={justifyItems}
          />
          <ToggleButtonFormControl
            onChange={handleFlexboxChange(justifyContent.name)}
            schema={justifyContent}
          />
          <ToggleButtonFormControl
            onChange={handleFlexboxChange(justifySelf.name)}
            schema={justifySelf}
          />
          {/* Container gaps live with the container toggles (AGL-587);
              they apply immediately like everything else. */}
          <FormRenderer
            key={formSeedKey}
            FormTemplate={ElementStylesFormTemplate}
            componentMapper={componentMapper}
            onSubmit={handleGroupSave(styleGroupFieldNames(gapGroup))}
            initialValues={pickStyleValues(
              styleGroupFieldNames(gapGroup),
              effectiveValues,
            )}
            schema={{ fields: gapGroup.fields }}
          />
        </Accordion>

        {/* Responsive visibility (AGL-562): hide the element on whole
            device bands — e.g. hide the desktop link cluster on mobile
            and show a menu button instead. */}
        <Accordion summary="Visibility" sx={{ mb: 2 }}>
          {VISIBILITY_BANDS.map((band) => (
            <FormControlLabel
              key={band}
              control={
                <Switch
                  size="small"
                  checked={hiddenBands.includes(band)}
                  onChange={handleVisibilityChange(band)}
                />
              }
              label={VISIBILITY_BAND_LABELS[band]}
              sx={{ display: 'flex', mb: 0.5 }}
            />
          ))}
          <FormHelperText>
            {'Hidden bands apply on the live site at those screen widths. ' +
              'The canvas preview follows your browser window width, so ' +
              'resize the window (or publish) to see the effect.'}
          </FormHelperText>
        </Accordion>

        {/* First-class style groups (AGL-540/587). Each form is keyed on
            the node + breakpoint so switching selection or artboard
            scope re-seeds the initial values; edits apply immediately
            through the shared debounced template. */}
        {styleGroups.map((group) => {
          const fieldNames = styleGroupFieldNames(group)
          return (
            <Accordion key={group.$id} summary={group.label} sx={{ mb: 2 }}>
              <FormRenderer
                key={formSeedKey}
                FormTemplate={ElementStylesFormTemplate}
                componentMapper={componentMapper}
                onSubmit={handleGroupSave(fieldNames)}
                initialValues={pickStyleValues(fieldNames, effectiveValues)}
                schema={{ fields: group.fields }}
              />
            </Accordion>
          )
        })}

        <Accordion summary="Classes & custom CSS" sx={{ mb: 2 }}>
          <ElementClassesField node={node} />
          <CustomCssForm node={node} breakpoint={activeBreakpoint} />
        </Accordion>

        <Container gutterY={[2]} dense>
          <FormControl margin="none" fullWidth>
            <Button
              onClick={() => deleteElementCallback(node)}
              sx={{ color: 'error.main' }}
              fullWidth
            >
              Delete Element
            </Button>
          </FormControl>
        </Container>
      </>
    )
  }),
)
ElementStylesForm.displayName = 'ElementStylesForm'

export default ElementStylesForm
