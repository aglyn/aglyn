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
import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import {
  mdiDeleteOutline,
  mdiDnsOutline,
  mdiEmailCheckOutline,
  mdiRefresh,
} from '@aglyn/shared-data-mdi'
import {
  AppLink,
  CardDisplay,
  Container,
  MdiIcon,
  SrOnly,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { NavigationDrawerComponent } from '@aglyn/shared-ui-jsx/components/navigation-drawer.component'
import RowActionsMenu, {
  type RowActionsMenuItem,
} from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useSendingApi,
  type SendingIdentityView,
} from '@aglyn/tenant-feature-instance/hooks/use-sending-identity-api'
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useRouter } from 'next/navigation'
import { useCallback, useRef, useState } from 'react'
import {
  describeOrgSendingDomainRemoval,
  describeSendingDomain,
  INCONCLUSIVE_CHECK,
} from '../model/sending-domain-status'
import {
  OrgSiteSelect,
  orgSiteEmailsPath,
  orgSiteName,
  orgSitePageLabel,
  useEmailOrgMount,
  useOrgSitePage,
  type EmailOrgMount,
} from './email-org-mount'
import SendingSenderDrawer from './sending-sender-drawer'
import { useOrgSendingViews } from './use-org-sending-views'

export interface OrgSendingCardProps {
  /** The organization's Emails page, which the domain pages hang beneath. */
  basePath: string
}

/** How a site's identity reads in one chip. */
function identityChip(view: SendingIdentityView): {
  label: string
  color: 'default' | 'primary' | 'warning'
} {
  if (view.refusal) return { label: 'Cannot send', color: 'warning' }
  if (view.identitySource === 'custom') {
    return { label: 'Own domain', color: 'primary' }
  }
  return { label: 'Shared address', color: 'default' }
}

/**
 * WHO EVERY SITE'S MAIL COMES FROM, AND THE DOMAINS THE ORGANIZATION PROVED.
 *
 * The two halves of a site's Sending section, over the organization. A domain
 * is proved once by the org — publishing its records is a statement about a
 * zone — and each site then chooses which proved domain it sends as, so the
 * page is two tables: the sites, each with what it sends as right now and its
 * default sender, and the domains, each with the sites sending as it.
 *
 * Every site row is read through the same route the site's own page reads,
 * so what it says is what a campaign sent as that site would get. The reads
 * are one per site over one page of sites, and the org's domains come back on
 * each of them, so there is no separate read for the domain table. What the
 * domain table says about which sites send as a domain is what the pages read
 * so far say, and the removal confirmation counts the sites not yet read.
 *
 * Managing — adding a domain, checking it, choosing what a site sends as, or
 * editing a sender — needs the organization admin role, exactly as on a
 * site's page, and the page says so to anybody else rather than offering
 * controls that would refuse.
 */
export function OrgSendingCard(props: OrgSendingCardProps) {
  const mount = useEmailOrgMount()
  return mount ? (
    <OrgSendingTables mount={mount} basePath={props.basePath} />
  ) : null
}
OrgSendingCard.displayName = 'OrgSendingCard'

