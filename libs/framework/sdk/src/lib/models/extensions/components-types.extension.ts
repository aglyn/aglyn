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

import { AglynExtensionInstance, AglynType, AglynUniqueId, PayloadData } from '../../types'
import { RestrictFlag } from '../../constants'
import { AnyProps } from '@aglyn/shared/util/types'
// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import { FormSchema } from '@aglyn/shared/ui/react'
import { EXTENSION_TYPE, MODULE_TYPE } from '../../aglyn-symbol'


export interface AglynComponentOptions {
  displayName: string
  title: string
  subtitle: string
  description: string
  icon: unknown
  propsSchema: FormSchema
  defaultProps: AnyProps
  resolveProps: <T>(...args: T[]) => AnyProps
  disableActions: boolean
  disableBadge: boolean
  disableCopying: boolean
  disableDragging: boolean
  disableDropping: boolean
  disableEditing: boolean
  disableNesting: boolean
  disableOutline: boolean
  disableRemoving: boolean
  disableSelecting: boolean
  restrictChildren: [type: RestrictFlag, ids: string[]]
  restrictParents: [type: RestrictFlag, ids: string[]]
}

export interface AglynComponent extends AglynUniqueId,
  AglynType<typeof MODULE_TYPE, typeof EXTENSION_TYPE> {
  options: Partial<AglynComponentOptions>
  <T>(...args: T[]): unknown
}

export interface AglynComponentData extends AglynUniqueId {
  component?: AglynComponent | string
  children?: (AglynComponentData | string)[]
  props: AnyProps
  temporary?: boolean
  parent?: string
  name?: string
  description?: string
}

export type ComponentId = string
export type RegistryEntry = [id: ComponentId, component: AglynComponent]
export type RegistryEntries = RegistryEntry[]
export type RegistryKeys = ComponentId[]
export type RegistryValue = AglynComponent
export type RegistryValues = RegistryValue[]
export type ComponentsRegistry = Map<string, AglynComponent>

export namespace PayloadParams {
  export type Register = PayloadData<{ component: AglynComponent }>
  export type Get = PayloadData<{ componentId: string }>
  export type Delete = PayloadData<{ componentId: string }>
}

export interface AglynComponentsExtension extends AglynExtensionInstance {
  getAllComponentsValues(): RegistryValues
  getAllComponentsKeys(): RegistryKeys
  getAllComponents(): RegistryEntries
  getComponent(payload: PayloadParams.Get): AglynComponent
  registerComponent(payload: PayloadParams.Register): this
  deleteComponent(payload: PayloadParams.Delete): this
}
