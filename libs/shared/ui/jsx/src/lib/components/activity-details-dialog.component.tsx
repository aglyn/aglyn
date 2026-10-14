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

import AppLink from './app-link'
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'

/**
 * A row's words, as the shared label map (`@aglyn/aglyn/app-utils/
 * activity-labels`, `ActivityDescription`) composes them. Declared here by
 * shape, because a shared component imports only shared code.
 */
export interface ActivityDetailsDescription {
  action: string
  target: string
  why: string | null
  credits: number | null
  result: string | null
  /** The stored code — staff only. */
  code: string | null
  /** The stored path — staff only. */
  path: string | null
  /** The AI job behind the row — its id is staff only. */
  jobId: string | null
}

/** One activity or audit row, as the details dialog shows it. */
export interface ActivityDetails {
  /** The row's words, from the shared label map. */
  description: ActivityDetailsDescription
  /** Who did it, as the row names them. */
  who: string
  /** When, already formatted for the reader. */
  when: string
  /** Where, when the list has a Where column. */
  where?: string | null
  /** Places to go from the row: the AI job, the item, the site. */
  links?: ReadonlyArray<{ label: string; href: string }>
  /**
   * Facts only Aglyn staff may read — the raw code and path are added from
   * `description` by the dialog itself, and these after them. Ignored unless
   * the dialog is told it is a staff view.
   */
  staffFields?: ReadonlyArray<{ label: string; value: ReactNode }>
}

export interface ActivityDetailsDialogProps {
  details: ActivityDetails | null
  /**
   * A STAFF view. Only then does the dialog show the stored code, the
   * stored path and `staffFields`: a customer's own activity list opens the
   * same dialog with the same words and none of the platform's internals.
   */
  staff?: boolean
  onClose: () => void
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 0.25, sm: 2 }}>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ minWidth: { sm: 120 }, flexShrink: 0 }}
      >
        {label}
      </Typography>
      <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        {typeof children === 'string' || typeof children === 'number' ? (
          <Typography variant="body2">{children}</Typography>
        ) : (
          children
        )}
      </Box>
    </Stack>
  )
}

/**
 * EVERY ACTIVITY AND AUDIT ROW OPENS THIS (AGL-3660).
 *
 * A table row holds as much as one line can: the act, the target, who,
 * where, when. What did not fit — why, the credits an AI act spent, what
 * came of it, the job it belonged to — is here, in the same words the row
 * used, from the same label map. A staff view adds what a customer never
 * sees: the code the writer stored and the path it filed the row under,
 * which is what an engineer needs to find the row in the database.
 */
export function ActivityDetailsDialog({ details, staff = false, onClose }: ActivityDetailsDialogProps) {
  const description = details?.description
  return (
    <Dialog open={Boolean(details)} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{description?.action ?? 'Activity'}</DialogTitle>
      <DialogContent dividers>
        {details && description ? (
          <Stack spacing={1.25}>
            <Field label="What">{description.action}</Field>
            <Field label="Target">{description.target}</Field>
            {details.where ? <Field label="Where">{details.where}</Field> : null}
            <Field label="Who">{details.who}</Field>
            <Field label="When">{details.when}</Field>
            {description.why ? <Field label="Why">{description.why}</Field> : null}
            {description.credits != null ? (
              <Field label="AI credits">{description.credits.toLocaleString()}</Field>
            ) : null}
            {description.result ? <Field label="Result">{description.result}</Field> : null}
            {details.links?.length ? (
              <Field label="Open">
                <Stack spacing={0.5}>
                  {details.links.map((link) => (
                    <AppLink key={link.href} href={link.href} variant="body2">
                      {link.label}
                    </AppLink>
                  ))}
                </Stack>
              </Field>
            ) : null}
            {staff ? (
              <>
                <Divider flexItem />
                <Typography variant="overline" color="text.secondary">
                  Staff only
                </Typography>
                {description.code ? (
                  <Field label="Code">
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {description.code}
                    </Typography>
                  </Field>
                ) : null}
                {description.path ? (
                  <Field label="Path">
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {description.path}
                    </Typography>
                  </Field>
                ) : null}
                {description.jobId ? (
                  <Field label="AI job id">
                    <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                      {description.jobId}
                    </Typography>
                  </Field>
                ) : null}
                {(details.staffFields ?? []).map((field) => (
                  <Field key={field.label} label={field.label}>
                    {field.value}
                  </Field>
                ))}
              </>
            ) : null}
          </Stack>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  )
}
ActivityDetailsDialog.displayName = 'ActivityDetailsDialog'

export default ActivityDetailsDialog
