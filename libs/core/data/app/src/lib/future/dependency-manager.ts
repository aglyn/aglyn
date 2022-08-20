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

export default class DependencyManager {
  readonly #statusesById: DependencyStatuses = {}
  readonly #dependentsById: DependencyDependents = {}
  readonly #dependenciesById: DependenciesById = {}

  constructor()
  constructor(dependencies: Array<Dependency>)
  constructor(dependencies?: Array<Dependency>) {
    this.#addDependencies(dependencies)
  }

  //region Self Lifecycle
  #addDependencies(dependencies?: Array<Dependency>) {
    const _dependencies = Array.isArray(dependencies) ? dependencies : []
    for (const dependency of _dependencies) {
      this.addDependency(dependency)
    }
  }
  #destroyDependencies() {
    const dependencyIds = Object.keys(this.#dependenciesById)
    for (const id of dependencyIds) {
      this.#removeDependency(id)
    }
  }
  //endregion

  //region Private Getters
  #getDependency(dependencyId: DependencyId): Dependency | undefined {
    return this.#dependenciesById[dependencyId]
  }
  #getDependencyDependents(dependencyId: DependencyId): Dependents | undefined {
    return this.#dependentsById[dependencyId]
  }
  #getDependencyStatus(
    dependencyId: DependencyId,
  ): DependencyStatus | undefined {
    return this.#statusesById[dependencyId]
  }
  //endregion

  //region Private Setters
  #setDependencyProperties(
    dependencyId: DependencyId,
    dependency: Dependency,
  ): this {
    this.#statusesById[dependencyId] = DependencyStatus.WAITING
    this.#dependentsById[dependencyId] ||= {}
    this.#dependenciesById[dependencyId] = dependency
    return this
  }
  #setDependencyDependents(dependencyId: DependencyId): this {
    for (const dependentId of Object.keys(
      this.#getDependency(dependencyId)?.dependencies || {},
    )) {
      const dependents = (this.#dependentsById[dependentId] ||= {})
      dependents[dependencyId] = true
    }
    return this
  }
  #removeDependencyDependents(dependencyId: DependencyId): this {
    for (const dependentId of Object.keys(
      this.#getDependency(dependencyId)?.dependencies || {},
    )) {
      delete this.#dependentsById[dependentId]?.[dependencyId]
    }
    return this
  }
  #removeDependencyProperties(dependencyId: DependencyId): this {
    delete this.#dependentsById[dependencyId]
    delete this.#statusesById[dependencyId]
    delete this.#dependenciesById[dependencyId]
    return this
  }
  //endregion

  //region Private Dependency Guards
  #hasDependency(dependencyId: DependencyId): boolean {
    return Boolean(dependencyId && this.#getDependency(dependencyId))
  }
  #isDependencyWaiting(dependencyId: DependencyId): boolean {
    return this.#getDependencyStatus(dependencyId) === DependencyStatus.WAITING
  }
  #isDependencyLoading(dependencyId: DependencyId): boolean {
    return this.#getDependencyStatus(dependencyId) === DependencyStatus.LOADING
  }
  #isDependencyLoaded(dependencyId: DependencyId): boolean {
    return this.#getDependencyStatus(dependencyId) === DependencyStatus.LOADED
  }
  #isDependencyUnloading(dependencyId: DependencyId): boolean {
    return (
      this.#getDependencyStatus(dependencyId) === DependencyStatus.UNLOADING
    )
  }
  #areAllDependenciesLoaded(dependentId: DependencyId): boolean {
    for (const dependencyId of Object.keys(
      this.#getDependency(dependentId)?.dependencies || {},
    )) {
      if (!this.#isDependencyLoaded(dependencyId)) {
        return false
      }
    }
    return true
  }
  //endregion

  //region Private Dependency Lifecycle
  #loadDependencyDependents(dependencyId: DependencyId): this {
    for (const dependentId of Object.keys(
      this.#getDependencyDependents(dependencyId) || {},
    )) {
      if (!this.#isDependencyLoaded(dependentId)) {
        this.#loadDependencyAndDependents(dependentId)
      }
    }
    return this
  }
  #loadDependency(dependencyId: DependencyId): this {
    if (this.#isDependencyWaiting(dependencyId)) {
      this.#statusesById[dependencyId] = DependencyStatus.LOADING
      this.#getDependency(dependencyId)?.load?.()
      this.#statusesById[dependencyId] = DependencyStatus.LOADED
    }
    return this
  }
  #unloadDependencyDependents(dependencyId: DependencyId): this {
    for (const dependentId of Object.keys(
      this.#getDependencyDependents(dependencyId) || {},
    )) {
      this.#unloadDependencyAndDependents(dependentId)
    }
    return this
  }
  #unloadDependency(dependencyId: DependencyId): this {
    if (this.#isDependencyLoaded(dependencyId)) {
      this.#statusesById[dependencyId] = DependencyStatus.UNLOADING
      this.#getDependency(dependencyId)?.destroy?.()
      this.#statusesById[dependencyId] = DependencyStatus.WAITING
    }
    return this
  }
  //endregion

  //region Private Dependency Handlers
  #handleAddingDependencyAndDependents(dependency: Dependency): this {
    const dependencyId: DependencyId = dependency.id
    if (!dependency) throw new Error('Invalid dependency')
    if (!dependencyId) throw new Error('Invalid dependencyId')
    /**
     * Set properties on local dependencies object
     */
    this.#setDependencyProperties(dependencyId, dependency)
    /**
     * Set dependencies' dependent relationships
     */
    this.#setDependencyDependents(dependencyId)
    /**
     * Load applicable dependencies
     */
    this.#loadDependencyAndDependents(dependencyId)
    return this
  }
  #loadDependencyAndDependents(dependencyId: DependencyId): this {
    if (!this.#hasDependency(dependencyId)) return this
    /**
     * Verify all dependencies are loaded
     */
    if (!this.#areAllDependenciesLoaded(dependencyId)) {
      return this
    }
    /**
     * Load the self dependency
     */
    this.#loadDependency(dependencyId)
    /**
     * Load waiting dependents
     */
    this.#loadDependencyDependents(dependencyId)
    return this
  }
  #unloadDependencyAndDependents(dependencyId: DependencyId): this {
    if (!this.#hasDependency(dependencyId)) return this
    /**
     * Unload all dependents of the dependency
     */
    this.#unloadDependencyDependents(dependencyId)
    /**
     * Unload self dependency
     */
    this.#unloadDependency(dependencyId)
    return this
  }
  #removeDependencyAndDependents(dependencyId: DependencyId): this {
    if (!this.#hasDependency(dependencyId)) return this
    /**
     * Unload dependency and its dependents
     */
    this.#unloadDependencyAndDependents(dependencyId)

    /**
     * Remove dependencies dependent relationships
     */
    this.#removeDependencyDependents(dependencyId)

    /**
     * Remove self from local dependencies property
     */
    this.#removeDependencyProperties(dependencyId)
    return this
  }
  //endregion

  //region Private Add/Remove
  #addDependency(dependency: Dependency): this {
    return this.#handleAddingDependencyAndDependents(dependency)
  }
  #removeDependency(id: DependencyId): this {
    return this.#removeDependencyAndDependents(id)
  }
  //endregion

  /**
   * Loads a dependency and its dependents. Do not call unless necessary.
   * Process flow automatically handles loading/unloading dependency when
   * all required dependencies have been loaded for itself. However, if
   * called should be ok as it checks if dependencies are loaded first.
   * Step 1: Verify all dependencies are loaded Step 2: Load the self
   * dependency Step 3: Load waiting dependents
   */
  public loadDependency(id: DependencyId): this {
    return this.#loadDependencyAndDependents(id)
  }

  /**
   * Unloads a dependency and its dependents. Do not call unless necessary.
   * Process flow automatically handles loading/unloading dependency when
   * all required dependencies have been unloaded for itself. However, if
   * called should be ok as it checks if dependencies are unloaded first.
   * Step 1: Unload all dependents of the dependency Step 2: Unload self
   * dependency
   */
  public unloadDependency(id: DependencyId): this {
    return this.#unloadDependencyAndDependents(id)
  }

  /**
   * Check if the dependency has 'waiting' status
   */
  public isDependencyWaiting(dependencyId: DependencyId): boolean {
    return this.#isDependencyWaiting(dependencyId)
  }

  /**
   * Check if the dependency has 'loading' status
   */
  public isDependencyLoading(dependencyId: DependencyId): boolean {
    return this.#isDependencyLoading(dependencyId)
  }

  /**
   * Check if the dependency has 'loaded' status
   */
  public isDependencyLoaded(dependencyId: DependencyId): boolean {
    return this.#isDependencyLoaded(dependencyId)
  }

  /**
   * Check if the dependency has 'unloaded' status
   */
  public isDependencyUnloading(dependencyId: DependencyId): boolean {
    return this.#isDependencyUnloading(dependencyId)
  }

  /**
   * Adds a new dependency and if dependencies are loaded it loads, then
   * loads checks all waiting dependencies if they can now load as well.
   * Step 1: Set properties on local dependencies object Step 2: Set
   * dependencies' dependent relationships Step 3: Load dependencies
   * waiting with all requirements met
   */
  public addDependency(dependency: Dependency): this {
    return this.#addDependency(dependency)
  }

  /**
   * Adds multiple dependencies
   */
  public addDependencies(dependencies: Array<Dependency>) {
    this.addDependencies(dependencies)
  }

  /**
   * Get a copy of the local dependency object
   */
  public getDependency(
    dependencyId: DependencyId,
  ): Readonly<Dependency> | undefined {
    const dependency = this.#getDependency(dependencyId)
    return dependency ? { ...dependency } : undefined
  }

  /**
   * Unloads all dependency dependents and then removes the dependency.
   * Step 1: Unload dependency and its dependents
   * Step 2: Remove dependencies dependent relationships
   * Step 3: Remove self from local dependencies property
   */
  public removeDependency(id: DependencyId): this {
    return this.#removeDependency(id)
  }

  /**
   * Breaks down and removes all dependencies
   */
  public destroyDependencies() {
    this.#destroyDependencies()
  }
}
