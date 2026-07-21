/**
 * @license
 * Copyright 2026 Aglyn LLC
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

import {
  BackgroundImageComponent,
  type BackgroundImageComponentProps,
  Container,
} from '@aglyn/shared-ui-jsx'
import { MdiIcon, type MdiIconProps } from '@aglyn/shared-ui-jsx'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import { Grid, Stack, Typography, type TypographyProps } from '@mui/material'
import { useMemo } from 'react'
import { isElement } from 'react-is'
import BreadcrumbsComponent, {
  type BreadcrumbsProps,
} from '../components/breadcrumbs.component'
import DocsHelpTip from '../components/docs-help-tip.component'
import type { DocsHelpTopicKey } from '../constants/docs-links'
import { CONTENT_MAX_WIDTH } from '../constants/shared'

export interface DashboardHeaderProps
  extends Partial<BackgroundImageComponentProps> {
  children?: JSX.Children
  breadcrumbItems?: BreadcrumbsProps['items']
  disableBreadcrumbs?: true
  header?: TypographyProps<any, any> & {
    icon?: MdiIconProps | JSX.Children
  }
  headerRight?: JSX.Children
  /** Docs topic for the header's help affordance (AGL-599). */
  help?: DocsHelpTopicKey
}

export function DashboardHeaderComponent(props: DashboardHeaderProps) {
  const {
    children,
    header,
    breadcrumbItems = [],
    disableBreadcrumbs = false,
    headerRight,
    help,
    ...rest
  } = props

  const {
    children: headerChildren,
    sx: headerSx,
    icon: headerIcon,
    ...headerProps
  } = header || {}

  const breadcrumbs = useMemo(() => {
    return Array.isArray(breadcrumbItems) ? breadcrumbItems : []
  }, [breadcrumbItems])

  return (
    <BackgroundImageComponent
      component="header"
      url="/_static/images/backgrounds/patterns/abstract-wave-lines.svg"
      bgPosition="50% 90%"
      sx={{
        pt: 10,
        pb: 2,
        bgcolor: 'surface.main',
        color: 'text.primary',
        borderBottomWidth: `1px`,
        borderBottomStyle: 'solid',
        borderBottomColor: 'divider',
      }}
      {...rest}
    >
      <Container maxWidth={CONTENT_MAX_WIDTH}>
        <Grid
          container
          direction="row"
          spacing={2}
          sx={{
            justifyContent: "space-between",
            alignItems: "center"
          }}>
          <Grid>
            <Stack>
              <Typography
                component="h1"
                variant="h4"
                sx={mergeSxProps(
                  {
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                  },
                  headerSx,
                )}
                {...headerProps}
              >
                {!headerIcon || isElement(headerIcon) ? (
                  headerIcon
                ) : (
                  <MdiIcon
                    color="inherit"
                    {...headerIcon}
                    sx={mergeSxProps(
                      {
                        padding: 1,
                        mr: 1.75,
                        fontSize: `1.5em`,
                        borderWidth: `1px`,
                        borderStyle: 'solid',
                        borderColor: 'tertiary.dark',
                        color: 'tertiary.contrastText',
                        bgcolor: 'tertiary.main',
                        borderRadius: (theme) =>
                          `${theme.shape.appIconBorderRadius}`,
                      },
                      headerIcon['sx'],
                    )}
                  />
                )}
                {headerChildren}
                {help && (
                  <DocsHelpTip
                    topic={help}
                    sx={{ ml: 1, fontSize: '0.55em' }}
                  />
                )}
              </Typography>

              {disableBreadcrumbs ? null : (
                <BreadcrumbsComponent
                  items={breadcrumbs}
                  sx={{
                    my: 2,
                    marginTop: 1,
                    color: 'text.primary',
                    a: {
                      textDecoration: 'none',
                      ':hover': {
                        color: 'secondary.main',
                      },
                    },
                  }}
                />
              )}
            </Stack>
          </Grid>

          {headerRight && <Grid>{headerRight}</Grid>}
        </Grid>
        {children}
      </Container>
    </BackgroundImageComponent>
  );
}
DashboardHeaderComponent.displayName = 'DashboardHeaderComponent'
DashboardHeaderComponent.aglyn = true

export default DashboardHeaderComponent
