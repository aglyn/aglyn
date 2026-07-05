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

import { AglynLogoFull } from '@aglyn/shared-ui-jsx'
import {
  Paper,
  Stack,
  type StackProps,
  Typography,
  type TypographyProps,
} from '@mui/material'
import { forwardRef } from 'react'

export interface AuthFormProps extends StackProps {
  paperTop?: JSX.Node
  headingTop?: JSX.Node
  headingTopProps?: TypographyProps<any, any>
  headingBottom?: JSX.Node
  headingBottomProps?: TypographyProps<any, any>
  headingAfter?: JSX.Node
  paperAfter?: JSX.Node
}

const AuthFormComponent = forwardRef<any, AuthFormProps>((props, ref) => {
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
      spacing={2}
      {...rest}
      sx={[{
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        maxWidth: 1,
        width: 420
      }, ...(Array.isArray(rest.sx) ? rest.sx : [rest.sx])]}>
      <Paper variant="outlined" sx={{ p: 2, width: 420, maxWidth: 1 }}>
        <Stack
          direction="column"
          spacing={1}
          sx={{
            justifyContent: "center",
            alignItems: "center",
            marginBottom: 4
          }}>
          {paperTop}

          <Stack
            direction="row"
            spacing={1}
            sx={{
              justifyContent: "center",
              alignItems: "center",
              pb: 3
            }}>
            <AglynLogoFull sx={{ fontSize: 100 }} />
          </Stack>

          {headingTop && (
            <Typography component="h1" variant="h4" {...headingTopProps}>
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
  );
})
AuthFormComponent.displayName = 'AuthFormComponent'
AuthFormComponent.aglyn = true

export default AuthFormComponent
