import React, { HTMLProps, PropsWithChildren, useState } from 'react'

import { jssPreset, StylesProvider } from '@material-ui/core/styles'

import { create } from 'jss'
import rtl from 'jss-rtl'

import { createShadowDomProxy } from '../shadow-dom/shadow-dom'
import useCombinedRefs from '../hooks/use-combined-refs'


/* eslint-disable-next-line */
export interface MuiShadowDomProps {}

const MuiStylesProvider = React.forwardRef<HTMLProps<HTMLDivElement>, PropsWithChildren<MuiShadowDomProps>>(
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
MuiStylesProvider.displayName = 'MuiStylesProvider'

export const MuiShadowDom = createShadowDomProxy({}, {
  keyPrefix: 'mui',
  renderFn: function renderFn(props) {
    const { children } = props

    return (
      <MuiStylesProvider>
        {children}
      </MuiStylesProvider>
    )
  }
})

export default MuiShadowDom