function OrgSendingTables(props: { mount: EmailOrgMount; basePath: string }) {
  const { mount, basePath } = props
  const call = useSendingApi()
  const router = useRouter()
  const { confirm } = useConfirmationContext()
  const { enqueueSnackbar } = useSnackbar()
  // Held in a ref for the reason the site card holds its own: the callbacks
  // below depend on it, and the hook hands back a fresh function per render.
  const notifyRef = useRef(enqueueSnackbar)
  notifyRef.current = enqueueSnackbar

  const sitePage = useOrgSitePage(mount)
  const { sites } = sitePage
  const { views, errors, loading, reload, first } = useOrgSendingViews(sites)
  const canManage = first?.canManage === true
  const entitled = first?.entitled === true
  const domains = first?.domains ?? []

  const [senderEditor, setSenderEditor] = useState<{
    hostId: string
    senderId: string | null
  } | null>(null)
  const [domainBusy, setDomainBusy] = useState('')
  /** The domain a site is being chosen for, with the site chosen so far. */
  const [assigning, setAssigning] = useState<{
    domain: string
    hostId: string
  } | null>(null)
  const [adding, setAdding] = useState(false)
  const [newDomain, setNewDomain] = useState('')
  const [addError, setAddError] = useState('')
  const [addingBusy, setAddingBusy] = useState(false)

  /** A domain's own page, the org route's twin of a site's. */
  const domainPath = useCallback(
    (domain: string) => `${basePath}/sending/${encodeURIComponent(domain)}`,
    [basePath],
  )
  /** The sites read so far whose mail leaves on `domain`. */
  const sitesSendingAs = (domain: string) =>
    mount.hosts.filter((site) => views[site.id]?.selected === domain)

  const handleVerifyDomain = useCallback(
    async (domain: string) => {
      if (domainBusy) return
      setDomainBusy(domain)
      const { response, payload } = await call({
        path: 'sending-domains',
        method: 'POST',
        body: { orgId: mount.orgId, domain, action: 'verify' },
      })
      setDomainBusy('')
      // No answer from DNS changes nothing about the record; see the site
      // card, which holds the same third outcome.
      if (response.status === 503) {
        return void notifyRef.current(INCONCLUSIVE_CHECK.text, {
          variant: 'info',
        })
      }
      if (!response.ok) {
        return void notifyRef.current(
          payload?.error ?? 'The check could not run',
          { variant: 'warning' },
        )
      }
      await reload()
      notifyRef.current(
        payload?.verified
          ? `Verified — ${domain} can send`
          : `Checked. Some of ${domain}’s records are still missing.`,
        { variant: payload?.verified ? 'success' : 'info' },
      )
    },
    [call, domainBusy, mount.orgId, reload],
  )

  const handleUseDomain = useCallback(
    async (hostId: string, domain: string) => {
      if (domainBusy) return
      setDomainBusy(domain)
      const { response, payload } = await call({
        path: 'sending-identity',
        method: 'POST',
        body: { hostId, domain },
      })
      setDomainBusy('')
      if (!response.ok) {
        return void notifyRef.current(
          payload?.error ?? 'Could not change the identity',
          { variant: 'warning' },
        )
      }
      setAssigning(null)
      await reload(hostId)
      // The address the ROUTE settled on, not the one this click asked for.
      const site = orgSiteName(mount, hostId)
      notifyRef.current(
        payload?.from
          ? `${site} now sends as ${payload.from}`
          : `${site}’s sending address was changed`,
        { variant: 'success' },
      )
    },
    [call, domainBusy, mount, reload],
  )

  const handleReleaseDomain = useCallback(
    async (domain: string) => {
      if (domainBusy) return
      const ok = await confirm({
        ...describeOrgSendingDomainRemoval({
          domain,
          sites: mount.hosts
            .filter((site) => views[site.id]?.selected === domain)
            .map((site) => ({
              name: orgSiteName(mount, site.id),
              issued: views[site.id]?.platformDomain === domain,
            })),
          unchecked: mount.hosts.filter((site) => !views[site.id]).length,
        }),
        confirmationButtonProps: { color: 'error' },
      })
        // `confirm` resolves with no value and REJECTS on cancel.
        .then(() => true)
        .catch(() => false)
      if (!ok) return
      setDomainBusy(domain)
      const { response, payload } = await call({
        path: 'sending-domains',
        method: 'DELETE',
        query: { orgId: mount.orgId, domain },
      })
      setDomainBusy('')
      if (!response.ok) {
        return void notifyRef.current(
          payload?.error ?? 'Could not remove the domain',
          { variant: 'warning' },
        )
      }
      await reload()
    },
    [call, confirm, domainBusy, mount, reload, views],
  )

  const handleAdd = useCallback(async () => {
    const domain = newDomain.trim()
    if (!domain || addingBusy) return
    setAddError('')
    setAddingBusy(true)
    const { response, payload } = await call({
      path: 'sending-domains',
      method: 'POST',
      body: { orgId: mount.orgId, domain, action: 'request' },
    })
    setAddingBusy(false)
    if (!response.ok) {
      setAddError(payload?.error ?? 'Could not add that domain')
      return
    }
    setAdding(false)
    setNewDomain('')
    // Straight to the records, which are what the person came for.
    router.push(domainPath(payload?.domain ?? domain))
  }, [addingBusy, call, domainPath, mount.orgId, newDomain, router])

  /**
   * What may be done to one domain from here, disabled with the reason rather
   * than hidden — the same four entries, gated the same way, as the site
   * card's row menu. The difference is the send-as entry: over the org it
   * asks which site.
   */
  const domainActions = (
    record: SendingIdentityView['domains'][number],
  ): RowActionsMenuItem[] => {
    const working = Boolean(domainBusy)
    const domainRouteReason = !canManage
      ? 'Managing sending domains needs the organization admin role.'
      : !entitled
        ? 'Managing sending domains needs a plan that carries sending as ' +
          'your own domain.'
        : ''
    return [
      {
        key: 'open',
        label: 'Open domain',
        icon: <MdiIcon path={mdiDnsOutline.path} size={0.8} />,
        href: domainPath(record.domain),
      },
      {
        key: 'verify',
        label: 'Check DNS',
        icon: <MdiIcon path={mdiRefresh.path} size={0.8} />,
        disabled:
          working ||
          record.status === 'requested' ||
          Boolean(domainRouteReason),
        disabledReason:
          record.status === 'requested'
            ? 'No records have been issued for this domain yet, so there is ' +
              'nothing to look for. Open it to see what it is waiting on.'
            : domainRouteReason || undefined,
        onClick: () => void handleVerifyDomain(record.domain),
      },
      {
        key: 'use',
        label: 'Send a site’s email as this domain…',
        icon: <MdiIcon path={mdiEmailCheckOutline.path} size={0.8} />,
        disabled: working || record.status !== 'verified' || !canManage,
        disabledReason:
          record.status !== 'verified'
            ? 'Only a verified domain can be sent as. Publish its records and ' +
              'check DNS first.'
            : !canManage
              ? 'Choosing what a site sends as needs the organization admin ' +
                'role.'
              : undefined,
        onClick: () => {
          if (mount.hosts.length === 1) {
            return void handleUseDomain(mount.hosts[0].id, record.domain)
          }
          setAssigning({
            domain: record.domain,
            hostId: mount.pickedHostId ?? '',
          })
        },
      },
      {
        key: 'release',
        label: 'Remove domain',
        icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
        destructive: true,
        disabled: working || Boolean(domainRouteReason),
        disabledReason: domainRouteReason || undefined,
        onClick: () => void handleReleaseDomain(record.domain),
      },
    ]
  }

  const noSites = mount.hostsReady && mount.hosts.length === 0
  const editorView = senderEditor ? (views[senderEditor.hostId] ?? null) : null

  return (
    <CardDisplay
      header="Sending"
      help={pluginDocsHelp('emailCampaigns', { anchor: '#sending-domains' })}
      contentGutterX
      contentGutterY
      contentBordered="all"
      HeaderProps={{
        action: canManage ? (
          <Button
            size="small"
            variant="contained"
            disabled={!entitled}
            onClick={() => setAdding(true)}
          >
            {'Add domain'}
          </Button>
        ) : null,
      }}
    >
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {'Receipts, password resets, booking confirmations and other ' +
            'account email send from every site on every plan, including ' +
            'Free. A domain is proved once for the whole organization; each ' +
            'site then chooses which proved domain its mail leaves on, and ' +
            'which senders it may use.'}
        </Typography>

        {first && !canManage ? (
          <Alert severity="info">
            {'Adding a domain, choosing what a site sends as and editing its ' +
              'senders need the organization admin role. You can see the ' +
              'current state here.'}
          </Alert>
        ) : null}

        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
          {'Sites'}
        </Typography>
        {noSites ? (
          <Typography variant="body2" color="text.secondary">
            {'This organization has no sites yet. What a site sends as is ' +
              'chosen per site, so there is nothing to show until there is one.'}
          </Typography>
        ) : (
          <ScrollTable size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Site'}</TableCell>
                <TableCell>{'Sends as'}</TableCell>
                <TableCell>{'Status'}</TableCell>
                <TableCell>{'Default sender'}</TableCell>
                <TableCell align="right">
                  <SrOnly>{'Actions'}</SrOnly>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {sites.map((site) => {
                const view = views[site.id]
                const error = errors[site.id]
                const sendingPage = orgSiteEmailsPath(mount, site.id, 'sending')
                const sender = view?.senders.find((entry) => entry.isDefault)
                const chip = view ? identityChip(view) : null
                return (
                  <TableRow key={site.id}>
                    <TableCell>
                      {sendingPage ? (
                        <AppLink href={sendingPage}>
                          {orgSiteName(mount, site.id)}
                        </AppLink>
                      ) : (
                        orgSiteName(mount, site.id)
                      )}
                    </TableCell>
                    <TableCell
                      sx={{ fontFamily: view ? 'monospace' : undefined }}
                    >
                      {view ? (
                        (view.refusal?.message ?? view.identity)
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          {error || 'Loading…'}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      {chip ? (
                        <Chip
                          size="small"
                          label={chip.label}
                          color={chip.color}
                        />
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {sender
                        ? [
                            sender.fromName,
                            sender.from ?? `${sender.localPart}@`,
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : view
                          ? '—'
                          : null}
                    </TableCell>
                    <TableCell align="right">
                      {view && canManage ? (
                        <Button
                          size="small"
                          onClick={() =>
                            setSenderEditor({
                              hostId: site.id,
                              senderId: sender?.id ?? null,
                            })
                          }
                        >
                          {'Edit sender'}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </ScrollTable>
        )}
        {noSites ? null : (
          <ListPagination
            page={sitePage.page}
            pageSize={sitePage.pageSize}
            rowCount={sites.length}
            count={sitePage.count}
            onPageChange={sitePage.setPage}
            labelDisplayedRows={orgSitePageLabel}
          />
        )}

        <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
          {'Domains'}
        </Typography>
        {first && !entitled ? (
          <Typography variant="body2" color="text.secondary">
            {(first.customDomainPlan
              ? `Sending as your own domain starts on the ${first.customDomainPlan} plan. `
              : '') +
              'Until then each site sends on a shared Aglyn address, whose ' +
              'delivery reputation is pooled with the other sites on it.'}
          </Typography>
        ) : null}
        {!first ? (
          <Typography variant="body2" color="text.secondary">
            {noSites
              ? 'Domains are listed once the organization has a site.'
              : loading
                ? 'Loading…'
                : 'The organization’s domains could not be read, because no ' +
                  'site’s sending identity could.'}
          </Typography>
        ) : domains.length ? (
          <ScrollTable size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Domain'}</TableCell>
                <TableCell>{'State'}</TableCell>
                <TableCell>{'Sites sending as it'}</TableCell>
                <TableCell align="right">
                  <SrOnly>{'Actions'}</SrOnly>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {domains.map((record) => {
                const state = describeSendingDomain({
                  status: record.status,
                  pendingProvider: record.status === 'requested',
                  issueError: record.lastIssueError ?? null,
                })
                const using = sitesSendingAs(record.domain)
                return (
                  <TableRow
                    key={record.domain}
                    hover
                    sx={{ cursor: 'pointer' }}
                    onClick={() => router.push(domainPath(record.domain))}
                  >
                    <TableCell sx={{ fontFamily: 'monospace' }}>
                      {record.domain}
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={state.label}
                        color={state.color}
                        variant={state.sending ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                    <TableCell>
                      {using.length ? (
                        using
                          .map((site) => orgSiteName(mount, site.id))
                          .join(', ')
                      ) : (
                        <Typography variant="body2" color="text.secondary">
                          {'—'}
                        </Typography>
                      )}
                    </TableCell>
                    <TableCell align="right" padding="none">
                      <RowActionsMenu
                        label={record.domain}
                        items={domainActions(record)}
                      />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </ScrollTable>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'No domain has been added yet.'}
          </Typography>
        )}
      </Stack>

      {/* One site's sender, in the same drawer the site's own page opens. */}
      {senderEditor && editorView ? (
        <SendingSenderDrawer
          open
          hostId={senderEditor.hostId}
          view={editorView}
          senderId={senderEditor.senderId}
          onClose={() => setSenderEditor(null)}
          onSaved={() => void reload(senderEditor.hostId)}
        />
      ) : null}

      <Dialog
        open={Boolean(assigning)}
        onClose={domainBusy ? undefined : () => setAssigning(null)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{`Send as ${assigning?.domain ?? ''}`}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            {'The site whose email should leave on this domain. Its receipts, ' +
              'account email and campaigns all move to it.'}
          </DialogContentText>
          {assigning ? (
            <OrgSiteSelect
              mount={mount}
              label="Site"
              value={assigning.hostId}
              onChange={(hostId) =>
                setAssigning((current) =>
                  current ? { ...current, hostId } : current,
                )
              }
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setAssigning(null)}
            disabled={Boolean(domainBusy)}
          >
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            disabled={!assigning?.hostId || Boolean(domainBusy)}
            onClick={() =>
              assigning
                ? void handleUseDomain(assigning.hostId, assigning.domain)
                : undefined
            }
          >
            {domainBusy ? 'Changing…' : 'Send as this domain'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Adding is a drawer, as on a site's page; see the site card. */}
      <NavigationDrawerComponent
        open={adding}
        anchor="right"
        variant="temporary"
        onClose={() => setAdding(false)}
        AppBarProps={{ color: 'surface' }}
        appBarLeft={
          <>
            <IconButton
              color="inherit"
              edge="start"
              onClick={() => setAdding(false)}
              sx={{ mr: 2 }}
            >
              <MdiIcon path={ICON_VARIANT_CLOSE.path} />
              <SrOnly>close drawer</SrOnly>
            </IconButton>
            <Typography variant="h6" component="div">
              {'Add a sending domain'}
            </Typography>
          </>
        }
      >
        <Container gutterY>
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {'The domain your mail should come from — the part after the @. ' +
                'Use a domain you control the DNS for; you will be given ' +
                'records to publish on it. Once it verifies, any of this ' +
                'organization’s sites can send as it.'}
            </Typography>
            <TextField
              label="Domain"
              value={newDomain}
              onChange={(event) => setNewDomain(event.target.value)}
              size="small"
              autoFocus
              placeholder="acme.com"
              helperText="For example acme.com — not an address"
            />
            {addError ? <Alert severity="error">{addError}</Alert> : null}
            <Button
              variant="contained"
              disabled={!newDomain.trim() || addingBusy}
              onClick={() => void handleAdd()}
            >
              {addingBusy ? 'Adding…' : 'Add domain'}
            </Button>
          </Stack>
        </Container>
      </NavigationDrawerComponent>
    </CardDisplay>
  )
}
OrgSendingTables.displayName = 'OrgSendingTables'

export default OrgSendingCard
