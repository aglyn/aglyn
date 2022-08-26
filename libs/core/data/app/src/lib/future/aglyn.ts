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

import {
  AGLYN_ERROR,
  AGLYN_LOGGER,
  IAglynCanvasController,
  IAglynCommandsController,
  IAglynComponentsController,
  IAglynContextsController,
  IAglynExtensionsController,
} from '@aglyn/core-data-foundation'
import { LogLevelString } from '@aglyn/shared-util-logger'
import { ITimestamp, Timestamp } from '@aglyn/shared-util-timestamp'
import {
  decode,
  type DecodeOptions,
  encode,
  type EncodeOptions,
} from '@msgpack/msgpack'
import type { SplitUndefined } from '@msgpack/msgpack/src/context'
import { EventEmitter2 } from 'eventemitter2'
import UAParser from 'ua-parser-js'
import DependencyManager from './dependency-manager'
import { name, version } from './package'

const TAG = 'Aglyn'

export enum AglynEvent {
  APP_CREATING = 'event:app:creating',
  APP_CREATED = 'event:app:created',
  APP_INITIALIZING = 'event:app:initializing',
  APP_INITIALIZED = 'event:app:initialized',
  APP_ACTIVATING = 'event:app:activating',
  APP_ACTIVATED = 'event:app:activated',
  APP_DEACTIVATING = 'event:app:deactivating',
  APP_DEACTIVATED = 'event:app:deactivated',
  APP_DESTROYING = 'event:app:destroying',
  APP_DESTROYED = 'event:app:destroyed',
  APP_DELETING = 'event:app:deleting',
  APP_DELETED = 'event:app:deleted',

  MODULE_INITIALIZING = 'event:module:initializing',
  MODULE_INITIALIZED = 'event:module:initialized',
  MODULE_ACTIVATING = 'event:module:activating',
  MODULE_ACTIVATED = 'event:module:activated',
  MODULE_DEACTIVATING = 'event:module:deactivating',
  MODULE_DEACTIVATED = 'event:module:deactivated',
  MODULE_DESTROYING = 'event:module:destroying',
  MODULE_DESTROYED = 'event:module:destroyed',

  EXTENSION_REGISTERING = 'event:extensions:registering-extension',
  EXTENSION_REGISTERED = 'event:extensions:registered-extension',
  EXTENSION_INITIALIZING = 'event:extensions:initializing-extension',
  EXTENSION_INITIALIZED = 'event:extensions:initialized-extension',
  EXTENSION_ACTIVATING = 'event:extensions:activating-extension',
  EXTENSION_ACTIVATED = 'event:extensions:activated-extension',
  EXTENSION_DEACTIVATING = 'event:extensions:deactivating-extension',
  EXTENSION_DEACTIVATED = 'event:extensions:deactivated-extension',
  EXTENSION_DESTROYING = 'event:extensions:destroying-extension',
  EXTENSION_DESTROYED = 'event:extensions:destroyed-extension',

  COMMAND_RESOLVER_SETTING = 'event:commands:setting-resolver',
  COMMAND_RESOLVER_SET = 'event:commands:set-resolver',
  COMMAND_LISTENER_REGISTERING = 'event:commands:registering-listener',
  COMMAND_LISTENER_REGISTERED = 'event:commands:registered-listener',
  COMMAND_RESOLVER_REMOVING = 'event:commands:unregistering-resolver',
  COMMAND_RESOLVER_REMOVED = 'event:commands:unregistered-resolver',
  COMMAND_LISTENER_UNREGISTERING = 'event:commands:unregistering-listener',
  COMMAND_LISTENER_UNREGISTERED = 'event:commands:unregistered-listener',
  COMMAND_RESOLVER_TRIGGERING = 'event:commands:triggering-resolver',
  COMMAND_RESOLVER_TRIGGERED = 'event:commands:triggered-resolver',
  COMMAND_LISTENERS_TRIGGERING = 'event:commands:triggering-listeners',
  COMMAND_LISTENERS_TRIGGERED = 'event:commands:triggered-listeners',

  COMPONENT_REGISTERING = 'event:components:registering-component',
  COMPONENT_REGISTERED = 'event:components:registered-component',
  COMPONENT_UNREGISTERING = 'event:components:unregistering-component',
  COMPONENT_UNREGISTERED = 'event:components:unregistered-component',
  COMPONENT_BUNDLE_REGISTERING = 'event:components:registering-bundle',
  COMPONENT_BUNDLE_REGISTERED = 'event:components:registered-bundle',
  COMPONENT_BUNDLE_UNREGISTERING = 'event:components:unregistering-bundle',
  COMPONENT_BUNDLE_UNREGISTERED = 'event:components:unregistered-bundle',
}

export interface AglynConfig {
  logLevel?: LogLevelString
}

export default class Aglyn {
  public static readonly namespace = name
  public static readonly version = version
  public static readonly platform = new UAParser()
  public static readonly errorFactory = AGLYN_ERROR
  public static readonly logger = AGLYN_LOGGER
  public static readonly emitter = new EventEmitter2()

  //region Properties
  readonly #createdAt: ITimestamp
  public get createdAt(): ITimestamp {
    return this.#createdAt
  }

  readonly #config: AglynConfig = {}
  public get config(): AglynConfig {
    return this.#config
  }

