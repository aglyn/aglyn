/**
 * @license
 * Copyright 2023 Aglyn LLC
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
  type AglynDependency,
  type AglynDependencyMap,
  AglynDependencyStatus,
  type AglynDependencyUid,
  AglynDependents,
  type IAglynDependencyManager,
} from '../../foundation'

const originalMixinSymbol = Symbol('originalMixinSymbol')
const appliedMixinSymbol = Symbol('appliedMixinSymbol')
const cachedApplicationSymbol = Symbol('cachedApplicationSymbol')

interface MixableClass<Instance, Args = any> {
  new (...args: Args[]): Instance
}

/** cacheMixin stores applied-mixin classes on the superclass under a per-mixin symbol key */
type MixinCacheHost = Record<symbol, unknown>

interface MixinFn<Super, New, Ctor extends MixableClass<Super>> {
  (Mixin: Ctor): MixableClass<Super & New, ConstructorParameters<Ctor>>
  [originalMixinSymbol]?: MixinFn<Super, New, Ctor>
  [cachedApplicationSymbol]?: symbol
}

interface AppliedMixinClassMembers<
  Super,
  New,
  Ctor extends MixableClass<Super>,
> {
  [originalMixinSymbol]?: MixinFn<Super, New, Ctor>
}

interface AppliedMixinClassCtor<Super, New, Ctor extends MixableClass<Super>> {
  new (
    ...args: ConstructorParameters<Ctor>
  ): Super & New & AppliedMixinClassMembers<Super, New, Ctor>
}

interface AppliedMixinClass<Super, New, Ctor extends MixableClass<Super>>
  extends AppliedMixinClassMembers<Super, New, Ctor>,
    AppliedMixinClassCtor<Super, New, Ctor> {
  readonly prototype: MixinFn<Super, New, Ctor>
}

function wrapMixin<S, T, C extends MixableClass<S>>(
  Mixin: MixinFn<S, T, C>,
  MixinWrapper: MixinFn<S, T, C>,
): MixinFn<S, T, C> {
  Object.setPrototypeOf(MixinWrapper, Mixin)
  if (!Object.hasOwn(Mixin, originalMixinSymbol)) {
    Mixin[originalMixinSymbol] = Mixin
  }
  return MixinWrapper as unknown as MixinFn<S, T, C>
}
function createMixin<S, T, C extends MixableClass<S>>(Mixin: MixinFn<S, T, C>) {
  return wrapMixin(Mixin, (BaseClass) => {
    const application = Mixin(BaseClass)
    application.prototype[appliedMixinSymbol] = Mixin[originalMixinSymbol]
    return application
  })
}
function checkMixinHasInstance<S, T, C extends MixableClass<S>>(
  Mixin: MixinFn<S, T, C>,
) {
  if (!Symbol.hasInstance) return Mixin
  Object.defineProperty(Mixin, Symbol.hasInstance, {
    value: function (o: { [x: string]: any }) {
      const originalMixin = this[originalMixinSymbol]
      while (o != null) {
        if (
          Object.hasOwn(o, appliedMixinSymbol) &&
          o[appliedMixinSymbol as unknown as string] === originalMixin
        ) {
          return true
        }
        o = Object.getPrototypeOf(o)
      }
      return false
    },
  })
  return Mixin
}

/**
 * @see https://justinfagnani.com/2016/01/07/enhancing-mixins-with-decorator-functions/
 */
function cacheMixin<S, T, C extends MixableClass<S>>(
  Mixin: MixinFn<S, T, C>,
): MixinFn<S, T, C> {
  return wrapMixin(Mixin, (BaseClass) => {
    // Create a symbol used to reference a cached application from a superclass
    let CachedApp = Mixin[cachedApplicationSymbol]
    if (!CachedApp) {
      CachedApp = Mixin[cachedApplicationSymbol] = Symbol(Mixin.name)
    }

    // Look up an cached application of `mixin` to `superclass`
    if (Object.hasOwn(BaseClass, CachedApp)) {
      return (BaseClass as unknown as MixinCacheHost)[
        CachedApp
      ] as ReturnType<MixinFn<S, T, C>>
    }

    // Apply the mixin
    const App = Mixin(BaseClass)

    // Cache the mixin application on the BaseClass
    ;(BaseClass as unknown as MixinCacheHost)[CachedApp] = App

    return App
  })
}

