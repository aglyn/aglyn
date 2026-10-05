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

import type { ConsoleSitePackageItemPreviewZoneProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import EmailDesignPreview from './email-design-preview'

const isDoc = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : undefined

/**
 * One side of a site email in a site package import (AGL-3545), drawn by
 * the preview an email's own page shows: the design rendered by the code
 * that builds the mail, with the site's reusable blocks grafted in, under
 * its subject line. The item carries its published design as `version`, so
 * both sides are the email the site would send.
 */
export function SitePackageEmailPreview(props: ConsoleSitePackageItemPreviewZoneProps) {
  const content = isDoc(props.content) ? props.content : {}
  const version = isDoc(content['version']) ? content['version'] : {}
  const subject = text(content['subject'])
  const preheader = text(content['preheader'])
  return (
    <EmailDesignPreview
      hostId={props.hostId}
      nodes={version['nodes']}
      {...(subject ? { subject } : {})}
      {...(preheader ? { preheader } : {})}
      emptyMessage={
        props.side === 'site'
          ? 'This site’s copy has no design, so the site sends its built-in email.'
          : 'The file’s copy has no design, so the site would send its built-in email.'
      }
    />
  )
}
SitePackageEmailPreview.displayName = 'SitePackageEmailPreview'

export default SitePackageEmailPreview
