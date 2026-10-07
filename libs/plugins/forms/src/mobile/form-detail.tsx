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

/**
 * ONE FORM (AGL-3622): what it has collected, as the console's form page
 * counts it (the counters the submit route and the recount keep on the
 * form, never a read of the submissions), and its submissions behind an ask.
 *
 * The console's form page does not list submissions itself: its
 * "Submissions to this form" card hosts the Inbox's reader, scoped to the
 * form, and says the Inbox is off when nothing reads them. The app does the
 * same through the Inbox's screen, by id, so the two plugins stay apart.
 */

import { getMobileScreen, type MobilePluginContext } from '@aglyn/mobile-plugin-host'
import { Button, Card, EmptyState, Field, Screen, Skeleton, Text } from '@aglyn/mobile-ui'
import { FORM_STATUS_OPTIONS } from '../lib/constants/form-list-query'
import { SUBMISSIONS_READER_SCREEN } from './screen-ids'
import { recorded, useForm } from './use-forms'

const figure = (value: number | null) => (value == null ? 'Not counted yet' : value.toLocaleString())

export function FormDetail({ context, formId }: { context: MobilePluginContext; formId: string | null }) {
  const form = useForm(context.firestore, context.hostId, formId)
  if (!formId) return <EmptyState icon="document-text-outline" title="Pick a form to see it here" />
  if (!form.ready) {
    return (
      <Screen>
        <Skeleton height={24} />
        <Skeleton height={96} />
      </Screen>
    )
  }
  if (form.error) return <EmptyState icon="warning-outline" title="Could not load this form" />
  if (!form.data) return <EmptyState icon="document-text-outline" title="This form is no longer on the site" />

  const name = form.data.displayName || formId
  const stats = form.data.stats ?? {}
  const lastAt = recorded(stats.lastSubmissionAtMs)
  const status = FORM_STATUS_OPTIONS.find((option) => option.value === String(form.data?.retired === true))
  const hasReader = Boolean(getMobileScreen(SUBMISSIONS_READER_SCREEN))

  return (
    <Screen>
      <Card
        title={name}
        actions={
          <Button
            variant="text"
            icon="open-outline"
            title="Console"
            onPress={() => context.openConsolePath(`/forms/${encodeURIComponent(formId)}`, 'site')}
          />
        }
      >
        <Field label="Status" value={status?.label ?? 'Active'} />
        {form.data.slug ? <Field label="Slug" value={form.data.slug} /> : null}
        <Field label="Lead routing" value={form.data.routing?.lead === true ? 'On' : 'Off'} />
      </Card>
      <Card title="What this form has collected">
        <Field testID="form-views" label="Views" value={figure(recorded(stats.views))} />
        <Field testID="form-submissions" label="Submissions" value={figure(recorded(stats.submissions))} />
        <Field testID="form-leads" label="Leads" value={figure(recorded(stats.leads))} />
        <Field label="Last submission" value={lastAt == null ? 'None yet' : new Date(lastAt).toLocaleString()} />
      </Card>
      <Card
        title="Submissions to this form"
        actions={
          hasReader ? (
            <Button
              testID="form-show-submissions"
              variant="text"
              icon="mail-outline"
              title="Show"
              onPress={() => context.navigate(SUBMISSIONS_READER_SCREEN, { formId, formName: name })}
            />
          ) : null
        }
      >
        {hasReader ? (
          <Text tone="secondary">The messages this form collected, newest first.</Text>
        ) : (
          <Text tone="secondary" testID="form-no-reader">
            Submissions are read in the Inbox, which is switched off for this workspace or this site. They are still
            being collected.
          </Text>
        )}
      </Card>
    </Screen>
  )
}
