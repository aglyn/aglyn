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

import * as Aglyn from '@aglyn/aglyn'
import * as Besigner from '@aglyn/besigner'
import { ICON_VARIANT_ELEMENT } from '@aglyn/shared-data-enums'
import { CardListItemProps, useForkedRefs } from '@aglyn/shared-ui-jsx'
import { MdiIcon, MdiIconProps } from '@aglyn/shared-ui-mdi-jsx'
import {
  Box,
  Card,
  Grid,
  ListItemAvatar,
  ListItemText,
  Stack,
} from '@mui/material'
import { observer } from 'mobx-react-lite'
import { forwardRef, useMemo } from 'react'
import useLeafDrag from '../hooks/use-leaf-drag'
import AccordionListComponent, {
  AccordionListProps,
} from './accordion-list.component'

export type ComponentGridItemData =
  | Aglyn.PresetSchema<any>
  | Aglyn.NodeSchema<any>
  | Aglyn.ComponentSchema
export type ComponentGridGroupItemData = {
  $id: string
  order: number
  icon: MdiIconProps
  label: string
  items: ComponentGridItemData[]
}
export type ComponentGridItemProps = Partial<CardListItemProps> & {
  item: ComponentGridGroupItemData
}
const ComponentGridItem = observer(
  forwardRef<any, ComponentGridItemProps>((props, ref) => {
    const { item, ...rest } = props
    const isPreset = item?.type === Aglyn.NodeType.PRESET
    const label =
      item?.label ||
      item?.displayName ||
      Aglyn.components.getLabel(item?.$id) ||
      item?.$id

    const {
      attributes: dragAttributes,
      transform,
      isDragging,
      setNodeRef: setDraggableNodeRef,
      listeners: draggableListeners,
    } = useLeafDrag(isPreset ? item : item, Besigner.DragType.PRESET)
    const style = transform
      ? {
          transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
          cursor: 'grab',
          opacity: 0.5,
        }
      : undefined

    return (
      <Card
        ref={useForkedRefs(ref, setDraggableNodeRef)}
        variant="outlined"
        style={style}
        sx={{ height: 1, minHeight: 100 }}
        {...rest}
        {...draggableListeners}
        {...dragAttributes}
      >
        <Stack
          height={1}
          minHeight={100}
          alignItems="center"
          justifyContent="space-evenly"
          textAlign="center"
          p={0.25}
          spacing={0.5}
        >
          <ListItemAvatar
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <MdiIcon
              {...item?.icon}
              sx={{ fontSize: '2rem' }}
              color="inherit"
              path={item?.icon?.path || ICON_VARIANT_ELEMENT.path}
            />
          </ListItemAvatar>
          <div>
            <ListItemText
              primaryTypographyProps={{
                fontWeight: 'fontWeightMedium',
                lineHeight: 'normal',
                fontSize: 'subtitle2.fontSize',
              }}
            >
              {label}
            </ListItemText>
          </div>
        </Stack>
      </Card>
    )
  }),
)
ComponentGridItem.displayName = 'ComponentGridItem'

interface ComponentAccordionListProp
  extends AccordionListProps<ComponentGridGroupItemData> {}

const ComponentAccordionList = observer((props: ComponentAccordionListProp) => {
  const { ...rest } = props
  const byCategory = Aglyn.components.schemasByCategory

  const itemsByCategory = useMemo(() => {
    return Object.entries(byCategory)
      .map(([k, v]) => ({
        $id: k,
        label: k,
        items: v,
      }))
      .sort(({ label: a }, { label: b }) => {
        switch (true) {
          case a === 'All' && b === 'Uncategorized':
            return 1
          case a === 'Uncategorized' && b === 'All':
            return -1
          case a === 'All':
          case a === 'Uncategorized':
            return 1
          case b === 'All':
          case b === 'Uncategorized':
            return -1
          default:
            return a.localeCompare(b)
        }
      })
  }, [byCategory])

  return (
    <AccordionListComponent
      items={itemsByCategory}
      getItemId={(item) => item?.$id}
      renderSummary={(item) => <>{item?.label}</>}
      renderDetails={(item) => (
        <Box>
          <Grid container spacing={2}>
            {item?.items?.map((i, index) => (
              <Grid key={i?.$id ?? index} xs={6} item>
                <ComponentGridItem item={i} />
              </Grid>
            ))}
          </Grid>
        </Box>
      )}
      {...rest}
    />
  )
})
ComponentAccordionList.displayName = 'ComponentAccordionList'

export default ComponentAccordionList
