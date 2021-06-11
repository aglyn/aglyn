/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { ElementType, forwardRef, ReactNode, HTMLAttributes } from 'react'
import { createStyles, Theme, withStyles, WithStyles } from '@material-ui/core/styles'
import clsx from 'clsx'


export const ${NAME}Styles = (theme: Theme) => createStyles({
  root: {},
})

export interface ${NAME}Props extends HTMLAttributes<HTMLElement> {
  component?: ElementType
}

const ${NAME} = forwardRef<any, ${NAME}Props & WithStyles<typeof ${NAME}Styles>>(
  function RefRenderFn(props, ref) {
    const { 
      children,
      component: Component,
      className: classNameProp,
      classes,
      ...rest
    } = props
    const className = clsx(classes.root, classNameProp)

    return (
      <Component 
        ref={ref}
        className={className} 
        {...rest}
      >
        {children}
      </Component>
    )
  }
)

${NAME}.displayName = '${NAME}'
${NAME}.defaultProps = {
  component: 'div',
}

export default withStyles(${NAME}Styles, {name: '${NAME}'})(${NAME})
