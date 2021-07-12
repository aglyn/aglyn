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

import { GridItems } from '@aglyn/shared/ui/react'
import { _isArr, ln } from '@aglyn/shared/util/helpers'
import Box from '@material-ui/core/Box'
import Container from '@material-ui/core/Container'
import MuiLink from '@material-ui/core/Link'
import { createStyles, Theme, withStyles, WithStyles } from '@material-ui/core/styles'
import Typography from '@material-ui/core/Typography'
import clsx from 'clsx'
import React, { ElementType, forwardRef, HTMLAttributes } from 'react'
import BackgroundImage from '../components/BackgroundImage'
import Link from '../components/Link'
import { footerNavigation } from '../const'


export const SiteFooterStyles = (theme: Theme) => createStyles({
  root: {
    background: 'none',
  },
  /* LEAVE EMPTY */
  link: {},
})

export interface SiteFooterViewProps extends HTMLAttributes<HTMLElement> {
  component?: ElementType
}

const SiteFooterView = forwardRef<any, SiteFooterViewProps & WithStyles<typeof SiteFooterStyles>>(
  function RefRenderFn(props, ref) {
    const {
      children,
      component: Component,
      className: propClass,
      classes,
      ...rest
    } = props
    const className = clsx(classes.root, propClass)

    return (
      <Component
        ref={ref}
        className={className}
        {...rest}
      >
        <Box pt={4}>
          {children && (
            <Container maxWidth="lg">
              {children}
            </Container>
          )}
          <Container maxWidth="lg">
            <GridItems
              spacing={2}
              justify="space-between"
              items={[
                {
                  xs: 12, sm: 6, md: 3,
                  children: (
                    <>
                      <img
                        src="/brand/logo.svg"
                        width={150}
                        height={'auto'}
                        alt="aglyn logo"
                      />
                      <br />
                      <br />
                      <Box fontSize={16}><strong>Mailing Address</strong></Box>
                      125 JOHNSTON LN<br />
                      JARRELL, TX, 76537-0029<br />
                      UNITED STATES<br />
                      <br />
                      Email: <MuiLink
                      href="mailto:info@aglyn.com"
                      children={'info@aglyn.com'}
                    /><br />
                    </>
                  ),
                },
                ...footerNavigation.map(({ items, ...item }, key) => ({
                  xs: 12 as any, sm: 6 as any, md: 3 as any,
                  children: (
                    <>
                      <Typography variant="overline">
                        <b children={item.children} />
                      </Typography>
                      <Typography component="ul">
                        {items.map((item, key) => (
                          <li key={key}>
                            <Link
                              {...item}
                              className={classes.link}
                            />
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
      </Component>
    )
  },
)

SiteFooterView.displayName = 'SiteFooterView'
SiteFooterView.defaultProps = {
  component: 'footer',
}

export default withStyles(SiteFooterStyles, { name: 'SiteFooterView' })(SiteFooterView)
