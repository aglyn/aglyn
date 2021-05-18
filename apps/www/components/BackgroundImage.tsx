/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
 */

import { forwardRef, useEffect, useState } from 'react'
import Box, { BoxProps } from '@material-ui/core/Box'
import { Theme, createStyles, WithStyles, withStyles } from '@material-ui/core/styles'
import clsx from 'clsx'


const styles = (theme: Theme) => createStyles({
  root: {
    backgroundColor: 'inherit',
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'bottom center',
    backgroundSize: 'cover',
    backgroundAttachment: (props: any) => props?.parallax ? 'fixed' : undefined,
  },
})

export interface BackgroundImageProps extends BoxProps {
  url: string
  parallax?: boolean
}

const BackgroundImage = forwardRef<any, BackgroundImageProps & WithStyles<typeof styles>>(
  function RefRenderFn(props, ref) {
    const { children, parallax, url, className, classes, ...rest } = props

    return (
      <Box
        // innerRef={ref}
        className={clsx(classes.root, className)}
        component="div"
        style={{
          backgroundImage: `url(${url})`,
        }}
        {...rest}
      >
        {children}
      </Box>
    )
  },
)

BackgroundImage.displayName = 'BackgroundImage'

export default withStyles(styles, { name: 'BackgroundImage' })(BackgroundImage)
