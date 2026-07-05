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

import { generateComponentClassKeys, styled } from '@aglyn/shared-ui-theme'
import { AppLink } from '@aglyn/shared-ui-jsx'
import { mdiChevronDown, mdiChevronUp } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Collapse,
  IconButton,
  List,
  ListItemButton,
  ListItemButtonProps,
  ListItemText,
  ListSubheader,
} from '@mui/material'
import clsx from 'clsx'
import { forwardRef, Fragment, useCallback, useState } from 'react'
import { CardDisplay, type CardDisplayProps } from '@aglyn/shared-ui-jsx'
import {
  type AggregatedPageMeta,
  withAggregatedPageMeta,
} from '../lib/app-pages'

const classKeys = generateComponentClassKeys(
  'AreaManageNavigationListWidgetView',
  ['listItem', 'active', 'open', 'childActive', 'collapse', 'nested'],
)

const StyledListItem = styled(ListItemButton, {
  name: 'AglynListItem',
})<ListItemButtonProps<AppLink>>(({ theme }) => ({
  position: 'relative',
  [`&.${classKeys.active}`]: {
    '&:before': {
      content: '" "',
      display: 'block',
      position: 'absolute',
      width: 5,
      height: 5,
      borderRadius: '50%',
      left: theme.spacing(0.75),
      top: 'calc(50% - 2.5px)',
      background: theme.palette.secondary.main,
    },
  },
  [`&.${classKeys.childActive}`]: {
    '&:after': {
      content: '" "',
      display: 'block',
      position: 'absolute',
      width: 3,
      height: '100%',
      borderRadius: '3px 0 0 3px',
      right: 0,
      top: 0,
      background: theme.palette.secondary.main,
    },
  },
  [`&.${classKeys.nested}`]: {
    paddingLeft: theme.spacing(4),
  },
}))

export interface AreaManageNavigationListWidgetViewProps
  extends Partial<CardDisplayProps> {
  aggregatedPageMeta: AggregatedPageMeta
}

const AreaManageNavigationListWidgetViewRaw = forwardRef<
  any,
  AreaManageNavigationListWidgetViewProps
>(function RefRenderFn(props, ref) {
  const { aggregatedPageMeta, ...rest } = props
  const {
    pathname,
    pageMeta,
    overrideMeta,
    pageAncestors: [, , subArea],
    denormalizedAreaPages,
  } = aggregatedPageMeta
  const [activeCollapse, setActiveCollapse] = useState(
    subArea?.id ?? pageMeta?.dynamic ? pageMeta?.parent : pageMeta?.id,
  )
  const openAreaCollapse = (id) => (e) => {
    e.preventDefault()
    e.stopPropagation()
    setActiveCollapse((prev) => (prev === id ? null : id))
  }
  const isOpen = useCallback(
    (item) => {
      return Boolean(activeCollapse === item?.id)
    },
    [activeCollapse],
  )

  const isActive = useCallback(
    (item) => {
      const path = pageMeta.dynamic ? pageMeta.parent : pathname
      return Boolean(path === item?.id)
    },
    [pathname, pageMeta],
  )

  const isChildActive = useCallback(
    (item) => {
      const path = pageMeta.dynamic ? pageMeta.parent : pathname
      return Boolean(item.pages?.some((i) => path === i?.id))
    },
    [pathname, pageMeta],
  )

  const getClass = (itemClass, item, topLvl = true) =>
    clsx(itemClass, {
      [classKeys.active]: isActive(item),
      [classKeys.open]: isOpen(item),
      [classKeys.childActive]: isChildActive(item) && topLvl,
      [classKeys.nested]: !topLvl,
    })

  return (
    <CardDisplay ref={ref} {...rest}>
      <List
        subheader={
          <ListSubheader sx={{ fontWeight: 'fontWeightMedium' }}>
            {'Manage Navigation'}
          </ListSubheader>
        }
        disablePadding
      >
        {denormalizedAreaPages.map((item, key) => (
          <Fragment key={item?.key ?? item?.id ?? key}>
            <StyledListItem
              className={getClass(classKeys.listItem, item)}
              color="inherit"
              selected={isActive(item)}
              component={AppLink}
              componentVariant="button"
              dense
            >
              <ListItemText>{item?.name.long}</ListItemText>
              {item?.pages?.length ? (
                <IconButton
                  disabled={isActive(item) || isChildActive(item)}
                  size={'small'}
                  title={
                    isOpen(item) || isActive(item) || isChildActive(item)
                      ? 'collapse'
                      : 'expand'
                  }
                  onClick={openAreaCollapse(item?.id)}
                >
                  <MdiIcon
                    path={
                      isOpen(item) || isActive(item) || isChildActive(item)
                        ? mdiChevronUp.path
                        : mdiChevronDown.path
                    }
                  />
                </IconButton>
              ) : null}
            </StyledListItem>
            {item?.pages?.length ? (
              <Collapse
                className={getClass(classKeys.collapse, item)}
                in={isOpen(item) || isActive(item) || isChildActive(item)}
                timeout="auto"
                unmountOnExit
              >
                <List component="div" disablePadding>
                  {item.pages.map((item, key) => (
                    <StyledListItem
                      key={item?.key ?? item?.id ?? key}
                      className={getClass(classKeys.listItem, item, false)}
                      color="inherit"
                      href={item?.id}
                      selected={isActive(item)}
                      component={AppLink}
                      componentVariant="button"
                      dense
                    >
                      <ListItemText primary={item?.name.long} />
                    </StyledListItem>
                  ))}
                </List>
              </Collapse>
            ) : null}
          </Fragment>
        ))}
      </List>
    </CardDisplay>
  )
})

AreaManageNavigationListWidgetViewRaw.displayName =
  'AreaManageNavigationListWidgetViewRaw'
AreaManageNavigationListWidgetViewRaw.aglyn = true
export const AreaManageNavigationListWidgetView = withAggregatedPageMeta(
  AreaManageNavigationListWidgetViewRaw,
)
export default AreaManageNavigationListWidgetView
