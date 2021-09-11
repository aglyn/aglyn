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

import { AglynComponentOptions } from '@aglyn/framework/sdk'
import { _isFnT } from '@aglyn/shared/util/guards'
import { copy } from '@aglyn/shared/util/tools'
import { handleElementPropDefaults } from './handle-element-prop-defaults'


/**
 * Merges properties of a resolving function with currents
 * @param elementDataProps
 * @param componentOptions
 * @param thisArg
 * @returns {any}
 */
export function handleElementResolveProps<P = any>(
  elementDataProps: P,
  componentOptions: AglynComponentOptions<P>,
  thisArg?: ThisType<unknown>,
): P {
  const {resolveProps, defaultProps = {}} = {...componentOptions}
  const _props = copy({...elementDataProps} as unknown) as P
  const _defaults = copy({...defaultProps}) as P
  const propsMergedDefaults = handleElementPropDefaults(_props, _defaults) as P
  if (_isFnT(resolveProps)) return resolveProps.call(thisArg, propsMergedDefaults)
  return propsMergedDefaults
}
export default handleElementResolveProps
