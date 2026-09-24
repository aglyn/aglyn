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

import { PageHeaderRecord, pluginDocsHelp } from '@aglyn/aglyn'
import { mdiDeleteOutline, mdiEmailCheckOutline } from '@aglyn/shared-data-mdi'
import {
  AppLink,
  CardDisplay,
  MdiIcon,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useSendingApi,
  type SendingDomainView,
} from '@aglyn/tenant-feature-instance/hooks/use-sending-identity-api'
import { Alert, Button, Chip, Divider, Stack, Typography } from '@mui/material'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  describeOrgSendingDomainRemoval,
  describeSendingDomain,
  INCONCLUSIVE_CHECK,
} from '../model/sending-domain-status'
import {
  OrgSiteSelect,
  orgSiteName,
  useEmailOrgMount,
  useOrgSitePage,
  type EmailOrgMount,
} from './email-org-mount'
import { RecordRow } from './sending-domain-detail'
import { useOrgSendingViews } from './use-org-sending-views'

export interface OrgSendingDomainDetailProps {
  domain: string
  /** The organization's Emails page, for the way back to Sending. */
  basePath: string
}

/**
 * ONE SENDING DOMAIN, from the organization's page —
 * `/[orgSlug]/emails/sending/{domain}`.
 *
 * The domain is the organization's, so its page reads the same as it does
 * from a site's: what to publish, whether a lookup can see it, and the checks
 * that move it on. What changes is the half that is a site's choice. Under a
 * site this page asks whether THIS site sends as the domain; over the org it
 * lists the sites that do, and offers to move another site onto it.
 *
 * The records come from the domains route, which is owner-or-admin. An editor
 * still sees the domain's state and the sites sending as it — both come back
 * on each site's own identity read, which an editor may make — and is told
 * why the records are not shown rather than handed an error.
 *
 * `inconclusive` is held apart from the record exactly as on the site's page:
 * a lookup nobody answered changed nothing.
 */
export function OrgSendingDomainDetail(props: OrgSendingDomainDetailProps) {
  const mount = useEmailOrgMount()
  return mount ? <OrgSendingDomainPage mount={mount} {...props} /> : null
}
OrgSendingDomainDetail.displayName = 'OrgSendingDomainDetail'

