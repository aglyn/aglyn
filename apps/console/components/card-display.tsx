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

import { ErrorBoundaryComponent } from '@aglyn/shared-ui-jsx'
import { generateComponentClassKeys, styled } from '@aglyn/shared-ui-theme'
import {
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
])

const Card = styled(MuiCard )(({ theme }) => ({
  '.MuiCardContent-root': {
    padding: 0,
    borderWidth: 0,
    borderStyle: 'solid',
    borderColor: theme.palette.divider,
    ':last-of-type': {
      paddingBottom: 'initial',
    },
  },
  '.MuiCardHeader-root': {
    fontWeight: theme.typography.fontWeightBold,
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
      // '&:last-child': {paddingBottom: theme.spacing(3)},
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
}))

export interface CardDisplayProps extends CardProps {
  contentGutterX?: boolean
  contentGutterY?: boolean
  contentBordered?: 'all' | 'top' | 'bottom' | undefined
  headerCentered?: boolean
  header?: JSX.Children
  subheader?: JSX.Children
  actions?: JSX.Children
  disableContentWrapper?: boolean
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
    ActionProps,
    HeaderProps,
    ContentProps,
    contentGutterX,
    contentGutterY,
    headerCentered,
    contentBordered,
    ...rest
  } = props

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
    },
    className,
  )

  return (
    <Card ref={ref} className={cardClassName} {...rest}>
      <ErrorBoundaryComponent>
        {header || HeaderProps || subheader ? (
          <MuiCardHeader
            title={header}
            subheader={subheader}
            titleTypographyProps={{ variant: 'h6', component: 'div' }}
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
