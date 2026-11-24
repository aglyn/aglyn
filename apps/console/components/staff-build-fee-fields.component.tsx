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

import {
  BUILD_FEE_DEFAULT_LABEL,
  BUILD_FEE_LABEL_MAX,
  BUILD_FEE_PAYING_WORKSPACE_REFUSAL,
  buildFeeDraftProblem,
  chargeForWorkOverlapWarning,
  describeBuildFee,
  type ChargeForWorkProjectSummary,
} from '@aglyn/aglyn/app-utils/build-fee'
import { describeBundle } from '@aglyn/aglyn/app-utils/bundle-intent'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Alert, InputAdornment, Stack, TextField, Typography } from '@mui/material'
import { useEffect, useRef, useState } from 'react'
import { buildFeeDraftBody, bundleDraftBody, type BundleDraft } from './staff-bundle-fields.component'

/**
 * The workspace's Charge for work projects (AGL-3970), read through the staff
 * route, for the warning beside a build fee (AGL-4244). Empty while the read
 * is on its way and when it fails: the warning is a courtesy, never a gate.
 */
export function useChargeForWorkProjects(orgId: string | null | undefined): ChargeForWorkProjectSummary[] {
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const uid = user?.uid ?? null
  const [projects, setProjects] = useState<ChargeForWorkProjectSummary[]>([])
  useEffect(() => {
    if (!uid || !orgId) return
    let cancelled = false
    void authorizedFetch(
      userRef.current,
      `/api/admin/site-care/projects?orgId=${encodeURIComponent(orgId)}`,
      { method: 'GET' },
    )
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled || !Array.isArray(payload?.projects)) return
        setProjects(
          payload.projects
            .map((view: { project?: ChargeForWorkProjectSummary }) => view?.project)
            .filter((project: unknown): project is ChargeForWorkProjectSummary => !!project),
        )
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [uid, orgId])
  return projects
}

export interface StaffBuildFeeFieldsProps {
  orgId: string
  draft: BundleDraft
  onChange: (next: BundleDraft) => void
  disabled?: boolean
  /** The workspace already pays: no fee can ride a first invoice, so the fields are off with why. */
  subscriptionLive?: boolean
  /**
   * The projects to warn about, for a caller that already holds them; read
   * from the staff route when absent.
   */
  projects?: readonly ChargeForWorkProjectSummary[]
}

/**
 * The optional one-time "Website build fee" on the Hand off dialog, Ask to
 * upgrade and the bundle link card (AGL-4244): an amount in dollars and the
 * line the owner sees, then what the owner sees for the bundle with it. The
 * owner pays it with the plan, on the subscription's first invoice, with
 * sales tax added by Stripe.
 *
 * Starts empty, including for a workspace made with Build for a client: a fee
 * is a price staff agree with the owner, never a default. When the workspace
 * also has an open Charge for work quote, the fields warn that it may be the
 * same build, without refusing: it may be different work.
 */
export function StaffBuildFeeFields(props: StaffBuildFeeFieldsProps) {
  const { orgId, draft, onChange, disabled, subscriptionLive } = props
  const fee = draft.buildFee ?? { amount: '', label: '' }
  const set = (patch: Partial<typeof fee>) => onChange({ ...draft, buildFee: { ...fee, ...patch } })
  const fetched = useChargeForWorkProjects(props.projects ? null : orgId)
  const projects = props.projects ?? fetched
  const problem = buildFeeDraftProblem(fee)
  const body = problem ? null : buildFeeDraftBody(fee)
  const overlap = body ? chargeForWorkOverlapWarning(projects) : null
  const off = disabled || subscriptionLive
  return (
    <Stack spacing={1.5}>
      <Typography variant="overline" color="text.secondary">
        {'Website build fee (optional)'}
      </Typography>
      {subscriptionLive ? <Alert severity="info">{BUILD_FEE_PAYING_WORKSPACE_REFUSAL}</Alert> : null}
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
        <TextField
          size="small"
          label="Amount"
          value={fee.amount}
          disabled={off}
          onChange={(event) => set({ amount: event.target.value.replace(/[^\d.,$]/g, '') })}
          error={!!problem}
          helperText={problem ?? 'Charged once, with the first payment, plus sales tax.'}
          slotProps={{
            input: { startAdornment: <InputAdornment position="start">{'$'}</InputAdornment> },
            htmlInput: { inputMode: 'decimal', 'aria-label': 'Website build fee amount' },
          }}
          sx={{ minWidth: 160 }}
        />
        <TextField
          size="small"
          label="Line the owner sees"
          placeholder={BUILD_FEE_DEFAULT_LABEL}
          value={fee.label}
          disabled={off}
          onChange={(event) => set({ label: event.target.value.slice(0, BUILD_FEE_LABEL_MAX) })}
          sx={{ flex: 1 }}
        />
      </Stack>
      {overlap ? <Alert severity="warning">{overlap}</Alert> : null}
      <StaffBundleOwnerSummary draft={draft} />
    </Stack>
  )
}

/**
 * "What the owner sees": the bundle as Billing will have it chosen, and the
 * build fee as its own one-time line (AGL-4244).
 */
export function StaffBundleOwnerSummary({ draft }: { draft: BundleDraft }) {
  const body = bundleDraftBody(draft)
  const fee = buildFeeDraftProblem(draft.buildFee) ? null : (body.buildFee ?? null)
  return (
    <Stack spacing={0.25}>
      <Typography variant="overline" color="text.secondary">
        {'What the owner sees'}
      </Typography>
      <Typography variant="body2">{describeBundle(body)}</Typography>
      {fee ? (
        <Typography variant="body2">
          {describeBuildFee({ amountCents: fee.amountCents, label: fee.label || BUILD_FEE_DEFAULT_LABEL })}
        </Typography>
      ) : null}
      <Typography variant="caption" color="text.secondary">
        {fee
          ? 'Billing shows the total due today, the plan and the build fee with sales tax, before they pay.'
          : 'Billing shows the total due today, with sales tax, before they pay.'}
      </Typography>
    </Stack>
  )
}

export default StaffBuildFeeFields
