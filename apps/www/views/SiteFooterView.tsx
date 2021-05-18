/**
 * @license
 * Copyright (c) 2021 Aglyn LLC
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the root directory of this source tree.
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
          <Container maxWidth="lg">
            {children}
          </Container>
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
                {
                  xs: 12, sm: 6, md: 3,
                  children: (
                    <>
                      <Typography variant="overline"><b>Resources</b></Typography>
                      <Typography component="ul">
                        <li>
                          <Link
                            href="/features"
                            children="Features"
                            className={classes.link}
                          />
                        </li>
                        <li>
                          <Link
                            href="/get"
                            children="Get access"
                            className={classes.link}
                          />
                        </li>
                      </Typography>
                    </>
                  ),
                },
                {
                  xs: 12, sm: 6, md: 3,
                  children: (
                    <>
                      <Typography variant="overline"><b>Company</b></Typography>
                      <Typography component="ul">
                        <li>
                          <Link
                            href="/contact"
                            children="Contact"
                            className={classes.link}
                          />
                        </li>
                        <li>
                          <Link
                            href="/partners"
                            children="Partners"
                            className={classes.link}
                          />
                        </li>
                      </Typography>
                    </>
                  ),
                },
                {
                  xs: 12, sm: 6, md: 3,
                  children: (
                    <>
                      <Typography variant="overline"><b>Legal</b></Typography>
                      <Typography component="ul">
                        <li>
                          <Link
                            href="/legal/privacy"
                            children="Privacy"
                            className={classes.link}
                          />
                        </li>

                      </Typography>
                    </>
                  ),
                },
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
