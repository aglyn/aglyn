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

import {_isFnT} from '@aglyn/shared-util-guards'
import {useScrollTrigger} from '@mui/material'
// eslint-disable-next-line no-restricted-imports
import type {UseScrollTriggerOptions} from '@mui/material/useScrollTrigger/useScrollTrigger'
import {cloneElement, type ReactElement, useMemo} from 'react'


export type ElevatedRenderProps = {
  activeWithHysteresis: boolean
  activeWithoutHysteresis: boolean
}

/* eslint-disable-next-line */
export interface ElevationOnScrollProps<P = any> extends Omit<UseScrollTriggerOptions, 'disableHysteresis'> {
  /**
   * If children is a function uses renderProps prop and copies children
   */
  children: ReactElement<P> | ((state: ElevatedRenderProps) => ReactElement<P>)
  renderProps?: Partial<P> | ((state: ElevatedRenderProps) => Partial<P>)

  withHysteresis?: Omit<UseScrollTriggerOptions, 'disableHysteresis'>
  withoutHysteresis?: Omit<UseScrollTriggerOptions, 'disableHysteresis'>
}

function ElevateOnScroll<P>(props: ElevationOnScrollProps<P>) {
  const {
    children,
    renderProps,
    threshold,
    target,
    withHysteresis,
    withoutHysteresis,
  } = props
  const activeWithoutHysteresis = useScrollTrigger({
    disableHysteresis: true,
    threshold: withoutHysteresis?.threshold ?? threshold,
    target: withoutHysteresis?.target || target || undefined,
  })
  const activeWithHysteresis = useScrollTrigger({
    disableHysteresis: false,
    threshold: withHysteresis?.threshold ?? threshold,
    target: withHysteresis?.target || target || undefined,
  })
  const state = useMemo(
    () => ({activeWithHysteresis, activeWithoutHysteresis}),
    [activeWithHysteresis, activeWithoutHysteresis],
  )

  if (_isFnT(children)) {
    return children(state)
  }

  const overrideProps = _isFnT(renderProps) ? renderProps(state) : renderProps
  return cloneElement(children, overrideProps)
}

ElevateOnScroll.displayName = 'ElevateOnScroll'
ElevateOnScroll.aglyn = true
ElevateOnScroll.defaultProps = {
  disableHysteresis: false,
}

export {ElevateOnScroll}
export default ElevateOnScroll
