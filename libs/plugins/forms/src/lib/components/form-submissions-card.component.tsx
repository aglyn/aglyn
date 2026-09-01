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

import { pluginDocsHelp } from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { Button, Stack, Typography } from '@mui/material'
import { useState } from 'react'
// A deep import, NOT the plugin barrel: the barrel is the entry point a
// loader imports to activate the inbox plugin, and naming it here would drag
// that activation into the forms plugin's own graph. The component path
// reaches the same module without crossing it — the same route the inbox's
// own card takes into the marketing plugin.
import { default as SubmissionsCard } from '@aglyn/plugins-inbox/components/submissions-card.component'

export interface FormSubmissionsCardProps {
  hostId: string
  formId: string
}

/**
 * THE SUBMISSIONS TO ONE FORM — behind an ask, not on mount.
 *
 * ## Why the reader has to press something
 *
 * `formSubmissions` is the collection that grows without bound and the one
 * the customer is billed on. Every other number on this page is a counter
 * that rode a write which was happening anyway, so opening a form costs the
 * form document and its versions and nothing else — a ceiling
 * `forms-console-read-cost.spec.tsx` asserts in documents.
 *
 * A table that mounted its own paged listener would put a page of that
 * collection on every visit to the surface, including the many visits that
 * are about renaming a form, checking where its submissions route, or
 * publishing a version. None of those asked to read anybody's messages. The
 * ask is one click and it buys a live, paged reader; not asking would buy the
 * same reader for every visit that did not want it.
 *
 * ## Why it is the Inbox's own card behind that ask
 *
 * `SubmissionsCard` scoped to this form, not a table written here. It already
 * walks the collection with `orderBy('createdAt')` and a page window, already
 * opens the reader, marks read, deletes, replies and shows attribution — and
 * a second implementation would be a second place for the unordered `limit()`
 * defect to come back, in a file whose tests were written by whoever needed a
 * table that afternoon.
 */
export function FormSubmissionsCard(props: FormSubmissionsCardProps) {
  const { hostId, formId } = props
  const [asked, setAsked] = useState(false)

  if (asked) return <SubmissionsCard hostId={hostId} formId={formId} />

  return (
    <CardDisplay
      header="Submissions to this form"
      help={pluginDocsHelp('forms', {
        anchor: '#one-forms-own-page',
        excerpt:
          'The same table the Inbox shows, narrowed to this form, and loaded ' +
          'when you ask rather than on every visit to this page.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Typography variant="body2" color="text.secondary">
          {'The messages this form collected, newest first. Reading them is ' +
            'a query over the submissions collection, so it runs when you ' +
            'ask rather than on every visit to this page.'}
        </Typography>
        <Button variant="outlined" size="small" onClick={() => setAsked(true)}>
          {'Show submissions'}
        </Button>
      </Stack>
    </CardDisplay>
  )
}
FormSubmissionsCard.displayName = 'FormSubmissionsCard'

export default FormSubmissionsCard
