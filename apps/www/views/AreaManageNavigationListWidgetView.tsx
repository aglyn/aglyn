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

import { AppLink, SvgPathIcon } from '@aglyn/shared/ui/react'
import { generateUtilityClasses, styled } from '@aglyn/shared/ui/themes'
import {
  Collapse,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
} from '@mui/material'
import clsx from 'clsx'
import React, { forwardRef } from 'react'
import WidgetCard, { Props as WidgetCardProps } from '../components/WidgetCard'
import { AggregatedPageMeta, withAggregatedPageMeta } from '../lib/app-pages'


const classKeys = generateUtilityClasses('AreaManageNavigationListWidgetView', [
  'listItem',
  'active',
  'open',
  'childActive',
  'collapse',
  'nested',
])

const StyledListItem = styled(ListItemButton, {
  name: 'ListItem',
})(({theme}) => ({
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

export interface AreaManageNavigationListWidgetViewProps extends Partial<WidgetCardProps> {
  aggregatedPageMeta: AggregatedPageMeta
}

const AreaManageNavigationListWidgetViewRaw = forwardRef<any, AreaManageNavigationListWidgetViewProps>(
  function RefRenderFn(props, ref) {
    const {aggregatedPageMeta, ...rest} = props
    const {
      pathname,
      pageMeta,
      overrideMeta,
      pageAncestors: [, , subArea],
      denormalizedAreaPages,
    } = aggregatedPageMeta
    const [activeCollapse, setActiveCollapse] = React.useState(
      subArea?.id ?? pageMeta?.dynamic ? pageMeta?.parent : pageMeta?.id,
    )
    const openAreaCollapse = (id) => (e) => {
      e.preventDefault()
      e.stopPropagation()
      setActiveCollapse(
        prev => prev === id ? null : id,
      )
    }
    const isOpen = React.useCallback((item) => {
      return Boolean(activeCollapse === item?.id)
    }, [activeCollapse])

    const isActive = React.useCallback((item) => {
      const path = pageMeta.dynamic ? pageMeta.parent : pathname
      return Boolean(path === item?.id)
    }, [pathname, pageMeta])

    const isChildActive = React.useCallback((item) => {
      const path = pageMeta.dynamic ? pageMeta.parent : pathname
      return Boolean(item.pages?.some(i => path === i?.id))
    }, [pathname, pageMeta])

    const getClass = (itemClass, item, topLvl = true) => clsx(itemClass, {
      [classKeys.active]: isActive(item),
      [classKeys.open]: isOpen(item),
      [classKeys.childActive]: isChildActive(item) && topLvl,
      [classKeys.nested]: !topLvl,
    })

    return (
      <WidgetCard ref={ref} {...rest}>
        <List
          subheader={(
            <ListSubheader
              children={'Manage Navigation'}
              sx={{fontWeight: 'fontWeightMedium'}}
            />
          )}
          disablePadding
        >
          {denormalizedAreaPages.map((item, key, arr) => (
            <React.Fragment key={key}>
              <StyledListItem
                className={getClass(classKeys.listItem, item)}
                color="inherit"
                selected={isActive(item)}
                component={AppLink}
                linkType="button"
                dense
              >
                <ListItemText children={item?.name.long}/>
                {item?.pages?.length ? (
                  <IconButton
                    disabled={
                      isActive(item) || isChildActive(item)
                    }
                    size={'small'}
                    title={
                      isOpen(item) || isActive(item) || isChildActive(item)
                        ? 'collapse'
                        : 'expand'
                    }
                    onClick={openAreaCollapse(item?.id)}
                  >
                    <SvgPathIcon
                      iconId={
                        isOpen(item) || isActive(item) || isChildActive(item)
                          ? 'chevron-up'
                          : 'chevron-down'
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
                    {item.pages.map((item, key, arr) => (
                      <StyledListItem
                        key={key}
                        className={getClass(classKeys.listItem, item, false)}
                        color="inherit"
                        href={item?.id}
                        selected={isActive(item)}
                        component={AppLink}
                        linkType="button"
                        dense
                      >
                        <ListItemText primary={item?.name.long}/>
                      </StyledListItem>
                    ))}
                  </List>
                </Collapse>
              ) : null}
            </React.Fragment>
          ))}
        </List>
      </WidgetCard>
    )
  },
)

AreaManageNavigationListWidgetViewRaw.displayName = 'AreaManageNavigationListWidgetView'
export const AreaManageNavigationListWidgetView = withAggregatedPageMeta(
  AreaManageNavigationListWidgetViewRaw,
)
export default AreaManageNavigationListWidgetView
