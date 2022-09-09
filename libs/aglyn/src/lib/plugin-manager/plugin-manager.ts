/**
 * @license
 * Copyright 2022 Aglyn LLC
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

// eslint-disable-next-line @nrwl/nx/enforce-module-boundaries
import { MdiIconProps } from '@aglyn/shared-ui-mdi-jsx'
import { _hasOwnProperty } from '@aglyn/shared-util-guards'
import { AglynEvent, emitter, lifecycleEvent } from '../emit-manager'

export enum PluginStatus {
  WAITING = 'waiting',
  LOADING = 'loading',
  LOADED = 'loaded',
  UNLOADING = 'unloading',
}

export type PluginId = string
export type PluginStatusById = Record<PluginId, PluginStatus>
export type PluginsById = Record<PluginId, Plugin>
export type PluginDependencies = Record<PluginId, true>
export type Dependents = Record<PluginId, true>
export type PluginDependents = Record<PluginId, Dependents>

export interface Plugin {
  id?: PluginId
  info?: {
    displayName?: string
    title?: string
    subtitle?: string
    description?: string
    icon?: MdiIconProps
  }
  dependencies?: PluginDependencies
  load?(...args: any[]): void
  destroy?(...args: any[]): void
}

export const bundles: Record<PluginId, Plugin> = {}

emitter.on(AglynEvent.BUNDLE_REGISTER, ({ bundle }) => {
  registerBundle(bundle)
})
emitter.on(AglynEvent.BUNDLE_UNREGISTER, ({ bundleId }) => {
  unregisterBundle(bundleId)
})

export function getBundle(bundleId: PluginId) {
  return bundles[bundleId]
}

export function hasBundle(bundleId: PluginId) {
  return bundleId && _hasOwnProperty(bundleId, bundles)
}

export function registerBundle(schema: Plugin) {
  const { id: pluginId } = schema
  lifecycleEvent(
    () => {
      bundles[pluginId] = schema
      // for (const preset of schema.presets || []) {
      //   emitter.emit(AglynEvent.PRESET_REGISTER, { preset })
      // }
    },
    {
      beforeEvent: AglynEvent.BUNDLE_REGISTERING,
      beforePayload: [{ schema }],
      afterEvent: AglynEvent.BUNDLE_REGISTERED,
      afterPayload: [{ schema }],
    },
  )
}

export function unregisterBundle(bundleId: PluginId) {
  const bundle = bundles[bundleId]
  lifecycleEvent(
    () => {
      if (!bundle) throw new Error(`No bundle exists with ID ${bundleId}`)

      // for (const componentId of bundle.componentIds || []) {
      //   emitter.emit(AglynEvent.COMPONENT_UNREGISTER, { componentId, bundleId })
      // }
      delete bundles[bundleId]
    },
    {
      beforeEvent: AglynEvent.BUNDLE_UNREGISTERING,
      beforePayload: [{ bundleId }],
      afterEvent: AglynEvent.BUNDLE_UNREGISTERED,
      afterPayload: [{ bundleId }],
    },
  )
}

//     ____  __________  _______   _______________________
//    / __ \/ ____/ __ \/ ____/ | / / ____/  _/ ____/ ___/
//   / / / / __/ / /_/ / __/ /  |/ / /    / // __/  \__ \
//  / /_/ / /___/ ____/ /___/ /|  / /____/ // /___ ___/ /
// /_____/_____/_/   /_____/_/ |_/\____/___/_____//____/
//

export const dependencies: PluginsById = {}
export const dependencyStatusById: PluginStatusById = {}
export const dependencyDependentsById: PluginDependents = {}

export function getDependency(dependencyId: PluginId): Plugin | undefined {
  return dependencies[dependencyId]
}

export function getDependencyDependents(
  dependencyId: PluginId,
): Dependents | undefined {
  return dependencyDependentsById[dependencyId]
}

export function getDependencyStatus(
  dependencyId: PluginId,
): PluginStatus | undefined {
  return dependencyStatusById[dependencyId]
}

export function hasDependency(dependencyId: PluginId): boolean {
  return Boolean(dependencyId && getDependency(dependencyId))
}

export function isDependencyWaiting(dependencyId: PluginId): boolean {
  return getDependencyStatus(dependencyId) === PluginStatus.WAITING
}

export function isDependencyLoading(dependencyId: PluginId): boolean {
  return getDependencyStatus(dependencyId) === PluginStatus.LOADING
}

export function isDependencyLoaded(dependencyId: PluginId): boolean {
  return getDependencyStatus(dependencyId) === PluginStatus.LOADED
}

export function isDependencyUnloading(dependencyId: PluginId): boolean {
  return getDependencyStatus(dependencyId) === PluginStatus.UNLOADING
}

export function areAllDependenciesLoaded(dependentId: PluginId): boolean {
  for (const dependencyId of Object.keys(
    getDependency(dependentId)?.dependencies || {},
  )) {
    if (!isDependencyLoaded(dependencyId)) {
      return false
    }
  }
  return true
}

export function addDependency(dependency: Plugin) {
  return handleAddingDependencyAndDependents(dependency)
}

export function addDependencies(dependencies?: Array<Plugin>) {
  const _dependencies = Array.isArray(dependencies) ? dependencies : []
  for (const dependency of _dependencies) {
    addDependency(dependency)
  }
}

export function destroyDependencies() {
  const dependencyIds = Object.keys(dependencies)
  for (const id of dependencyIds) {
    removeDependency(id)
  }
}

export function removeDependency(id: PluginId) {
  return handleRemovingDependencyAndDependents(id)
}

export function loadDependency(id: PluginId) {
  return handleLoadingDependencyAndDependents(id)
}

export function unloadDependency(id: PluginId) {
  return handleUnloadingDependencyAndDependents(id)
}

export function getDependencyCopy(
  dependencyId: PluginId,
): Readonly<Plugin> | undefined {
  const dependency = getDependency(dependencyId)
  return dependency ? { ...dependency } : undefined
}

//     ____  __________  _____             ____ _    ________
//    / __ \/ ____/ __ \/ ___/            / __ \ |  / /_  __/
//   / / / / __/ / /_/ /\__ \   ______   / /_/ / | / / / /
//  / /_/ / /___/ ____/___/ /  /_____/  / ____/| |/ / / /
// /_____/_____/_/    /____/           /_/     |___/ /_/
// 👇

function handleSettingDependencyProperties(
  dependencyId: PluginId,
  dependency: Plugin,
) {
  dependencyStatusById[dependencyId] = PluginStatus.WAITING
  dependencyDependentsById[dependencyId] ||= {}
  dependencies[dependencyId] = dependency
  return
}

function handleSettingDependencyDependents(dependencyId: PluginId) {
  for (const dependentId of Object.keys(
    getDependency(dependencyId)?.dependencies || {},
  )) {
    const dependents = (dependencyDependentsById[dependentId] ||= {})
    dependents[dependencyId] = true
  }
  return
}

function handleRemovingDependencyDependents(dependencyId: PluginId) {
  for (const dependentId of Object.keys(
    getDependency(dependencyId)?.dependencies || {},
  )) {
    delete dependencyDependentsById[dependentId]?.[dependencyId]
  }
  return
}

function handleRemovingDependencyProperties(dependencyId: PluginId) {
  delete dependencyDependentsById[dependencyId]
  delete dependencyStatusById[dependencyId]
  delete dependencies[dependencyId]
  return
}

function handleLoadingDependencyDependents(dependencyId: PluginId) {
  for (const dependentId of Object.keys(
    getDependencyDependents(dependencyId) || {},
  )) {
    if (!isDependencyLoaded(dependentId)) {
      handleLoadingDependencyAndDependents(dependentId)
    }
  }
  return
}

function handleLoadingDependency(dependencyId: PluginId) {
  if (isDependencyWaiting(dependencyId)) {
    dependencyStatusById[dependencyId] = PluginStatus.LOADING
    getDependency(dependencyId)?.load?.()
    dependencyStatusById[dependencyId] = PluginStatus.LOADED
  }
  return
}

function handleUnloadingDependencyDependents(dependencyId: PluginId) {
  for (const dependentId of Object.keys(
    getDependencyDependents(dependencyId) || {},
  )) {
    handleUnloadingDependencyAndDependents(dependentId)
  }
  return
}

function handleUnloadingDependency(dependencyId: PluginId) {
  if (isDependencyLoaded(dependencyId)) {
    dependencyStatusById[dependencyId] = PluginStatus.UNLOADING
    getDependency(dependencyId)?.destroy?.()
    dependencyStatusById[dependencyId] = PluginStatus.WAITING
  }
  return
}

function handleAddingDependencyAndDependents(dependency: Plugin) {
  const dependencyId: PluginId = dependency.id
  if (!dependency) throw new Error('Invalid dependency')
  if (!dependencyId) throw new Error('Invalid dependencyId')
  /**
   * Set properties on local dependencies object
   */
  handleSettingDependencyProperties(dependencyId, dependency)
  /**
   * Set dependencies' dependent relationships
   */
  handleSettingDependencyDependents(dependencyId)
  /**
   * Load applicable dependencies
   */
  handleLoadingDependencyAndDependents(dependencyId)
  return
}

function handleLoadingDependencyAndDependents(dependencyId: PluginId) {
  if (!hasDependency(dependencyId)) return
  /**
   * Verify all dependencies are loaded
   */
  if (!areAllDependenciesLoaded(dependencyId)) return
  /**
   * Load the self dependency
   */
  handleLoadingDependency(dependencyId)
  /**
   * Load waiting dependents
   */
  handleLoadingDependencyDependents(dependencyId)
  return
}

function handleUnloadingDependencyAndDependents(dependencyId: PluginId) {
  if (!hasDependency(dependencyId)) return
  /**
   * Unload all dependents of the dependency
   */
  handleUnloadingDependencyDependents(dependencyId)
  /**
   * Unload self dependency
   */
  handleUnloadingDependency(dependencyId)
  return
}

function handleRemovingDependencyAndDependents(dependencyId: PluginId) {
  if (!hasDependency(dependencyId)) return
  /**
   * Unload dependency and its dependents
   */
  handleUnloadingDependencyAndDependents(dependencyId)

  /**
   * Remove dependencies dependent relationships
   */
  handleRemovingDependencyDependents(dependencyId)

  /**
   * Remove self from local dependencies property
   */
  handleRemovingDependencyProperties(dependencyId)
  return
}
