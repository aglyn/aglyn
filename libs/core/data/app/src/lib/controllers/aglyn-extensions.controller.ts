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

import type {
  AglynExtensionMap,
  AglynExtensionsControllerOptions,
  AglynModuleEffectListener,
  ExtensionUUN,
  IAglynAppController,
  IAglynExtension,
  IAglynExtensionsController,
} from '@aglyn/core-data-foundation'
import {
  AGLYN_ERROR,
  AglynErrorEventFlag,
  AglynEventStateFlag,
  AglynEventTriggerFlag,
  AglynLifecycleFlag,
  type ExtensionDestroyPayload,
  type ExtensionHandleLoaderPayload,
  type ExtensionInitializePayload,
  type ExtensionLoadPayload,
  type ExtensionRegisterPayload,
  type ExtensionUnloadPayload,
} from '@aglyn/core-data-foundation'
import { isAglynExtension, isAglynModule } from '@aglyn/core-util-app'
import { _isCtor } from '@aglyn/shared-util-tools'
import { AglynExtension } from '../models/aglyn-extension.model'
import { AglynModuleModel } from '../models/aglyn-module.model'

const TAG = 'AglynExtensions'
const NS = 'com.aglyn.core.data.controller.extensions'

export class AglynExtensionsController
  extends AglynModuleModel<AglynExtensionsControllerOptions>
  implements IAglynExtensionsController
{
  public static get [Symbol.toStringTag](): string {
    return TAG
  }
  public static get namespace(): string {
    return NS
  }

  #extensions: AglynExtensionMap = new Map()

  public get extensions(): Readonly<IAglynExtension[]> {
    return [...this.#extensions.values()]
  }

  protected get listeners(): AglynModuleEffectListener<any>[] {
    return [
      [AglynEventTriggerFlag.EXTENSION_REGISTER, this.registerExtension],
      [AglynEventTriggerFlag.EXTENSION_INITIALIZE, this.initializeExtension],
      [AglynEventTriggerFlag.EXTENSION_ACTIVATE, this.activateExtension],
      [AglynEventTriggerFlag.EXTENSION_DEACTIVATE, this.deactivateExtension],
      [AglynEventTriggerFlag.EXTENSION_DESTROY, this.destroyExtension],
    ]
  }

  constructor(
    app: IAglynAppController,
    options: AglynExtensionsControllerOptions,
  ) {
    super(app, options)
    this.#setup()
  }
  #setup() {
    this.#setupInitialExtensions()
  }
  #setupInitialExtensions(): this {
    this.options.defaults?.extensions?.forEach(this.handleLoader)
    return this
  }

  public toJSON() {
    return {
      ...super.toJSON(),
      extensions: this.extensions.keys() as any,
    }
  }

  public onDestroy(): this {
    this.deactivateAllExtensions()
    this.destroyAllExtensions()
    super.onDestroy()
    return this
  }

  public handleLoader(payload: ExtensionHandleLoaderPayload): IAglynExtension {
    const { loader, options } = payload
    const module = loader()
    const appName = this.app.getName()
    if (!module) {
      throw AGLYN_ERROR.create(
        AglynErrorEventFlag.EXTENSION_BAD_MODULE_LOADER,
        { appName },
      )
    }
    if (
      !isAglynModule(module) ||
      !isAglynExtension(module) ||
      !_isCtor(module)
    ) {
      throw AGLYN_ERROR.create(AglynErrorEventFlag.EXTENSION_BAD_MODULE, {
        appName,
        extensionName: module?.['moduleName'] ?? 'unknown',
      })
    }
    const instance = new module({ ...options, app: this.app })
    if (!(instance instanceof AglynExtension)) {
      throw AGLYN_ERROR.create(AglynErrorEventFlag.EXTENSION_BAD_MODULE, {
        appName,
        extensionName: module?.['extensionName'] ?? 'unknown',
      })
    }
    this.registerExtension({ extension: instance })
    return instance
  }

  public getExtensionByName(extensionName: ExtensionUUN): IAglynExtension {
    const extension = this.#extensions.get(extensionName)
    if (extension) {
      const current = extension?.lifecycle
      const autoload = extension?.getOptions?.()?.autoload
      if (current === AglynLifecycleFlag.INITIALIZED && autoload) {
        this.activateExtension({ extensionName })
      }
    } else {
      // TODO: throw errorFactory error
      throw new Error(`Extension does not exists: (${extensionName})`)
    }
    return extension
  }

  public getAllExtensions(): Readonly<IAglynExtension[]> {
    return [...this.#extensions.values()]
  }

  public registerExtension(payload: ExtensionRegisterPayload): this {
    const { extension } = payload
    const extensionName = extension?.extensionName
    if (extensionName && isAglynExtension(extension)) {
      extension.lifecycle = AglynLifecycleFlag.REGISTERING
      const namespace = extension?.namespace
      this.handleEvent(
        [
          AglynEventStateFlag.EXTENSION_REGISTERING,
          AglynEventStateFlag.EXTENSION_REGISTERED,
        ],
        { namespace },
        () => {
          this.#extensions.set(extensionName, extension)
          extension.lifecycle = AglynLifecycleFlag.REGISTERED
        },
      )
    } else {
      // TODO: throw errorFactory error
      if (!extension) throw new Error(`Bad extension provided`)
      if (!extensionName) throw new Error(`Extension missing name`)
      throw new Error(`Invalid extension provided: (${extensionName})`)
    }
    return this
  }

  public initializeExtension(payload: ExtensionInitializePayload): this {
    const { extension } = payload
    const extensionName = extension?.extensionName
    if (extensionName && isAglynExtension(extension)) {
      extension.lifecycle = AglynLifecycleFlag.INITIALIZING
      const namespace = extension?.namespace
      this.handleEvent(
        [
          AglynEventStateFlag.EXTENSION_INITIALIZING,
          AglynEventStateFlag.EXTENSION_INITIALIZED,
        ],
        { namespace },
        () => {
          extension.onInitialize?.(this.app)
          extension.lifecycle = AglynLifecycleFlag.INITIALIZED
        },
      )
    } else {
      // TODO: throw errorFactory error
      if (!extension) throw new Error(`Bad extension provided`)
      if (!extensionName) throw new Error(`Extension missing name`)
      throw new Error(`Invalid extension provided: (${extensionName})`)
    }
    return this
  }

  public activateExtension(payload: ExtensionLoadPayload): this {
    const { extensionName } = payload
    const extension = this.#extensions.get(
      extensionName,
    ) as MutableShallow<IAglynExtension>
    const lifecycle = extension.lifecycle
    if (
      extension &&
      (lifecycle === AglynLifecycleFlag.INITIALIZED ||
        lifecycle === AglynLifecycleFlag.DEACTIVATED)
    ) {
      extension.lifecycle = AglynLifecycleFlag.ACTIVATING
      const namespace = extension?.namespace
      this.handleEvent(
        [
          AglynEventStateFlag.EXTENSION_ACTIVATING,
          AglynEventStateFlag.EXTENSION_ACTIVATED,
        ],
        { namespace },
        () => {
          extension.onActivate?.(this.app)
          extension.lifecycle = AglynLifecycleFlag.ACTIVATED
        },
      )
    } else {
      // TODO: throw errorFactory error
      if (!extension)
        throw new Error(`Extension does not exists: (${extensionName})`)
      throw new Error(
        `Extension is unloaded or not initialized: (${extensionName})`,
      )
    }
    return this
  }

  public deactivateExtension(payload: ExtensionUnloadPayload): this {
    const { extensionName } = payload
    const extension = this.#extensions.get(
      extensionName,
    ) as MutableShallow<IAglynExtension>
    if (extension) {
      extension.lifecycle = AglynLifecycleFlag.UNLOADING
      const namespace = extension?.namespace
      this.handleEvent(
        [
          AglynEventStateFlag.EXTENSION_DEACTIVATING,
          AglynEventStateFlag.EXTENSION_DEACTIVATED,
        ],
        { namespace },
        () => {
          extension.onDeactivate?.(this.app)
          extension.lifecycle = AglynLifecycleFlag.DEACTIVATED
        },
      )
    } else {
      // TODO: throw errorFactory error
      throw new Error(`Extension does not exists: (${extensionName})`)
    }
    return this
  }

  public destroyExtension(payload: ExtensionDestroyPayload): this {
    const { extensionName } = payload
    const extension = this.#extensions.get(extensionName)
    if (extension) {
      extension.lifecycle = AglynLifecycleFlag.DESTROYING
      const namespace = extension?.namespace
      this.handleEvent(
        [
          AglynEventStateFlag.EXTENSION_DESTROYING,
          AglynEventStateFlag.EXTENSION_DESTROYED,
        ],
        { namespace },
        () => {
          extension.onDestroy?.(this.app)
          this.#extensions.delete(extensionName)
          extension.lifecycle = AglynLifecycleFlag.DESTROYED
        },
      )
    } else {
      // TODO: throw errorFactory error
      throw new Error(`Extension does not exists: (${extensionName})`)
    }
    return this
  }

  public deactivateAllExtensions(): this {
    this.#extensions.forEach((extension, extensionName) => {
      if (extension.lifecycle === AglynLifecycleFlag.ACTIVATED) {
        this.deactivateExtension({ extensionName })
      }
    })
    return this
  }

  public destroyAllExtensions(): this {
    this.#extensions.forEach((extension, extensionName) => {
      if (extension.lifecycle !== AglynLifecycleFlag.UNREGISTERED) {
        this.destroyExtension({ extensionName })
      }
    })
    return this
  }
}

export default AglynExtensionsController
