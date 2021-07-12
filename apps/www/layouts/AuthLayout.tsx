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

import { forwardRef, useEffect, useState } from 'react'
import Box, { BoxProps } from '@material-ui/core/Box'
import Container from '@material-ui/core/Container'
import { Theme, createStyles, WithStyles, withStyles } from '@material-ui/core/styles'
import Typography from '@material-ui/core/Typography'
import Slide from '@material-ui/core/Slide'
import Copyright from '../components/Copyright'
import clsx from 'clsx'
import { AglynIcon } from '@aglyn/shared/ui/react'
import BackgroundImage from '../components/BackgroundImage'


const styles = (theme: Theme) => createStyles({
  root: {
    color: theme.palette.text.primary
  },
  logo: {
    height: 'auto',
    width: 320,
    maxWidth: '100%',
    marginBottom: theme.spacing(4),
  },
  copyright: {
    position: 'absolute',
    bottom: theme.spacing(1),
    left: theme.spacing(2),
  },
})

export interface AuthLayoutProps extends BoxProps {
  text: string
}

const AuthLayout = forwardRef<any, AuthLayoutProps & WithStyles<typeof styles>>(
  function RefRenderFn(props, ref) {
    const { text, children, className, classes, ...rest } = props
    const [animated, setAnimated] = useState({ left: false, right: false })

    useEffect(() => {
      let leftAnimationTimeout = null
      let rightAnimationTimeout = null

      function animate(which: string) {
        setAnimated(prev => ({ ...prev, [which]: true }))
      }
      leftAnimationTimeout = setTimeout(animate, 700, 'left')
      rightAnimationTimeout = setTimeout(animate, 500, 'right')

      return () => {
        leftAnimationTimeout && clearTimeout(leftAnimationTimeout)
        rightAnimationTimeout && clearTimeout(rightAnimationTimeout)
      }
    }, [])

    return (
      <BackgroundImage
        ref={ref}
        alignItems="stretch"
        className={clsx(classes.root, className)}
        display="flex"
        height="100vh"
        url={"/backgrounds/patterns/abstract-wave-lines.svg"}
        fixed
        {...rest}
      >
        <Box alignItems="center" display="flex" flexGrow={1}>
          <Container maxWidth="lg">
            <Slide direction="up" in={animated.left} mountOnEnter unmountOnExit>
              <div>
                <AglynIcon className={classes.logo} />
                <Typography
                  children={text}
                  variant="h2"
                />
              </div>
            </Slide>
            <Copyright className={classes.copyright} />
          </Container>
        </Box>
        <Slide direction="left" in={animated.right} mountOnEnter unmountOnExit>
          <Box alignItems="center" bgcolor="common.white" display="flex" width={450}>
            <Container>
              {children}
            </Container>
          </Box>
        </Slide>
      </BackgroundImage>
    )
  },
)

AuthLayout.displayName = 'Layout:AuthLayout'

export default withStyles(styles, { name: 'Layout:AuthLayout' })(AuthLayout)
