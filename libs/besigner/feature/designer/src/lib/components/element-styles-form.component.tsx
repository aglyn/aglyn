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
import {
  SX_SCHEME_DARK_KEY,
  useAglynSiteTheme,
} from '@aglyn/aglyn-node-renderer'
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
import { Container, HelpTip, MdiIcon } from '@aglyn/shared-ui-jsx'
import { useHostThemeDocument } from '@aglyn/shared-ui-theme'
import { objectFlatten } from '@aglyn/shared-util-vendor'
import {
  Alert,
  Box,
  Chip,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  MenuItem,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from '@mui/material'
import Button from '@mui/material/Button'
import FormControl from '@mui/material/FormControl'
import { observer } from 'mobx-react-lite'
import {
  type ChangeEvent,
  forwardRef,
  type SyntheticEvent,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import ComponentPromotionContext from '../contexts/component-promotion-context'
import useAglynBesignerFlag from '../hooks/use-aglyn-besigner-flag'
import {
  deriveStateSlice,
  stateScopedSx,
  stripStateSlices,
  stateAdvisory,
  sxHasStateSlice,
  sxStateSliceLabel,
  SX_STATE_DESCRIPTIONS,
  SX_STATE_LABELS,
  SX_STATE_PROSE,
  SX_STATES,
  writeStateSlice,
  type SxState,
} from '../utils/state-sx'
import useDeleteElementCallback from '../hooks/use-delete-element-callback'
import { besignerDocsUrl } from '../utils/docs-help'
import {
  canvasSchemeToSxScheme,
  deviceFlagToBreakpoint,
} from '../utils/responsive-sx'
import {
  applyStylePartialToSx,
  buildFlexGridGroup,
  buildStyleFieldGroups,
  computeEffectiveStyleValues,
  computeStylePartial,
  pickStyleValues,
  styleGroupFieldNames,
} from '../utils/style-field-groups'
import {
  filterStyleGroup,
  matchesStyleQuery,
  STYLE_SECTION_ENTRIES,
  styleFieldEntry,
} from '../utils/style-field-search'
import { getNodeStyleTarget } from '../utils/style-target'
import { buildStyleThemeScales } from '../utils/theme-scale-options'
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

/**
 * The Flexbox & Grid alignment toggles, in panel order (AGL-1458).
 *
 * A list rather than eight literal call sites because every one of them
 * needs the same two wirings — the change handler AND the effective value
 * — and the shipped panel gave them only the first. One render site is one
 * place for that pair to be right.
 *
 * Ordered container-first, then the two per-ITEM properties (AGL-2486).
 * `Align self` and `Justify self` describe how this element sits inside
 * its parent, not how it arranges its own children, and reading them in
 * the middle of the container list was half of why the panel needed a
 * second layout section to put the rest of the per-item properties in.
 */
const FLEXBOX_TOGGLES: ButtonGroupFormControl[] = [
  flexDirection,
  flexWrap,
  justifyContent,
  alignItems,
  alignContent,
  justifyItems,
  alignSelf,
  justifySelf,
]

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
          color="primary"
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

/**
 * The panel fills a form-renderer-shaped slot in the aside panel, but it
 * reads neither `schema` nor `componentMapper` — it renders its own groups
 * and builds their forms itself. They are optional so a caller (and a
 * spec) can hand it the one prop it actually consumes; the aside panel's
 * `as any` at the mount site is the same statement, made less precisely.
 */
export interface ElementStylesFormProps extends Partial<FormRendererProps> {
  node?: Aglyn.NodeSchema
}

/**
 * The styles panel (AGL-587 consolidation): every control applies
 * immediately through {@link ElementStylesFormTemplate} or a direct
 * `applyStyleValues` call — no per-group "Save Element" buttons — and
 * every style field has exactly one home:
 *
 * - Flexbox & Grid: the alignment toggles plus every typed layout field
 *   (gaps, grid tracks, item placement, flex-child sizing) — one section
 *   since AGL-2486, where it used to be two.
 * - Visibility: device-band switches.
 * - Layout / Colors / Sizing / Typography / Borders & Shadows /
 *   Position & Overflow: the accordion field groups from
 *   `buildStyleFieldGroups`.
 * - Top level: search box, breakpoint chip, BoxStyler, and the text-align
 *   toggle.
 *
 * The search box (AGL-2486) filters every one of those by property name AND
 * by the words a non-developer would use — `rounded` finds Corner Radius —
 * hiding sections with no match and opening the ones that have one. See
 * `style-field-search.ts`; the filtered group is also what each form SAVES
 * through, so hiding a field can never clear it.
 */
const ElementStylesForm = observer(
  forwardRef<any, ElementStylesFormProps>((props, ref) => {
    const { node: selectedNode } = props
    const deleteElementCallback = useDeleteElementCallback()

    // The node as the CANVAS currently holds it (AGL-2486).
    //
    // Undo and redo restore a whole-document snapshot through
    // `CanvasManager.setNodes`, which mints fresh node instances and
    // replaces the map. The selection holds a node OBJECT, not an id, so
    // after an undo the aside panel handed this component a DETACHED copy
    // — the canvas rolled back and every field here kept reading the value
    // that had just been undone, then wrote it back over the restored one
    // on the next edit. Looking the id up in the map re-attaches the panel
    // to what the canvas renders, and — read inside an `observer` — is
    // also what makes an undo re-render the panel at all.
    //
    // The fallback keeps a node the map does not have (a spec's hand-built
    // schema, a node deleted while its panel is still mounted) rendering
    // rather than blanking the panel.
    const node = (selectedNode?.$id
      ? (Aglyn.canvas.getNode(selectedNode.$id) ?? selectedNode)
      : selectedNode) as Aglyn.NodeSchema | undefined

    // The definition behind a selected instance (AGL-1332): the panel needs
    // its node tree to offer the leaves an author may style. Read from the
    // same context the canvas renders instances through, so the picker can
    // only ever offer targets the graft will actually consult.
    const { definitions } = useContext(ComponentPromotionContext)
    const definition = useMemo(() => {
      if (node?.componentId !== Aglyn.REUSABLE_INSTANCE_COMPONENT_ID) {
        return undefined
      }
      const refId = (node?.props as { refId?: string } | undefined)?.refId
      return refId ? definitions?.[refId] : undefined
    }, [node, definitions])
    const styleTargets = useMemo(
      () => Aglyn.listInstanceStyleTargets(definition),
      [definition],
    )

    // Which target inside the instance the panel is editing. Held per
    // selection rather than in an effect: switching nodes must land on the
    // component root, and deriving that from the current `node.$id` cannot
    // render one frame aimed at the PREVIOUS instance's leaf.
    const [picked, setPicked] = useState<{ nodeId?: string; key: string }>({
      key: Aglyn.STYLE_OVERRIDES_ROOT_KEY,
    })
    const pickedKey =
      picked.nodeId && picked.nodeId === node?.$id
        ? picked.key
        : Aglyn.STYLE_OVERRIDES_ROOT_KEY
    // A leaf the component no longer has falls back to the root instead of
    // aiming the panel at a slice nothing renders (the definition may have
    // been edited since). An unloaded definition offers nothing yet, so it
    // is not evidence the key is stale.
    const overrideKey =
      !styleTargets.length ||
      styleTargets.some((entry) => entry.key === pickedKey)
        ? pickedKey
        : Aglyn.STYLE_OVERRIDES_ROOT_KEY

    // Where edits land (AGL-1306 root, AGL-1332 leaves): a plain node's own
    // sx, or — for a reusable-component instance — one slice of its
    // styleOverrides, so the whole panel styles the instance without
    // touching the component. Reads go through the same target, so the
    // panel shows exactly what THIS instance overrides for THIS target
    // (empty = the component's own look), the same way a fresh plain node
    // starts empty.
    const target = useMemo(
      () => getNodeStyleTarget(node, overrideKey),
      [node, overrideKey],
    )
    const nodeSx = target.sx
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
    //
    // The override mode is passed in (AGL-1338) because a field whose
    // "empty" state is meaningful has to say what empty MEANS here: on an
    // instance an unset Background Fill is the component's gradient, not
    // no gradient, and the control that could not tell those apart was
    // the bug.
    // The theme's own scales for font size, font weight and z-index
    // (AGL-2486, item 12). Read off the SITE theme, so a host that retuned
    // its type scale or added a stacking layer offers its own values — and
    // the option list names what each token resolves to, which is the only
    // thing that makes `h4.fontSize` legible to an author.
    const themeScales = useMemo(
      () => buildStyleThemeScales(siteTheme as any),
      [siteTheme],
    )
    const styleGroups = useMemo(
      () =>
        buildStyleFieldGroups(presetColors, {
          isInstanceOverride: target.isInstanceOverride,
          themeScales,
        }),
      [presetColors, target.isInstanceOverride, themeScales],
    )
    // Every typed layout field, rendered under the alignment toggles in
    // the single Flexbox & Grid section (AGL-2486).
    const flexGridGroup = useMemo(() => buildFlexGridGroup(), [])

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

    // Interaction-state scope (AGL-2486 item 39): a state chip puts the panel
    // into that state's slice — every field then reads and writes
    // `sx['&:hover']` instead of the base. Selecting the chip ALSO holds the
    // state on the canvas for this element, because you cannot hover an
    // element while working in a side panel. The hold is a canvas flag, never
    // a document field, so it cannot be saved and cannot reach Preview or a
    // published page; and it is not a toggle that can be left on by mistake —
    // going back to `Default` ends it.
    const [heldState, setHeldState] = useAglynBesignerFlag('heldState')
    const [, setHeldStateNodeId] = useAglynBesignerFlag('heldStateNodeId')
    const activeState = (heldState ?? null) as SxState | null

    // What THIS panel is holding, tracked in a ref so the release paths below
    // can read it without depending on it. Two reasons it is not the flag
    // itself: an effect that read the flag would have registered its unmount
    // cleanup on the render where it was still undefined (the chip is clicked
    // AFTER mount) and stranded the canvas holding a state with no visible
    // control left to explain it; and the release must be able to tell "we
    // hold nothing" from "we hold nothing yet", because writing a flag needs a
    // live besigner app and a panel rendered without one — which is every
    // panel unit test — would throw on mount.
    const heldRef = useRef<SxState | null>(null)

    const selectState = useCallback(
      (next: SxState | null) => {
        heldRef.current = next
        setHeldState(next ?? undefined)
        setHeldStateNodeId(next ? node?.$id : undefined)
      },
      [setHeldState, setHeldStateNodeId, node],
    )

    /** Ends the hold, and writes nothing when there is nothing to end. */
    const releaseHold = useCallback(() => {
      if (!heldRef.current) return
      heldRef.current = null
      setHeldState(undefined)
      setHeldStateNodeId(undefined)
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // The hold dies with the panel: a preview nothing on screen explains any
    // more is worse than no preview.
    useEffect(() => () => releaseHold(), [releaseHold])

    // …and it follows the SELECTION. Clicking element B while holding hover on
    // element A must not leave either of them rendering as hovered — the panel
    // now describes a different element, and a scope the chips no longer show
    // is a scope the author cannot get out of.
    useEffect(() => {
      releaseHold()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [node?.$id])

    /** Drops a whole state slice — the clear affordance, one level up. */
    const clearState = useCallback(
      (state: SxState) => {
        if (!node) return
        Aglyn.canvas.transact(
          () => {
            target.setSx(
              writeStateSlice(
                (target.sx ?? {}) as Record<string, any>,
                state,
                undefined,
              ),
            )
          },
          ['sx', node.$id, 'clear-state', state].join(':'),
        )
      },
      [node, target],
    )

    // Allowed on every element, but said out loud where it will never fire.
    const stateAdvisoryText = useMemo(
      () =>
        stateAdvisory(activeState, {
          componentId: node?.componentId,
          hasHref: !!(node?.props as Record<string, unknown>)?.['href'],
          hasTabIndex:
            (node?.props as Record<string, unknown>)?.['tabIndex'] !==
            undefined,
        }),
      [activeState, node],
    )

    /**
     * Merges style values into node.sx at the active breakpoint + scheme
     * scope. Unchanged values are skipped so effective (inherited)
     * readings never get pinned into a slice by round-tripping through a
     * form.
     */
    const applyStyleValues = useCallback(
      (partial: Record<string, unknown>) => {
        if (!node) return
        // Undoable, and coalesced (AGL-1204). Every control here applies
        // live — one call per character typed, one per drag tick — so the
        // key ends the burst when the adjustment changes, not when the
        // writing stops: the field names are in it, so moving from Gap to
        // Padding is a second undo step even mid-burst.
        //
        // The write itself goes through the style target (AGL-1306), so the
        // step is recorded whether the edit lands in the node's own sx or in
        // a component instance's root override slice — the history snapshot
        // carries `styleOverrides` like any other node field.
        Aglyn.canvas.transact(
          () => {
            const current = (target.sx ?? {}) as Record<string, any>
            if (!activeState) {
              target.setSx(
                applyStylePartialToSx(
                  current,
                  partial,
                  activeBreakpoint,
                  activeScheme,
                ),
              )
              return
            }
            // A state scope edits the MERGED reading — base with the slice
            // over it, i.e. what the element actually looks like hovered —
            // and the write is split back out so only a genuine difference
            // is stored. That one rule gives all three behaviours: a changed
            // value lands in the slice, a value set back to the base leaves
            // it, and a cleared value leaves it so the state inherits again.
            const base = stripStateSlices(current)
            const edited = applyStylePartialToSx(
              stateScopedSx(current, activeState) as Record<string, any>,
              partial,
              activeBreakpoint,
              activeScheme,
            )
            target.setSx(
              writeStateSlice(
                current,
                activeState,
                deriveStateSlice(base, edited),
              ),
            )
          },
          [
            'sx',
            node.$id,
            activeState ?? 'base',
            activeBreakpoint ?? 'base',
            activeScheme ?? 'light',
            Object.keys(partial).sort().join(':'),
          ].join(':'),
        )
      },
      [node, target, activeBreakpoint, activeScheme, activeState],
    )

    // Effective scalar values at the active breakpoint + scheme — feeds
    // the form and controls; responsive objects resolve to their active
    // slice, color fields through the dark slice while previewing dark.
    const effectiveValues = useMemo(
      () =>
        computeEffectiveStyleValues(
          // In a state scope the panel reads the slice merged over the base
          // (AGL-2486), so a field the author has not overridden for hover
          // shows the inherited value rather than empty — the same reading
          // the breakpoint scope gives, and what the browser actually paints.
          stateScopedSx(
            nodeSx as Record<string, any>,
            activeState,
          ) as Record<string, any>,
          activeBreakpoint,
          activeScheme,
        ),
      [nodeSx, activeBreakpoint, activeScheme, activeState],
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

    /**
     * The border shorthand the box diagram draws for context (AGL-2486).
     * Read only — border width, style and colour are edited in the
     * Borders & Shadows section, which is their one home.
     */
    const boxBorder =
      effectiveValues['border'] === undefined
        ? undefined
        : `${effectiveValues['border']}`

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
          if (!node) return
          // No coalesce key: a band switch is one discrete decision, so it
          // gets its own undo step even when two are flipped in quick
          // succession (AGL-1204).
          Aglyn.canvas.transact(() => {
            target.setSx(
              writeHiddenBand(
                (target.sx ?? {}) as Record<string, any>,
                band,
                event.target.checked,
              ),
            )
          })
        },
      [node, target],
    )

    // Per-property clear for the instance override list (AGL-1306):
    // removing the top-level key returns this instance to the component's
    // own value for that property. Clearing the last one removes the
    // override field entirely (see NodeStyleTarget.setSx).
    const handleClearOverride = useCallback(
      (property: string) => () => {
        // Undoable and uncoalesced (AGL-1204): clearing a chip is a discrete
        // decision, and it DISCARDS an override — the one edit in this panel
        // that most needs a way back.
        Aglyn.canvas.transact(() => {
          const next = { ...(target.sx ?? {}) } as Record<string, any>
          delete next[property]
          target.setSx(next)
        })
      },
      [target],
    )
    // Read during render (observer): the list tracks the live override
    // record, so it updates as edits land or chips clear.
    const overrideProperties = target.isInstanceOverride
      ? Object.keys(target.sx ?? {})
      : []
    // Which targets this instance has overridden at all, so the picker can
    // mark them — an author restyling a CTA needs to see that the headline
    // already carries a colour without opening every leaf.
    const overriddenKeys = target.isInstanceOverride
      ? new Set(
          Object.keys(
            (node?.styleOverrides as Record<string, any> | undefined) ?? {},
          ),
        )
      : new Set<string>()

    /** The picker's name for one target — the author's word, then the component's. */
    const styleTargetLabel = useCallback(
      (entry: Aglyn.InstanceStyleTarget) =>
        entry.isRoot
          ? 'Component root'
          : entry.name ||
            (entry.componentId && Aglyn.components.getLabel(entry.componentId)) ||
            entry.componentInternalId,
      [],
    )

    const handleStyleTargetChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => {
        setPicked({ nodeId: node?.$id, key: event.target.value })
      },
      [node?.$id],
    )

    // Panel search (AGL-2486, item 13). The panel is seven accordions plus
    // the box stylers and the toggles, so "which section is Corner Radius
    // in?" was a question every author had to answer from memory. Filtering
    // is derived from the query on every render rather than held in state:
    // one source of truth, and no way for the list to disagree with the box.
    const [query, setQuery] = useState('')
    const search = query.trim()
    const searching = search !== ''
    const handleSearchChange = useCallback(
      (event: ChangeEvent<HTMLInputElement>) => setQuery(event.target.value),
      [],
    )
    // While searching, a section that HAS a match opens itself — a hit
    // hidden inside a collapsed accordion is not a hit. Keyed on the search
    // MODE rather than the text so this re-seeds the accordions once, when
    // searching starts or stops, not on every keystroke.
    const accordionKey = searching ? 'search' : 'browse'
    const matchesSection = useCallback(
      (key: keyof typeof STYLE_SECTION_ENTRIES) =>
        matchesStyleQuery(STYLE_SECTION_ENTRIES[key], search),
      [search],
    )
    const visibleFlexboxToggles = useMemo(
      () =>
        FLEXBOX_TOGGLES.filter((schema) =>
          matchesStyleQuery(styleFieldEntry(schema as any), search),
        ),
      [search],
    )
    const visibleFlexGridGroup = useMemo(
      () => filterStyleGroup(flexGridGroup, search),
      [flexGridGroup, search],
    )
    const visibleStyleGroups = useMemo(
      () =>
        styleGroups
          .map((group) => filterStyleGroup(group, search))
          .filter((group): group is typeof styleGroups[number] =>
            Boolean(group),
          ),
      [styleGroups, search],
    )
    // Nothing anywhere answered the query — said once, rather than leaving
    // the author looking at a panel that has silently emptied itself.
    const hasResults =
      !searching ||
      Boolean(
        visibleStyleGroups.length ||
          visibleFlexboxToggles.length ||
          visibleFlexGridGroup ||
          matchesSection('box') ||
          matchesSection('textAlign') ||
          matchesSection('visibility') ||
          matchesSection('classes'),
      )

    // Re-seeds a group form's initial values when the selection, the
    // override target or the artboard scope changes (AGL-540/588/1332).
    const formSeedKey =
      `${node?.$id ?? ''}:${overrideKey}:${activeBreakpoint ?? 'base'}` +
      `:${activeScheme ?? 'light'}:${activeState ?? 'base'}`

    return (
      <>
        {/* Find a style by what it is called OR by what an author would
            call it (AGL-2486, item 13): `rounded` finds Corner Radius,
            `shadow` finds the shadow preset, `see through` finds Opacity. */}
        <Container gutterY={[1]} dense>
          <TextField
            fullWidth
            size="small"
            margin="dense"
            type="search"
            value={query}
            onChange={handleSearchChange}
            label="Search styles"
            placeholder="rounded, shadow, spacing…"
          />
        </Container>
        {hasResults ? null : (
          <Container gutterY={[1]} dense>
            <Alert severity="info" sx={{ fontSize: '0.8125rem' }}>
              {`No style matches “${search}”. Try a plainer word — ` +
                '“rounded”, “shadow”, “spacing”, “hide”.'}
            </Alert>
          </Container>
        )}
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
              color={activeBreakpoint ? 'primary' : 'default'}
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
                color="primary"
                variant="outlined"
                sx={{ ml: 1 }}
                label="Styling: dark scheme"
              />
            </Tooltip>
          ) : null}
        </Container>
        {/* Interaction states (AGL-2486 item 39): a sibling of the breakpoint
            chip above, not a second mechanism — same "which slice am I
            editing" question, same answer shape. Picking a state also HOLDS
            it on the canvas for this element, which is the only way to see
            what you are styling from a side panel. */}
        <Container gutterY={[1]} dense sx={{ position: 'relative', pr: 3 }}>
          <HelpTip
            title="Hover, focus & other states"
            excerpt="Style how this element looks when someone points at it, presses it or reaches it with the keyboard. Picking a state also shows it on the canvas while you work — that preview is never saved."
            href={besignerDocsUrl('responsiveStyling', '#interaction-states')}
            sx={{
              position: 'absolute',
              top: 0,
              right: 8,
              zIndex: 1,
              fontSize: '0.9em',
            }}
          />
          {/* The row is structurally unable to wrap. Five labelled chips need
              ~272px and a 375px panel offers 359, so they fit at every normal
              width — but the panel is resizable, and at ~260px nothing fits at
              any size consistent with the rest of the panel. `nowrap` plus
              `overflow-x` makes the failure mode a few pixels of scroll rather
              than an orphaned chip on a second line, which is what this row
              shipped as and what Zach reported. */}
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'nowrap',
              alignItems: 'center',
              gap: 0.5,
              overflowX: 'auto',
              // The scrollbar would eat more height than the chips it serves.
              scrollbarWidth: 'none',
              '&::-webkit-scrollbar': { display: 'none' },
              // Tightened from the stock small chip so the row clears a narrow
              // panel; the 0.75rem type still matches the breakpoint chip above.
              '& .MuiChip-label': { px: 0.75 },
              '& .MuiChip-root': { flexShrink: 0 },
              '& .MuiChip-deleteIcon': { ml: '-2px', mr: '2px' },
            }}
          >
            {/* Default is FILLED and the states are OUTLINED, always — the base
                scope reads as a different kind of thing at a glance rather than
                as a fifth state, and unlike a divider it costs no width. */}
            <Tooltip title="Styles that apply at rest, and everywhere a state does not override them.">
              <Chip
                size="small"
                variant="filled"
                color={activeState ? 'default' : 'primary'}
                label="Default"
                onClick={() => selectState(null)}
              />
            </Tooltip>
            {SX_STATES.map((state) => (
              <Tooltip key={state} title={SX_STATE_DESCRIPTIONS[state]}>
                <Chip
                  size="small"
                  variant="outlined"
                  color={activeState === state ? 'primary' : 'default'}
                  label={
                    sxHasStateSlice(nodeSx as Record<string, any>, state)
                      ? `${SX_STATE_LABELS[state]} •`
                      : SX_STATE_LABELS[state]
                  }
                  onClick={() => selectState(state)}
                  // The X clears the WHOLE slice, and only appears on the state
                  // being edited that actually has one — the same clear
                  // affordance individual values have, one level up.
                  onDelete={
                    activeState === state &&
                    sxHasStateSlice(nodeSx as Record<string, any>, state)
                      ? () => clearState(state)
                      : undefined
                  }
                />
              </Tooltip>
            ))}
          </Box>
        </Container>
        {activeState ? (
          <Container gutterY={[1]} dense>
            <Alert severity="warning" sx={{ fontSize: '0.8125rem' }}>
              {`The canvas is showing this element's ${SX_STATE_PROSE[activeState]}` +
                ' state so you can see what you are styling. ' +
                'It is a preview — it is not saved and does not affect your ' +
                'published page. Choose Default to stop.'}
            </Alert>
            {stateAdvisoryText ? (
              <Alert severity="info" sx={{ fontSize: '0.8125rem', mt: 1 }}>
                {stateAdvisoryText}
              </Alert>
            ) : null}
          </Container>
        ) : null}
        {/* Instance override layer (AGL-1306): on a component instance the
            whole panel writes per-instance overrides, never the component.
            The chip names the mode; each overridden property lists as a
            deletable chip whose ✕ returns that property to the
            component's own value. */}
        {target.isInstanceOverride ? (
          <Container gutterY={[1]} dense>
            {/* Which part of the component this instance is restyling
                (AGL-1332). Root-only overrides could change an instance's
                background but never the colour its headline sets for
                itself, so a white band rendered white-on-white; picking the
                headline here writes a slice keyed by that leaf's definition
                id, merged over the leaf at graft time. Content stays the
                component's — this styles the instance's copy, it does not
                unlock the component's text. */}
            {styleTargets.length > 1 ? (
              <TextField
                select
                fullWidth
                size="small"
                margin="dense"
                label="Style target"
                value={overrideKey}
                onChange={handleStyleTargetChange}
                helperText={
                  target.isLeafOverride
                    ? 'Styling one element inside the component, on this ' +
                      'instance only. Its content still comes from the ' +
                      'component.'
                    : "Styling the component's outer element on this " +
                      'instance. Pick an element inside it to restyle that ' +
                      'part — a headline that sets its own color ignores ' +
                      'one set out here.'
                }
              >
                {styleTargets.map((entry) => (
                  <MenuItem
                    key={entry.key}
                    value={entry.key}
                    // Nesting reads as nesting: the definition's tree is the
                    // only map an author has of what is inside a component.
                    sx={{ pl: 2 + entry.depth * 1.5 }}
                  >
                    {styleTargetLabel(entry)}
                    {overriddenKeys.has(entry.key) ? ' •' : ''}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
            <Tooltip
              title={
                'This element is a component instance: style edits here ' +
                'apply to this instance only, layered over the ' +
                "component's own styles. Other placements keep the " +
                'component look, and component updates still flow ' +
                'through. Use "Edit component" on the Attributes tab to ' +
                'change the component for everyone.'
              }
            >
              <Chip
                size="small"
                color={overrideProperties.length ? 'secondary' : 'default'}
                label={
                  overrideProperties.length
                    ? `Instance overrides: ${overrideProperties.length}`
                    : 'Styling this instance'
                }
              />
            </Tooltip>
            {overrideProperties.map((property) => (
              <Tooltip
                key={property}
                title={
                  'Clear this override — the instance returns to the ' +
                  "component's own value"
                }
              >
                <Chip
                  size="small"
                  variant="outlined"
                  sx={{ ml: 1, mt: 0.5 }}
                  label={
                    property === SX_SCHEME_DARK_KEY
                      ? 'dark scheme'
                      : // A state slice is a whole nested block, not a
                        // property — printing the raw `&:hover` here would
                        // show an author a selector they never typed
                        // (AGL-2486).
                        (sxStateSliceLabel(property) ?? property)
                  }
                  onDelete={handleClearOverride(property)}
                />
              </Tooltip>
            ))}
          </Container>
        ) : null}
        {matchesSection('box') ? (
        <Container gutterY={[2]} dense sx={{ position: 'relative' }}>
          <HelpTip
            title="Margin & padding"
            excerpt="Click a side of the box to set its space at the active breakpoint — a step from your theme's spacing scale, or an exact amount in the unit of your choice."
            href={besignerDocsUrl('responsiveStyling', '#box-stylers')}
            sx={{ position: 'absolute', top: 0, right: 8, zIndex: 1, fontSize: '0.9em' }}
          />
          <BoxStyler
            measurements={boxMeasurements}
            spacingSteps={themeScales.spacing}
            border={boxBorder}
            onChange={handleBoxStylerChange}
          />
        </Container>
        ) : null}
        {matchesSection('textAlign') ? (
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
        ) : null}

        {/* One layout section, not two (AGL-2486). `Flexbox & Grids` and
            `Grid & Flex Child` described the same two CSS layout models
            from different ends and split them by a line the property names
            did not follow — `Align self` sat with the container controls
            while `Grid Columns`, a container property, sat under "Flex
            Child". Every property both sections carried is here. */}
        {visibleFlexboxToggles.length || visibleFlexGridGroup ? (
        <Accordion
          key={`flex-grid:${accordionKey}`}
          expanded={searching}
          summary="Flexbox & Grid"
          help={{
            title: 'Flexbox & grid layout',
            excerpt:
              'Configure the selected element as a flex or grid container — alignment, wrapping, direction, gaps and track lists — and place it inside its own parent’s layout.',
            href: besignerDocsUrl('responsiveStyling', '#style-groups'),
          }}
        >
          {/* Every container toggle reads its own key back (AGL-1458).
              These were rendered with an `onChange` and no `value`, so the
              control seeded its local state from nothing and reported "-
              not set" for a property the node demonstrably had — while
              Text Alignment above, which IS handed its effective value,
              highlighted the same authoring correctly on the same node.
              Rendered from a list rather than eight hand-wired call sites
              so a toggle added later cannot arrive read-only again. */}
          {visibleFlexboxToggles.map((schema) => (
            <ToggleButtonFormControl
              key={schema.name}
              onChange={handleFlexboxChange(schema.name as string)}
              schema={schema}
              value={effectiveValues[schema.name as string] ?? ''}
            />
          ))}
          {/* Gaps, grid tracks, item placement and flex-child sizing —
              the typed half of the same section. They apply immediately
              like everything else. */}
          {visibleFlexGridGroup ? (
            <FormRenderer
              key={formSeedKey}
              FormTemplate={ElementStylesFormTemplate}
              componentMapper={componentMapper}
              keepDirtyOnReinitialize
              // The SAVE stays scoped to the whole group even while the
              // panel shows a filtered subset (AGL-2486): a partial does not
              // carry the hidden fields, and `computeStylePartial` would
              // then write `undefined` over every one of them — a search
              // would silently clear the styles it was only meant to hide.
              onSubmit={handleGroupSave(
                styleGroupFieldNames(visibleFlexGridGroup),
              )}
              initialValues={pickStyleValues(
                styleGroupFieldNames(visibleFlexGridGroup),
                effectiveValues,
              )}
              schema={{ fields: visibleFlexGridGroup.fields }}
            />
          ) : null}
        </Accordion>
        ) : null}

        {/* Responsive visibility (AGL-562): hide the element on whole
            device bands — e.g. hide the desktop link cluster on mobile
            and show a menu button instead. */}
        {matchesSection('visibility') ? (
        <Accordion
          key={`visibility:${accordionKey}`}
          expanded={searching}
          summary="Visibility"
          help={{
            title: 'Visibility per device band',
            excerpt:
              'Hide the element on whole device bands — e.g. hide a desktop link cluster on mobile and show a menu button instead.',
            href: besignerDocsUrl('responsiveStyling', '#visibility-per-device-band'),
          }}
        >
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
        ) : null}

        {/* First-class style groups (AGL-540/587). Each form is keyed on
            the node + breakpoint so switching selection or artboard
            scope re-seeds the initial values; edits apply immediately
            through the shared debounced template. */}
        {visibleStyleGroups.map((group) => {
          const fieldNames = styleGroupFieldNames(group)
          return (
            <Accordion
              key={`${group.$id}:${accordionKey}`}
              expanded={searching}
              summary={group.label}
              help={{
                title: `${group.label} styles`,
                excerpt:
                  'Every field edits the selected element at the active breakpoint and scheme scope; the line under each field says what it does, and a ? marks the few whose bare number is not pixels.',
                href: besignerDocsUrl('responsiveStyling', '#style-groups'),
              }}
            >
              <FormRenderer
                key={formSeedKey}
                FormTemplate={ElementStylesFormTemplate}
                componentMapper={componentMapper}
                // Re-seed from the document, but never over the caret
                // (AGL-2486). Changing `initialValues` is what carries an
                // undo into these fields; on its own it also resets the
                // field being typed in the moment a SIBLING key in the same
                // group moves. `keepDirtyOnReinitialize` draws the line
                // where it belongs: a field whose value still equals what
                // was last stored takes the new reading, and one the author
                // has since changed keeps their characters until the
                // debounced commit stores them.
                keepDirtyOnReinitialize
                onSubmit={handleGroupSave(fieldNames)}
                initialValues={pickStyleValues(fieldNames, effectiveValues)}
                schema={{ fields: group.fields }}
              />
            </Accordion>
          )
        })}

        {matchesSection('classes') ? (
        <Accordion
          key={`classes:${accordionKey}`}
          expanded={searching}
          summary="Classes & custom CSS"
          help={{
            title: 'Custom classes & CSS',
            excerpt:
              'Attach reusable style classes to the element, or write raw CSS (sx) for anything the panels don’t cover.',
            href: besignerDocsUrl('responsiveStyling', '#custom-classes'),
          }}
        >
          <ElementClassesField node={node} />
          {/* Same override target as the rest of the panel (AGL-1332) — a
              raw sx edit must land on the leaf the picker names, not
              silently back on the component root. */}
          <CustomCssForm
            node={node}
            breakpoint={activeBreakpoint}
            overrideKey={overrideKey}
          />
        </Accordion>
        ) : null}

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
