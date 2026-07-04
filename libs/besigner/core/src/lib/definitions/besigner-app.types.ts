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

import type { LogLevelString } from '@aglyn/shared-util-logger'
import type {
  BesignerInterfaceControllerOptions,
  IBesignerInterfaceController,
} from './besigner-interface.types'

/** Unique app name */
export type AppUUN = string

export const DEFAULT_APP_UUN: AppUUN = '[DEFAULT]'

export interface BesignerAppOptions {
  appName?: AppUUN
  logLevel?: LogLevelString
  modulesOptions?: {
    interface?: BesignerInterfaceControllerOptions
  }
}

export interface IBesignerAppController {
  readonly appName: AppUUN
  readonly deleted: boolean
  readonly options: BesignerAppOptions
  readonly interface?: IBesignerInterfaceController

  getName(): AppUUN
  getBesignerController(): IBesignerInterfaceController
  onDestroy?(): void
  setDeleted(value: boolean): void
}

export interface BesignerAppControllerT {
  new (options: BesignerAppOptions): IBesignerAppController
}
