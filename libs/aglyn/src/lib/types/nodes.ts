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
import type { MuiStyledOptions } from '@mui/system/createStyled'
import type { SvgIconProps } from '@mui/material/SvgIcon'
/** Minimal icon-props type used in component/preset schemas. Structurally compatible with @aglyn/shared-ui-jsx MdiIconProps. */
export type MdiIconProps<D extends React.ElementType = 'svg', P = object> = SvgIconProps<D, P> & {
  path?: string
}
import type {
  ComponentId,
  ComponentsLinealOrder,
  NodeId,
  PresetId,
} from '../foundation'
import { ComponentCategory } from '../foundation/constants/components'
import type { ITimestamp } from '@aglyn/shared-util-timestamp'
import type React from 'react'
import type { ComponentClass, ComponentProps } from 'react'
import type { NODE_ROOT_ID } from '../canvas-manager'
import type { NodeInteraction } from '../app-utils/node-interactions'

import type {
  FEATURE_FLAG,
  FieldComponentType,
  RICH_TEXT_COMMANDS,
} from '../foundation'
import type { PluginId } from '../plugin-manager'
import type { ElementContentMap, Node, Props, Taxonomic } from './ast'
import type { AglynDocument } from '../foundation'
import type { HostUid } from '../foundation'

declare module './ast' {
  /**
   * This map registers all node types that may be used as top-level content in
   * the document.
   *
   * These types are accepted inside `root` nodes.
   *
   * This interface can be augmented to register custom node types.
   *
   * @example
   * declare module 'hast' {
   *   interface RootContentMap {
   *     // Allow using raw nodes defined by `rehype-raw`.
   *     raw: Raw;
   *   }
   * }
   */
  export interface RootContentMap {
    canvasNode: CanvasNode
    canvasElement: CanvasElement
  }

  /**
   * This map registers all node types that may be used as content in an
   * element.
   *
   * These types are accepted inside `element` nodes.
   *
   * This interface can be augmented to register custom node types.
   *
   * @example
   * declare module 'hast' {
   *   interface RootContentMap {
   *     custom: Custom;
   *   }
   * }
   */
  export interface ElementContentMap {
    canvasNode: CanvasNode
    canvasElement: CanvasElement
  }
}

/**
 * This map registers all node types that may be used as content in an canvas
 * node.
 *
 * These types are accepted inside `element` nodes.
 *
 * This interface can be augmented to register custom node types.
 *
 * @example
 * declare module 'hast' {
 *   interface RootContentMap {
 *     custom: Custom;
 *   }
 * }
 */
export interface CanvasNodeContentMap extends ElementContentMap {
  canvasNode: CanvasNode
  canvasElement: CanvasElement
}

export type CanvasNodeContent = CanvasNodeContentMap[keyof CanvasNodeContentMap]

/**
 * CanvasNode represents a the schema for building a JSX Element.
 */
export interface CanvasNode extends Node {
  /**
   * Represents this variant of a Node.
   */
  type: 'node'

  /**
   * List representing the children of a node.
   */
  children?: CanvasNodeContent[] | undefined

  /**
   * Represents the element's internal name defined by the user
   */
  name?: string | undefined

  /**
   * Represents the element's parent unique identifier
   */
  parentId?: string | undefined

  /**
   * Represents the elements' component unique identifier
   */
  componentId?: string | undefined

  /**
   * Represents the elements' components' plugin unique identifier
   */
  pluginId?: string | undefined

  /**
   * Represents information associated with the element.
   */
  props?: Props | undefined
}

/**
 * CanvasElement represents a living JSX Element
 */
export interface CanvasElement extends CanvasNode {
  /**
   * Represents the element's unique identifier
   */
  $id: string
}

export type AbstractId = string

// @TODO ⚠️ Refactor for better adoption of hast
export interface AbstractNodeSchema<P = JSX.AnyProps> extends CanvasNode {
  /**
   * The unique identifier for a node
   */
  $id: AbstractId
  title?: string
  displayName?: string
  description?: string

