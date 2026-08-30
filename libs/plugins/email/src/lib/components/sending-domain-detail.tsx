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
import { mdiDeleteOutline, mdiEmailCheckOutline } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  Divider,
  Stack,
  Typography,
} from '@mui/material'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  describeSendingDomain,
  INCONCLUSIVE_CHECK,
} from '../model/sending-domain-status'
import {
  useSendingApi,
  type SendingDnsRecordView,
  type SendingDomainView,
  type SendingIdentityView,
} from './use-sending-identity-api'

export interface SendingDomainDetailProps {
  hostId: string
  domain: string
  basePath: string
}

/** The record block, in the shape a registrar's own form asks for. */
function RecordRow(props: { record: SendingDnsRecordView; missing: boolean }) {
  const { record, missing } = props
  const target = record.priority
    ? `${record.priority} ${record.value}`
    : record.value
  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Chip size="small" label={record.type} variant="outlined" />
        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
          {record.purpose === 'spf'
            ? 'Authorization'
            : record.purpose === 'dkim'
              ? 'Signing key'
              : record.purpose === 'return-path'
                ? 'Bounce routing'
                : 'DMARC policy'}
        </Typography>
        {record.required ? null : (
          <Chip size="small" label="Optional" variant="outlined" />
        )}
        {missing ? <Chip size="small" label="Not seen yet" color="warning" /> : null}
      </Stack>
      <Typography
        variant="body2"
        component="code"
        sx={{
          p: 1,
          bgcolor: 'action.hover',
          borderRadius: 1,
          fontFamily: 'monospace',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }}
      >
        {`${record.type}  ${record.name}  →  ${target || '(not issued yet)'}`}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {record.note}
      </Typography>
    </Stack>
  )
}
RecordRow.displayName = 'RecordRow'

/**
 * ONE SENDING DOMAIN: what to publish, whether we can see it, and whether
 * this site sends as it.
 *
 * ## `inconclusive` is not a failure, and this page is where that is felt
 *
 * Pressing Check DNS has three outcomes, not two. The third is that nobody
 * answered — a resolver outage, a timeout — and the route says so with a
 * `503` rather than with `verified: false`. It is held HERE, in the surface's
 * own state, next to a status the record still holds, because the record was
 * not changed and saying otherwise would send a customer whose DNS is perfect
 * to go and edit a zone that has nothing wrong with it.
 *
 * That is why `lastCheck` is a separate piece of state from `record.status`
 * and never assigned into it.
 */
