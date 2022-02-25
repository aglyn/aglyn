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

import {APP_CONSOLE} from '@aglyn/shared-data-enums'
import {mergeSxProps} from '@aglyn/shared-feature-themes'
import {
  AglynSvgIcon,
  AglynSvgLogo,
  AppLink,
  type AppLinkProps,
  ElevateOnScroll,
  Menu,
} from '@aglyn/shared-ui-jsx'
import {MdiIcon, type MdiIconProps} from '@aglyn/shared-ui-mdi-jsx'
import {_isArr} from '@aglyn/shared-util-guards'
import {
  AppBar,
  Avatar,
  IconButton,
  type IconButtonProps,
  Stack,
  Toolbar,
  Typography,
} from '@mui/material'
import Head from 'next/head'
import {Fragment, type ReactNode} from 'react'


export const TOP_BAR_HEIGHT = 52

// eslint-disable-next-line react/display-name
const buildNav = (type?: 'icon' | 'text') => (item, i) => {
  const {
    avatar,
    icon,
    children,
    id,
    key,
    items,
    sx,
    ...rest
  } = item
  const itemKey = key || id || i
  const inner = (
    <>
      {!avatar
        ? !icon.path || !icon ? icon : (<MdiIcon {...icon} />)
        : (<Avatar {...avatar} sx={{bgcolor: 'grey.500'}} />)
      }
      {children}
    </>
  )
  const rendered = type === 'text' ? (
    <AppLink
      key={key}
      id={id}
      componentVariant="button"
      color="inherit"
      sx={mergeSxProps({p: avatar ? 0.5 : undefined}, sx)}
      {...rest}
    >
      {inner}
    </AppLink>
  ) : (
    <IconButton
      key={itemKey}
      color="inherit"
      sx={sx}
      {...rest}
    >
      {inner}
    </IconButton>
  )

  return _isArr(items) ? (
    <Menu
      key={itemKey}
      items={items}
      sx={{
        p: {padding: 0.5, xs: 0.25},
        '&:last-child': {
          paddingLeft: 0.75,
        },
      }}
    >
      {rendered}
    </Menu>
  ) : (
    <Fragment key={itemKey}>
      {rendered}
    </Fragment>
  )
}

export interface QuickActionsMenuItem extends IconButtonProps {
  icon?: MdiIconProps
  avatar?: any
  dense?: boolean
  href?: any
  items?: QuickActionsMenuItem[]
}

export interface LayoutMainProps {
  children?: ReactNode | undefined
  title?: ReactNode[] | ReactNode
  centerNavigationItems?: Array<AppLinkProps>
  quickActions?: QuickActionsMenuItem[]
  appBarSuffix?: ReactNode
  disableAppBarElevation?: boolean
}

function LayoutMainComponent(props: LayoutMainProps) {
  const {
    children,
    title,
    centerNavigationItems,
    appBarSuffix,
    quickActions,
    disableAppBarElevation,
  } = props


  return (
    <Fragment>
      <Head>
        <title>
          {!title
            ? APP_CONSOLE.TITLE
            : [
              ..._isArr(title) ? title : [title],
              APP_CONSOLE.AFFIX,
            ].join(` ${APP_CONSOLE.SEP} `)
          }
        </title>
      </Head>
      <Stack
        alignItems="stretch"
        flexDirection="column"
        minHeight="100vh"
      >
        <ElevateOnScroll
          renderProps={(elevated) => ({
            elevation: elevated && !disableAppBarElevation ? 4 : 0,
          })}
        >
          <AppBar
            component="header"
            color="inherit"
            variant="elevation"
            position={disableAppBarElevation ? 'relative' : 'sticky'}
            enableColorOnDark
            sx={{
              borderBottomWidth: `1px`,
              borderBottomStyle: 'solid',
              borderBottomColor: 'divider',
              zIndex: theme => theme.zIndex.appBar + 5,
            }}
          >
            <Stack
              component={Toolbar}
              variant="dense"
              alignItems="center"
              justifyContent="flex-start"
              direction="row"
              height={TOP_BAR_HEIGHT}
            >
              <Stack
                flexGrow={1}
                alignItems="center"
                direction="row"
                justifyContent="flex-start"
                color="inherit"
                component={AppLink}
                componentVariant="button-base"
                anchorComponent="button"
                href="/"
                disableRipple
                spacing={0.75}
                sx={{
                  fontWeight: 'fontWeightRegular',
                  fontFamily: 'h6.fontFamily',
                  fontSize: (theme) => ({
                    fontSize: theme.typography.pxToRem(18),
                    md: theme.typography.pxToRem(20),
                  }),
                }}
              >
                <AglynSvgIcon
                  sx={{
                    fontSize: `1.75em`,
                    borderRadius: theme => theme.shape.appIconBorderRadius,
                    ml: -0.5,
                  }}
                />
                <AglynSvgLogo
                  color="secondary"
                  sx={{
                    transform: 'translateY(0.0265em)',
                    height: 'auto',
                    fontSize: '2.765em',
                  }}
                />
                {appBarSuffix && (
                  <Typography
                    component="span"
                    fontWeight="inherit"
                    fontSize="inherit"
                    lineHeight="inherit"
                    color="textPrimary"
                    display="flex"
                    alignItems="center"
                  >
                    {appBarSuffix}
                  </Typography>
                )}
              </Stack>
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="flex-start"
                flexBasis="72%"
                flexGrow={1}
              >
                {(centerNavigationItems ?? []).map(buildNav('text'))}
              </Stack>
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="flex-start"
                spacing={0.5}
              >
                {(quickActions ?? []).map(buildNav('icon'))}
              </Stack>
            </Stack>
          </AppBar>
        </ElevateOnScroll>
        {children}
      </Stack>
    </Fragment>
  )
}

LayoutMainComponent.displayName = 'LayoutMainComponent'
LayoutMainComponent.defaultProps = {}

export {LayoutMainComponent}
export default LayoutMainComponent
