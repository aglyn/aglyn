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

export enum DependencyStatus {
  WAITING = 'waiting',
  LOADING = 'loading',
  LOADED = 'loaded',
  UNLOADING = 'unloading',
}

export type DependencyId = string
export type DependencyStatuses = Record<DependencyId, DependencyStatus>
export type DependenciesById = Record<DependencyId, Dependency>
export type DependencyDependencies = Record<DependencyId, true>
export type Dependents = Record<DependencyId, true>
export type DependencyDependents = Record<DependencyId, Dependents>

export interface Dependency {
  id: DependencyId
  dependencies?: DependencyDependencies
  load(...args: any[]): void
  destroy(...args: any[]): void
}

export const dependencies: DependenciesById = {}
export const dependencyStatusById: DependencyStatuses = {}
export const dependencyDependentsById: DependencyDependents = {}

export function getDependency(
  dependencyId: DependencyId,
): Dependency | undefined {
  return dependencies[dependencyId]
}

export function getDependencyDependents(
  dependencyId: DependencyId,
): Dependents | undefined {
  return dependencyDependentsById[dependencyId]
}

export function getDependencyStatus(
  dependencyId: DependencyId,
): DependencyStatus | undefined {
  return dependencyStatusById[dependencyId]
}

export function hasDependency(dependencyId: DependencyId): boolean {
  return Boolean(dependencyId && getDependency(dependencyId))
}

export function isDependencyWaiting(dependencyId: DependencyId): boolean {
  return getDependencyStatus(dependencyId) === DependencyStatus.WAITING
}

export function isDependencyLoading(dependencyId: DependencyId): boolean {
  return getDependencyStatus(dependencyId) === DependencyStatus.LOADING
}

export function isDependencyLoaded(dependencyId: DependencyId): boolean {
  return getDependencyStatus(dependencyId) === DependencyStatus.LOADED
}

export function isDependencyUnloading(dependencyId: DependencyId): boolean {
  return getDependencyStatus(dependencyId) === DependencyStatus.UNLOADING
}

export function areAllDependenciesLoaded(dependentId: DependencyId): boolean {
  for (const dependencyId of Object.keys(
    getDependency(dependentId)?.dependencies || {},
  )) {
    if (!isDependencyLoaded(dependencyId)) {
      return false
    }
  }
  return true
}

export function addDependency(dependency: Dependency) {
  return handleAddingDependencyAndDependents(dependency)
}

export function addDependencies(dependencies?: Array<Dependency>) {
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

export function removeDependency(id: DependencyId) {
  return handleRemovingDependencyAndDependents(id)
}

export function loadDependency(id: DependencyId) {
  return handleLoadingDependencyAndDependents(id)
}

export function unloadDependency(id: DependencyId) {
  return handleUnloadingDependencyAndDependents(id)
}

export function getDependencyCopy(
  dependencyId: DependencyId,
): Readonly<Dependency> | undefined {
  const dependency = getDependency(dependencyId)
  return dependency ? { ...dependency } : undefined
}

//     ____       _             __
//    / __ \_____(_)   ______ _/ /____
//   / /_/ / ___/ / | / / __ `/ __/ _ \
//  / ____/ /  / /| |/ / /_/ / /_/  __/
// /_/   /_/  /_/ |___/\__,_/\__/\___/
// 👇

function handleSettingDependencyProperties(
  dependencyId: DependencyId,
  dependency: Dependency,
) {
  dependencyStatusById[dependencyId] = DependencyStatus.WAITING
  dependencyDependentsById[dependencyId] ||= {}
  dependencies[dependencyId] = dependency
  return
}

function handleSettingDependencyDependents(dependencyId: DependencyId) {
  for (const dependentId of Object.keys(
    getDependency(dependencyId)?.dependencies || {},
  )) {
    const dependents = (dependencyDependentsById[dependentId] ||= {})
    dependents[dependencyId] = true
  }
  return
}

function handleRemovingDependencyDependents(dependencyId: DependencyId) {
  for (const dependentId of Object.keys(
    getDependency(dependencyId)?.dependencies || {},
  )) {
    delete dependencyDependentsById[dependentId]?.[dependencyId]
  }
  return
}

function handleRemovingDependencyProperties(dependencyId: DependencyId) {
  delete dependencyDependentsById[dependencyId]
  delete dependencyStatusById[dependencyId]
  delete dependencies[dependencyId]
  return
}

function handleLoadingDependencyDependents(dependencyId: DependencyId) {
  for (const dependentId of Object.keys(
    getDependencyDependents(dependencyId) || {},
  )) {
    if (!isDependencyLoaded(dependentId)) {
      handleLoadingDependencyAndDependents(dependentId)
    }
  }
  return
}

function handleLoadingDependency(dependencyId: DependencyId) {
  if (isDependencyWaiting(dependencyId)) {
    dependencyStatusById[dependencyId] = DependencyStatus.LOADING
    getDependency(dependencyId)?.load?.()
    dependencyStatusById[dependencyId] = DependencyStatus.LOADED
  }
  return
}

function handleUnloadingDependencyDependents(dependencyId: DependencyId) {
  for (const dependentId of Object.keys(
    getDependencyDependents(dependencyId) || {},
  )) {
    handleUnloadingDependencyAndDependents(dependentId)
  }
  return
}

function handleUnloadingDependency(dependencyId: DependencyId) {
  if (isDependencyLoaded(dependencyId)) {
    dependencyStatusById[dependencyId] = DependencyStatus.UNLOADING
    getDependency(dependencyId)?.destroy?.()
    dependencyStatusById[dependencyId] = DependencyStatus.WAITING
  }
  return
}

function handleAddingDependencyAndDependents(dependency: Dependency) {
  const dependencyId: DependencyId = dependency.id
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

function handleLoadingDependencyAndDependents(dependencyId: DependencyId) {
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

function handleUnloadingDependencyAndDependents(dependencyId: DependencyId) {
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

function handleRemovingDependencyAndDependents(dependencyId: DependencyId) {
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
