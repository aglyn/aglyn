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

import { listConsoleWidgets, pluginDocsHelp } from '@aglyn/aglyn'
import { useConsoleWidgetSlot } from '@aglyn/aglyn/app-utils/console-widget-slot-context'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { Button, Stack, Typography } from '@mui/material'
import { useState } from 'react'
import { FORM_SUBMISSIONS_ZONE } from './form-zones'

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
 * ## Why the reader is a zone, not a table written here
 *
 * The reader this page wants already exists: it walks the collection with
 * `orderBy('createdAt')` and a page window, opens a submission, marks it read,
 * deletes, replies and shows attribution. A second implementation would be a
 * second place for the unordered `limit()` defect to come back. It belongs to
 * the plugin that reads submissions, so this card hosts the
 * `formSubmissions` zone and that plugin draws its reader there, scoped to
 * this form. Neither plugin imports the other.
 *
 * A workspace with no such plugin loaded has nothing to read them with, and
 * the card says so rather than offering a button that opens an empty space.
 */
export function FormSubmissionsCard(props: FormSubmissionsCardProps) {
  const { hostId, formId } = props
  const [asked, setAsked] = useState(false)
  const Zone = useConsoleWidgetSlot()
  // Read at render, after the shell has loaded its plugins: whether anything
  // in this workspace registered a reader for one form's submissions.
  const hasReader =
    Zone !== null && listConsoleWidgets(FORM_SUBMISSIONS_ZONE.id).length > 0

  if (asked && Zone) {
    return (
      <Zone slot={FORM_SUBMISSIONS_ZONE.id} hostId={hostId} formId={formId} />
    )
  }

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
        {hasReader ? (
          <Button variant="outlined" size="small" onClick={() => setAsked(true)}>
            {'Show submissions'}
          </Button>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'Submissions are read in the Inbox, which is switched off for ' +
              'this workspace or this site. They are still being collected.'}
          </Typography>
        )}
      </Stack>
    </CardDisplay>
  )
}
FormSubmissionsCard.displayName = 'FormSubmissionsCard'

export default FormSubmissionsCard