function createCachedMixin<S, T, C extends MixableClass<S>>(
  Mixin: MixinFn<S, T, C>,
): MixinFn<S, T, C> {
  return cacheMixin(checkMixinHasInstance(createMixin(Mixin)))
}

function applyMixins<T extends MixableClass<any>, Ts extends MixableClass<any>>(
  Constructor: T,
  ...constructors: Ts[]
): Ts & T {
  constructors.forEach((ctor) => {
    Object.getOwnPropertyNames(ctor.prototype).forEach((name) => {
      const attributes =
        Object.getOwnPropertyDescriptor(ctor.prototype, name) ||
        Object.create(null)
      Object.defineProperty(Constructor.prototype, name, attributes)
    })
  })
  return Constructor as unknown as T & Ts
}

const dependencyManager = (BaseClass: new (...args: any[]) => any) =>
  (class extends BaseClass implements IAglynDependencyManager {
    readonly _dependencies: AglynDependencyMap = {
      statusByDependencyId: {},
      dependentsByDependencyId: {},
      __: {},
    }

    public get dependencies(): ImmutableSlightlyDeep<AglynDependencyMap> {
      const { statusByDependencyId, dependentsByDependencyId, __ } =
        this._dependencies
      return {
        statusByDependencyId: { ...statusByDependencyId },
        dependentsByDependencyId: { ...dependentsByDependencyId },
        __: { ...__ },
      }
    }

    dependencyInternal(dependencyId: AglynDependencyUid): AglynDependency | undefined {
      return this.dependencies.__[dependencyId]
    }
    dependents(dependencyId: AglynDependencyUid): AglynDependents | undefined {
      return this.dependencies.dependentsByDependencyId[dependencyId]
    }
    dependencyStatus(
      dependencyId: AglynDependencyUid,
    ): AglynDependencyStatus | undefined {
      return this.dependencies.statusByDependencyId[dependencyId]
    }
    hasDependency(dependencyId: AglynDependencyUid): boolean {
      return Boolean(dependencyId && this.dependencyInternal(dependencyId))
    }
    dependencyWaitingInternal(dependencyId: AglynDependencyUid): boolean {
      return (
        this.dependencyStatus(dependencyId) === AglynDependencyStatus.WAITING
      )
    }
    dependencyLoadingInternal(dependencyId: AglynDependencyUid): boolean {
      return (
        this.dependencyStatus(dependencyId) === AglynDependencyStatus.LOADING
      )
    }
    dependencyLoadedInternal(dependencyId: AglynDependencyUid): boolean {
      return (
        this.dependencyStatus(dependencyId) === AglynDependencyStatus.LOADED
      )
    }
    dependencyUnloadingInternal(dependencyId: AglynDependencyUid): boolean {
      return (
        this.dependencyStatus(dependencyId) === AglynDependencyStatus.UNLOADING
      )
    }
    allDependenciesLoaded(dependentId: AglynDependencyUid): boolean {
      for (const dependencyId of Object.keys(
        this.dependencyInternal(dependentId)?.dependencies || {},
      )) {
        if (!this.dependencyLoadedInternal(dependencyId)) {
          return false
        }
      }
      return true
    }
    setSelfDependencyProperties(
      dependencyId: AglynDependencyUid,
      dependency: AglynDependency,
    ): this {
      this._dependencies.statusByDependencyId[dependencyId] =
        AglynDependencyStatus.WAITING
      this._dependencies.dependentsByDependencyId[dependencyId] ||= {}
      this._dependencies.__[dependencyId] = dependency
      return this
    }
    setSelfDependencyDependents(dependencyId: AglynDependencyUid): this {
      for (const dependentId of Object.keys(
        this.dependencyInternal(dependencyId)?.dependencies || {},
      )) {
        const dependents = (this._dependencies.dependentsByDependencyId[
          dependentId
        ] ||= {})
        dependents[dependencyId] = true
      }
      return this
    }
    loadDependencyDependents(dependencyId: AglynDependencyUid): this {
      for (const dependentId of Object.keys(
        this.dependents(dependencyId) || {},
      )) {
        if (!this.dependencyLoadedInternal(dependentId)) {
          this.handleLoadingDependencyAndDependents(dependentId)
        }
      }
      return this
    }
    loadDependencyInternal(dependencyId: AglynDependencyUid): this {
      if (this.dependencyWaitingInternal(dependencyId)) {
        this._dependencies.statusByDependencyId[dependencyId] =
          AglynDependencyStatus.LOADING
        this.dependencyInternal(dependencyId)?.load?.()
        this._dependencies.statusByDependencyId[dependencyId] =
          AglynDependencyStatus.LOADED
      }
      return this
    }
    unloadDependencyDependents(dependencyId: AglynDependencyUid): this {
      for (const dependentId of Object.keys(
        this.dependents(dependencyId) || {},
      )) {
        this.handleUnloadingDependencyAndDependents(dependentId)
      }
      return this
    }
    unloadDependencyInternal(dependencyId: AglynDependencyUid): this {
      if (this.dependencyLoadedInternal(dependencyId)) {
        this._dependencies.statusByDependencyId[dependencyId] =
          AglynDependencyStatus.UNLOADING
        this.dependencyInternal(dependencyId)?.destroy?.()
        this._dependencies.statusByDependencyId[dependencyId] =
          AglynDependencyStatus.WAITING
      }
      return this
    }
    removeSelfDependencyProperties(dependencyId: AglynDependencyUid): this {
      delete this._dependencies.dependentsByDependencyId[dependencyId]
      delete this._dependencies.statusByDependencyId[dependencyId]
      delete this._dependencies.__[dependencyId]
      return this
    }
    removeSelfDependencyDependents(dependencyId: AglynDependencyUid): this {
      for (const dependentId of Object.keys(
        this.dependencyInternal(dependencyId)?.dependencies || {},
      )) {
        delete this._dependencies.dependentsByDependencyId[dependentId]?.[
          dependencyId
        ]
      }
      return this
    }

    handleAddingDependencyAndDependents(
      dependencyId: AglynDependencyUid,
      dependency: AglynDependency,
    ): this {
      if (!dependency) throw new Error('Invalid dependency')
      if (!dependencyId) throw new Error('Invalid dependencyId')
      /**
       * Set properties on local dependencies object
       */
      this.setSelfDependencyProperties(dependencyId, dependency)
      /**
       * Set dependencies' dependent relationships
       */
      this.setSelfDependencyDependents(dependencyId)
      /**
       * Load applicable dependencies
       */
      this.handleLoadingDependencyAndDependents(dependencyId)
      return this
    }
    handleLoadingDependencyAndDependents(
      dependencyId: AglynDependencyUid,
    ): this {
      if (!this.hasDependency(dependencyId)) return this
      /**
       * Verify all dependencies are loaded
       */
      if (!this.allDependenciesLoaded(dependencyId)) {
        return this
      }
      /**
       * Load the self dependency
       */
      this.loadDependencyInternal(dependencyId)
      /**
       * Load waiting dependents
       */
      this.loadDependencyDependents(dependencyId)
      return this
    }
    handleUnloadingDependencyAndDependents(
      dependencyId: AglynDependencyUid,
    ): this {
      if (!this.hasDependency(dependencyId)) return this
      /**
       * Unload all dependents of the dependency
       */
      this.unloadDependencyDependents(dependencyId)
      /**
       * Unload self dependency
       */
      this.unloadDependencyInternal(dependencyId)
      return this
    }
    handleRemovingDependencyAndDependents(
      dependencyId: AglynDependencyUid,
    ): this {
      if (!this.hasDependency(dependencyId)) return this
      /**
       * Unload dependency and its dependents
       */
      this.handleUnloadingDependencyAndDependents(dependencyId)

      /**
       * Remove dependencies dependent relationships
       */
      this.removeSelfDependencyDependents(dependencyId)

      /**
       * Remove self from local dependencies property
       */
      this.removeSelfDependencyProperties(dependencyId)
      return this
    }

    /**
     * Check if the dependency has 'waiting' status
     */
    public dependencyWaiting(dependencyId: AglynDependencyUid): boolean {
      return this.dependencyWaitingInternal(dependencyId)
    }
    /**
     * Check if the dependency has 'loading' status
     */
    public dependencyLoading(dependencyId: AglynDependencyUid): boolean {
      return this.dependencyLoadingInternal(dependencyId)
    }
    /**
     * Check if the dependency has 'loaded' status
     */
    public dependencyLoaded(dependencyId: AglynDependencyUid): boolean {
      return this.dependencyLoadedInternal(dependencyId)
    }
    /**
     * Check if the dependency has 'unloaded' status
     */
    public dependencyUnloading(dependencyId: AglynDependencyUid): boolean {
      return this.dependencyUnloadingInternal(dependencyId)
    }
    /**
     * Get a copy of the local dependency object
     */
    public dependency(
      dependencyId: AglynDependencyUid,
    ): Readonly<AglynDependency> | undefined {
      const dependency = this.dependencyInternal(dependencyId)
      return dependency ? { ...dependency } : undefined
    }

    /**
     * Adds a new dependency and if dependencies are loaded it loads, then
     * loads checks all waiting dependencies if they can now load as well.
     * Step 1: Set properties on local dependencies object Step 2: Set
     * dependencies' dependent relationships Step 3: Load dependencies
     * waiting with all requirements met
     */
    public addDependency(dependency: AglynDependency): this {
      return this.handleAddingDependencyAndDependents(
        dependency?.namespace,
        dependency,
      )
    }

    /**
     * Loads a dependency and its dependents. Do not call unless necessary.
     * Process flow automatically handles loading/unloading dependency when
     * all required dependencies have been loaded for itself. However, if
     * called should be ok as it checks if dependencies are loaded first.
     * Step 1: Verify all dependencies are loaded Step 2: Load the self
     * dependency Step 3: Load waiting dependents
     */
    public loadDependency(id: AglynDependencyUid): this {
      return this.handleLoadingDependencyAndDependents(id)
    }

    /**
     * Unloads a dependency and its dependents. Do not call unless necessary.
     * Process flow automatically handles loading/unloading dependency when
     * all required dependencies have been unloaded for itself. However, if
     * called should be ok as it checks if dependencies are unloaded first.
     * Step 1: Unload all dependents of the dependency Step 2: Unload self
     * dependency
     */
    public unloadDependency(id: AglynDependencyUid): this {
      return this.handleUnloadingDependencyAndDependents(id)
    }

    /**
     * Unloads all dependency dependents and then removes the dependency.
     * Step 1: Unload dependency and its dependents
     * Step 2: Remove dependencies dependent relationships
     * Step 3: Remove self from local dependencies property
     */
    public removeDependency(id: AglynDependencyUid): this {
      return this.handleRemovingDependencyAndDependents(id)
    }
  })

function AglynDependencyManager<Instance>(
  Constructor: MixableClass<Instance>,
): AppliedMixinClass<
  Instance,
  ReturnType<typeof dependencyManager>,
  MixableClass<Instance>
> {
  return createCachedMixin<
    Instance,
    ReturnType<typeof dependencyManager>,
    MixableClass<Instance>
  >((Super) => {
    return dependencyManager(Super) as any
  })(Constructor)
}

export default AglynDependencyManager
