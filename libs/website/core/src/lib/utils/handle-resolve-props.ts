/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { AnyProps } from '../core'
import Website from '../../index'
import { _isFn } from '@aglyn/shared/util/helpers'
import handlePropDefaults from './handle-prop-defaults'


export function handleResolveProps(
  dataProps: AnyProps,
  metadata: Website.Component['metadata'],
  thisArg?: any,
) {
  const {resolveProps, defaultProps} = metadata
  const mergedProps = handlePropDefaults(dataProps, defaultProps)
  const propsResolver = _isFn(resolveProps) ? resolveProps : (p) => p
  return propsResolver.call(thisArg, mergedProps)
}

export default handleResolveProps
