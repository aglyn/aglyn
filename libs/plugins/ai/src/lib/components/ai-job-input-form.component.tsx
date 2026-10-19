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

import type { MaybeTokenSource } from '@aglyn/shared-util-http/authorized-token'
import { Alert, Button, Stack, TextField } from '@mui/material'
import { useState, type FormEvent } from 'react'
import { aiJobInputKey } from '../model/ai-job-input'
import type { AiJobInputRequest, AiJobSummary } from '../model/ai-jobs.types'
import { resumeAiJobRequest } from './ai-job-requests'

export interface AiJobInputFormProps {
  job: AiJobSummary & { input: AiJobInputRequest }
  orgId: string
  user: MaybeTokenSource
  /** The job as the door answered: back on its plan card once the answer reads. */
  onJob: (job: AiJobSummary) => void
}

/**
 * What a job waiting in `needs_input` for a person asks (AGL-3978) — a
 * tracking change's Meta pixel ID — as one field per id, each naming its
 * provider. Continue sends the answers through the resume door, which holds
 * each to its pattern and answers a refusal by field, shown under it; an
 * answer that reads returns the job to its plan card. Paused, never failed.
 * The AI jobs drawer and the Assist build card both draw it.
 */
export function AiJobInputForm({ job, orgId, user, onJob }: AiJobInputFormProps): JSX.Element {
  const [values, setValues] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setNotice(null)
    const decision = await resumeAiJobRequest(user, orgId, job, { input: values })
    setErrors(decision.fieldErrors ?? {})
    if (decision.error && !decision.fieldErrors) setNotice(decision.error)
    if (decision.job) onJob(decision.job)
    setBusy(false)
  }

  return (
    <Alert severity="warning" icon={false} sx={{ mt: 0.5 }} aria-label="Waiting for your answer">
      <Stack component="form" spacing={1} onSubmit={(event) => void submit(event)} noValidate>
        <span>{`Paused. ${job.input.message} Nothing is built until you answer and confirm the plan.`}</span>
        {job.input.fields.map((field) => {
          const key = aiJobInputKey(field)
          return (
            <TextField
              key={key}
              size="small"
              label={field.label}
              value={values[key] ?? ''}
              onChange={(event) => setValues((current) => ({ ...current, [key]: event.target.value }))}
              error={Boolean(errors[key])}
              helperText={errors[key] ?? `It looks like ${field.shape}.`}
              disabled={busy}
              required
              fullWidth
            />
          )
        })}
        {notice ? (
          <span role="alert">{notice}</span>
        ) : null}
        <Stack direction="row">
          <Button type="submit" size="small" variant="contained" disabled={busy}>
            {'Continue'}
          </Button>
        </Stack>
      </Stack>
    </Alert>
  )
}