  #depends: DependencyManager = new DependencyManager()
  public get depends(): DependencyManager {
    return this.#depends
  }

  #canvas: IAglynCanvasController = null
  public get canvas(): IAglynCanvasController {
    return this.#canvas
  }

  #contexts: IAglynContextsController = null
  public get contexts(): IAglynContextsController {
    return this.#contexts
  }

  #commands: IAglynCommandsController = null
  public get commands(): IAglynCommandsController {
    return this.#commands
  }

  #components: IAglynComponentsController = null
  public get components(): IAglynComponentsController {
    return this.#components
  }

  #extensions: IAglynExtensionsController = null
  public get extensions(): IAglynExtensionsController {
    return this.#extensions
  }
  //endregion

  public static instance: Aglyn
  public static getInstance(appName?: string, config?: AglynConfig) {
    return (this.instance ||= new Aglyn(appName, config))
  }

  protected constructor(
    public readonly appName?: string,
    config?: AglynConfig,
  ) {
    this.#config = { ...config }
    this.#createdAt = Timestamp.now()
    this.setupLogger()
    this.setupDepends()
  }

  //region Setup/Breakdown
  private setupLogger() {
    Aglyn.logger.setLogLevel(this.#config.logLevel)
  }
  private setupDepends(): void {
    this.#depends.addDependencies([])
  }
  private breakdownDepends() {
    this.#depends.destroyDependencies()
  }
  //endregion

  //region Lifecycle Methods
  public static lifecycleEvent(
    callbackFn: () => void,
    options: {
      startEvent: AglynEvent
      startPayload: any[]
      endEvent: AglynEvent
      endPayload: any[]
      onCatch?: (e: unknown) => void
    },
  ): void {
    const { startEvent, startPayload, endEvent, endPayload, onCatch } = options
    Aglyn.logger.debug(Timestamp.now().toJSON(), startEvent, startPayload)
    Aglyn.emitter.emit(startEvent, Timestamp.now().toJSON(), ...startPayload)
    try {
      callbackFn()
    } catch (e) {
      Aglyn.logger.error(Timestamp.now().toJSON(), startEvent, startPayload, e)
      onCatch && onCatch(e)
    } finally {
      Aglyn.logger.debug(Timestamp.now().toJSON(), startEvent, startPayload)
      Aglyn.emitter.emit(endEvent, Timestamp.now().toJSON(), ...endPayload)
    }
  }

  /** @ignore */
  public __initialize__(props?: never): this {
    Aglyn.lifecycleEvent(
      () => {
        this.onInitialize()
      },
      {
        startEvent: AglynEvent.APP_INITIALIZING,
        startPayload: [{ appName: Aglyn.namespace }],
        endEvent: AglynEvent.APP_INITIALIZED,
        endPayload: [{ appName: this.appName }],
      },
    )
    return this
  }
  /** @ignore */
  public __activate__(props?: never): this {
    Aglyn.lifecycleEvent(
      () => {
        this.onActivate()
      },
      {
        startEvent: AglynEvent.APP_ACTIVATING,
        startPayload: [{ appName: this.appName }],
        endEvent: AglynEvent.APP_ACTIVATED,
        endPayload: [{ appName: this.appName }],
      },
    )
    return this
  }
  /** @ignore */
  public __deactivate__(props?: never): this {
    Aglyn.lifecycleEvent(
      () => {
        this.onDeactivate()
      },
      {
        startEvent: AglynEvent.APP_DEACTIVATING,
        startPayload: [{ appName: this.appName }],
        endEvent: AglynEvent.APP_DEACTIVATED,
        endPayload: [{ appName: this.appName }],
      },
    )
    return this
  }
  /** @ignore */
  public __destroy__(props?: never): this {
    Aglyn.lifecycleEvent(
      () => {
        this.onDestroy()
      },
      {
        startEvent: AglynEvent.APP_DESTROYING,
        startPayload: [{ appName: this.appName }],
        endEvent: AglynEvent.APP_DESTROYED,
        endPayload: [{ appName: this.appName }],
      },
    )
    return this
  }

  public onInitialize(): this {
    return this
  }
  public onActivate(): this {
    return this
  }
  public onDeactivate(): this {
    return this
  }
  public onDestroy(): this {
    this.breakdownDepends()
    return this
  }
  //endregion

  //region Compression/Decompression
  public static encode<ContextType = undefined>(
    value: unknown,
    options?: EncodeOptions<SplitUndefined<ContextType>>,
  ): Uint8Array {
    return encode(value, options)
  }
  public static decode<ContextType = undefined>(
    buffer: ArrayLike<number> | BufferSource,
    options?: DecodeOptions<SplitUndefined<ContextType>>,
  ): unknown {
    return decode(buffer, options)
  }
  //endregion

  //region Built-in
  public get [Symbol.toStringTag](): string {
    return TAG
  }
  public toString() {
    return `[object ${this[Symbol.toStringTag]}]`
  }
  public toJSON() {
    return {
      namespace: Aglyn.namespace,
      version: Aglyn.version,
      platform: Aglyn.platform,
      created: this.#createdAt.toJSON(),
      appName: this.appName,
      options: this.#config,
    }
  }
  //endregion
}

export interface Node {}

export namespace Aglyn {}
