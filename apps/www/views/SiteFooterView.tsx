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

import { AppLink, Container, GridItems } from '@aglyn/shared-ui-jsx'
import { styled } from '@aglyn/shared-ui-theme'
import { Box, Link as MuiLink, Typography } from '@mui/material'
import NextImage from 'next/image'
import { type ElementType, forwardRef, type HTMLAttributes } from 'react'
import { footerNavigation } from '../const'

const FooterElement = styled('footer', {
  name: 'FooterElement',
})({
  background: 'none',
})

export interface SiteFooterViewProps extends HTMLAttributes<HTMLDivElement> {
  component?: ElementType
}

const SiteFooterView = forwardRef<HTMLDivElement, SiteFooterViewProps>(
  function RefRenderFn(props, ref) {
    const { children, className: propClass, ...rest } = props

    return (
      <FooterElement ref={ref} {...rest}>
        <Box sx={{ pt: 4 }}>
          {children && <Container maxWidth="lg">{children}</Container>}
          <Container maxWidth="lg">
            <GridItems
              spacing={2}
              justifyContent="space-between"
              items={[
                {
                  size: {
                    xs: 12,
                    sm: 6,
                    md: 3,
                  },
                  children: (
                    <>
                      <NextImage
                        src="/_static/images/brand/aglyn-logo.svg"
                        width={135}
                        height={48}
                        alt="aglyn"
                      />
                      <br />
                      <br />
                      <Box sx={{
                        fontSize: 16
                      }}>
                        <strong>Mailing Address</strong>
                      </Box>
                      125 JOHNSTON LN
                      <br />
                      JARRELL, TX, 76537-0029
                      <br />
                      UNITED STATES
                      <br />
                      <br />
                      Email:{' '}
                      <MuiLink href="mailto:info@aglyn.com">
                        {'info@aglyn.com'}
                      </MuiLink>
                      <br />
                    </>
                  ),
                },
                ...footerNavigation.map(({ items, ...item }, key) => ({
                  size: {
                    xs: 12,
                    sm: 6,
                    md: 3,
                  },
                  children: (
                    <>
                      <Typography variant="overline">
                        <b>{item.children}</b>
                      </Typography>
                      <Typography component="ul">
                        {items.map((item, key) => (
                          <li key={item?.key ?? item?.id ?? key}>
                            <AppLink {...item} />
                          </li>
                        ))}
                      </Typography>
                    </>
                  ),
                })),
              ]}
            />
          </Container>
        </Box>
      </FooterElement>
    );
  },
)

SiteFooterView.displayName = 'SiteFooterView'
SiteFooterView.aglyn = true
export { SiteFooterView }
export default SiteFooterView
