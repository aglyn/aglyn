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
  AGLYN_OF,
  type AglynAppModule,
  type AglynCommandListener,
  type AglynCommandResolver,
  type AglynExoticComponent,
  COMMAND_LISTENER_TYPE,
  COMMAND_RESOLVER_TYPE,
  COMPONENT_ELEMENT_TYPE,
  EXTENSION_TYPE,
  type IAglynExtension,
  MODULE_TYPE,
} from '@aglyn/core-data-foundation'
import { _isFnT, _isObj } from '@aglyn/shared-util-tools'

export function kindOf(object: unknown) {
  if (_isFnT(object) || _isObj(object)) {
    // eslint-disable-next-line no-case-declarations
    const kind = object[AGLYN_OF]

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
  return kindOf(object) === MODULE_TYPE
}
export function isAglynExtension<T>(
  object: unknown,
): object is IAglynExtension {
  return kindOf(object) === EXTENSION_TYPE
}

export function isAglynCommandResolver<T>(
  object: unknown,
): object is AglynCommandResolver {
  return kindOf(object) === COMMAND_RESOLVER_TYPE
}
export function isAglynCommandListener<T>(
  object: unknown,
): object is AglynCommandListener {
  return kindOf(object) === COMMAND_LISTENER_TYPE
}
export function isAglynComponentElement<T>(
  object: unknown,
): object is AglynExoticComponent {
  return kindOf(object) === COMPONENT_ELEMENT_TYPE
}
