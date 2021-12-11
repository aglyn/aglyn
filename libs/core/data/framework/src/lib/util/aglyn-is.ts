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
import { _isFnT, _isObj } from '@aglyn/shared-util-guards'
import {
  COMMAND_LISTENER_TYPE,
  COMMAND_RESOLVER_TYPE,
  COMPONENT_ELEMENT_TYPE,
  EXTENSION_TYPE,
  MODULE_TYPE,
  TYPE_KIND,
  TYPE_OF,
} from '../constants/symbol'
import type {
  AglynCommandListener,
  AglynCommandResolver,
} from '../controllers/aglyn-commands.controller'
import type { IAglynComponent } from '../controllers/aglyn-components.controller'
import type { AglynExtension } from '../models/aglyn-extension.model'
import type { AglynAppModule } from '../types'


export function typeOf(object: unknown) {
  if (_isFnT(object) || _isObj(object)) {
    const _typeof = object[TYPE_OF]
    switch (_typeof) {
      case MODULE_TYPE:
        return _typeof
      default:
        return typeof object
    }
  }

  return undefined
}

export function kindOf(object: unknown) {
  if (_isFnT(object) || _isObj(object)) {
    // eslint-disable-next-line no-case-declarations
    const kind = object[TYPE_KIND]

    switch (kind) {
      case MODULE_TYPE:
      case EXTENSION_TYPE:

      case COMMAND_RESOLVER_TYPE:
      case COMMAND_LISTENER_TYPE:
      case COMPONENT_ELEMENT_TYPE:
      default:
        return kind
    }
  }

  return undefined
}

export function isAglynModule<T>(object: unknown): object is AglynAppModule {
  return typeOf(object) === MODULE_TYPE
}
export function isAglynExtension<T>(object: unknown): object is AglynExtension {
  return kindOf(object) === EXTENSION_TYPE
}

export function isAglynCommandResolver<T>(object: unknown): object is AglynCommandResolver {
  return kindOf(object) === COMMAND_RESOLVER_TYPE
}
export function isAglynCommandListener<T>(object: unknown): object is AglynCommandListener {
  return kindOf(object) === COMMAND_LISTENER_TYPE
}
export function isAglynComponentElement<T>(object: unknown): object is IAglynComponent {
  return kindOf(object) === COMPONENT_ELEMENT_TYPE
}
