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

import {
  AglynApp,
  AglynAppEventFlag,
  AglynAppOptions,
  AglynCommandController,
  AglynEffectType,
  AglynEmitter,
  AglynExtensionController,
  AglynLogger,
  AglynModuleTriggerFlag,
  AglynSymbol,
  DEFAULT_ENTRY_NAME,
} from '@aglyn/framework/sdk'
import { Timestamp } from '@aglyn/shared/feature/timestamp'
import { AglynAppExtensionController } from './aglyn-app-extension.controller'
import { AglynAppCommandController } from './aglyn-command.controller'


const TAG = 'AglynApp'

export class AglynAppController implements AglynApp {

  #deleted = false
  protected options: AglynAppOptions
  protected emitter: AglynEmitter
  protected logger: AglynLogger
  protected name: string
  protected created: Timestamp = Timestamp.now()
  protected commandController: AglynCommandController = new AglynAppCommandController({app: this})
  protected extensionController: AglynExtensionController = new AglynAppExtensionController({app: this})

  get event() {
    return this.emitter
  }
  get log() {
    return this.logger
  }
  get extensions() {
    return this.extensionController
  }
  get commands() {
    return this.commandController
  }
  set deleted(value: boolean) {
    this.#deleted = Boolean(value)
  }
  get deleted(): boolean {
    return this.#deleted
  }

  constructor(props: {
    options: AglynAppOptions,
    emitter: AglynEmitter,
    logger: AglynLogger,
  }) {
    const {options, emitter, logger} = props
    this.options = {...options}
    this.name = this.options.name ?? DEFAULT_ENTRY_NAME
    this.emitter = emitter
    this.logger = logger

    AglynAppController.commandControllers.set(this.name, this.commandController)
    AglynAppController.extensionControllers.set(this.name, this.extensionController)

    logger.debug(AglynAppEventFlag.APP_CREATED, {app: this})
    emitter.emit(AglynAppEventFlag.APP_CREATED, {app: this})
  }

  getCreatedAt = () => {
    return this.created
  }
  getName = () => {
    return this.name
  }
  getOptions = () => {
    return this.options
  }
  effect = (data: AglynEffectType<AglynModuleTriggerFlag>) => {
    const {type, payload} = data
    this.emitter.emit(type, payload as any)
  }
  get [AglynSymbol.TypeOf]() {
    return AglynSymbol.APP_TYPE
  }
  get [Symbol.toStringTag]() {
    return `${TAG}`
  }
  toString = () => {
    return `${TAG}(name: '${name}')`
  }
  toJSON = () => {
    return {
      created: this.created,
      name: this.name,
      options: this.options,
    }
  }
  onInit = (): void => {
    this.commandController.onInit?.()
    this.extensionController.onInit?.()
    this.log.debug(AglynAppEventFlag.APP_LOADED, {appName: this.name})
    this.emitter.emit(AglynAppEventFlag.APP_LOADED, {appName: this.name})
  }
  onDestroy = (): void => {
    this.extensionController.unloadExtensions()
    this.commandController.onDestroy?.()
    this.extensionController.onDestroy?.()
    this.log.debug(AglynAppEventFlag.APP_UNLOADED, {appName: this.name})
    this.emitter.emit(AglynAppEventFlag.APP_UNLOADED, {appName: this.name})
  }

}

export namespace AglynAppController {

  export const extensionControllers: Map<string, AglynExtensionController> = new Map()
  export const commandControllers: Map<string, AglynCommandController> = new Map()

}
