/**
 * @license
 * Copyright 2024 Aglyn LLC
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
'use client'

import { BUILD_ID, PACKAGE_VERSION } from '@aglyn/shared-data-enums'
import {
  AppLink,
  Container,
  GridButtons,
  type GridButtonsProps,
} from '@aglyn/shared-ui-jsx'
import { Box, Divider, Stack, Typography } from '@mui/material'
import { forwardRef, type HTMLAttributes } from 'react'
import CopyrightComponent from '../components/copyright.component'
import { tailNavigation } from '../constants/shared'

export const FOOTER_MAX_WIDTH = 'xl'

export interface FooterProps extends HTMLAttributes<HTMLDivElement> {
  items?: GridButtonsProps['items']
}

const FooterComponent = forwardRef<any, FooterProps>((props, ref) => {
  const { children, ...rest } = props
  return (
    <Box ref={ref} component="footer" {...rest}>
      <Container maxWidth={FOOTER_MAX_WIDTH} sx={{ mt: 6, pb: 1 }}>
        <Divider sx={{ mb: 2 }} />
        <Container dense maxWidth={false}>
          <Stack flexWrap="wrap" alignItems="center" direction="row">
            <Stack component="div" flexGrow={1}>
              <CopyrightComponent />
            </Stack>

            <Stack display="flex">
              <GridButtons
                spacing={1}
                ItemComponent={AppLink}
                items={tailNavigation.map((i) => ({
                  size: 'small',
                  componentVariant: 'button',
                  ...i,
                }))}
              />
            </Stack>

            <Stack
              alignItems="space-around"
              flex="1 1 auto"
              flexBasis="100%"
              justifyContent="center"
            >
              <Typography
                align="center"
                color="textSecondary"
                variant="overline"
              >
                <span>{`Version ${PACKAGE_VERSION}`}</span>{' '}
                <span>{`(${BUILD_ID})`}</span>
              </Typography>
            </Stack>
          </Stack>
        </Container>
      </Container>
    </Box>
  )
})
FooterComponent.displayName = 'FooterComponent'
FooterComponent.aglyn = true

export { FooterComponent }
export default FooterComponent
