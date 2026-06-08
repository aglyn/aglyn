/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import { _isFnT } from '@aglyn/shared-util-tools'
import { useScrollTrigger } from '@mui/material'
// eslint-disable-next-line no-restricted-imports
import type { UseScrollTriggerOptions } from '@mui/material/useScrollTrigger/useScrollTrigger'
import { cloneElement, type ReactElement } from 'react'

export type ElevatedRenderProps = {
  activeWithHysteresis: boolean
  activeWithoutHysteresis: boolean
}

export type ScrollTriggerOptions = Omit<
  UseScrollTriggerOptions,
  'disableHysteresis'
>

export interface ScrollReactionProps<P = any> extends ScrollTriggerOptions {
  /**
   * If children is a render function then passes local state to parameter.
   * Otherwise will clone child element, passing or calling renderProps
   */
  children: ReactElement<P> | ((state: ElevatedRenderProps) => ReactElement<P>)
  /**
   * Optionally, provide a render props function to contextually change passed
   * props based on the local state provided through the
   */
  renderProps?: Partial<P> | ((state: ElevatedRenderProps) => Partial<P>)

  /**
   * Optionally provided to override the options passed to useScrollTrigger for
   * the hook responding to triggers *WITH* hysteresis.
   *
   * __Meaning of Hysteresis__
   * > The meaning of hysteresis is "lagging." Hysteresis is characterized as a
   * > lag of magnetic flux density (B) behind the magnetic field strength (H).
   */
  withHysteresis?: ScrollTriggerOptions
  /**
   * Optionally provided to override the options passed to
   * the`useScrollTrigger` for the hook responding to triggers *WITHOUT*
   * hysteresis.
   *
   * @see {@link withHysteresis} for Hysteresis meaning
   */
  withoutHysteresis?: ScrollTriggerOptions
}

export function ScrollReaction<P>(props: ScrollReactionProps<P>) {
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
    threshold,
    target: target ?? undefined,
    ...withoutHysteresis,
  })
  const activeWithHysteresis = useScrollTrigger({
    disableHysteresis: false,
    threshold,
    target: target ?? undefined,
    ...withHysteresis,
  })
  const activity = { activeWithHysteresis, activeWithoutHysteresis }

  if (_isFnT(children)) return children(activity)

  return cloneElement(
    children,
    _isFnT(renderProps) ? renderProps(activity) : renderProps,
  )
}

ScrollReaction.displayName = 'ScrollReaction'
ScrollReaction.aglyn = true

export default ScrollReaction
