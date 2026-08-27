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
'use client'

import * as Aglyn from '@aglyn/aglyn'
import { mergeSxProps } from '@aglyn/shared-ui-theme'
import { Typography } from '@mui/material'
import { useMemo, useState, type SyntheticEvent } from 'react'
import AccordionListComponent from './accordion-list.component'

/**
 * What this element IS, at the bottom of Attributes (AGL-1486).
 *
 * Two collapsed accordions: the component's own description, and the
 * element / parent / component / plugin ids. Reference detail — worth having
 * when a name is ambiguous or an id has to be quoted in a bug report, and not
 * worth the tab it used to occupy. Beside the fields it describes it costs a
 * reader nothing until they open it; as a tab it cost every reader a third of
 * the panel's header.
 */
export function ElementInfoDetails({
  node,
}: {
  node: Aglyn.NodeSchema<any>
}) {
  const schema = Aglyn.components.getSchema(node?.componentId)
  const failoverText = 'n/a'
  const details = useMemo(
    () => [
      {
        key: 'element-overview',
        label: 'Element Overview',
        items: [
          {
            key: 'component-display-name',
            label: 'Type',
            value: schema?.displayName,
          },
          {
            key: 'component-title',
            label: 'Title',
            value: schema?.title,
          },
          {
            key: 'component-subtitle',
            label: 'Subtitle',
            value: schema?.subtitle,
          },
          {
            key: 'component-description',
            label: 'Description',
            value: schema?.description,
            TypographyProps: { gutterBottom: true },
          },
        ],
      },
      {
        key: 'unique-identifiers',
        label: 'Unique Identifiers',
        items: [
          {
            key: 'element-id',
            label: 'Element ID',
            value: node.$id,
          },
          {
            key: 'parent-id',
            label: 'Parent Element ID',
            value: node?.parentId,
          },
          {
            key: 'component-id',
            label: 'Component ID',
            value: node?.componentId,
          },
          {
            key: 'plugin-id',
            label: 'Add-on ID',
            value: node?.pluginId,
            ValueTypographyProps: {},
          },
        ],
      },
    ],
    [schema, node],
  )
  const [expanded, setExpanded] = useState<string | false>(details[0].key)
  const handleChange =
    (panel: string) => (event: SyntheticEvent, newExpanded: boolean) => {
      setExpanded(newExpanded ? panel : false)
    }

  return (
    <>
      <AccordionListComponent
        items={details}
        getItemId={(item) => item.key}
        onRenderSummary={({ item }) => <>{item?.label}</>}
        onRenderDetail={({ item }) => (
          <>
            {item?.items?.map(
              ({
                label,
                value,
                TypographyProps,
                ValueTypographyProps,
                ...item
              }: any) => (
                <Typography key={item.key} component="div" {...TypographyProps}>
                  <Typography
                    variant="caption"
                    sx={{
                      display: 'inline',
                      textTransform: 'uppercase',
                    }}
                  >
                    <b>{label}:</b>
                  </Typography>{' '}
                  <Typography
                    variant="body1"
                    {...ValueTypographyProps}
                    sx={mergeSxProps(
                      (theme) => {
                        const tv = (theme as any).vars || theme
                        return {
                          bgcolor: `rgba(${tv.palette.primary.lightChannel} / 0.18)`,
                          border: `1px solid rgba(${tv.palette.primary.lightChannel} / 0.72)`,
                          borderRadius: '0.3em',
                          px: 0.5,
                          py: 0.15,
                          wordBreak: 'break-word',
                          fontSize: '0.8rem',
                        }
                      },
                      { display: 'inline' },
                      ValueTypographyProps?.sx,
                    )}
                  >
                    {value || <i>{failoverText}</i>}
                  </Typography>
                </Typography>
              ),
            )}
          </>
        )}
      />
    </>
  )
}
ElementInfoDetails.displayName = 'ElementInfoDetails'

export default ElementInfoDetails
