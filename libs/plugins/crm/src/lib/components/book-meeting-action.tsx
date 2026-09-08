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

import * as Aglyn from '@aglyn/aglyn'
import {
  type AglynOrgBilling,
  checkEntitlement,
  type CrmBookingRefKind,
  isHostPluginEnabled,
} from '@aglyn/aglyn'
/*
 * The Bookings MODEL by its leaf path, never the plugin's barrel: the barrel
 * registers the plugin's console page and canvas block, and a record page
 * that imported it would carry both into a bundle that only wants the URL
 * builder. Plugin-to-plugin is legal here (both are add-ons), and the link
 * is the Bookings plugin's own to define.
 */
import { BOOKING_PATH_DEFAULT, bookingLinkFor } from '@aglyn/plugins-bookings/model/bookings'
import { mdiCalendarClock, mdiContentCopy } from '@aglyn/shared-data-mdi'
import { AppLink, MdiIcon } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  useOrgDataScope,
  useSitePluginConfig,
} from '@aglyn/tenant-feature-instance'
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material'
import { collection, doc, limit, query } from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { useCallback, useState } from 'react'

/** The Bookings plugin's id, as `enabledPlugins` and `disabledPlugins` name it. */
const BOOKINGS_PLUGIN_ID = 'bookings'

/**
 * A link dropped into a plain-text draft at the caret, replacing whatever
 * was selected. A space is put on either side where the text would
 * otherwise run into the URL — a mail client reads `word https://…` as a
 * link and `wordhttps://…` as a typo — and none where the caret already
 * sits on whitespace, a line end, or an edge of the draft. The caret lands
 * after the inserted run, where typing continues.
 */
export function insertLinkAtCaret(
  text: string,
  link: string,
  start: number,
  end: number,
): { text: string; caret: number } {
  const from = Math.max(0, Math.min(start, text.length))
  const to = Math.max(from, Math.min(end, text.length))
  const before = text.slice(0, from)
  const after = text.slice(to)
  const lead = before && !/\s$/.test(before) ? ' ' : ''
  const trail = after && !/^\s/.test(after) ? ' ' : ''
  const inserted = `${lead}${link}${trail}`
  return { text: `${before}${inserted}${after}`, caret: before.length + inserted.length }
}

/**
 * WHETHER THIS SITE HAS A BOOKING DOOR (AGL-2660).
 *
 * The action is offered only where a booking can actually be taken: the
 * Bookings plugin runs on the site — the org's set less the site's own
 * deny-list, which is the one resolver every other per-site gate reads —
 * and the org holds the `bookings` entitlement, without which the booking
 * API refuses every request. One listen on the site document answers the
 * deny-list and, for the link, the site's public naming.
 *
 * At the organization level the record's own capturing site is the site
 * asked about, which is how a contact captured by one brand of an agency
 * offers that brand's services and not another's. A record no site has
 * captured has no door.
 */
export function useBookingDoor(
  hostId: string | null | undefined,
  org?: Partial<AglynOrgBilling> | null,
): { open: boolean; host: Record<string, unknown> | null } {
  const firestore = useFirestore()
  const { data: host, status } = useFirestoreDoc<Record<string, unknown>>(
    () => (hostId ? doc(firestore, 'hosts', hostId) : null),
    [firestore, hostId],
  )
  const open =
    Boolean(hostId) &&
    status === 'success' &&
    Boolean(host) &&
    isHostPluginEnabled(org ?? null, host as never, BOOKINGS_PLUGIN_ID) &&
    checkEntitlement(org ?? null, 'bookings')
  return { open, host: host ?? null }
}

export interface BookMeetingButtonProps {
  /**
   * The site whose services are offered — the mounted site, or at the
   * organization level the record's own capturing site; `null` for a
   * record no site has captured, which offers nothing.
   */
  hostId: string | null
  org?: Partial<AglynOrgBilling> | null
  /** The record the link is dropped from, carried as `?crm=kind:id`. */
  kind: CrmBookingRefKind
  recordId: string
  /**
   * When given, every service also offers **Insert into email** and the
   * chosen link is handed here — the email dialog's use.
   */
  onInsert?: (link: string) => void
  /** `chip` is the compact form the email dialog carries beside its fields. */
  variant?: 'button' | 'chip'
}

/**
 * THE "BOOK A MEETING" ACTION A RECORD CARRIES (AGL-2660): one control, and
 * the dialog it opens, mounted only while open. Renders NOTHING where the
 * site has no booking door, rather than a disabled control with a reason —
 * a site that has never enabled Bookings should not read every record page
 * as missing something.
 */