  children?: any
  nodes?: any

  /**
   * The node style properties for emotion
   */
  sx?: JSX.SxProps
  /**
   * The node props/attributes passed to the component
   */
  props?: P

  category?: any
  icon?: any

  createdAt?: ITimestamp
  updatedAt?: ITimestamp
  deletedAt?: ITimestamp
}

/**
 * CanvasPreset represents an encapsulated 'node' type as the root node for
 * crafting a living JSX Element
 */
export interface CanvasPreset extends Node, Taxonomic {
  /**
   * Represents this variant of a Node.
   */
  type: 'preset'

  /**
   * Represents the element's unique identifier
   */
  $id: string

  /**
   * Represents the elements' component unique identifier
   */
  componentId?: string | undefined

  /**
   * Represents the elements' components' plugin unique identifier
   */
  pluginId?: string | undefined

  /**
   * Represents information associated with the element.
   */
  props?: Props | undefined

  /**
   * Represents the element's internal name defined by the user
   */
  name?: string | undefined
}

export type { NodeId }

// @TODO ⚠️ Refactor for better adoption of hast
type PresetI = AglynDocument &
  Omit<AbstractNodeSchema<any>, 'type' | 'data'> &
  Omit<CanvasPreset, 'type' | 'data'>

interface PresetII extends PresetI {
  type: NodeType.PRESET | string
}

export interface PresetSchema<P = JSX.AnyProps> extends PresetII {
  $id: PresetId
  pluginId?: PluginId
  displayName?: string
  description?: string
  category?: string | ComponentCategory
  /**
   * Extra words this element should be findable by in the element picker —
   * synonyms and the name people reach for when it is not the name we chose
   * ("picture" for Image, "dropdown" for Select).
   *
   * Search terms only; never rendered. A hit here ranks BELOW every hit on a
   * name, so a tag widens what the picker finds without letting a synonym
   * outrank the element actually called that (AGL-2486).
   */
  tags?: string[]
  /** Alias of {@link tags}; both are searched. */
  keywords?: string[]
  icon?: MdiIconProps
  data: NodeSchemaNested<P>
  /**
   * Interaction templates wired when the preset is inserted (AGL-589):
   * the host app resolves each `presetRef` marker to a freshly minted node
   * and persists the result. Presets that need hover choreography (a
   * primitive dropdown panel) ship working out of the box instead of asking
   * the user to author the interactions by hand.
   *
   * TEMPLATES, and named so. These are not interactions: they are
   * unresolved, they reference nodes that do not exist yet, and they are
   * consumed at insert time and never stored. What they resolve INTO lives
   * on the node as {@link NodeSchema.interactions}, and a `PresetSchema` is
   * assignable to a `NodeSchema` — so while the two shared a name, one of
   * them had to be wrong wherever a preset was passed as a node.
   */
  interactionTemplates?: PresetInteractionSchema[]
}

/**
 * A visibility step inside a {@link PresetSchema} interaction template.
 * Only the basic client visibility steps are expressible — presets
 * scaffold in-page choreography, never server automations.
 */
export interface PresetInteractionStepSchema {
  type: 'showElement' | 'hideElement' | 'toggleElement'
  /** `presetRef` of the preset node this step targets. */
  targetRef: string
  /** Optional grace delay, validated to 0–5000ms like the builder. */
  delayMs?: number
  /** Self-dismissal for steps that can reveal the target. */
  dismissOn?: Array<'escape' | 'outsideClick'>
}

/** An interaction template a preset wires on insert (AGL-589). */
export interface PresetInteractionSchema {
  name: string
  event: 'elementClick' | 'elementHoverEnter' | 'elementHoverLeave'
  /** `presetRef` of the preset node whose selector fires the trigger. */
  triggerRef: string
  steps: PresetInteractionStepSchema[]
}

