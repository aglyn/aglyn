/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import { AglynSvgLogo, Container } from '@aglyn/shared-ui-jsx'
import { styled } from '@aglyn/shared-ui-theme'
import { Box, Slide, Typography } from '@mui/material'
import { forwardRef, useEffect, useState } from 'react'
import BackgroundImage, {
  type BackgroundImageProps,
} from '../components/BackgroundImage'
import Copyright from '../components/Copyright'

const AuthLayoutBackground = styled(BackgroundImage, {
  name: 'AglynAuthLayoutBackground',
})(({ theme }) => ({
  color: theme.palette.text.primary,
}))
const AuthLayoutLogo = styled(AglynSvgLogo, {
  name: 'AglynAuthLayoutLogo',
})(({ theme }) => ({
  height: 'auto',
  width: 320,
  maxWidth: '100%',
  marginBottom: theme.spacing(4),
}))
const AuthLayoutCopyright = styled(Copyright, {
  name: 'AglynAuthLayoutCopyright',
})(({ theme }) => ({
  position: 'absolute',
  bottom: theme.spacing(1),
  left: theme.spacing(2),
}))

export interface AuthLayoutProps extends BackgroundImageProps {
  text: string
}

const AuthLayout = forwardRef<any, AuthLayoutProps>(
  function RefRenderFn(props, ref) {
    const { text, children, classes, ...rest } = props
    const [animated, setAnimated] = useState({ left: false, right: false })

    useEffect(() => {
      let leftAnimationTimeout = null
      let rightAnimationTimeout = null

      function animate(which: string) {
        setAnimated((prev) => ({ ...prev, [which]: true }))
      }
      leftAnimationTimeout = setTimeout(animate, 700, 'left')
      rightAnimationTimeout = setTimeout(animate, 500, 'right')

      return () => {
        leftAnimationTimeout && clearTimeout(leftAnimationTimeout)
        rightAnimationTimeout && clearTimeout(rightAnimationTimeout)
      }
    }, [])

    return (
      <AuthLayoutBackground
        ref={ref}
        alignItems="stretch"
        display="flex"
        height="100vh"
        url={'/_static/images/backgrounds/patterns/abstract-wave-lines.svg'}
        fixed
        {...rest}
      >
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            flexGrow: 1,
          }}
        >
          <Container maxWidth="lg">
            <Slide direction="up" in={animated.left} mountOnEnter unmountOnExit>
              <div>
                <AuthLayoutLogo />
                <Typography variant="h2">{text}</Typography>
              </div>
            </Slide>
            <AuthLayoutCopyright />
          </Container>
        </Box>
        <Slide direction="left" in={animated.right} mountOnEnter unmountOnExit>
          <Box
            sx={{
              alignItems: 'center',
              bgcolor: 'common.white',
              display: 'flex',
              width: 450,
            }}
          >
            <Container>{children}</Container>
          </Box>
        </Slide>
      </AuthLayoutBackground>
    )
  },
)

AuthLayout.displayName = 'AuthLayout'
AuthLayout.aglyn = true

export default AuthLayout
