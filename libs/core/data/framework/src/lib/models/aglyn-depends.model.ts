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

import {_hasOwnProperty} from '@aglyn/shared-util-guards'
import {
  type AglynDependency,
  type AglynDependencyMap,
  AglynDependencyStatus,
  type AglynDependencyUid,
  type IAglynDependencyManager,
} from '../types/aglyn-depends.types'


type Mixin<S, T, C extends new (...args: any[]) => T> = {
  [_originalMixin]?: Mixin<S, T, C>
  new(...any: ConstructorParameters<C>): S & T & {[_mixinRef]?: Mixin<S, T, C>}
}
type MixinWrapper<S, T, C extends new (...args: any[]) => T> = (mixin: C) => Mixin<S, T, C>

const _originalMixin = Symbol('_originalMixin')
const _mixinRef = Symbol('_mixinRef')
const _cachedApplicationRef = Symbol('_cachedApplicationRef')

const wrap = <S, T, C extends new (...args: any[]) => T>(
  mixin: MixinWrapper<S, T, C>,
  wrapper,//: MixinWrapper<S, T, C>,
) => {
  Object.setPrototypeOf(wrapper, mixin)
  if (!mixin[_originalMixin]) {
    mixin[_originalMixin] = mixin
  }
  return wrapper
}
const createMixin = (
  mixin,
) => wrap(mixin, (superclass) => {
  const application = mixin(superclass)
  application.prototype[_mixinRef] = mixin[_originalMixin]
  return application
})
const mixinHasInstance = (mixin) => {
  if (!Symbol.hasInstance) {
    return mixin
  }
  mixin[Symbol.hasInstance] = function(o) {
    const originalMixin = this[_originalMixin]
    while (o != null) {
      if (_hasOwnProperty(_mixinRef, o) && o[_mixinRef] === originalMixin) {
        return true
      }
      o = Object.getPrototypeOf(o)
    }
    return false
  }
  return mixin
}

/**
 * @see https://justinfagnani.com/2016/01/07/enhancing-mixins-with-decorator-functions/
 */
const cacheMixin = (mixin) => wrap(mixin, (superclass) => {
  // Create a symbol used to reference a cached application from a superclass
  let applicationRef = mixin[_cachedApplicationRef]
  if (!applicationRef) {
    applicationRef = mixin[_cachedApplicationRef] = Symbol(mixin.name)
  }

  // Look up an cached application of `mixin` to `superclass`
  if (_hasOwnProperty(applicationRef, superclass)) {
    return superclass[applicationRef]
  }

  // Apply the mixin
  const application = mixin(superclass)

  // Cache the mixin application on the superclass
  superclass[applicationRef] = application

  return application
})

const createCachedMixin = (mixin) => cacheMixin(mixinHasInstance(createMixin(mixin)))

const AglynDependencyManager = createCachedMixin((superclass) => class extends superclass implements IAglynDependencyManager {

  public readonly dependencies: Readonly<AglynDependencyMap> = {
    status: {},
    dependents: {},
    __: {},
  }

  public dependencyLoaded(id: AglynDependencyUid): boolean {
    return this.dependencies.status[id] === AglynDependencyStatus.LOADED
  }
  public dependencyWaiting(id: AglynDependencyUid): boolean {
    return this.dependencies.status[id] === AglynDependencyStatus.WAITING
  }
  public getDependency(id: AglynDependencyUid): AglynDependency | undefined {
    return this.dependencies.__[id]
  }

  public __unloadDependency__(id: AglynDependencyUid): this {
    const dependency = this.dependencies.__[id]
    if (!dependency) return this
    for (const dependentId of Object.keys(this.dependencies.dependents[id] || {})) {
      this.__unloadDependency__(dependentId)
    }
    dependency.destroy()
    this.dependencies.status[id] = AglynDependencyStatus.WAITING
    return this
  }

  public __loadDependency__(id: AglynDependencyUid): this {
    const dependency = this.dependencies.__[id]
    if (!dependency) return this
    // Verify all dependencies are loaded
    for (const dependencyId of Object.keys(dependency.dependencies[id] || {})) {
      if (this.dependencies.status[dependencyId] !== AglynDependencyStatus.LOADED) {
        return this
      }
    }
    this.dependencies.status[id] = AglynDependencyStatus.LOADED
    dependency.load()
    // Load waiting dependents
    for (const dependentId of Object.keys(this.dependencies.dependents[id] || {})) {
      if (this.dependencies.status[dependentId] !== AglynDependencyStatus.LOADED) {
        this.__loadDependency__(dependentId)
      }
    }
    return this
  }

  public removeDependency(id: AglynDependencyUid): this {
    const dependency = this.dependencies.__[id]
    if (!dependency) return this
    this.__unloadDependency__(id)
    // Remove dependencies dependent relationships
    for (const dependentId of Object.keys(dependency.dependencies || {})) {
      delete this.dependencies.dependents[dependentId]?.[id]
    }
    delete this.dependencies.dependents[id]
    delete this.dependencies.status[id]
    delete this.dependencies.__[id]
    return this
  }

  public addDependency(dependency: AglynDependency): this {
    const id = dependency.id
    this.dependencies.status[id] = AglynDependencyStatus.WAITING
    ;(this.dependencies.dependents[id] ||= {})
    this.dependencies.__[id] = dependency
    // Add dependencies dependent relationships
    for (const dependencyId of Object.keys(dependency.dependencies || {})) {
      ;(this.dependencies.dependents[dependencyId] ||= {})[id] = true
    }
    return this.__loadDependency__(id)
  }
})

export default AglynDependencyManager