// @TODO ⚠️ Refactor for better adoption of hast
type NodeI<P> = AglynDocument & Omit<AbstractNodeSchema<P>, 'type'>

export interface NodeSchema<P = JSX.AnyProps> extends NodeI<P> {
  type: NodeType | string
  /**
   * List of the children unique identifiers for the node
   */
  nodes?: NodeId[]
  /**
   * Class name to pass the DOM node, can also be defined in props
   */
  className?: string
  /**
   * Preset-authoring marker (AGL-589): names a node inside a preset's
   * `data` tree so the preset's interaction templates can reference it
   * (`triggerRef` / `targetRef`). Cloned onto the inserted node; inert
   * everywhere else.
   */
  presetRef?: string
  /**
   * Per-instance style overrides on a reusable-component instance node
   * (AGL-1306), keyed by target: `root` (see `STYLE_OVERRIDES_ROOT_KEY`)
   * addresses the component ROOT, and any other key is a DEFINITION-internal
   * node id addressing one leaf inside the component (AGL-1332). Each slice
   * is an sx-shaped record merged over that node's own sx at graft time
   * (`composeReusableComponentNodes` → `mergeNodeSx`), so one page's CTA can
   * switch to a white background AND repaint its headline without widening
   * the component's declared props or detaching.
   *
   * Keyed on the definition's id, never the grafted `cmp__{instance}__{def}`
   * id: the graft id is derived per placement, so it would not survive a
   * duplicate or a re-key, and the same component could not offer two
   * instances the same authoring vocabulary. A key naming a node the
   * definition no longer has is ignored — a component edited later degrades
   * to its own styling instead of taking a page down.
   *
   * A first-class node field, NOT a prop: `AglynNode`'s constructor drops
   * unknown top-level keys, and anything in `props` is spread onto the
   * instance's wrapper DOM element. Lives on the instance node in the
   * document that places it — it survives component republish and never
   * pins the instance to an old component version, because the graft
   * always merges it over the definition's CURRENT nodes.
   */
  styleOverrides?: Record<string, JSX.SxProps>
  /**
   * Per-instance ATTRIBUTE overrides on a reusable-component instance node
   * (AGL-1899) — the same addressing as {@link styleOverrides}, applied to
   * a node's props instead of its sx, so one placement can carry a
   * different button `variant`, `size` or `href` without the component
   * declaring a prop for it and without detaching.
   *
   * Merged **per named prop**: a slice replaces only the props it names and
   * leaves the definition's others alone, so a component that later adds a
   * prop still gives every existing instance the new default. That is
   * deliberately shallower than the sx merge next door — an sx slice
   * cascades because `@scheme dark` and breakpoint objects are themselves
   * selectors, whereas a prop value is one value, and half-merging two
   * objects that merely look alike (say a `slotProps`) would produce a
   * third thing neither side asked for.
   *
   * `sx` is refused here. Styling an instance already has a mechanism one
   * field up, and honouring both would leave two writers racing for one
   * rendered value with no rule to say which wins.
   *
   * Applied BEFORE `{{prop.*}}` substitution, so an override may itself be
   * written in tokens and still resolves, and an override on a prop the
   * definition binds to a declared prop wins — the more specific placement
   * beats the component's own default.
   */
  attrOverrides?: Record<string, Record<string, unknown>>
  /**
   * Interactions this element carries — the click, hover and
   * scroll-into-view choreography authored on it in the besigner.
   *
   * ## Why they live on the NODE
   *
   * They used to be rows in `hosts/{hostId}/actions`, bound to an element by
   * a `[data-aglyn="leaf:<id>"]` selector — the same collection the Workflows
   * page lists. An interaction is not a site-wide automation, and storing it
   * as one had four consequences, every one of them a thing an author would
   * expect to work:
   *
   * - it was not versioned with the document, so it neither published nor
   *   rolled back with the screen it belongs to;
   * - it did not travel with a component copied to another site, or packaged
   *   into a template or a plugin — the element arrived inert;
   * - deleting the element left the action behind, pointing at a selector
   *   nothing resolves;
   * - and a nav's hover choreography sat in the site's automation list
   *   beside "when an order is placed", which is a different kind of thing.
   *
   * Host actions remain, and remain the right home for a genuine site event.
   * The split is the concept: an ACTION is something the site does, an
   * INTERACTION is something an element does.
   *
   * ## Shape
   *
   * Deliberately the same `HostAction` the automations engine already takes,
   * so nothing about the runtime changes: the selector is stamped from this
   * node's own id when the page is composed, and the compiled result is the
   * shape the client engine has always consumed. `trigger.selector` is
   * therefore ignored here — the node IS the selector.
   */
  interactions?: NodeInteraction[]
  /**
   * Hidden by the author — the eye on the element's hierarchy row.
   *
   * Renders `display: none` on the canvas AND on the published site. It is
   * the plain "I do not want this on the page" switch: no runtime, no
   * interaction, nothing reveals it. Showing it again is the same eye.
   *
   * ## Why a FIELD and not a style
   *
   * Because it has to override the element's own display rather than replace
   * it. An author who toggles the eye on a Stack laid out with
   * `display: flex` must get that flex back when they toggle it off, and
   * writing `display: none` into `node.sx` destroys the value it overwrote —
   * there is nothing left to restore. Composed LAST in `Leaf` instead, so it
   * wins on the cascade and the stored style is never touched.
   *
   * ## Not {@link ELEMENT_HIDDEN_CLASS}
   *
   * `aglyn-hidden` is a different thing wearing a similar name: it means
   * "starts hidden, and an interaction shows it" — a mega-menu panel, a
   * drawer. That class is part of a runtime contract (the show/hide steps
   * toggle it, and the canvas reveals it for designing), and it is bespoke to
   * that job. A visibility toggle that wrote it would enrol every hidden
   * element in a choreography it is not part of.
   */
  hidden?: boolean
  /**
   * The computed node parent (only for type completion)
   */
  readonly parent?: NodeSchema<any> | null
  /**
   * The computed node parent (only for type completion)
   */
  readonly children?: NodeSchema<any>[]
  /**
   * The computed index in parent nodes (only for type completion)
   */
  readonly index?: number | null
  /**
   * The computed label (only for type completion)
   */
  readonly labelShort?: string | undefined
  /**
   * The computed breadcrumb path (only for type completion)
   */
  readonly breadcrumbPath?: NodeBreadcrumbPath
  /**
   * The computed component schema (only for type completion)
   */
  readonly componentSchema?: ComponentSchema | undefined
  /**
   * The computed guard for of child nodes (only for type completion)
   */
  readonly hasNodes?: boolean
  /**
   * The computed property for the resolved props from component schema
   */
  readonly resolvedProps?: P
}

