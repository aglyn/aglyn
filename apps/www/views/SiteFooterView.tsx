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

import { AppLink, GridItems } from '@aglyn/shared/ui/react'
import Box from '@material-ui/core/Box'
import Container from '@material-ui/core/Container'
import MuiLink from '@material-ui/core/Link'
import Typography from '@material-ui/core/Typography'
import { ElementType, forwardRef, HTMLAttributes } from 'react'
import { footerNavigation } from '../const'
import NextImage from 'next/image'


export interface SiteFooterViewProps extends HTMLAttributes<HTMLElement> {
  component?: ElementType
}

const SiteFooterView = forwardRef<any, SiteFooterViewProps>(
  function RefRenderFn(props, ref) {
    const {
      children,
      className: propClass,
      ...rest
    } = props

    return (
      <Box
        ref={ref}
        component={'footer'}
        sx={{background: 'none'}}
        {...rest}
      >
        <Box sx={{pt: 4}}>
          {children && (
            <Container maxWidth="lg">
              {children}
            </Container>
          )}
          <Container maxWidth="lg">
            <GridItems
              spacing={2}
              justifyContent="space-between"
              items={[
                {
                  xs: 12, sm: 6, md: 3,
                  children: (
                    <>
                      <NextImage
                        src="/_static/images/brand/aglyn-logo.svg"
                        width={135}
                        height={48}
                        alt="aglyn"
                      />
                      <br/>
                      <br/>
                      <Box fontSize={16}><strong>Mailing Address</strong></Box>
                      125 JOHNSTON LN
                      <br/>
                      JARRELL, TX, 76537-0029
                      <br/>
                      UNITED STATES
                      <br/>
                      <br/>
                      Email: <MuiLink
                      href="mailto:info@aglyn.com"
                      children={'info@aglyn.com'}
                    />
                      <br/>
                    </>
                  ),
                },
                ...footerNavigation.map(({items, ...item}, key) => ({
                  xs: 12 as any, sm: 6 as any, md: 3 as any,
                  children: (
                    <>
                      <Typography variant="overline">
                        <b children={item.children}/>
                      </Typography>
                      <Typography component="ul">
                        {items.map((item, key) => (
                          <li key={key}>
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
      </Box>
    )
  },
)

SiteFooterView.displayName = 'SiteFooterView'

export default SiteFooterView
