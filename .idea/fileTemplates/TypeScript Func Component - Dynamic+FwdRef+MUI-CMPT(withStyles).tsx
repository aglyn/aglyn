/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { ElementType, forwardRef, ReactNode, HTMLAttributes } from 'react'
import { createStyles, Theme, withStyles, WithStyles } from '@mui/styles'
import ${COMPONENT}, { ${COMPONENT}Props } from '@mui/material/${COMPONENT}'
import clsx from 'clsx'


export const ${NAME}Styles = (theme: Theme) => createStyles({
  root: {},
})

export interface ${NAME}Props<C extends React.ElementType> extends ${Mui}Props<C, { component?: C }>, WithStyles<typeof ${NAME}Styles> {

}

export const Unstyled${NAME} = forwardRef<any, ${NAME}Props>(
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

const ${NAME} = withStyles(${NAME}Styles, {
  name: '${NAME}'
})(Unstyled${NAME})
${NAME}.displayName = '${NAME}'
${NAME}.defaultProps = {
  component: 'div',
}

export { ${NAME} }
export default ${NAME}
