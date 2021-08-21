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
  AglynAppInstance,
  AglynAppModule,
  AglynCommandHandler,
  AglynExtensionInstance,
  APP_TYPE,
  COMMAND_TYPE,
  EXTENSION_TYPE,
  MODULE_TYPE,
  TypeKind,
  TypeOf,
} from '@aglyn/framework/sdk'
import { _isFnT, _isObj } from '@aglyn/shared/util/guards'


export function typeOf(object: unknown) {
  if (_isFnT(object) || _isObj(object)) {
    const _typeof = object[TypeOf]
    switch (_typeof) {
      case MODULE_TYPE:
        return _typeof
      case APP_TYPE:
      default:
        return typeof object
    }
  }

  return undefined
}

export function kindOf(object: unknown) {
  if (_isFnT(object) || _isObj(object)) {
    // eslint-disable-next-line no-case-declarations
    const kind = object[TypeKind]

    switch (kind) {
      case COMMAND_TYPE:
      case EXTENSION_TYPE:
      default:
        return kind
    }
  }

  return undefined
}

export function isApp<T>(object: unknown): object is AglynAppInstance {
  return typeOf(object) === APP_TYPE
}
export function isAppModule<T>(object: unknown): object is AglynAppModule {
  return typeOf(object) === MODULE_TYPE
}
export function isCommand<T>(object: unknown): object is AglynCommandHandler {
  return kindOf(object) === COMMAND_TYPE
}
export function isExtension<T>(object: unknown): object is AglynExtensionInstance {
  return kindOf(object) === EXTENSION_TYPE
}
