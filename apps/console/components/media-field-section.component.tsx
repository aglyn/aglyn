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

import { CardDisplay, HelpTip } from '@aglyn/shared-ui-jsx'
import { Divider, Stack, Typography } from '@mui/material'
import type { ReactNode } from 'react'

/**
 * A media control that can be its own card OR a section inside someone else's
 * (AGL-2486).
 *
 * The favicon, the entity logo and the social image are all `seo.*` fields:
 * they belong to the SEO form. They are separate components only because a
 * media pick needs state and a picker dialog, and because a CLEARED value has
 * to reach Firestore as `''` rather than being dropped by the form stack
 * (AGL-1191), which the schema-driven form cannot do. Given a card each, that
 * implementation detail surfaces as three free-floating cards sitting between
 * the fields they belong to.
 *
 * So the components keep their own state and their own writes, and this
 * decides only whether they are drawn with a card around them. `embedded`
 * renders a titled section instead — same content, same help affordance, one
 * heading level down.
 */
export interface MediaFieldSectionProps {
  /** Draw as a section inside a surrounding card rather than a card. */
  embedded?: boolean
  header: string
  /** `docsHelp(...)` content, shown beside the heading either way. */
  help?: any
  children?: ReactNode
}

export function MediaFieldSection(props: MediaFieldSectionProps) {
  const { embedded, header, help, children } = props
  if (!embedded) {
    return (
      <CardDisplay header={header} help={help} contentGutterX contentGutterY>
        {children}
      </CardDisplay>
    )
  }
  return (
    <Stack spacing={1.5} sx={{ mt: 3 }}>
      {/* A rule above each section, because these sit under a form whose own
          fields have no separators — without it the first one reads as more
          form and the eye never finds the boundary. */}
      <Divider />
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <Typography variant="subtitle2">{header}</Typography>
        {help ? <HelpTip {...help} /> : null}
      </Stack>
      {children}
    </Stack>
  )
}
MediaFieldSection.displayName = 'MediaFieldSection'

export default MediaFieldSection
