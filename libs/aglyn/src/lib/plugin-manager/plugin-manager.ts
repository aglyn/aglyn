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

import type { MdiIconProps } from '../types/nodes'
import { makeAutoObservable } from 'mobx'
import { type Aglyn, lifecycleEvent } from '../aglyn'
import { AglynEvent } from '../emit-manager'

export enum PluginStatus {
  WAITING = 'waiting',
  LOADING = 'loading',
  LOADED = 'loaded',
  UNLOADING = 'unloading',
}

import type { PluginId } from '../foundation'
export type { PluginId }
export type PluginStatusById = Record<PluginId, PluginStatus>
export type PluginsById = Record<PluginId, Plugin>
export type PluginDependencies = Record<PluginId, true>
export type Dependents = Record<PluginId, true>
export type PluginDependents = Record<PluginId, Dependents>

export interface Plugin {
  $id?: PluginId
  displayName?: string
  title?: string
  subtitle?: string
  description?: string
  icon?: MdiIconProps
  dependencies?: PluginDependencies
  load?(...args: any[]): void
  destroy?(...args: any[]): void
}

// export const plugins: Record<PluginId, Plugin> = {}
//
// export function getBundle(pluginId: PluginId) {
//   return plugins[pluginId]
// }
//
// export function hasBundle(pluginId: PluginId) {
//   return pluginId && _hasOwnProperty(pluginId, plugins)
// }
//
// export function registerBundle(schema: Plugin) {
//   const { $id: pluginId } = schema
//   lifecycleEvent(
//     () => {
//       addDependency(schema)
//       plugins[pluginId] = schema
//       // for (const preset of schema.presets || []) {
//       //   emitter.emit(AglynEvent.PRESET_REGISTER, { preset })
//       // }
//     },
//     {
//       beforeEvent: AglynEvent.PLUGIN_REGISTERING,
//       beforePayload: [{ schema }],
//       afterEvent: AglynEvent.PLUGIN_REGISTERED,
//       afterPayload: [{ schema }],
//     },
//   )
// }
//
// export function unregisterBundle(pluginId: PluginId) {
//   const bundle = plugins[pluginId]
//   lifecycleEvent(
//     () => {
//       if (!bundle) throw new Error(`No bundle exists with $id ${pluginId}`)
//
//       // for (const componentId of bundle.componentIds || []) {
//       //   emitter.emit(AglynEvent.COMPONENT_UNREGISTER, { componentId, pluginId })
//       // }
//       delete plugins[pluginId]
//     },
//     {
//       beforeEvent: AglynEvent.PLUGIN_UNREGISTERING,
//       beforePayload: [{ pluginId }],
//       afterEvent: AglynEvent.PLUGIN_UNREGISTERED,
//       afterPayload: [{ pluginId }],
//     },
//   )
// }

export class PluginManager {
  //     ____  __________  _______   _______________________
  //    / __ \/ ____/ __ \/ ____/ | / / ____/  _/ ____/ ___/
  //   / / / / __/ / /_/ / __/ /  |/ / /    / // __/  \__ \
  //  / /_/ / /___/ ____/ /___/ /|  / /____/ // /___ ___/ /
  // /_____/_____/_/   /_____/_/ |_/\____/___/_____//____/
  //

  public dependencies: PluginsById = {}
  public dependencyStatusById: PluginStatusById = {}
  public dependencyDependentsById: PluginDependents = {}

  constructor(protected aglyn?: Aglyn) {
    makeAutoObservable(this)
  }

  public getDependency(dependencyId: PluginId): Plugin | undefined {
    return this.dependencies[dependencyId]
  }

  public getDependencyDependents(
    dependencyId: PluginId,
  ): Dependents | undefined {
    return this.dependencyDependentsById[dependencyId]
  }

  public getDependencyStatus(dependencyId: PluginId): PluginStatus | undefined {
    return this.dependencyStatusById[dependencyId]
  }

  public hasDependency(dependencyId: PluginId): boolean {
    return Boolean(dependencyId && this.getDependency(dependencyId))
  }

  public isDependencyWaiting(dependencyId: PluginId): boolean {
    return this.getDependencyStatus(dependencyId) === PluginStatus.WAITING
  }

  public isDependencyLoading(dependencyId: PluginId): boolean {
    return this.getDependencyStatus(dependencyId) === PluginStatus.LOADING
  }

  public isDependencyLoaded(dependencyId: PluginId): boolean {
    return this.getDependencyStatus(dependencyId) === PluginStatus.LOADED
  }

  public isDependencyUnloading(dependencyId: PluginId): boolean {
    return this.getDependencyStatus(dependencyId) === PluginStatus.UNLOADING
  }

  public areAllDependenciesLoaded(dependentId: PluginId): boolean {
    for (const dependencyId of Object.keys(
      this.getDependency(dependentId)?.dependencies || {},
    )) {
      if (!this.isDependencyLoaded(dependencyId)) {
        return false
      }
    }
    return true
  }

  public addDependency(dependency: Plugin) {
    lifecycleEvent(
      () => {
        this.handleAddingDependencyAndDependents(dependency)
      },
      {
        beforeEvent: AglynEvent.PLUGIN_REGISTERING,
        beforePayload: [{ schema: dependency }],
        afterEvent: AglynEvent.PLUGIN_REGISTERED,
        afterPayload: [{ schema: dependency }],
      },
    )
    return
  }

  public addDependencies(dependencies?: Array<Plugin>) {
    const _dependencies = Array.isArray(dependencies) ? dependencies : []
    for (const dependency of _dependencies) {
      this.addDependency(dependency)
    }
  }

  public destroyDependencies() {
    const dependencyIds = Object.keys(this.dependencies)
    for (const $id of dependencyIds) {
      this.removeDependency($id)
    }
  }

