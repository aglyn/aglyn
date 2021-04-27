/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

//TODO: FIX ALL TYPINGS AND REFACTOR OPTIONS/PROPS

import React, { HTMLProps, PropsWithChildren, useState } from 'react'

import { jssPreset, StylesProvider } from '@material-ui/core/styles'

import { create } from 'jss'
import rtl from 'jss-rtl'

import { createShadowDomProxy } from '../shadow-dom/shadow-dom'
import useCombinedRefs from '../../hooks/use-combined-refs'

/* eslint-disable-next-line */
export interface MuiShadowDomProps {}

const MuiShadowStylesProvider = React.forwardRef<HTMLProps<HTMLDivElement>, PropsWithChildren<MuiShadowDomProps>>(
  function RefRenderFn(props, ref) {
    const { children } = props
    const [styleNode, setStyleNode] = useState(null)
    const elemRef = useCombinedRefs(setStyleNode, ref)
    const jss = create({
      plugins: [...jssPreset().plugins, rtl()],
      insertionPoint: styleNode,
    })

    return (
      <StylesProvider jss={jss}>
        {styleNode ? children : null}
        <div ref={elemRef} />
      </StylesProvider>
    )
  }
)
MuiShadowStylesProvider.displayName = 'MuiShadowStylesProvider'

export const MuiShadowDom = createShadowDomProxy(
  {},
  {
    keyPrefix: 'mui',
    render: function (props) {
      const { children } = props

      return <MuiShadowStylesProvider>{children}</MuiShadowStylesProvider>
    },
  }
)

export default MuiShadowDom
