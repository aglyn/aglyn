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
import { AppLink, Container } from '@aglyn/shared-ui-jsx'
import { type GridButtonsProps } from '@aglyn/shared-ui-jsx/components/grid-buttons'
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
          <Stack
            direction="row"
            sx={{
              flexWrap: "wrap",
              alignItems: "center"
            }}>
            <Stack component="div" sx={{
              flexGrow: 1,
              minWidth: 0,
            }}>
              <CopyrightComponent />
            </Stack>

            {/*
              * LINKS, not buttons (AGL-2486). Zach: "probably should just do
              * applinks and not buttons".
              *
              * `componentVariant: 'button'` rendered five MUI buttons, which
              * brought uppercase labels, button padding and a hover surface
              * to what is a row of ordinary footer links — and the padding is
              * most of the "spacing breaks down poorly" he saw, because each
              * label carried its own box before any gap was applied.
              *
              * A plain `AppLink` row instead, with the gap on the container
              * so it wraps evenly at a narrow width rather than each item
              * reserving its own margin.
              */}
            <Stack
              direction="row"
              component="nav"
              sx={{
                alignItems: 'center',
                columnGap: 2,
                rowGap: 0.5,
                flexWrap: 'wrap',
              }}
            >
              {tailNavigation.map((item) => (
                <AppLink
                  key={String(item.children)}
                  href={item.href}
                  target={item.target}
                  rel={item.rel}
                  variant="body2"
                  color="text.secondary"
                  underline="hover"
                >
                  {item.children}
                </AppLink>
              ))}
            </Stack>

            <Stack
              sx={{
                alignItems: "space-around",
                flex: "1 1 auto",
                flexBasis: "100%",
                justifyContent: "center"
              }}>
              {/*
               * `caption`, not `overline` — overline uppercases, so a
               * semantic version and a commit sha rendered as
               * "VERSION 1.0.0-BETA.8 (82F7EAE)". Neither is a word; a sha is
               * hex and a prerelease tag is lowercase by spec, and shouting
               * them makes both harder to read and harder to copy.
               */}
              <Typography
                align="center"
                color="textSecondary"
                variant="caption"
              >
                <span>{`Version ${PACKAGE_VERSION}`}</span>
                {/*
                 * The build id, when there IS one (AGL-2486).
                 *
                 * `BUILD_ID` falls back to the literal string 'NULL' when
                 * nothing set it — deliberately, so an unset build is not
                 * given an invented id nobody can trace (AGL-2181). That is
                 * the right VALUE and the wrong thing to print: the footer
                 * read "Version 1.0.0-beta.6 (NULL)" to every visitor of a
                 * deployment built outside CI, which reads as a fault in the
                 * product rather than an absent stamp.
                 *
                 * Compared against the sentinel rather than falsiness —
                 * `BUILD_ID` is `String(...)`, so it is never empty and never
                 * falsy, and `strictNullChecks` is off repo-wide.
                 */}
                {BUILD_ID === 'NULL' ? null : <>{' '}<span>{`(${BUILD_ID})`}</span></>}
              </Typography>
            </Stack>
          </Stack>
        </Container>
      </Container>
    </Box>
  );
})
FooterComponent.displayName = 'FooterComponent'
FooterComponent.aglyn = true

export { FooterComponent }
export default FooterComponent