  public removeDependency($id: PluginId) {
    lifecycleEvent(
      () => {
        this.handleRemovingDependencyAndDependents($id)
      },
      {
        beforeEvent: AglynEvent.PLUGIN_UNREGISTERING,
        beforePayload: [{ $id }],
        afterEvent: AglynEvent.PLUGIN_UNREGISTERED,
        afterPayload: [{ $id }],
      },
    )
    return
  }

  public loadDependency($id: PluginId) {
    return this.handleLoadingDependencyAndDependents($id)
  }

  public unloadDependency($id: PluginId) {
    return this.handleUnloadingDependencyAndDependents($id)
  }

  public getDependencyCopy(
    dependencyId: PluginId,
  ): Readonly<Plugin> | undefined {
    const dependency = this.getDependency(dependencyId)
    return dependency ? { ...dependency } : undefined
  }

  //     ____  __________  _____             ____ _    ________
  //    / __ \/ ____/ __ \/ ___/            / __ \ |  / /_  __/
  //   / / / / __/ / /_/ /\__ \   ______   / /_/ / | / / / /
  //  / /_/ / /___/ ____/___/ /  /_____/  / ____/| |/ / / /
  // /_____/_____/_/    /____/           /_/     |___/ /_/
  // 👇

  private handleSettingDependencyProperties(
    dependencyId: PluginId,
    dependency: Plugin,
  ) {
    this.dependencyStatusById[dependencyId] = PluginStatus.WAITING
    this.dependencyDependentsById[dependencyId] ||= {}
    this.dependencies[dependencyId] = dependency
    return
  }

  private handleSettingDependencyDependents(dependencyId: PluginId) {
    for (const dependentId of Object.keys(
      this.getDependency(dependencyId)?.dependencies || {},
    )) {
      const dependents = (this.dependencyDependentsById[dependentId] ||= {})
      dependents[dependencyId] = true
    }
    return
  }

  private handleRemovingDependencyDependents(dependencyId: PluginId) {
    for (const dependentId of Object.keys(
      this.getDependency(dependencyId)?.dependencies || {},
    )) {
      delete this.dependencyDependentsById[dependentId]?.[dependencyId]
    }
    return
  }

  private handleRemovingDependencyProperties(dependencyId: PluginId) {
    delete this.dependencyDependentsById[dependencyId]
    delete this.dependencyStatusById[dependencyId]
    delete this.dependencies[dependencyId]
    return
  }

  private handleLoadingDependencyDependents(dependencyId: PluginId) {
    for (const dependentId of Object.keys(
      this.getDependencyDependents(dependencyId) || {},
    )) {
      if (!this.isDependencyLoaded(dependentId)) {
        this.handleLoadingDependencyAndDependents(dependentId)
      }
    }
    return
  }

  private handleLoadingDependency(dependencyId: PluginId) {
    if (this.isDependencyWaiting(dependencyId)) {
      this.dependencyStatusById[dependencyId] = PluginStatus.LOADING
      this.getDependency(dependencyId)?.load?.()
      this.dependencyStatusById[dependencyId] = PluginStatus.LOADED
    }
    return
  }

  private handleUnloadingDependencyDependents(dependencyId: PluginId) {
    for (const dependentId of Object.keys(
      this.getDependencyDependents(dependencyId) || {},
    )) {
      this.handleUnloadingDependencyAndDependents(dependentId)
    }
    return
  }

  private handleUnloadingDependency(dependencyId: PluginId) {
    if (this.isDependencyLoaded(dependencyId)) {
      this.dependencyStatusById[dependencyId] = PluginStatus.UNLOADING
      this.getDependency(dependencyId)?.destroy?.()
      this.dependencyStatusById[dependencyId] = PluginStatus.WAITING
    }
    return
  }

  private handleAddingDependencyAndDependents(dependency: Plugin) {
    if (!dependency) throw new Error('Invalid dependency')
    const dependencyId: PluginId = dependency.$id
    if (!dependencyId) throw new Error('Invalid dependencyId')
    /**
     * Set properties on local dependencies object
     */
    this.handleSettingDependencyProperties(dependencyId, dependency)
    /**
     * Set dependencies' dependent relationships
     */
    this.handleSettingDependencyDependents(dependencyId)
    /**
     * Load applicable dependencies
     */
    this.handleLoadingDependencyAndDependents(dependencyId)
    return
  }

  private handleLoadingDependencyAndDependents(dependencyId: PluginId) {
    if (!this.hasDependency(dependencyId)) return
    /**
     * Verify all dependencies are loaded
     */
    if (!this.areAllDependenciesLoaded(dependencyId)) return
    /**
     * Load the self dependency
     */
    this.handleLoadingDependency(dependencyId)
    /**
     * Load waiting dependents
     */
    this.handleLoadingDependencyDependents(dependencyId)
    return
  }

  private handleUnloadingDependencyAndDependents(dependencyId: PluginId) {
    if (!this.hasDependency(dependencyId)) return
    /**
     * Unload all dependents of the dependency
     */
    this.handleUnloadingDependencyDependents(dependencyId)
    /**
     * Unload self dependency
     */
    this.handleUnloadingDependency(dependencyId)
    return
  }

  private handleRemovingDependencyAndDependents(dependencyId: PluginId) {
    if (!this.hasDependency(dependencyId)) return
    /**
     * Unload dependency and its dependents
     */
    this.handleUnloadingDependencyAndDependents(dependencyId)

    /**
     * Remove dependencies dependent relationships
     */
    this.handleRemovingDependencyDependents(dependencyId)

    /**
     * Remove self from local dependencies property
     */
    this.handleRemovingDependencyProperties(dependencyId)
    return
  }
}

export default PluginManager
