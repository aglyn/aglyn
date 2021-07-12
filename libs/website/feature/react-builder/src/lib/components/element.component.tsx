/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { useCombinedRefs, useConfirmationContext } from '@aglyn/shared/ui/react'
import { copyJson } from '@aglyn/shared/util/helpers'
import { forwardRef, useCallback, useRef, useState } from 'react'
import {
  ElementComponent as RenderElementComponent,
  ElementComponentProps as RenderElementComponentProps,
} from '@aglyn/website/feature/react-renderer'
import { useSelectionContext } from '../contexts/selection.context'


export interface ElementComponentProps extends RenderElementComponentProps {
  [prop: string]: any
}

const ElementComponent = forwardRef<any, ElementComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      ...rest
    } = props

    const { confirm } = useConfirmationContext()

    const localRef = useRef(ref)
    const elemRef = useCombinedRefs(localRef, ref)
    const { select } = useSelectionContext()
    const [entered, setEntered] = useState(null)
    const [clientRect, setRect] = useState(null)

    const handleMouseEnter = useCallback((e) => {
      const t = e.target
      console.log('is self', localRef.current)
      if (t && t === localRef.current) setEntered(t)
      else setEntered(null)
      setRect(copyJson(t?.getBoundingClientRect()))
    }, [])

    const handleMouseLeave = useCallback((e) => {
      setEntered(null)
    }, [])

    const handleClick = useCallback((e) => {
      select({ clientRect })
      confirm({ title: 'clicked' })
    }, [clientRect])

    return (
      <RenderElementComponent
        ref={elemRef}
        {...rest}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      />
    )
  },
)

ElementComponent.displayName = 'ElementComponent'
ElementComponent.defaultProps = {
  elementComponent: ElementComponent,
}

export default ElementComponent
