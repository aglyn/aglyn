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

import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import {
  Button,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import { docsHelp } from '../constants/docs-links'
import { buildRoute, Route } from '../constants/route-links'

/**
 * A person resolved server-side by `/api/admin/org-detail` (AGL-938) —
 * mirrors `ResolvedPerson` from `@aglyn/tenant-data-admin`, redeclared here
 * because that module is server-only and this file ships to the client.
 */
export interface StaffPerson {
  uid: string
  email: string | null
  displayName: string | null
  source: 'auth' | 'roster' | null
}

/**
 * Name-or-email for a resolved person; null when nothing resolved — the
 * caller then shows the uid itself, which at least identifies the account.
 */
export function staffPersonLabel(
  person: StaffPerson | null | undefined,
): string | null {
  return person?.displayName ?? person?.email ?? null
}

/** A labelled value row — the whole point of AGL-938's second half. */
const FieldRow = ({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) => (
  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{ width: 112, flexShrink: 0 }}
    >
      {label}
    </Typography>
    {children}
  </Stack>
)

const GroupHeader = ({ children }: { children: string }) => (
  <Typography
    variant="overline"
    color="text.secondary"
    sx={{ lineHeight: 1.5, pt: 0.5 }}
  >
    {children}
  </Typography>
)

export interface StaffOrgSummaryCardProps {
  orgId: string
  /** The org served by `/api/admin/org-detail`; null while absent/unread. */
  org: {
    name?: string | null
    slug?: string | null
    plan?: string | null
    ownerUid?: string | null
    stripeCustomerId?: string | null
    suspendedAt?: unknown
    suspendedReason?: string | null
    subscription?: { status?: string | null } | null
    createdAt?: { seconds?: number } | null
  } | null
  /** The resolved owner, when the detail endpoint could name one. */
  owner?: StaffPerson | null
  onImpersonateOwner: () => void
}

/**
 * The staff org-detail Summary card (AGL-938). Every value carries a label,
 * grouped as identity (name/id/slug/owner/created) and billing
 * (plan/subscription/Stripe); the org id is copyable because staff paste it
 * into scripts constantly. The owner renders as a person — uid demoted to a
 * tooltip — with the raw uid kept visible only when no identity store could
 * resolve it (an SSO roster gap or an erased account), never a blank.
 */
const StaffOrgSummaryCard = ({
  orgId,
  org,
  owner,
  onImpersonateOwner,
}: StaffOrgSummaryCardProps) => {
  const { enqueueSnackbar } = useSnackbar()
  const handleCopyOrgId = () => {
    void navigator.clipboard.writeText(orgId)
    enqueueSnackbar('Org id copied', { variant: 'success', persist: false })
  }
  const ownerLabel = staffPersonLabel(owner)

  return (
    <CardDisplay
      header={'Summary'}
      help={docsHelp('staffConsole', {
        anchor: '#whats-there',
        excerpt:
          'Plan, subscription, and suspension state at a glance. Impersonating the owner replaces your session and is audited.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1}>
        <GroupHeader>{'Identity'}</GroupHeader>
        <FieldRow label="Name">
          <Typography variant="body2">{org?.name ?? '—'}</Typography>
        </FieldRow>
        <FieldRow label="Org ID">
          <Typography
            variant="body2"
            sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
          >
            {orgId}
          </Typography>
          <Tooltip title="Copy org id">
            <IconButton
              size="small"
              aria-label="Copy org id"
              onClick={handleCopyOrgId}
            >
              <ContentCopyIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        </FieldRow>
        <FieldRow label="Slug">
          <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
            {org?.slug ?? '—'}
          </Typography>
        </FieldRow>
        <FieldRow label="Owner">
          {org?.ownerUid ? (
            // The one identifier on this card with a page of its own
            // (AGL-244). Resolved, the uid survives as the tooltip; when no
            // store answered, the uid itself renders — flagged, not blank.
            <Tooltip
              title={
                ownerLabel
                  ? org.ownerUid
                  : `${org.ownerUid} — no auth record or roster entry resolved this uid`
              }
            >
              <AppLink
                variant="body2"
                color={ownerLabel ? 'primary' : 'text.secondary'}
                underline="hover"
                sx={ownerLabel ? undefined : { fontFamily: 'monospace' }}
                href={buildRoute(Route.ADMIN_USER_DETAIL, {
                  uid: org.ownerUid,
                })}
              >
                {ownerLabel ?? org.ownerUid}
              </AppLink>
            </Tooltip>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {'—'}
            </Typography>
          )}
        </FieldRow>
        <FieldRow label="Created">
          <Typography variant="body2">
            {org?.createdAt?.seconds
              ? new Date(org.createdAt.seconds * 1000).toLocaleDateString()
              : '—'}
          </Typography>
        </FieldRow>

        <GroupHeader>{'Billing'}</GroupHeader>
        <FieldRow label="Plan">
          <Chip
            label={org?.plan ?? 'no plan'}
            size="small"
            color={org?.plan ? 'primary' : 'default'}
          />
          {org?.suspendedAt ? (
            <Chip
              label={`suspended${
                org?.suspendedReason ? `: ${org.suspendedReason}` : ''
              }`}
              size="small"
              color="error"
            />
          ) : null}
        </FieldRow>
        <FieldRow label="Subscription">
          {org?.subscription?.status ? (
            <Chip
              label={org.subscription.status}
              size="small"
              variant="outlined"
            />
          ) : (
            <Typography variant="body2" color="text.secondary">
              {'—'}
            </Typography>
          )}
        </FieldRow>
        <FieldRow label="Stripe customer">
          <Typography
            variant="body2"
            color={org?.stripeCustomerId ? 'text.primary' : 'text.secondary'}
            sx={org?.stripeCustomerId ? { fontFamily: 'monospace' } : undefined}
          >
            {org?.stripeCustomerId ?? '—'}
          </Typography>
        </FieldRow>

        {org?.ownerUid ? (
          // Org impersonation (AGL-357).
          <Button
            size="small"
            color="warning"
            variant="outlined"
            sx={{ alignSelf: 'flex-start', mt: 0.5 }}
            onClick={onImpersonateOwner}
          >
            {'Impersonate owner (replaces your session)'}
          </Button>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
StaffOrgSummaryCard.displayName = 'StaffOrgSummaryCard'

export default StaffOrgSummaryCard
