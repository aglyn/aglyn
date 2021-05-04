/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { useClientRect, useCombinedRefs, ComponentProp, useConfirmationContext } from '@aglyn/shared/ui/react'
import { copyJson } from '@aglyn/shared/util/helpers'
import { forwardRef, Fragment, useCallback, useRef, useState } from 'react'
import { ElementComponent as RenderElementComponent } from '@aglyn/website/feature/react-renderer'


export interface ElementComponentProps extends ComponentProp {

}

export const ElementComponent = forwardRef<any, ElementComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      component: Component,
      ...rest
    } = props

    const confirm = useConfirmationContext()

    const localRef = useRef(ref)
    const elemRef = useCombinedRefs(localRef, ref)
    const [entered, setEntered] = useState(false)
    const [selected, setSelected] = useState(false)
    const [clientRect, setRect] = useState(null)

    const handleMouseEnter = useCallback((e) => {
      const t = e.target
      console.log('is self', localRef.current)
      if (t && t === localRef.current) setEntered(t)
      else setEntered(false)
      setRect(copyJson(t?.getBoundingClientRect()))
    }, [])

    const handleMouseLeave = useCallback((e) => {
      setEntered(false)
    }, [])

    const handleClick = useCallback((e) => {
      setSelected(prev => !prev)
      confirm({
        title: 'Success!',
        description: 'You clicked an element!'
      })
    }, [])

    return (
      <Fragment>
        {(entered || selected) && (
          <span
            style={{
              ...clientRect,
              position: 'absolute',
              outline: `2px solid #40d0f4`,
              outlineOffset: -2,
              pointerEvents: 'none',
            }}
          />
        )}
        <Component
          {...rest}
          ref={elemRef}
          onClick={handleClick}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        />
      </Fragment>
    )
  }
)

ElementComponent.displayName = 'ElementComponent'
ElementComponent.defaultProps = {
  component: RenderElementComponent,
}

export default ElementComponent
