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

import React from 'react'
import { createStyles, WithStyles, withStyles, Theme } from '@material-ui/core/styles'
import clsx from 'clsx'
import Card, { CardProps } from '@material-ui/core/Card'
import CardHeader, { CardHeaderProps } from '@material-ui/core/CardHeader'
import CardActions, { CardActionsProps } from '@material-ui/core/CardActions'
import CardContent, { CardContentProps } from '@material-ui/core/CardContent'
import ErrorBoundary from './ErrorBoundary'

const styles = (theme: Theme) => createStyles({
  action: {/* empty */},

  root: {marginBottom: theme.spacing(3)},
  title: {fontWeight: theme.typography.fontWeightBold},
  header: {'& $action': {}},
  centerAction: {
    marginBottom: theme.spacing(-1),
    alignSelf: 'center'
  },
  content: { padding: 0 },
  actions: {},
  bordered: {
    border: `1px solid ${theme.palette.divider}`,
    borderRight: 'none',
    borderLeft: 'none',
  },
  guttersY: {
    paddingTop: theme.spacing(2),
    paddingBottom: theme.spacing(2),
    '&:last-child': { paddingBottom: theme.spacing(3) },
  },
  guttersX: {
    paddingLeft: theme.spacing(2),
    paddingRight: theme.spacing(2),
    [theme.breakpoints.up('md')]: {
      paddingTop: theme.spacing(3),
      paddingBottom: theme.spacing(3),
    }
  },
})

export type Props = CardProps & {
  header?: string
  actions?: CardActionsProps
  guttersX?: boolean
  guttersY?: boolean
  bordered?: boolean
  HeaderProps?: CardHeaderProps
  ContentProps?: CardContentProps
  ActionProps?: CardActionsProps
}

const WidgetCard = React.forwardRef<typeof Card, Props & WithStyles<typeof styles>>(
  function WidgetCard(props, ref) {
    const {
      actions,
      bordered,
      classes,
      children,
      className,
      guttersX,
      guttersY,
      header,
      ActionProps,
      HeaderProps,
      ContentProps,
      ...rest
    } = props

    const _className = {
      root: clsx(classes.root, className),
      header: clsx(classes.header, HeaderProps?.className),
      headerAction: clsx(classes.action, { [classes.centerAction]: !props.HeaderProps?.subheader }, HeaderProps?.classes?.action),
      headerTitle: clsx(classes.title, HeaderProps?.titleTypographyProps?.className),
      content: clsx(classes.content, {
        [classes.guttersX]: Boolean(guttersX),
        [classes.guttersY]: Boolean(guttersY),
        [classes.bordered]: Boolean(bordered),
      }, ContentProps?.className),
      actions: clsx(classes.actions, ActionProps?.className),
    }

    return (
      <Card ref={ref} className={_className.root} {...rest}>
        {header || HeaderProps ? (
          <CardHeader
            {...HeaderProps}
            className={_className.header}
            classes={{
              ...HeaderProps?.classes,
              action: _className.headerAction,
            }}
            title={header}
            titleTypographyProps={{
              ...HeaderProps?.titleTypographyProps,
              className: _className.headerTitle,
              variant: 'h6'
            }}
          />
        ) : null}
        <CardContent {...ContentProps} className={_className.content}>
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </CardContent>
        {actions || ActionProps ? (
          <CardActions {...ActionProps} className={_className.actions}>
            <ErrorBoundary>
              {actions}
            </ErrorBoundary>
          </CardActions>
        ) : null}
      </Card>
    )
  }
)

WidgetCard.displayName = 'WidgetCard'

export default withStyles(styles, {name: 'WidgetCard'})(WidgetCard)
