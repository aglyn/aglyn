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

import React, { cloneElement, ReactElement } from 'react'
import useScrollTrigger from '@material-ui/core/useScrollTrigger'

/* eslint-disable-next-line */
export interface ElevationScrollProps {
  target?: Node | Window
  children: ReactElement
}

export function ElevationScroll(props: ElevationScrollProps) {
  const { children, target } = props
  const trigger = useScrollTrigger({
    disableHysteresis: true,
    threshold: 0,
    target: target ?? undefined,
  })

  return cloneElement(children, { elevation: trigger ? 4 : 0 })
}
ElevationScroll.displayName = 'ElevationScroll'

export default ElevationScroll
