/**
 * @license
 * Copyright 2023 Aglyn LLC
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
import {
  List as MuiList,
  listItemButtonClasses,
  listItemClasses,
  type ListProps,
} from '@mui/material'
import { observer } from 'mobx-react-lite'
import { forwardRef, RefObject } from 'react'

const classKey = generateComponentClassKeys('TreeList', [
  'root',
  'subTreeView',
  'treeItem',
  'treeListItem',
  'dragHandle',
  'itemSelected',
  'itemHovered',
  'itemIsDragging',
  'itemIsDragOver',
])

const List = styled(MuiList)<ListProps>(({ theme }) => ({
  alignItems: 'stretch',
  flexDirection: 'column',
  width: 'fit-content',
  minWidth: '100%',

  [`& .${listItemButtonClasses.root}`]: {
    zIndex: 0,
    paddingTop: 0,
    paddingBottom: 0,
    // paddingLeft: 0,
    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,
    [[
      `&:hover`,
      `&.${listItemButtonClasses.focusVisible}`,
      `&.${listItemButtonClasses.selected}`,
      `&.${classKey.itemSelected}`,
    ].join(',')]: {
      backgroundColor: 'transparent',
    },
  },

  [`& .${listItemClasses.root}`]: {
    alignItems: 'stretch',
    flexDirection: 'column',

    borderTopLeftRadius: 4,
    borderBottomLeftRadius: 4,

    [`> .${classKey.treeListItem}`]: {
      borderTopLeftRadius: 4,
      borderBottomLeftRadius: 4,
      [`& .${classKey.dragHandle}`]: {
        visibility: 'hidden',
      },

      [`&:hover, &.${classKey.itemHovered}`]: {
        [`& .${classKey.dragHandle}`]: {
          visibility: 'visible',
        },
        backgroundColor: `rgba(${(theme as any).vars.palette.secondary.darkChannel} / calc(${(theme as any).vars.palette.action.hoverOpacity} + 0.2))`,
        [`&:has(> .${listItemButtonClasses.focusVisible})`]: {
          backgroundColor: `rgba(${(theme as any).vars.palette.secondary.darkChannel} / calc(${(theme as any).vars.palette.action.focusOpacity} + 0.3))`,
        },
      },
      [`&:has(> .${listItemButtonClasses.focusVisible})`]: {
        backgroundColor: `rgba(${(theme as any).vars.palette.secondary.darkChannel} / calc(${(theme as any).vars.palette.action.focusOpacity} + 0.2))`,
      },
    },
    [`&.${classKey.itemSelected}`]: {
      [`> .${classKey.treeListItem}`]: {
        backgroundColor: `rgba(${(theme as any).vars.palette.tertiary.mainChannel} / ${(theme as any).vars.palette.action.selectedOpacity})`,

        [`&:hover, &.${classKey.itemHovered}`]: {
          backgroundColor: `rgba(${(theme as any).vars.palette.tertiary.mainChannel} / calc(${(theme as any).vars.palette.action.selectedOpacity} + 0.2))`,

          [`&:has(> .${listItemButtonClasses.focusVisible})`]: {
            backgroundColor: `rgba(${(theme as any).vars.palette.tertiary.mainChannel} / calc(${(theme as any).vars.palette.action.selectedOpacity} + 0.2))`,
          },
        },
        [`&:has(> .${listItemButtonClasses.focusVisible})`]: {
          backgroundColor: `rgba(${(theme as any).vars.palette.tertiary.mainChannel} / ${(theme as any).vars.palette.action.activatedOpacity})`,
        },
      },
    },
  },
}))
List.displayName = 'List'

export interface TreeListProps<T> extends ListProps {
  items: T[]
}

export const TreeList = observer(
  forwardRef(
    <T,>(props: TreeListProps<T>, ref: RefObject<HTMLUListElement>) => {
      const { children, items, ...rest } = props
      return <List ref={ref} {...rest}></List>
    },
  ),
)
TreeList.displayName = 'TreeList'

export default TreeList
