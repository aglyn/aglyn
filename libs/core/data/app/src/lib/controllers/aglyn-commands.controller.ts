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

import type {
  AglynCommander,
  AglynCommandResolver,
  AglynCommandsControllerOptions,
  AglynModuleEffectListener,
  CommandUId,
  IAglynAppController,
  IAglynCommandsController,
} from '@aglyn/core-data-foundation'
import {
  AglynEventStateFlag,
  AglynEventTriggerFlag,
  type CommandsRegisterListenerPayload,
  type CommandsRemoveResolverPayload,
  type CommandsSetResolverPayload,
  type CommandsTriggerPayload,
  type CommandsUnregisterListenerPayload,
} from '@aglyn/core-data-foundation'
import { EmitterFn } from '@aglyn/shared-util-emitter'
import { _isFnT } from '@aglyn/shared-util-tools'
import { AglynModuleModel } from '../models/aglyn-module.model'

const TAG = 'AglynCommands'
const NS = 'com.aglyn.core.data.controller.commands'

export class AglynCommandsController
  extends AglynModuleModel<AglynCommandsControllerOptions>
  implements IAglynCommandsController
{
  public static get [Symbol.toStringTag](): string {
    return TAG
  }
  public static get namespace(): string {
    return NS
  }

  #commander: AglynCommander = EmitterFn()
  #resolvers: Map<CommandUId, AglynCommandResolver> = new Map()

  public get commander(): AglynCommander {
    return this.#commander
  }
  public get resolvers(): Map<CommandUId, AglynCommandResolver> {
    return this.#resolvers
  }

  protected get listeners(): AglynModuleEffectListener<any>[] {
    return [
      [AglynEventTriggerFlag.COMMANDS_RESOLVER_SET, this.setResolver],
      [AglynEventTriggerFlag.COMMANDS_LISTENER_REGISTER, this.registerListener],
      [AglynEventTriggerFlag.COMMANDS_RESOLVER_REMOVE, this.removeResolver],
      [
        AglynEventTriggerFlag.COMMANDS_LISTENER_UNREGISTER,
        this.unregisterListener,
      ],
      [AglynEventTriggerFlag.COMMANDS_TRIGGER, this.trigger],
    ]
  }

  constructor(
    app: IAglynAppController,
    options: AglynCommandsControllerOptions,
  ) {
    super(app, options)
  }

  public toJSON() {
    return {
      ...super.toJSON(),
      commands: this.#commander.all.entries() as any,
    }
  }

  public setResolver(payload: CommandsSetResolverPayload): this {
    const { resolver, commandId: cId } = payload
    const commandId = resolver?.commandId || cId
    if (_isFnT(resolver) && commandId) {
      this.handleEvent(
        [
          AglynEventStateFlag.COMMAND_RESOLVER_SETTING,
          AglynEventStateFlag.COMMAND_RESOLVER_SET,
        ],
        { commandId },
        () => {
          this.#resolvers.set(commandId, resolver)
        },
      )
    } else {
      // TODO: throw errorFactory error
      if (_isFnT(resolver)) throw new Error('Invalid resolver fn')
      throw new Error('Invalid commandId provided')
    }
    return this
  }
  public registerListener(payload: CommandsRegisterListenerPayload): this {
    const { listener, commandId: cId } = payload
    const commandId = listener?.commandId || cId
    if (_isFnT(listener) && commandId) {
      this.handleEvent(
        [
          AglynEventStateFlag.COMMAND_LISTENER_REGISTERING,
          AglynEventStateFlag.COMMAND_LISTENER_REGISTERED,
        ],
        { commandId },
        () => {
          this.#commander.on(commandId, listener)
        },
      )
    } else {
      // TODO: throw errorFactory error
      if (_isFnT(listener)) throw new Error('Invalid listener fn')
      throw new Error('Invalid commandId provided')
    }
    return this
  }
  public unregisterListener(payload: CommandsUnregisterListenerPayload): this {
    const { listener, commandId: cId } = payload
    const commandId = listener?.commandId || cId
    if (commandId) {
      this.handleEvent(
        [
          AglynEventStateFlag.COMMAND_LISTENER_UNREGISTERING,
          AglynEventStateFlag.COMMAND_LISTENER_UNREGISTERED,
        ],
        { commandId },
        () => {
          this.#commander.off(commandId, listener)
        },
      )
    } else {
      // TODO: throw errorFactory error
      throw new Error('Invalid commandId provided')
    }
    return this
  }
  public removeResolver(payload: CommandsRemoveResolverPayload): this {
    const { commandId } = payload
    if (commandId) {
      this.handleEvent(
        [
          AglynEventStateFlag.COMMAND_RESOLVER_REMOVING,
          AglynEventStateFlag.COMMAND_RESOLVER_REMOVED,
        ],
        { commandId },
        () => {
          this.#resolvers.delete(commandId)
        },
      )
    } else {
      // TODO: throw errorFactory error
      throw new Error('Invalid commandId provided')
    }
    return this
  }
  public trigger(payload: CommandsTriggerPayload): this {
    const { commandId } = payload
    const resolver = this.#resolvers.get(commandId)
    if (_isFnT(resolver)) {
      this.handleEvent(
        [
          AglynEventStateFlag.COMMAND_RESOLVER_TRIGGERING,
          AglynEventStateFlag.COMMAND_RESOLVER_TRIGGERED,
        ],
        { commandId },
        () => {
          const response = resolver(payload)
          this.handleEvent(
            [
              AglynEventStateFlag.COMMAND_LISTENERS_TRIGGERING,
              AglynEventStateFlag.COMMAND_LISTENERS_TRIGGERED,
            ],
            { commandId },
            () => {
              this.#commander.emit(commandId, { payload, response })
            },
          )
        },
      )
    } else {
      // TODO: throw errorFactory error
      if (_isFnT(resolver)) throw new Error('Invalid resolver fn')
      throw new Error('Invalid commandId provided')
    }
    return this
  }
}

export default AglynCommandsController
