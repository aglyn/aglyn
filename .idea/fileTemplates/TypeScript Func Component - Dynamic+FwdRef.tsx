/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { ElementType, forwardRef, HTMLAttributes } from 'react'


export interface ${NAME}Props extends HTMLAttributes<HTMLElement> {
  component?: ElementType
}

export const ${NAME} = forwardRef<any, ${NAME}Props>(
  function RefRenderFn(props, ref) {
    const { 
      children,
      component: Component,
      ...rest
    } = props

    return (
      <Component ref={ref} {...rest}>
        {children}
      </Component>
    )
  }
)

${NAME}.displayName = '${NAME}'
${NAME}.defaultProps = {
  component: 'div',
}

export default ${NAME}
