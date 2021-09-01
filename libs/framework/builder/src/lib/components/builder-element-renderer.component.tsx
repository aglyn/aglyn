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

import { useCombinedRefs, useConfirmationContext } from '@aglyn/shared/ui/react'
import { forwardRef, useCallback, useRef, useState } from 'react'
import { ElementRendererComponent, ElementRendererComponentProps } from '@aglyn/framework/renderer'
import { useSelectionContext } from '../contexts/selection-context'


export interface BuilderElementRendererComponentProps extends ElementRendererComponentProps {
  [prop: string]: any
}

export const BuilderElementRendererComponent = forwardRef<any, BuilderElementRendererComponentProps>(
  function RefRenderFn(props, ref) {
    const {
      elementData,
      elementRendererComponent,
      ...rest
    } = props
    const {confirm} = useConfirmationContext()
    const localRef = useRef(ref)
    const elemRef = useCombinedRefs(localRef, ref)
    const {select} = useSelectionContext()
    const [entered, setEntered] = useState(null)
    const [clientRect, setRect] = useState(null)

    const handleMouseEnter = useCallback((e) => {
      const target = e.target
      if (target && target === localRef.current) setEntered(target)
      else setEntered(null)
      setRect(target?.getBoundingClientRect?.().toJSON?.())
    }, [])

    const handleMouseLeave = useCallback((e) => {
      setEntered(null)
    }, [])

    const handleClick = useCallback((e) => {
      e.stopPropagation()
      select({clientRect, elementData})
      confirm({title: 'clicked'})
    }, [clientRect, elementData])

    return (
      <ElementRendererComponent
        ref={elemRef}
        elementRendererComponent={elementRendererComponent ?? BuilderElementRendererComponent}
        elementData={elementData}
        data-aglyn-element-component={elementData?.component}
        data-aglyn-element-id={elementData?.$id}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        {...rest}
      />
    )
  },
)

BuilderElementRendererComponent.displayName = 'BuilderElementRendererComponent'
BuilderElementRendererComponent.defaultProps = {
}

export default BuilderElementRendererComponent
