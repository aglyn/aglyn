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

//TODO: FIX ALL TYPINGS AND REFACTOR OPTIONS/PROPS

import { jssPreset, StylesProvider } from '@aglyn/shared/ui/themes'

import { create } from 'jss'
import rtl from 'jss-rtl'
import React, { HTMLProps, PropsWithChildren, useState } from 'react'
import useCombinedRefs from '../../hooks/use-combined-refs'

import { createShadowDomProxy } from '../shadow-dom/shadow-dom'

/* eslint-disable-next-line */
export interface MuiShadowDomProps {}

const MuiShadowStylesProvider = React.forwardRef<HTMLProps<HTMLDivElement>, PropsWithChildren<MuiShadowDomProps>>(
  function RefRenderFn(props, ref) {
    const {children} = props
    const [styleNode, setStyleNode] = useState(null)
    const elemRef = useCombinedRefs(setStyleNode, ref)
    const jss = create({
      plugins: [...jssPreset().plugins, rtl()],
      insertionPoint: styleNode,
    })

    return (
      <StylesProvider jss={jss}>
        {styleNode ? children : null}
        <div ref={elemRef}/>
      </StylesProvider>
    )
  },
)
MuiShadowStylesProvider.displayName = 'MuiShadowStylesProvider'

export const MuiShadowDom = createShadowDomProxy(
  {},
  {
    keyPrefix: 'mui',
    render: function(props) {
      const {children} = props

      return <MuiShadowStylesProvider>{children}</MuiShadowStylesProvider>
    },
  },
)

export default MuiShadowDom
