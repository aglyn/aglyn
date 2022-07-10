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

import type { AnyObj } from '@aglyn/shared-data-types'
import { Collapse, type CollapseProps, Divider } from '@mui/material'
import { Fragment, useCallback, useState } from 'react'

export type CollapsibleKey = string | number

export interface CollapsibleItem extends AnyObj {
  id: CollapsibleKey
}
export type RenderCollapsibleItem = JSX.ElementType<{
  id: CollapsibleKey
  item: CollapsibleItem
  isOpen: boolean
  open: CollapsibleKey[]
  triggerToggle(event?: Event): void
}>
export type RenderCollapsibleContents = JSX.ElementType<{
  id: CollapsibleKey
  item: CollapsibleItem
  isOpen: boolean
  open: CollapsibleKey[]
  triggerToggle(event?: Event): void
}>

export interface CollapsibleListsProps extends CollapseProps {
  children?: JSX.Children
  items: CollapsibleItem[]
  initialOpen?: CollapsibleKey[]
  RenderItem: RenderCollapsibleItem
  RenderContents: RenderCollapsibleContents
  unique?: boolean
}

const CollapsibleListsComponent = (props: CollapsibleListsProps) => {
  const {
    children,
    items,
    initialOpen,
    RenderItem,
    RenderContents,
    unique,
    ...rest
  } = props
  const [open, setOpen] = useState<CollapsibleKey[]>([])
  const handleToggle = useCallback(
    (id: CollapsibleKey) => (event: Event) => {
      setOpen((prev) => {
        const exists = prev.indexOf(id) >= 0
        if (exists) return prev.filter((i) => i !== id)
        else if (unique) return [id]
        return [...prev, id]
      })
    },
    [unique],
  )

  const isOpen = (id: CollapsibleKey) => {
    return unique ? open[open.length - 1] === id : open.indexOf(id) >= 0
  }

  return (
    <Fragment>
      {items.map((item, index, arr) => (
        <Fragment key={item?.id}>
          <RenderItem
            id={item?.id}
            item={item}
            isOpen={isOpen(item?.id)}
            open={open}
            triggerToggle={handleToggle(item?.id)}
          />
          <Collapse orientation="vertical" in={isOpen(item?.id)} {...rest}>
            <RenderContents
              id={item?.id}
              item={item}
              isOpen={isOpen(item?.id)}
              open={open}
              triggerToggle={handleToggle(item?.id)}
            />
          </Collapse>
          <Divider component="li" />
        </Fragment>
      ))}
    </Fragment>
  )
}
CollapsibleListsComponent.displayName = 'CollapsibleListsComponent'
CollapsibleListsComponent.aglyn = true
CollapsibleListsComponent.defaultProps = {
  initialOpen: [],
  unique: false,
}

export { CollapsibleListsComponent }
export default CollapsibleListsComponent
