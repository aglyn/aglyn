/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import ElementsContext from '../contexts/elements.context'
import { ReactNode, useState } from 'react'
import Website from '@aglyn/website/core'


export interface ElementsProviderComponentProps {
  children?: ReactNode
  elements?: Website.ElementData[]
}

function ElementsProviderComponent(props: ElementsProviderComponentProps) {
  const { children, elements } = props
  const [ctx, setCtx] = useState({elements})

  return (
    <ElementsContext.Provider value={ctx}>
      {children}
    </ElementsContext.Provider>
  )
}

ElementsProviderComponent.defaultProps = {
  elements: []
}
export default ElementsProviderComponent