function OrgSendingDomainPage(
  props: OrgSendingDomainDetailProps & { mount: EmailOrgMount },
) {
  const { mount, domain, basePath } = props
  const call = useSendingApi()
  const router = useRouter()
  const { confirm } = useConfirmationContext()
  const { enqueueSnackbar } = useSnackbar()
  // Held in a ref: `load` depends on it and the hook hands a fresh function
  // back per render, which would re-run the fetch on every render.
  const notifyRef = useRef(enqueueSnackbar)
  notifyRef.current = enqueueSnackbar

  // The first page of sites by name: enough to say which of them send as
  // this domain, and bounded however many sites the organization runs.
  const { sites } = useOrgSitePage(mount)
  const {
    views,
    reload,
    first,
    loading: viewsLoading,
  } = useOrgSendingViews(sites)
  const canManage = first?.canManage === true

  const [record, setRecord] = useState<SendingDomainView | null>(null)
  const [refusal, setRefusal] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [unreachable, setUnreachable] = useState(false)
  const [assignHostId, setAssignHostId] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const { response, payload } = await call({
      path: 'sending-domains',
      method: 'GET',
      query: { orgId: mount.orgId },
    })
    setLoading(false)
    if (!response.ok) {
      setRecord(null)
      setRefusal(payload?.error ?? 'This domain’s records could not be read.')
      return
    }
    setRefusal('')
    setRecord(
      (payload?.domains ?? []).find(
        (one: SendingDomainView) => one.domain === domain,
      ) ?? null,
    )
  }, [call, mount.orgId, domain])

  useEffect(() => {
    void load()
  }, [load])

  /** The domain as the list knows it, for a reader the records route refused. */
  const listed = first?.domains.find((one) => one.domain === domain) ?? null
  const status = record?.status ?? listed?.status ?? null
  const using = mount.hosts.filter(
    (site) => views[site.id]?.selected === domain,
  )
  /** Sites whose identity this page has not read, so cannot speak for. */
  const unchecked = mount.hosts.filter((site) => !views[site.id]).length
  const offered = mount.hosts.filter(
    (site) => views[site.id]?.selected !== domain,
  )

  const handleVerify = useCallback(async () => {
    if (busy) return
    setBusy(true)
    setUnreachable(false)
    const { response, payload } = await call({
      path: 'sending-domains',
      method: 'POST',
      body: { orgId: mount.orgId, domain, action: 'verify' },
    })
    setBusy(false)
    if (response.status === 503) {
      setUnreachable(true)
      return
    }
    if (!response.ok) {
      return void notifyRef.current(
        payload?.error ?? 'The check could not run',
        {
          variant: 'warning',
        },
      )
    }
    await Promise.all([load(), reload()])
    notifyRef.current(
      payload?.verified
        ? 'Verified — this domain can send'
        : 'Checked. Some records are still missing.',
      { variant: payload?.verified ? 'success' : 'info' },
    )
  }, [busy, call, domain, load, mount.orgId, reload])

  const handleRequestRecords = useCallback(async () => {
    if (busy) return
    setBusy(true)
    const { response, payload } = await call({
      path: 'sending-domains',
      method: 'POST',
      body: { orgId: mount.orgId, domain, action: 'request' },
    })
    setBusy(false)
    if (!response.ok) {
      return void notifyRef.current(
        payload?.error ?? 'Could not request records',
        { variant: 'warning' },
      )
    }
    await load()
  }, [busy, call, domain, load, mount.orgId])

  /** Moves one site onto this domain, or off it with `'platform'`. */
  const handleUse = useCallback(
    async (hostId: string, next: string) => {
      if (busy || !hostId) return
      setBusy(true)
      const { response, payload } = await call({
        path: 'sending-identity',
        method: 'POST',
        body: { hostId, domain: next },
      })
      setBusy(false)
      if (!response.ok) {
        return void notifyRef.current(
          payload?.error ?? 'Could not change the identity',
          { variant: 'warning' },
        )
      }
      setAssignHostId('')
      await reload(hostId)
      // The address the ROUTE settled on — see the site's page.
      const site = orgSiteName(mount, hostId)
      notifyRef.current(
        payload?.from
          ? `${site} now sends as ${payload.from}`
          : `${site}’s sending address was changed`,
        { variant: 'success' },
      )
    },
    [busy, call, mount, reload],
  )

  const handleRelease = useCallback(async () => {
    const ok = await confirm({
      ...describeOrgSendingDomainRemoval({
        domain,
        sites: using.map((site) => ({
          name: orgSiteName(mount, site.id),
          issued: views[site.id]?.platformDomain === domain,
        })),
        unchecked,
      }),
      confirmationButtonProps: { color: 'error' },
    })
      // `confirm` resolves with no value and REJECTS on cancel.
      .then(() => true)
      .catch(() => false)
    if (!ok) return
    const { response, payload } = await call({
      path: 'sending-domains',
      method: 'DELETE',
      query: { orgId: mount.orgId, domain },
    })
    if (!response.ok) {
      return void notifyRef.current(
        payload?.error ?? 'Could not remove the domain',
        { variant: 'warning' },
      )
    }
    router.push(`${basePath}/sending`)
  }, [basePath, call, confirm, domain, mount, router, unchecked, using, views])

  const state = status
    ? describeSendingDomain({
        status,
        pendingProvider: record?.pendingProvider ?? status === 'requested',
        issueError: record?.lastIssueError ?? listed?.lastIssueError ?? null,
        missing: record?.lastMissing ?? null,
      })
    : null
  const missing = new Set(record?.lastMissing ?? [])
  const actions: RowActionsMenuItem[] =
    canManage && record
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

  const card = (
    <CardDisplay
      header={'Sending domain'}
      help={pluginDocsHelp('emailCampaigns', { anchor: '#sending-domains' })}
      contentGutterX
      contentGutterY
      contentBordered="all"
      HeaderProps={{
        action: (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Button
              component={AppLink as any}
              {...({ componentVariant: 'naked', nativeButton: false } as any)}
              href={`${basePath}/sending`}
              size="small"
              color="primary"
            >
              {'All of Sending'}
            </Button>
            {actions.length ? <RowActionsMenu items={actions} /> : null}
          </Stack>
        ),
      }}
    >
      {(loading || viewsLoading) && !state ? (
        <Typography variant="body2" color="text.secondary">
          {'Loading…'}
        </Typography>
      ) : !state ? (
        <Alert severity="warning">
          {refusal ||
            `${domain} is not claimed by this organization. It may have been ` +
              'removed — go back and add it again if you still want it.'}
        </Alert>
      ) : (
        <Stack spacing={2}>
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
          >
            <Chip
              label={state.label}
              color={state.color}
              variant={state.sending ? 'filled' : 'outlined'}
            />
          </Stack>

          <Alert severity={state.severity}>{state.text}</Alert>

          {unreachable ? (
            <Alert severity={INCONCLUSIVE_CHECK.severity} icon={false}>
              <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                {INCONCLUSIVE_CHECK.label}
              </Typography>
              <Typography variant="body2">{INCONCLUSIVE_CHECK.text}</Typography>
            </Alert>
          ) : null}

          {/*
            THE SITES SENDING AS IT, of those this page read. Each is the
            site's own choice, and moving one off it is the org twin of the
            "stop sending" control on a site's page.
           */}
          <Divider />
          <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
            {'Sites sending as this domain'}
          </Typography>
          {using.length ? (
            <Stack spacing={1}>
              {using.map((site) => (
                <Stack
                  key={site.id}
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                >
                  <Typography variant="body2">
                    {orgSiteName(mount, site.id)}
                  </Typography>
                  {canManage ? (
                    <Button
                      size="small"
                      disabled={busy}
                      onClick={() => void handleUse(site.id, 'platform')}
                    >
                      {'Stop sending as this domain'}
                    </Button>
                  ) : null}
                </Stack>
              ))}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {unchecked
                ? 'None of the sites checked sends as it.'
                : 'No site sends as it.'}
            </Typography>
          )}
          {unchecked && !viewsLoading ? (
            <Typography variant="caption" color="text.secondary">
              {`${unchecked} more ${unchecked === 1 ? 'site was' : 'sites were'} ` +
                'not checked; the Sending page reads them a page at a time.'}
            </Typography>
          ) : null}
          {canManage && status === 'verified' && offered.length ? (
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ alignItems: 'center', flexWrap: 'wrap' }}
            >
              <OrgSiteSelect
                mount={mount}
                label="Send a site’s email as this domain"
                value={assignHostId}
                onChange={setAssignHostId}
                sites={offered}
              />
              <Button
                variant="outlined"
                startIcon={
                  <MdiIcon path={mdiEmailCheckOutline.path} size={0.8} />
                }
                disabled={busy || !assignHostId}
                onClick={() => void handleUse(assignHostId, domain)}
              >
                {'Send as this domain'}
              </Button>
            </Stack>
          ) : null}

          {/*
            THE RECORDS, which only the domains route returns. A reader it
            refused is told why, in place of the records, rather than shown an
            empty section that reads as "nothing to publish".
           */}
          <Divider />
          {refusal ? (
            <Alert severity="info">
              {canManage
                ? refusal
                : 'The records to publish, and the checks that verify them, ' +
                  'are shown to the organization’s owners and admins.'}
            </Alert>
          ) : record ? (
            <>
              {record.dmarc ? (
                <Alert
                  severity={
                    record.dmarc.policy === 'reject' &&
                    record.status !== 'verified'
                      ? 'error'
                      : 'info'
                  }
                >
                  {record.dmarc.consequence}
                </Alert>
              ) : null}
              {record.records?.some((entry) => entry.value) ? (
                <>
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
                      <RecordRow
                        record={record.dmarcSuggestion}
                        missing={false}
                      />
                    ) : null}
                  </Stack>
                </>
              ) : null}
              <Stack
                direction="row"
                spacing={1}
                sx={{ flexWrap: 'wrap', gap: 1 }}
              >
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
              </Stack>
            </>
          ) : null}
        </Stack>
      )}
    </CardDisplay>
  )

  return (
    <>
      <PageHeaderRecord title={domain} />
      {card}
    </>
  )
}
OrgSendingDomainPage.displayName = 'OrgSendingDomainPage'

export default OrgSendingDomainDetail
