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

import {bitwiseHasOnlyAttributes} from '@aglyn/shared-util-tools'


export enum LifecycleFlag {
  NONE,
  SPIN = 0x01 << 0x01,
  UP = 0x01 << 0x03,
  DOWN = 0x01 << 0x04,

  REGISTER = 0x01 << 0x0A,
  INITIALIZE = 0x01 << 0x0B,
  LOAD = 0x01 << 0x0C,
  DESTROY = 0x01 << 0x0D,

  SPINNING_UP = SPIN | UP,
  SPINNING_DOWN = SPIN | DOWN,
}

export enum AglynLifecycleFlag {
  UNREGISTERED = LifecycleFlag.NONE,
  REGISTERING = LifecycleFlag.REGISTER | LifecycleFlag.SPINNING_UP,
  REGISTERED = LifecycleFlag.REGISTER | LifecycleFlag.UP,
  INITIALIZING = LifecycleFlag.REGISTER | LifecycleFlag.INITIALIZE | LifecycleFlag.SPINNING_UP,
  INITIALIZED = LifecycleFlag.REGISTER | LifecycleFlag.INITIALIZE | LifecycleFlag.UP,
  LOADING = LifecycleFlag.REGISTER | LifecycleFlag.INITIALIZE | LifecycleFlag.LOAD | LifecycleFlag.SPINNING_UP,
  LOADED = LifecycleFlag.REGISTER | LifecycleFlag.INITIALIZE | LifecycleFlag.LOAD | LifecycleFlag.UP,
  UNLOADING = LifecycleFlag.REGISTER | LifecycleFlag.INITIALIZE | LifecycleFlag.LOAD | LifecycleFlag.SPINNING_DOWN,
  UNLOADED = LifecycleFlag.REGISTER | LifecycleFlag.INITIALIZE | LifecycleFlag.LOAD | LifecycleFlag.DOWN,
  DESTROYING = LifecycleFlag.DESTROY | LifecycleFlag.SPINNING_DOWN,
  DESTROYED = LifecycleFlag.DESTROY | LifecycleFlag.DOWN,
}


export function nextLifecycleIsValid(current: AglynLifecycleFlag, next: AglynLifecycleFlag) {
  switch (true) {
    // REGISTERING
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.REGISTERING)
    && bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.UNREGISTERED):

    // REGISTERED
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.REGISTERED)
    && bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.UNREGISTERED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.REGISTERED)
    && bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.REGISTERING):

    // INITIALIZING
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.INITIALIZING)
    && bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.REGISTERED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.INITIALIZED)
    && bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.REGISTERED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.INITIALIZED)
    && bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.INITIALIZING):

    // LOADING
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.LOADING)
    && bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.INITIALIZED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.LOADING)
    && bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.UNLOADED):

    // LOADED
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.LOADED)
    && bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.INITIALIZED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.LOADED)
    && bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.LOADING):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.LOADED)
    && bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.UNLOADED):

    // UNLOADING
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.UNLOADING)
    && bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.LOADED):

    // UNLOADED
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.UNLOADED)
    && bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.LOADED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.UNLOADED)
    && bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.UNLOADING):

    // DESTROYING
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.DESTROYING)
    && bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.REGISTERED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.DESTROYING)
    && bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.INITIALIZED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.DESTROYING)
    && bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.UNLOADED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.DESTROYING)
    && bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.DESTROYING):

    // DESTROYED
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.DESTROYED)
    && bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.INITIALIZED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.DESTROYED)
    && bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.LOADED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.DESTROYED)
    && bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.UNLOADED):
    case bitwiseHasOnlyAttributes(next, AglynLifecycleFlag.DESTROYED)
    && bitwiseHasOnlyAttributes(current, AglynLifecycleFlag.DESTROYING):

      return true
  }
  return false
}
