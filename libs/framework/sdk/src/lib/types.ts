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

import { AnyProps } from '@aglyn/shared/util/types'
import { AppErrorFlag, AppEventFlag, RestrictFlag } from './constants'
import { Emitter, Handler } from 'mitt'
import { Timestamp } from '@aglyn/shared/feature/timestamp'
import { FormSchema } from '@aglyn/shared/ui/react'


export type AppsMap = Map<string, WebApp>
export type AppExtMap = Map<string, AppExtension>
export type AppExtComponents = AppComponent[]

export type AppEmitter = Emitter<AppEvents>
export type AppEventHandler<T = unknown> = Handler<T>
export type AppEvent = AppEventFlag
export type AppEvents = {
  [AppEventFlag.CREATED_APP]: WebApp,
  [AppEventFlag.BEFORE_DELETE_APP]: WebApp,
  [AppEventFlag.DELETED_APP]: string,
  [AppEventFlag.SET_EXTENSION]: AppExtension,
  [AppEventFlag.SET_COMPONENT]: AppComponent,
}

export interface WebApp {
  readonly event: AppEmitter
  readonly extension: AppExtMap
  getName(): string
  getCreated(): Timestamp
  getOptions(): AppOptions
  getExtensions(): AppExtension[]
}

export interface AppOptions {
  name?: string
}

export interface AppExtension {
  component: AppExtComponents
  getApp(): WebApp
  getId(): ExtensionConfig['$id']
  getConfig(): ExtensionConfig
  getComponents(): AppComponent[]
}

export interface ExtensionConfig {
  $id: string
  components?: AppExtComponents
}

export interface AppComponent<T = unknown> {
  $id: string
  ctor: T
  metadata: Partial<ComponentMetadata>
}

export interface ComponentMetadata {
  displayName: string
  description: string
  title: string
  subtitle: string
  icon: any
  propsSchema: FormSchema
  defaultProps: AnyProps
  resolveProps: <T>(...args: T[]) => AnyProps | void
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

export interface ElementData {
  $id: string
  component?: AppComponent | string
  children?: (ElementData | string)[]
  props: AnyProps
  temporary?: boolean
  parent?: string
  name?: string
  description?: string
}

export interface ErrorParams {
  [AppErrorFlag.NO_APP]: { appName: string };
  [AppErrorFlag.BAD_APP_NAME]: { appName: string };
  [AppErrorFlag.DUPLICATE_APP]: { appName: string };
  [AppErrorFlag.APP_DELETED]: { appName: string };
  [AppErrorFlag.INVALID_APP_ARG]: { appName: string };
  [AppErrorFlag.NO_APP_EXTENSION]: { extensionId: string, appName: string }
}
