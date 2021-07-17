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

import { AnyProps, Component } from '../core-types'
import { _isFn } from '@aglyn/shared/util/helpers'
import { handlePropDefaults } from './handle-prop-defaults'

export function handleResolveProps(
  dataProps: AnyProps,
  metadata: Component['metadata'],
  thisArg?: any
) {
  const { resolveProps, defaultProps } = metadata
  const mergedProps = handlePropDefaults(dataProps, defaultProps)
  const propsResolver = _isFn(resolveProps) ? resolveProps : (p) => p
  return propsResolver.call(thisArg, mergedProps)
}