export function BookMeetingButton(props: BookMeetingButtonProps) {
  const { hostId, org, kind, recordId, onInsert, variant = 'button' } = props
  const door = useBookingDoor(hostId, org)
  const [open, setOpen] = useState(false)
  if (!door.open || !hostId || !recordId) return null
  const icon = <MdiIcon path={mdiCalendarClock.path} size={0.8} />
  return (
    <>
      {variant === 'chip' ? (
        <Chip
          size="small"
          variant="outlined"
          icon={icon}
          label="Insert booking link"
          onClick={() => setOpen(true)}
          // A flex item in the dialog's column, kept to its own width.
          sx={{ alignSelf: 'flex-start' }}
        />
      ) : (
        <Button size="small" variant="outlined" startIcon={icon} onClick={() => setOpen(true)}>
          {'Book a meeting'}
        </Button>
      )}
      {open ? (
        <BookMeetingDialog
          open
          onClose={() => setOpen(false)}
          hostId={hostId}
          host={door.host}
          org={org}
          kind={kind}
          recordId={recordId}
          onInsert={onInsert}
        />
      ) : null}
    </>
  )
}
BookMeetingButton.displayName = 'BookMeetingButton'

interface BookMeetingDialogProps {
  open: boolean
  onClose: () => void
  hostId: string
  /** The site document the door already read — its public naming. */
  host: Record<string, unknown> | null
  org?: Partial<AglynOrgBilling> | null
  kind: CrmBookingRefKind
  recordId: string
  onInsert?: (link: string) => void
}

/**
 * The site's bookable services, each with the link a visitor books it at.
 *
 * The link is the Bookings plugin's own builder over three facts read here:
 * the site's public naming (off the site document), the page the Booking
 * block lives on (the plugin's per-site `bookingPath` setting), and the
 * record this dialog was opened from. A site with no public address yet
 * lists its services and says why there is no link.
 */
export function BookMeetingDialog(props: BookMeetingDialogProps) {
  const { open, onClose, hostId, host, org, kind, recordId, onInsert } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { orgId } = useOrgDataScope({ hostId, orgId: org?.$id })
  const { config, ready: configReady } = useSitePluginConfig(orgId, hostId, BOOKINGS_PLUGIN_ID)
  const { data: serviceDocs, status } = useFirestoreCollection<Record<string, unknown>>(
    () => query(collection(firestore, 'hosts', hostId, 'services'), limit(100)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const services = (serviceDocs ?? [])
    .filter((service) => !service['deletedAt'])
    .sort((a, b) => String(a['name'] ?? '').localeCompare(String(b['name'] ?? '')))

  // Where services are set up, for the empty state — addressable only
  // under a site route, where the URL names the org and the site.
  const params = useParams<{ orgSlug?: string; host?: string }>()
  const bookingsHref =
    params?.orgSlug && params?.host
      ? Aglyn.siteRecordLinks({
          orgSlug: String(params.orgSlug),
          host: String(params.host),
        }).bookings()
      : null

  const site = {
    cname: host?.['cname'] as string | null | undefined,
    subdomain: host?.['subdomain'] as string | null | undefined,
  }
  const path = configReady ? String(config['bookingPath'] ?? BOOKING_PATH_DEFAULT) : null
  const crmRef = { kind, id: recordId }

  const copy = useCallback(
    async (link: string) => {
      try {
        await navigator.clipboard.writeText(link)
        enqueueSnackbar('Booking link copied', { variant: 'success', persist: false })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('The link could not be copied', { variant: 'error', allowDuplicate: true })
      }
    },
    [enqueueSnackbar],
  )

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{'Book a meeting'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {'Each link opens your site’s booking page on one service, with this ' +
            'record attached so the booking lands on its timeline — whatever ' +
            'address the person books with.'}
        </Typography>
        {status === 'loading' || path === null ? (
          <Typography variant="body2" color="text.secondary">
            {'Loading…'}
          </Typography>
        ) : services.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'No bookable services yet. '}
            {bookingsHref ? <AppLink href={bookingsHref}>{'Set up services'}</AppLink> : null}
          </Typography>
        ) : (
          <Stack spacing={1.5}>
            {services.map((service) => {
              const id = String(service['$id'])
              const name = String(service['name'] ?? '')
              const link = bookingLinkFor({ site, service: { id }, path, crmRef })
              const price = Number(service['priceUsd'] ?? 0)
              return (
                <Stack key={id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Stack sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {`${Number(service['durationMinutes'] ?? 0)} min` +
                        (price > 0 ? ` · $${price}` : ' · free')}
                    </Typography>
                    {link ? (
                      <Typography variant="caption" sx={{ wordBreak: 'break-all' }}>
                        {link}
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {'This site has no public address yet, so there is no link.'}
                      </Typography>
                    )}
                  </Stack>
                  <Tooltip title="Copy link">
                    <span>
                      <IconButton
                        size="small"
                        aria-label={`Copy link for ${name}`}
                        disabled={!link}
                        onClick={() => link && void copy(link)}
                      >
                        <MdiIcon path={mdiContentCopy.path} size={0.8} />
                      </IconButton>
                    </span>
                  </Tooltip>
                  {onInsert ? (
                    <Button
                      size="small"
                      variant="outlined"
                      disabled={!link}
                      onClick={() => {
                        if (!link) return
                        onInsert(link)
                        onClose()
                      }}
                    >
                      {'Insert into email'}
                    </Button>
                  ) : null}
                </Stack>
              )
            })}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Close'}</Button>
      </DialogActions>
    </Dialog>
  )
}
BookMeetingDialog.displayName = 'BookMeetingDialog'

export default BookMeetingButton
