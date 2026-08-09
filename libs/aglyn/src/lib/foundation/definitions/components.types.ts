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

import type {
  ConditionDefinition,
  DataType,
  Validator,
} from '@data-driven-forms/react-form-renderer'
import type {
  FieldActions,
  ResolvePropsFunction,
} from '@data-driven-forms/react-form-renderer/common-types'
import type { SvgIconProps } from '@mui/material'
import type { MuiStyledOptions } from '@mui/system/createStyled'
import type { CANVAS_ROOT_ELEMENT_ID } from '../constants/canvas'
import type { ComponentCategory } from '../constants/components'
import type { FEATURE_FLAG } from '../constants/shared'
import type { AGLYN_OF, SYMBOL_TYPE } from '../constants/symbol'

export enum LinealDirectiveFlag {
  LIMIT_TO = 'limitedTo',
  DISALLOW = 'forbid',
}

export type BundleId = string
export type PluginId = string
export type ComponentId = string
export type PresetId = string
export type NodeId = string

export type ComponentsLinealOrder = [
  directiveType: LinealDirectiveFlag,
  directiveDefinition:
    | Array<ComponentId>
    | { plugins?: Array<PluginId>; components: Array<ComponentId> }
    | { plugins: Array<PluginId>; components?: Array<ComponentId> },
]

export type AglynNodeItemDenormalized<P = JSX.AnyProps> = AglynNodeSchema<P> & {
  nodes?: AglynNodeItemDenormalized[]
}

export type AglynNodesList = Array<AglynNodeItemDenormalized>

export type AglynNodeHierarchy<$ID extends NodeId = NodeId> = [
  root: CANVAS_ROOT_ELEMENT_ID,
  ...nodes: [...ancestors: NodeId[], element: $ID],
]

export interface AglynExoticComponent<PROPS = any, REF = any>
  extends JSX.ForwardRefExoticComponent<
    JSX.PropsWithoutRef<PROPS> & JSX.RefAttributes<REF>
  > {
  [AGLYN_OF]?: SYMBOL_TYPE
  aglyn?: boolean
  schema?: AglynComponentSchema<PROPS>
}

export interface AglynComponentSchema<P = any> {
  $id: ComponentId
  pluginId?: BundleId
  kind?: 'element' | 'plaintext' | 'markdown'

  displayName: string
  title?: string
  subtitle?: string
  description?: string

  /**
   * Icon props for display around besigner
   */
  icon?: SvgIconProps
  /**
   * Options to be passed to styled(Component, \{...styledOptions\})
   */
  styledOptions?: MuiStyledOptions

  /**
   * Define a limitation for nodes allowed as direct descendents
   */
  restrictChildren?: ComponentsLinealOrder
  /**
   * Define a limitation for nodes allowed to be direct ancestors
   */
  restrictParent?: ComponentsLinealOrder

  /**
   * Filter props
   */
  resolveProps?: JSX.ResolveProps<AglynNodeItemDenormalized<P>>

  /**
   * Attribute fields to modify the contextual properties
   * New version
   */
  attributes?: AglynAttributeSchema[]

  /**
   * Feature flags
   */
  flags?: {
    /**
     * Disable the use of emotion styled
     */
    emotion?: FEATURE_FLAG
    /**
     * Can the nodes of this component type be cloned?
     */
    cloning?: FEATURE_FLAG
    /**
     * Allow dragging nodes of this component type
     */
    dragging?: FEATURE_FLAG
    /**
     * Allow dropping nodes inside nodes of this component type
     */
    dropping?: FEATURE_FLAG
    /**
     * Allow editing element attributes of this component type
     */
    editing?: FEATURE_FLAG
    /**
     * Allow removing nodes of this component type
     */
    removing?: FEATURE_FLAG
    /**
     * Describe nodes of this component type to be self-closing
     */
    selfClosing?: FEATURE_FLAG
    /**
     * Component renders its `children` prop as text content the editor may
     * edit directly (Attributes "Text" field, inline canvas editing).
     */
    textEditable?: FEATURE_FLAG
    /**
     * Component also accepts basic rich text (AGL-54): sanitized HTML in the
     * `html` prop with `children` as the plain-text fallback.
     */
    richTextEditable?: FEATURE_FLAG
    /**
     * Component reads its children POSITIONALLY (AGL-1237), so the renderer
     * must hand it one React child per node child instead of the single
     * `<Branch>` element it normally passes.
     *
     * MUI's Accordion does `const [summary, ...rest] = Children.toArray(children)`,
     * and `toArray` does not traverse into an element — so with the default
     * wrapping the summary swallowed the whole subtree and the Collapse got
     * nothing. Every accordion on every published site expanded to reveal an
     * empty panel while its content rendered unconditionally inside the
     * summary's `<h3>`.
     *
     * Opt in only for components with this contract; the wrapper is what
     * keeps the Branch/Stem/Leaf seam swappable for everything else.
     */
    positionalChildren?: FEATURE_FLAG
  }

  /**
   * Preset items are the available items to add to the canvas
   */
  presets?: AglynNodePresetSchema[]
}

export type NodePresetData = Omit<AglynNodeSchema, '$id' | 'nodes'> & {
  $id?: NodeId
  nodes?: NodePresetData[]
}

export type AglynNodePresetSchema = {
  $id: PresetId
  label: string
  componentId?: ComponentId
  pluginId?: BundleId
  description?: string
  icon?: SvgIconProps
  category?: string | ComponentCategory
  data: NodePresetData
}

