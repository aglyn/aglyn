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

import { decodeStoredNodes } from '@aglyn/aglyn'
import type { ConsoleSitePackageItemPreviewZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { Typography } from '@mui/material'
import { useMemo } from 'react'
import FormDesignPreview from './form-design-preview.component'

const isDoc = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * One side of a form in a site package import (AGL-3545), drawn by the same
 * preview the form's own page shows: the fields a submission arrives under,
 * read off the design the import would write. Both sides go through it, so
 * a renamed field, a dropped one or a new consent field is the difference
 * the two frames show.
 */
export function SitePackageFormPreview(props: ConsoleSitePackageItemPreviewZoneProps) {
  const content = isDoc(props.content) ? props.content : {}
  const nodes = content['nodes']
  const consent = content['consentFieldName']
  const designed = useMemo(() => {
    const decoded = decodeStoredNodes<Record<string, unknown>>(nodes)
    return Boolean(decoded && Object.keys(decoded).length)
  }, [nodes])
  if (!designed) {
    return (
      <Typography variant="body2" color="text.secondary">
        {props.side === 'site'
          ? 'This site’s copy has no published design.'
          : 'The file’s copy carries no published design.'}
      </Typography>
    )
  }
  return (
    <FormDesignPreview
      formId={props.itemId}
      nodes={nodes}
      {...(typeof consent === 'string' && consent ? { consentFieldName: consent } : {})}
    />
  )
}
SitePackageFormPreview.displayName = 'SitePackageFormPreview'

export default SitePackageFormPreview