export enum NodeType {
  NODE = 'node',
  TEXT = 'text',
  NUMBER = 'number',
  SCREEN = 'screen',
  REF = 'ref',
  PRESET = 'preset',
}

export type NodeSchemaJSON<P = JSX.AnyProps> = Omit<
  NodeSchema<P>,
  | 'parent'
  | 'index'
  | 'labelShort'
  | 'breadcrumbPath'
  | 'componentSchema'
  | 'hasNodes'
>

export type NodeSchemaNested<P = JSX.AnyProps> = Omit<
  NodeSchemaJSON<P>,
  'nodes'
> & { nodes?: NodeSchemaNested<any>[] }

export type NodesMap = Record<NodeId, NodeSchema<any>>

export type NodeBreadcrumbPath = [
  root: string & typeof NODE_ROOT_ID,
  ...nodes: [...ancestors: NodeId[], node: NodeId],
]

export type ProcessableNodes =
  | NodeSchemaNested<any>[]
  | NodeSchemaNested<any>
  | Record<NodeId, NodeSchema>

export { ComponentCategory }

export type { ComponentId }
export type { PresetId }

export type ComponentFactory<
  P extends ComponentProps<C> | any = any,
  C extends keyof JSX.IntrinsicElements | JSX.ElementConstructor<any> = any,
