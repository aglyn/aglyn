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

import type { LogLevelString } from '@aglyn/shared-util-logger'
import type { ITimestamp } from '@aglyn/shared-util-timestamp'
import type { AglynEmitter } from '../constants/emitter'
import type { AglynErrorFactory } from '../constants/error'
import type { AglynLogger } from '../constants/logger'

export type Payload<T = any> = { payload: T }
export type PayloadData<T extends Dictionary = any> = T
export type PayloadParams<T> = { [K in keyof T]: T[K] }

export type AglynUniqueId<T extends boolean = false> = T extends boolean
  ? T extends true
    ? { getId(): string }
    : { readonly $id: string }
  : never

/** Observers to handle life cycle onInit/onDestroy events */
export interface AglynLifecycleObserver<T = any> {
  /**
   * Should be invoked once immediately after instantiation
   */
  onInitialize?(props?: T): void
  /**
   * Should be invoked once as last step before garbage collection
   */
  onDestroy?(props?: T): void
  /**
   * @private
   */
  __initialize__(props?: T): void
  /**
   * @private
   */
  __destroy__(props?: T): void
}

export interface AglynLoadableObserver<T = any> {
  /**
   * Should be invoked each time the object is loaded
   */
  onActivate?(props?: T): void
  /**
   * Should be invoked each time the object is unloaded
   */
  onDeactivate?(props?: T): void
  /**
   * @private
   */
  __activate__(props?: T): void
  /**
   * @private
   */
  __deactivate__(props?: T): void
}

export interface ModificationHistoryState<T> {
  past: [previous?: T, ...more: T[]]
  present: T
  future: [next?: T, ...more: T[]]
}

export interface AglynBaseModelOptions {
  logLevel?: LogLevelString
  errorFactory?: AglynErrorFactory
  emitter?: AglynEmitter
  logger?: AglynLogger
}

export interface IAglynBaseModel<
  O extends AglynBaseModelOptions = AglynBaseModelOptions,
  LO = never,
> extends StringLike,
    Serializable,
    AglynLifecycleObserver<LO>,
    AglynLoadableObserver<LO>,
    Partial<AglynLogger>,
    Partial<AglynEmitter> {
  readonly [Symbol.toStringTag]: string
  readonly namespace: string
  readonly createdAt: ITimestamp
  readonly options: O
  readonly errorFactory: AglynErrorFactory
  readonly logger: AglynLogger
  readonly emitter: AglynEmitter

  getCreatedAt(): ITimestamp
  getOptions(): O
  getErrorFactory(): AglynErrorFactory
  setErrorFactory(value: AglynErrorFactory): this
  getEmitter(): AglynEmitter
  setEmitter(value: AglynEmitter): this
  getLogger(): AglynLogger
  setLogger(value: AglynLogger): this
}

export interface AglynBaseModelT<
  O extends AglynBaseModelOptions = AglynBaseModelOptions,
  LO = never,
> {
  readonly [Symbol.toStringTag]: string
  readonly namespace: string

  new (options: O): IAglynBaseModel<O, LO>
}

export type AglynDependencyUid = string

export enum AglynDependencyStatus {
  WAITING = 'waiting',
  LOADING = 'loading',
  LOADED = 'loaded',
  UNLOADING = 'unloading',
}

export type AglynDependencyStatuses = Record<
  AglynDependencyUid,
  AglynDependencyStatus
>
export type AglynDependenciesById = Record<AglynDependencyUid, AglynDependency>
export type AglynDependencyDependencies = Record<AglynDependencyUid, true>
export type AglynDependents = Record<AglynDependencyUid, true>
export type AglynDependencyDependents = Record<
  AglynDependencyUid,
  AglynDependents
>

export interface AglynDependency {
  namespace: AglynDependencyUid
  dependencies?: AglynDependencyDependencies
  load(...args: any[]): void
  destroy(...args: any[]): void
}

export interface AglynDependencyMap {
  statusByDependencyId: AglynDependencyStatuses
  dependentsByDependencyId: AglynDependencyDependents
  __: AglynDependenciesById
}

export interface IAglynDependencyManager {
  dependencies?: AglynDependencyMap
  dependency(id: AglynDependencyUid): AglynDependency | undefined
  dependencyWaiting(id: AglynDependencyUid): boolean
  dependencyLoading(id: AglynDependencyUid): boolean
  dependencyUnloading(id: AglynDependencyUid): boolean
  dependencyLoaded(id: AglynDependencyUid): boolean
  addDependency(dependency: AglynDependency): this
  loadDependency(id: AglynDependencyUid): this
  unloadDependency(id: AglynDependencyUid): this
  removeDependency(id: AglynDependencyUid): this
}