export function SendingDomainDetail(props: SendingDomainDetailProps) {
  const { hostId, domain, basePath } = props
  const call = useSendingApi()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  /*
   * The snackbar held in a REF, for the reason `use-campaign-send-api` holds
   * the user in one: `load` is a dependency of the effect that runs it, so
   * anything whose identity changes per render re-runs the fetch — and a
   * hook returning a fresh object each render turns that into a loop that
   * never settles. Reading it through a ref makes the effect depend on the
   * things that actually identify the request.
   */
  const notifyRef = useRef(enqueueSnackbar)
  notifyRef.current = enqueueSnackbar
  const { confirm } = useConfirmationContext()

  const [identity, setIdentity] = useState<SendingIdentityView | null>(null)
  const [record, setRecord] = useState<SendingDomainView | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  /**
   * The outcome of the last check the reader ran, and ONLY when it was
   * inconclusive. Never merged into the record: an unanswered lookup is
   * evidence of nothing, and the record's own status is still the last thing
   * we actually established.
   */
  const [unreachable, setUnreachable] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const view = await call({
      path: 'sending-identity',
      method: 'GET',
      query: { hostId },
    })
    if (!view.response.ok) {
      setLoading(false)
      return void notifyRef.current(
        view.payload?.error ?? 'Could not read the sending identity',
        { variant: 'warning' },
      )
    }
    setIdentity(view.payload as SendingIdentityView)
    const orgId = String(view.payload?.orgId ?? '')
    const domains = orgId
      ? await call({
          path: 'sending-domains',
          method: 'GET',
          query: { orgId },
        })
      : null
    setLoading(false)
    const found = (domains?.payload?.domains ?? []).find(
      (one: SendingDomainView) => one.domain === domain,
    )
    setRecord(found ?? null)
  }, [call, hostId, domain])

  useEffect(() => {
    void load()
  }, [load])

  const handleVerify = useCallback(async () => {
    if (busy || !identity?.orgId) return
    setBusy(true)
    setUnreachable(false)
    const { response, payload } = await call({
      path: 'sending-domains',
      method: 'POST',
      body: { orgId: identity.orgId, domain, action: 'verify' },
    })
    setBusy(false)
    /*
     * THE THIRD OUTCOME.
     *
     * A `503` here means the lookup got no answer. Nothing about the domain
     * changed, so nothing on screen changes either except a notice saying the
     * question could not be asked. Treating it as a failed check — which is
     * what a plain `!response.ok` branch would do — is how a customer ends up
     * rewriting records that were already correct.
     */
    if (response.status === 503) {
      setUnreachable(true)
      return
    }
    if (!response.ok) {
      return void notifyRef.current(payload?.error ?? 'The check could not run', {
        variant: 'warning',
      })
    }
    await load()
    notifyRef.current(
      payload?.verified
        ? 'Verified — this domain can send'
        : 'Checked. Some records are still missing.',
      { variant: payload?.verified ? 'success' : 'info' },
    )
  }, [busy, call, identity?.orgId, domain, load])

  const handleRequestRecords = useCallback(async () => {
    if (busy || !identity?.orgId) return
    setBusy(true)
    const { response, payload } = await call({
      path: 'sending-domains',
      method: 'POST',
      body: { orgId: identity.orgId, domain, action: 'request' },
    })
    setBusy(false)
    if (!response.ok) {
      return void notifyRef.current(payload?.error ?? 'Could not request records', {
        variant: 'warning',
      })
    }
    await load()
  }, [busy, call, identity?.orgId, domain, load])

  const handleUse = useCallback(
    async (next: string) => {
      if (busy) return
      setBusy(true)
      const { response, payload } = await call({
        path: 'sending-identity',
        method: 'POST',
        body: { hostId, domain: next },
      })
      setBusy(false)
      if (!response.ok) {
        return void notifyRef.current(payload?.error ?? 'Could not change the identity', {
          variant: 'warning',
        })
      }
      await load()
      notifyRef.current(
        next === 'platform'
          ? 'This site now sends on the shared Aglyn domain'
          : `This site now sends as ${payload?.from ?? next}`,
        { variant: 'success' },
      )
    },
    [busy, call, hostId, load],
  )

  const handleRelease = useCallback(async () => {
    if (!identity?.orgId) return
    const ok = await confirm({
      title: `Remove ${domain}?`,
      /*
       * The consequence stated rather than implied. Removing the claim does
       * NOT move a site sending as this domain back onto the shared one —
       * that site refuses instead, which is deliberate and is exactly the
       * thing a person needs told before they press the button rather than
       * after their campaigns start failing.
       */
      description:
        identity.selected === domain
          ? `This site is currently sending as ${domain}. Removing the ` +
            `domain does not move it back to the shared Aglyn address — it ` +
            `stops this site sending at all until you choose another ` +
            `identity. The DNS records stay in your zone; nothing is changed ` +
            `at your registrar.`
          : `The claim and the signing key are dropped. The DNS records stay ` +
            `in your zone — nothing is changed at your registrar — and you ` +
            `can add the domain again later, which issues a new key.`,
      confirmationText: 'Remove domain',
      confirmationButtonProps: { color: 'error' },
    })
      // `confirm` resolves with no value and REJECTS on cancel, so the
      // resolved value alone can never gate this.
      .then(() => true)
      .catch(() => false)
    if (!ok) return
    const { response, payload } = await call({
      path: 'sending-domains',
      method: 'DELETE',
      query: { orgId: identity.orgId, domain },
    })
    if (!response.ok) {
      return void notifyRef.current(payload?.error ?? 'Could not remove the domain', {
        variant: 'warning',
      })
    }
    router.push(basePath)
  }, [confirm, call, identity, domain, router, basePath])

  const state = describeSendingDomain({
    status: record?.status ?? 'requested',
    pendingProvider: record?.pendingProvider ?? record?.status === 'requested',
    issueError: record?.lastIssueError ?? null,
    missing: record?.lastMissing ?? null,
  })
  const missing = new Set(record?.lastMissing ?? [])
  const canManage = identity?.canManage === true
  const isSelected = identity?.selected === domain

  const actions: RowActionsMenuItem[] = canManage
    ? [
        {
          key: 'release',
          label: 'Remove domain',
          icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
          destructive: true,
          onClick: () => void handleRelease(),
        },
      ]
    : []

  return (
    <CardDisplay
      header={domain}
      help={pluginDocsHelp('emailCampaigns', {
        anchor: '#sending-domains',
      })}
      contentGutterX
      contentGutterY
      contentBordered="all"
      HeaderProps={{
        action: actions.length ? <RowActionsMenu items={actions} /> : null,
      }}
    >
      {loading ? (
        <Typography variant="body2" color="text.secondary">
          {'Loading…'}
        </Typography>
      ) : !record ? (
        <Alert severity="warning">
          {`${domain} is not claimed by this workspace. It may have been ` +
            `removed — go back and add it again if you still want it.`}
        </Alert>
      ) : (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Chip
              label={state.label}
              color={state.color}
              variant={state.sending ? 'filled' : 'outlined'}
            />
            {isSelected ? (
              <Chip label="This site sends as this" color="primary" size="small" />
            ) : null}
          </Stack>

          <Alert severity={state.severity}>{state.text}</Alert>

          {/*
            The unanswered check, BESIDE the state above and never instead of
            it. Both are true at once: the record still says what it said, and
            the last thing we tried could not be completed.
           */}
          {unreachable ? (
            <Alert severity={INCONCLUSIVE_CHECK.severity} icon={false}>
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                {INCONCLUSIVE_CHECK.label}
              </Typography>
              <Typography variant="body2">{INCONCLUSIVE_CHECK.text}</Typography>
            </Alert>
          ) : null}

          {/*
            The customer's DMARC policy, read and never written. It decides
            whether unauthenticated mail from this domain is filed as spam or
            refused outright, which is something a person publishing these
            records should know before they finish rather than after.
           */}
          {record.dmarc ? (
            <Alert
              severity={
                record.dmarc.policy === 'reject' && record.status !== 'verified'
                  ? 'error'
                  : 'info'
              }
            >
              {record.dmarc.consequence}
            </Alert>
          ) : null}

          {record.records?.length &&
          record.records.some((entry) => entry.value) ? (
            <>
              <Divider />
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                {'Publish these records'}
              </Typography>
              <Stack spacing={2}>
                {record.records
                  .filter((entry) => entry.value)
                  .map((entry) => (
                    <RecordRow
                      key={`${entry.type}:${entry.name}`}
                      record={entry}
                      missing={missing.has(`${entry.type}:${entry.name}`)}
                    />
                  ))}
                {record.dmarcSuggestion &&
                record.dmarc?.policy === 'absent' ? (
                  <RecordRow record={record.dmarcSuggestion} missing={false} />
                ) : null}
              </Stack>
            </>
          ) : null}

          <Divider />
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
            {record.status === 'requested' && canManage ? (
              <Button
                variant="contained"
                disabled={busy}
                onClick={() => void handleRequestRecords()}
              >
                {busy ? 'Working…' : 'Request records'}
              </Button>
            ) : null}
            {record.status !== 'requested' ? (
              <Button
                variant="contained"
                disabled={busy}
                onClick={() => void handleVerify()}
              >
                {busy ? 'Checking…' : 'Check DNS'}
              </Button>
            ) : null}
            {canManage && record.status === 'verified' && !isSelected ? (
              <Button
                variant="outlined"
                startIcon={<MdiIcon path={mdiEmailCheckOutline.path} size={0.8} />}
                disabled={busy}
                onClick={() => void handleUse(domain)}
              >
                {'Send this site’s email as this domain'}
              </Button>
            ) : null}
            {canManage && isSelected ? (
              <Button
                variant="outlined"
                disabled={busy}
                onClick={() => void handleUse('platform')}
              >
                {'Go back to the shared Aglyn domain'}
              </Button>
            ) : null}
          </Stack>
        </Stack>
      )}
    </CardDisplay>
  )
}
SendingDomainDetail.displayName = 'SendingDomainDetail'

export default SendingDomainDetail
