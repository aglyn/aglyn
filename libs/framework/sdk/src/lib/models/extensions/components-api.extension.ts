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
  AglynComponent,
  AglynComponentOptions,
  AglynComponentsExtension,
  PayloadParams, RegistryEntries,
  RegistryValues,
} from './components-types.extension'
import { AglynAppInstance } from '../../types'
import { AglynExtension } from '../../constants'
import { _validateAppArg, getExtension } from '../../api'


export function aglynComponent($id: string, options: Partial<AglynComponentOptions>) {
  return function(target) {
    target.$id = $id
    target.options = {...options}
    return target
  }
}

export function _getComponentsExtension(app: AglynAppInstance): AglynComponentsExtension {
  _validateAppArg(app)
  return getExtension<AglynComponentsExtension>(app, {name: AglynExtension.COMPONENTS})
}

export function getAllComponents(app: AglynAppInstance): RegistryEntries {
  return _getComponentsExtension(app)?.getAllComponents() ?? []
}

export function getComponent(app: AglynAppInstance, options: PayloadParams.Get): AglynComponent {
  return _getComponentsExtension(app)?.getComponent(options)
}

export function registerComponent(app: AglynAppInstance, options: PayloadParams.Register): void {
  _getComponentsExtension(app)?.registerComponent(options)
}
