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

import { Container } from '@aglyn/shared-ui-jsx'
import { BackgroundImageComponent, type BackgroundImageComponentProps } from '@aglyn/shared-ui-jsx/components/background-image.component'
import { MdiIcon, type MdiIconProps } from '@aglyn/shared-ui-jsx'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import { Box, Grid, Stack, Typography, type TypographyProps } from '@mui/material'
import { useMemo } from 'react'
import { isElement } from 'react-is'
import BreadcrumbsComponent, {
  type BreadcrumbsProps,
} from '../components/breadcrumbs.component'
import DocsHelpTip from '../components/docs-help-tip.component'
import type {
  DocsHelpTarget,
  DocsHelpTopicKey,
} from '../constants/docs-links'
import { CONTENT_MAX_WIDTH } from '../constants/shared'

export interface DashboardHeaderProps
  extends Partial<BackgroundImageComponentProps> {
  children?: JSX.Children
  breadcrumbItems?: BreadcrumbsProps['items']
  disableBreadcrumbs?: true
  header?: TypographyProps<any, any> & {
    icon?: MdiIconProps | JSX.Children
    /**
     * The subpage the reader is standing on, shown after the surface name.
     *
     * A surface with a vertical section rail keeps ONE title across every
     * section it holds, so the heading of `/marketing/campaigns` and of
     * `/marketing/overlays` read the same. This names the section without
     * replacing the surface: the reader still learns which surface they are
     * on, and the heading now says which part of it.
     *
     * Rendered inside the same `h1` rather than as a second heading — it is
     * one page with one title, and a second `h1` would say otherwise to a
     * screen reader walking the document outline.
     */
    secondary?: JSX.Children
  }
  headerRight?: JSX.Children
  /**
   * Docs destination for the header's help affordance (AGL-599).
   *
   * A bare topic key opens the top of that page. `{ topic, anchor }` opens the
   * heading the reader is actually standing in front of (AGL-2200) — the whole
   * of `/admin` used to share one destination, so eight staff surfaces offered
   * the same tooltip and the same link.
   */
  help?: DocsHelpTopicKey | DocsHelpTarget
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
    secondary: headerSecondary,
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
        // The room above the heading is for the background pattern; on a
        // phone it is most of the first screen, so it shrinks with the width.
        pt: { xs: 3, sm: 6, md: 10 },
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
          spacing={{ xs: 1, sm: 2 }}
          sx={{
            justifyContent: "space-between",
            alignItems: "center"
          }}>
          {/* Full width below `md`, so the controls take their own row under
              the heading instead of squeezing it to a word per line. */}
          <Grid size={{ xs: 12, md: 'grow' }} sx={{ minWidth: 0 }}>
            <Stack>
              <Typography
                component="h1"
                variant="h4"
                sx={mergeSxProps(
                  {
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    typography: { xs: 'h5', sm: 'h4' },
                    overflowWrap: 'anywhere',
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
                        flexShrink: 0,
                        padding: { xs: 0.75, sm: 1 },
                        mr: { xs: 1.25, sm: 1.75 },
                        fontSize: `1.5em`,
                        borderWidth: `1px`,
                        borderStyle: 'solid',
                        borderColor: 'secondary.dark',
                        color: 'secondary.contrastText',
                        bgcolor: 'secondary.main',
                        borderRadius: (theme) =>
                          `${theme.shape.appIconBorderRadius}`,
                      },
                      headerIcon['sx'],
                    )}
                  />
                )}
                {headerChildren}
                {headerSecondary ? (
                  <Box component="span" sx={{ color: 'text.secondary' }}>
                    <Box
                      component="span"
                      aria-hidden
                      sx={{ mx: 1.5, color: 'text.disabled' }}
                    >
                      {'/'}
                    </Box>
                    {headerSecondary}
                  </Box>
                ) : null}
                {help && (
                  <DocsHelpTip
                    {...(typeof help === 'string' ? { topic: help } : help)}
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
                        color: 'primary.main',
                      },
                    },
                  }}
                />
              )}
            </Stack>
          </Grid>

          {headerRight && (
            <Grid
              size={{ xs: 12, md: 'auto' }}
              sx={{
                // A control row that does not fit wraps onto a second line
                // rather than pushing the page wider than the phone.
                '& > .MuiStack-root, & > .MuiBox-root': {
                  flexWrap: 'wrap',
                  rowGap: 1,
                },
              }}
            >
              {headerRight}
            </Grid>
          )}
        </Grid>
        {children}
      </Container>
    </BackgroundImageComponent>
  );
}
DashboardHeaderComponent.displayName = 'DashboardHeaderComponent'
DashboardHeaderComponent.aglyn = true

export default DashboardHeaderComponent
