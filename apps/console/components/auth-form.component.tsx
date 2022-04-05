/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import {AglynSvgIcon, AglynSvgLogo} from '@aglyn/shared-ui-jsx'
import {Paper, Stack, type StackProps, Typography, type TypographyProps} from '@mui/material'
import type {ReactNode} from 'react'
import {forwardRef} from 'react'


export interface AuthFormProps extends StackProps {
  paperTop?: ReactNode
  headingTop?: ReactNode
  headingTopProps?: TypographyProps<any, any>
  headingBottom?: ReactNode
  headingBottomProps?: TypographyProps<any, any>
  headingAfter?: ReactNode
  paperAfter?: ReactNode
}

const AuthFormComponent = forwardRef<any, AuthFormProps>(
  function RefRenderFn(props, ref) {
    const {
      paperTop,
      headingTop,
      headingTopProps,
      headingBottom,
      headingBottomProps,
      headingAfter,
      paperAfter,
      children,
      ...rest
    } = props

    return (
      <Stack
        ref={ref}
        direction="column"
        justifyContent="center"
        alignItems="center"
        textAlign="center"
        spacing={2}
        maxWidth={1}
        width={420}
        {...rest}
      >
        <Paper
          variant="outlined"
          sx={{p: 2, width: 420, maxWidth: 1}}
        >
          <Stack
            direction="column"
            justifyContent="center"
            alignItems="center"
            spacing={1}
            marginBottom={4}
          >
            {paperTop}

            <Stack
              direction="row"
              justifyContent="center"
              alignItems="center"
              spacing={1}
              sx={{pb: 3}}
            >
              <AglynSvgIcon rounded bordered sx={{fontSize: 24}} />
              <AglynSvgLogo sx={{fontSize: 64, transform: `translateY(0.12rem)`}} />
            </Stack>

            {headingTop && (
              <Typography
                component="h1"
                variant="h4"
                {...headingTopProps}
              >
                {headingTop}
              </Typography>
            )}
            {headingBottom && (
              <Typography
                component="div"
                variant="h6"
                align="center"
                {...headingBottomProps}
              >
                {headingBottom}
              </Typography>
            )}
            {headingAfter}
          </Stack>

          {children}
        </Paper>

        {paperAfter}
      </Stack>
    )
  }
)
AuthFormComponent.displayName = 'AuthFormComponent'
AuthFormComponent.aglyn = true

export default AuthFormComponent
