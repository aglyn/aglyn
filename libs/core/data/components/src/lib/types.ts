/**
 * @license
 * Copyright 2021 Aglyn LLC
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

import {
  AglynEmitterPayload,
  EXTENSION_TYPE,
  IAglynExtension,
  MODULE_TYPE,
  PayloadData,
  RestrictFlag,
  TYPE_KIND,
  TYPE_OF,
} from '@aglyn/core-data-framework'
import type { IconId as MdiIconId } from '@aglyn/shared-data-mdi'
import type {
  AnyProps,
  JSXIntrinsicElement,
  JSXNode,
  OrUndef,
  ResolveProps,
} from '@aglyn/shared-data-types'
import type { FormSchema, InnerRefProp } from '@aglyn/shared-ui-jsx'
import type { ComponentClass, FunctionComponent } from 'react'


export enum AglynComponentEventFlag {
  COMPONENT_GET = 'module:extension:components:get-component',
  COMPONENTS_GET = 'module:extension:components:get-components',
  COMPONENT_REGISTER = 'module:extension:components:register-component',
  COMPONENT_UNREGISTER = 'module:extension:components:unregister-component',
  COMPONENTS_BUNDLE_REGISTER = 'module:extension:components:register-components-bundle',
  COMPONENTS_BUNDLE_UNREGISTER = 'module:extension:components:unregister-components-bundle',
}

declare module '@aglyn/core-data-framework' {
  export interface AglynModuleEventParams
    extends Record<AglynComponentEventFlag, OrUndef<AglynEmitterPayload>> {
    [AglynComponentEventFlag.COMPONENT_GET]: GetComponentPayload
    [AglynComponentEventFlag.COMPONENTS_GET]: undefined
    [AglynComponentEventFlag.COMPONENT_REGISTER]: UnregisterComponentPayload
    [AglynComponentEventFlag.COMPONENT_UNREGISTER]: UnregisterComponentPayload
    [AglynComponentEventFlag.COMPONENTS_BUNDLE_REGISTER]: RegisterBundlePayload
    [AglynComponentEventFlag.COMPONENTS_BUNDLE_UNREGISTER]: UnregisterBundlePayload
  }
}

export type AglynComponentClassElement<P = any> = ComponentClass<P>
export type AglynComponentFunctionElement<P = any> = FunctionComponent<P>
export type AglynComponentIntrinsicElement<P = any> = JSXIntrinsicElement<P>
export type AglynComponentElementType<P = any> =
  | AglynComponentClassElement<P>
  | AglynComponentFunctionElement<P>
  | AglynComponentIntrinsicElement<P>

export type BundleId = string
export type ComponentId = string

export type HierarchyRestriction = [
  type: RestrictFlag,
  componentIds: (ComponentId | [ComponentId, BundleId])[]
]

export type ComponentsRegistryKeys = (ComponentId | [ComponentId, BundleId])[]
export type ComponentsRegistryValues = IAglynComponentElement[]
export type ComponentsRegistryEntry = [
  cId: ComponentId | [ComponentId, BundleId],
  cmp: IAglynComponentElement
]

export type GetComponentPayload = PayloadData<{
  componentId: string
  bundleId?: string
}>
export type GetComponentSchemaPayload = PayloadData<{
  componentId: string
  bundleId?: string
}>
export type GetBundlePayload = PayloadData<{
  bundleId: string
}>

export type RegisterComponentPayload<P = any> = PayloadData<{
  schema: IAglynComponentSchema<P>
  component: IAglynComponentElement<P>
}>
export type RegisterBundlePayload = PayloadData<{
  bundle: IAglynComponentsBundle
  components: RegisterComponentPayload[]
}>

export type UnregisterComponentPayload = PayloadData<{
  componentId: ComponentId
  bundleId: BundleId
}>
export type UnregisterBundlePayload = PayloadData<{
  bundleId: BundleId
}>

export interface IAglynComponentsExtension extends IAglynExtension<ComponentsRegistry> {
  getAllComponents(): ComponentsRegistryEntry[]
  getAllComponentsKeys(): ComponentsRegistryKeys
  getAllComponentsValues(): ComponentsRegistryValues

  getTemplateBlocks(): AglynComponentElementTemplateData[]

  getComponent(payload: GetComponentPayload): OrUndef<IAglynComponentElement>
  getComponentSchema(payload: GetComponentSchemaPayload): OrUndef<IAglynComponentSchema>
  getBundle(payload: GetBundlePayload): OrUndef<IAglynComponentsBundle>

  registerComponent(payload: RegisterComponentPayload): this
  registerBundle(payload: RegisterBundlePayload): this

  unregisterComponent(payload: UnregisterComponentPayload): this
  unregisterBundle(payload: UnregisterBundlePayload): this
}

export interface ComponentsRegistry {
  bundles: Map<BundleId, IAglynComponentsBundle>
  components: Map<ComponentId | [ComponentId, BundleId], IAglynComponentElement>
  schemas: Map<ComponentId | [ComponentId, BundleId], IAglynComponentSchema>
  templates: Map<string, AglynComponentElementTemplateData>
}

export interface IAglynComponentsBundle {
  readonly bundleId: BundleId
  metadata?: {
    displayName: string
    description?: string
    icon?: string
  }
  components: ComponentId[]
}

export interface IAglynComponentElement<P = any>
  extends AglynComponentClassElement<P & InnerRefProp> {
  readonly [TYPE_OF]: typeof MODULE_TYPE
  readonly [TYPE_KIND]: typeof EXTENSION_TYPE
  componentId: ComponentId
  bundleId?: BundleId
}

export interface IAglynComponentSchema<P = any> {
  componentId: ComponentId
  bundleId?: BundleId

  // Metadata
  metadata: {
    displayName: string
    title?: string
    subtitle?: string
    description?: string
    icon?: MdiIconId | JSXNode
  }

  // Builder feature flags
  builderFlags?: {
    actions?: { disable?: boolean }
    badge?: { disable?: boolean }
    copying?: { disable?: boolean }
    dragging?: { disable?: boolean }
    dropping?: { disable?: boolean }
    editing?: { disable?: boolean }
    outline?: { disable?: boolean }
    removing?: { disable?: boolean }
    selecting?: { disable?: boolean }
  }

  // Render feature flags
  renderFlags?: {
    hierarchy?: {
      restrictChildren?: HierarchyRestriction
      restrictParent?: HierarchyRestriction
    }
    styled?: { disable?: boolean }
    elementRef?: { disable?: boolean; innerRef?: boolean }
    propsSchema?: FormSchema
    resolveProps?: ResolveProps<P>
  }

  templates?: AglynComponentElementTemplateData[]
}

export interface AglynComponentElementData {
  readonly $id: string
  readonly componentId: ComponentId
  readonly bundleId?: BundleId
  displayName?: string
  description?: string
  props?: AnyProps
  elements?: AglynComponentElementData[]
}

export interface AglynComponentElementTemplateData {
  readonly id: string
  title: string
  description?: string
  icon?: string
  data: TemplateSubElementData
}

export interface TemplateSubElementData {
  readonly componentId: ComponentId
  readonly bundleId?: BundleId
  elements?: TemplateSubElementData[]
  props?: AnyProps
}
