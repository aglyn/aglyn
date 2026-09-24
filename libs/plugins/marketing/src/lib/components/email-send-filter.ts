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

import {
  campaignSendDisplay,
  type CampaignSendDisplayState,
} from '@aglyn/shared-ui-email-campaigns/model'
import { inMemoryListField } from '@aglyn/shared-ui-jsx/const/list-grid-filter'

/*
 * What a table of emails filters by (AGL-3317) — the Emails list and a
 * campaign's own emails. State is what the email is DOING
 * (`campaignSendDisplay`), not the status it stores, so an email between
 * batches is Sending, not Scheduled; the subject and the state columns read
 * their filter values from the fields `emailFilterValues` adds to a row.
 */
export const EMAIL_STATE_OPTIONS: ReadonlyArray<{
  value: CampaignSendDisplayState
  label: string
}> = [
  { value: 'draft', label: 'Draft' },
  { value: 'pending', label: 'Scheduled' },
  { value: 'sending', label: 'Sending' },
  { value: 'sent', label: 'Sent' },
  { value: 'stopped', label: 'Stopped' },
]

export const EMAIL_SUBJECT_FILTER_FIELD = inMemoryListField('subject', 'text', 'subjectText')
export const EMAIL_STATE_FILTER_FIELD = inMemoryListField('state', 'select', 'stateKey')

/** The filter values an email row carries beside its stored fields. */
export function emailFilterValues(email: {
  $id?: string
  subject?: string | null
  status?: string
}): { subjectText: string; stateKey: CampaignSendDisplayState } {
  return {
    subjectText: email.subject || 'Untitled email',
    stateKey: campaignSendDisplay(email as never).state,
  }
}