export enum FieldComponentType {
  BUTTON = 'button',
  BUTTON_GROUP = 'button-group',
  CHECKBOX = 'checkbox',
  COLOR_PICKER = 'color-picker',
  /**
   * CSS length editor (AGL-1219): a number box plus a unit picker sharing
   * the styles panel's unit list. The persisted prop is still ONE CSS
   * string (`"920px"`, `"100%"`, `"auto"`, `""`) — this is an input
   * affordance, not a shape change, so renderers stay untouched. Values
   * the picker can't model (`calc(…)`, a binding token) fall back to free
   * text rather than being clobbered.
   */
  CSS_DIMENSION = 'css-dimension',
  /**
   * Background fill editor (AGL-1331): a fill-type switch (default / solid
   * / linear / radial) over an angle box and a colour-stop list, each stop
   * bindable to a palette token or a literal. The persisted prop is ONE CSS
   * string under `backgroundImage` — a solid fill writes the explicit
   * keyword `none` and leaves `backgroundColor` to do the job, while the
   * default choice writes nothing at all (AGL-1338: the two differ on a
   * component instance, where absence means "keep the component's fill") —
   * so renderers stay untouched. Values
   * the editor cannot model (`conic-gradient`, `to bottom right`, a stacked
   * image list) fall back to free text rather than being clobbered.
   */
  CSS_GRADIENT = 'css-gradient',
  DATE_PICKER = 'date-picker',
  DUAL_LIST_SELECT = 'dual-list-select',
  FIELD_ARRAY = 'field-array',
  ICON_PICKER = 'icon-picker',
  INPUT_ADDON_BUTTON_GROUP = 'input-addon-button-group',
  INPUT_ADDON_GROUP = 'input-addon-group',
  PLAIN_TEXT = 'plain-text',
  RADIO = 'radio',
  /**
   * Select listing the host's screens; the editor resolves the options from
   * the host routing map at render time and writes the chosen screen id.
   */
  SCREEN_SELECT = 'screen-select',
  /**
   * Select listing the canvas's other elements (AGL-557): the editor
   * resolves options from the live canvas at edit time and persists the
   * node id — e.g. the form's reveal-on-submit target.
   */
  NODE_SELECT = 'node-select',
  /**
   * Id-based entity pickers (AGL-343/344): the editor resolves options
   * from EntityPickerContext at edit time and persists the entity id —
   * renames never break the reference.
   */
  /**
   * Select listing the plugins installed for this site (AGL-1030): the editor
   * resolves options from the install set the console publishes and persists
   * the listing id. A picker rather than a typed document id — the same reason
   * every other reference in the designer is one, and here it also removes the
   * "is this installed?" question by construction.
   */
  PLUGIN_SELECT = 'plugin-select',
  /**
   * A placed plugin's declared settings, rendered as real fields (AGL-1049).
   * Reads the sibling plugin selection to know which manifest to offer.
   */
  PLUGIN_SETTINGS = 'plugin-settings',
  PRODUCT_SELECT = 'product-select',
  COLLECTION_SELECT = 'collection-select',
  CATEGORY_SELECT = 'category-select',
  DATASET_SELECT = 'dataset-select',
  /**
   * Select listing the model fields of the nearest ancestor node's chosen
   * dataset (AGL-556): the editor resolves options from
   * EntityPickerContext.datasetFields using the ancestor's `datasetId`
   * (or legacy `datasetName` matched by label) and persists the stable
   * model fieldId — field renames never break the mapping.
   */
  DATASET_FIELD_SELECT = 'dataset-field-select',
  SELECT = 'select',
  SLIDER = 'slider',
  SUB_FORM = 'sub-form',
  SWITCH = 'switch',
  TAB_ITEM = 'tab-item',
  TABS = 'tabs',
  TEXT_FIELD = 'text-field',
  TEXTAREA = 'textarea',
  TIME_PICKER = 'time-picker',
  TOGGLE_BUTTON = 'toggle-button',
  WIZARD = 'wizard',
}

export enum FieldValidatorType {
  EXACT_LENGTH = 'exact-length',
  MAX_LENGTH = 'max-length',
  MAX_NUMBER_VALUE = 'max-number-value',
  MIN_ITEMS = 'min-items',
  MIN_LENGTH = 'min-length',
  MIN_NUMBER_VALUE = 'min-number-value',
  PATTERN = 'pattern',
  REQUIRED = 'required',
  URL = 'url',
}

export type FieldDataType =
  | 'boolean'
  | 'float'
  | 'integer'
  | 'number'
  | 'string'

export interface AglynAttributeSchema extends Dictionary<any> {
  name: string
  dataType?: DataType
  component: string | FieldComponentType
  validate?: Validator[]
  condition?: ConditionDefinition | ConditionDefinition[]
  initializeOnMount?: boolean
  initialValue?: unknown
  clearedValue?: unknown
  clearOnUnmount?: boolean
  actions?: FieldActions
  resolveProps?: ResolvePropsFunction
  description?: string
}

export interface AglynNodeSchema<P = JSX.AnyProps> {
  $id: NodeId
  componentId: ComponentId
  pluginId?: BundleId
  parentId?: NodeId
  sx?: JSX.SxProps
  props?: P
  nodes?: NodeId[] | AglynNodeSchema[]
}
