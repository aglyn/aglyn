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

import { bitwiseHasOnlyAttributes } from '@aglyn/shared-util-tools'

export enum LifecycleFlag {
  NONE,
  SPIN = 0x01 << 0x01,
  UP = 0x01 << 0x03,
  DOWN = 0x01 << 0x04,

  REGISTER = 0x01 << 0x0a,
  INITIALIZE = 0x01 << 0x0b,
  LOAD = 0x01 << 0x0c,
  DESTROY = 0x01 << 0x0d,

  SPINNING_UP = SPIN | UP,
  SPINNING_DOWN = SPIN | DOWN,
}

export enum AglynLifecycleFlag {
  UNREGISTERED = LifecycleFlag.NONE,
  REGISTERING = LifecycleFlag.REGISTER | LifecycleFlag.SPINNING_UP,
  REGISTERED = LifecycleFlag.REGISTER | LifecycleFlag.UP,
  INITIALIZING = LifecycleFlag.REGISTER | LifecycleFlag.INITIALIZE | LifecycleFlag.SPINNING_UP,
  INITIALIZED = LifecycleFlag.REGISTER | LifecycleFlag.INITIALIZE | LifecycleFlag.UP,
  ACTIVATING = LifecycleFlag.REGISTER |
    LifecycleFlag.INITIALIZE |
    LifecycleFlag.LOAD |
    LifecycleFlag.SPINNING_UP,
  ACTIVATED = LifecycleFlag.REGISTER |
    LifecycleFlag.INITIALIZE |
    LifecycleFlag.LOAD |
    LifecycleFlag.UP,
  UNLOADING = LifecycleFlag.REGISTER |
    LifecycleFlag.INITIALIZE |
    LifecycleFlag.LOAD |
    LifecycleFlag.SPINNING_DOWN,
  DEACTIVATED = LifecycleFlag.REGISTER |
    LifecycleFlag.INITIALIZE |
    LifecycleFlag.LOAD |
    LifecycleFlag.DOWN,
  DESTROYING = LifecycleFlag.DESTROY | LifecycleFlag.SPINNING_DOWN,
  DESTROYED = LifecycleFlag.DESTROY | LifecycleFlag.DOWN,
}

export function nextLifecycleIsValid(current: AglynLifecycleFlag, next: AglynLifecycleFlag) {
  switch (true) {
    // REGISTERING
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.REGISTERING) &&
      bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.UNREGISTERED):

    // REGISTERED
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.REGISTERED) &&
      bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.UNREGISTERED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.REGISTERED) &&
      bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.REGISTERING):

    // INITIALIZING
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.INITIALIZING) &&
      bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.REGISTERED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.INITIALIZED) &&
      bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.REGISTERED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.INITIALIZED) &&
      bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.INITIALIZING):

    // LOADING
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.ACTIVATING) &&
      bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.INITIALIZED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.ACTIVATING) &&
      bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.DEACTIVATED):

    // LOADED
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.ACTIVATED) &&
      bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.INITIALIZED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.ACTIVATED) &&
      bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.ACTIVATING):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.ACTIVATED) &&
      bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.DEACTIVATED):

    // UNLOADING
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.UNLOADING) &&
      bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.ACTIVATED):

    // UNLOADED
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.DEACTIVATED) &&
      bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.ACTIVATED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.DEACTIVATED) &&
      bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.UNLOADING):

    // DESTROYING
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.DESTROYING) &&
      bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.REGISTERED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.DESTROYING) &&
      bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.INITIALIZED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.DESTROYING) &&
      bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.DEACTIVATED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.DESTROYING) &&
      bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.DESTROYING):

    // DESTROYED
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.DESTROYED) &&
      bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.INITIALIZED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.DESTROYED) &&
      bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.ACTIVATED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.DESTROYED) &&
      bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.DEACTIVATED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.DESTROYED) &&
      bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.DESTROYING):
      return true
  }
  return false
}
