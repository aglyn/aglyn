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

import { ErrorBoundaryComponent } from './error-boundary.component'
import { HelpTip, type HelpTipContent } from './help-tip.component'
import { generateComponentClassKeys, styled } from '@aglyn/shared-ui-theme'
import {
  Box,
  Card as MuiCard,
  CardActions as MuiCardActions,
  type CardActionsProps,
  CardContent as MuiCardContent,
  type CardContentProps,
  CardHeader as MuiCardHeader,
  type CardHeaderProps,
  type CardProps,
} from '@mui/material'
import clsx from 'clsx'
import { forwardRef } from 'react'

const classKeys = generateComponentClassKeys('CardDisplay', [
  'contentGutterX',
  'contentGutterY',
  'headerCentered',
  'headerBordered',
  'actionsBordered',
  'fullHeight',
])

/** The header's action slot, which the compact-action rule reads. */
const HEADER_ACTION = 'MuiCardHeader-action'

const Card = styled(MuiCard)(({ theme }) => {
  const tv = (theme as any).vars || theme
  return {
    '.MuiCardContent-root': {
      padding: 0,
      borderWidth: 0,
      borderStyle: 'solid',
      borderColor: tv.palette.divider,
      ':last-of-type': {
        paddingBottom: 'initial',
      },
    },
    /*
     * A header action wider than the room beside the title wraps onto its own
     * line under it, instead of pushing past the card's edge where the card's
     * `overflow: hidden` clips it (AGL-3311). The title keeps a floor so a
     * short action still sits beside it, top right.
     */
    '.MuiCardHeader-root': {
      fontWeight: theme.typography.fontWeightBold,
      flexWrap: 'wrap',
      rowGap: theme.spacing(1),
      /*
       * A lone icon button or status chip (a pin, a menu, "Live") is narrow
       * enough to share the title's row on any card, so it stays top right
       * and the title gives way beside it instead of the action dropping
       * under the title.
       */
      [`&:has(> .${HEADER_ACTION} > :is(.MuiIconButton-root, .MuiChip-root):only-child)`]:
        {
          flexWrap: 'nowrap',
          '.MuiCardHeader-content': {
            flexBasis: 0,
          },
        },
    },
    '.MuiCardHeader-content': {
      flex: `1 1 ${theme.spacing(24)}`,
      // A long title shortens inside the header (its ellipsis or its wrap)
      // rather than shoving the avatar onto a row of its own or running past
      // the card's edge.
      minWidth: 0,
    },
    [`.${HEADER_ACTION}`]: {
      maxWidth: '100%',
    },
    /*
     * Every card in a row as tall as the row (a grid of tiles): the content
     * takes the spare height, so each card's actions line up along the
     * bottom.
     */
    [`&.${classKeys.fullHeight}`]: {
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      '.MuiCardContent-root': {
        flexGrow: 1,
      },
    },
    [`&.${classKeys.contentGutterX}`]: {
      '.MuiCardContent-root': {
        paddingLeft: theme.spacing(2),
        paddingRight: theme.spacing(2),
        [theme.breakpoints.up('md')]: {
          paddingLeft: theme.spacing(2),
          paddingRight: theme.spacing(2),
        },
      },
    },
    [`&.${classKeys.contentGutterY}`]: {
      '.MuiCardContent-root': {
        paddingTop: theme.spacing(2),
        paddingBottom: theme.spacing(2),
      },
    },
    [`&.${classKeys.headerCentered}`]: {
      '.MuiCardHeader-root': {
        marginBottom: theme.spacing(-1),
        alignSelf: 'center',
      },
    },
    [`&.${classKeys.headerBordered}`]: {
      '.MuiCardContent-root': {
        borderTopWidth: 1,
      },
    },
    [`&.${classKeys.actionsBordered}`]: {
      '.MuiCardContent-root': {
        borderBottomWidth: 1,
      },
    },
  }
})

export interface CardDisplayProps extends CardProps {
  contentGutterX?: boolean
  contentGutterY?: boolean
  contentBordered?: 'all' | 'top' | 'bottom' | undefined
  headerCentered?: boolean
  /**
   * Fill the grid cell: as tall as the tallest card in its row, with the
   * actions along the bottom. For a row of tiles (`GridItems masonry={false}`).
   */
  fullHeight?: boolean
  header?: JSX.Children
  subheader?: JSX.Children
  actions?: JSX.Children
  disableContentWrapper?: boolean
  /** Contextual help affordance rendered beside the header title (AGL-601). */
  help?: HelpTipContent
  HeaderProps?: CardHeaderProps
  ContentProps?: CardContentProps
  ActionProps?: CardActionsProps
}

const CardDisplay = forwardRef<any, CardDisplayProps>((props, ref) => {
  const {
    actions,
    classes,
    children,
    className,
    header,
    subheader,
    disableContentWrapper,
    help,
    ActionProps,
    HeaderProps,
    ContentProps,
    contentGutterX,
    contentGutterY,
    headerCentered,
    contentBordered,
    fullHeight,
    ...rest
  } = props

  const headerTitle =
    help && header != null ? (
      <Box
        component="span"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          // Never wider than the title's line, so a long title is what gives
          // way (its ellipsis, under a `noWrap` title) and the help stays.
          maxWidth: '100%',
          verticalAlign: 'top',
        }}
      >
        <Box
          component="span"
          sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
        >
          {header}
        </Box>
        <HelpTip
          {...help}
          title={help.title ?? (typeof header === 'string' ? header : undefined)}
          sx={{ fontSize: '0.8em', my: -0.5, flexShrink: 0 }}
        />
      </Box>
    ) : (
      header
    )

  const allBordered = contentBordered === 'all'
  const headerBordered = contentBordered === 'top'
  const actionsBordered = contentBordered === 'bottom'

  const cardClassName = clsx(
    {
      [classKeys.contentGutterX]: Boolean(contentGutterX),
      [classKeys.contentGutterY]: Boolean(contentGutterY),
      [classKeys.headerBordered]: Boolean(allBordered || headerBordered),
      [classKeys.actionsBordered]: Boolean(allBordered || actionsBordered),
      [classKeys.headerCentered]: Boolean(headerCentered),
      [classKeys.fullHeight]: Boolean(fullHeight),
    },
    className,
  )

  return (
    <Card ref={ref} className={cardClassName} {...rest}>
      <ErrorBoundaryComponent>
        {header || HeaderProps || subheader ? (
          <MuiCardHeader
            title={headerTitle}
            subheader={subheader}
            slotProps={{ title: { variant: 'h6', component: 'div' } }}
            {...HeaderProps}
          />
        ) : null}
        {disableContentWrapper ? (
          children
        ) : children || ContentProps ? (
          <MuiCardContent {...ContentProps}>
            {ContentProps?.children || children}
          </MuiCardContent>
        ) : null}
        {actions || ActionProps ? (
          <MuiCardActions {...ActionProps}>
            {ActionProps?.children || actions}
          </MuiCardActions>
        ) : null}
      </ErrorBoundaryComponent>
    </Card>
  )
})

CardDisplay.displayName = 'CardDisplayComponent'

export { CardDisplay }
export default CardDisplay