> = ComponentClass<P> | JSX.ElementConstructor<P> | keyof JSX.IntrinsicElements
// | keyof JSX.IntrinsicElements[keyof JSX.IntrinsicElements]

export type { ComponentsLinealOrder }

// @TODO ⚠️ Refactor for better adoption of hast
export interface AttributeSchema extends Dictionary<any> {
  name: string
  dataType?: DataType
  component: string | FieldComponentType
  validate?: Validator[]
  condition?: ConditionDefinition | ConditionDefinition[]
  initializeOnMount?: boolean
  initialValue?: any
  clearedValue?: any
  clearOnUnmount?: boolean
  actions?: FieldActions
  resolveProps?: ResolvePropsFunction
  description?: string
}

// @TODO ⚠️ Refactor for better adoption of hast
export interface ComponentSchema<P = any> {
  $id?: ComponentId
  pluginId?: PluginId
  kind?: 'element' | 'plaintext' | 'markdown'

  displayName: string
  title?: string
  subtitle?: string
  description?: string
  category?: string | ComponentCategory

  /**
   * Extra words this element should be findable by in the element picker —
   * synonyms and the name people reach for when it is not the name we chose
   * ("picture" for Image, "dropdown" for Select).
   *
   * Search terms only; never rendered. A hit here ranks BELOW every hit on a
   * name, so a tag widens what the picker finds without letting a synonym
   * outrank the element actually called that (AGL-2486).
   */
  tags?: string[]
  /** Alias of {@link tags}; both are searched. */
  keywords?: string[]

  /**
   * Icon props for display around besigner
   */
  icon?: MdiIconProps
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
  resolveProps?: JSX.ResolveProps<NodeSchema<P>>

  /**
   * Attribute fields to modify the contextual properties
   * New version
   */
  attributes?: AttributeSchema[]

  /**
   * Which groups of formatting the inline rich-text toolbar offers for this
   * component (AGL-2557). Read only where `flags.richTextEditable` is on.
   *
   * Omitted means every group, which is what leaves Typography exactly as it
   * was. Naming a subset narrows the toolbar AND the commit: a surface that
   * offers neither lists nor links is phrasing-only, and the sanitizer holds
   * it to that whatever an author pastes in.
   */
  richTextCommands?: RICH_TEXT_COMMANDS[]

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
     * Component also accepts basic rich text (AGL-54): the inline editor
     * upgrades to a formatting surface and commits sanitized HTML into the
     * `html` prop (with `children` kept as the plain-text fallback).
     */
    richTextEditable?: FEATURE_FLAG
    /**
     * Component reads its children POSITIONALLY (AGL-1237), so the renderer
     * hands it one React child per node child instead of the single `<Branch>`
     * element it normally passes.
     *
     * MUI's Accordion does `const [summary, ...rest] = Children.toArray(children)`,
     * and `toArray` does not traverse into an element — so with the default
     * wrapping the summary swallowed the whole subtree and the Collapse got
     * nothing. Every accordion on every published site expanded to reveal an
     * empty panel while its content rendered unconditionally inside the
     * summary's heading.
     *
     * Opt in only for components with this contract; the wrapper is what keeps
     * the Branch/Stem/Leaf seam swappable for everything else.
     */
    positionalChildren?: FEATURE_FLAG
  }
}

export type SchemasByCategory = Record<
  ComponentCategory | string,
  (ComponentSchema<any> | PresetSchema<any>)[]
>

export interface ScreenSchema {
  nodes: NodeSchemaNested
  createdAt?: ITimestamp
  updatedAt?: ITimestamp
  hostId?: HostUid
}
