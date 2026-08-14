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

/**
 * DISABLED FILES — the staff form for asset quarantine (AGL-1687).
 *
 * AGL-1512 shipped the enforcement, AGL-1613 the ingestion gate and AGL-1612
 * the red `Disabled` badge in the DAM. Setting and lifting one stayed a curl
 * against `/api/admin/media-quarantine` with a bearer token, which is a fine
 * runbook and a bad incident tool: the operator has to transcribe a digest
 * and a scope segment, choose between two digest fields correctly (AGL-1631
 * exists because the runbook named the wrong one), and then believe the
 * result.
 *
 * So this page never asks for a key. It asks for **the file** — a workspace
 * or site id and a media id, both readable off the CDN URL in the report
 * that started the incident — and the route derives every key from the
 * document. See `by: "media"` in `/api/admin/media-quarantine` for the three
 * transcription failures that removes.
 *
 * ## What the page refuses to do
 *
 * **Claim a state it has not read back.** Every action re-reads the deny
 * list and renders the server's answer, and a write that returns while the
 * state disagrees is reported as NOT CONFIRMED rather than as success — the
 * AGL-1571 discipline the Lockdown page states at length, for the same
 * reason: the dangerous half is a *lift* you believe happened.
 *
 * **Hide the reach of the key it is about to write.** A digest key covers
 * every copy of those bytes in every workspace; a per-asset key covers one
 * document. Which one is being written is on screen before the button is
 * pressed, because "I disabled one customer's file" and "I disabled that
 * stock photo everywhere" are different actions with the same button.
 *
 * **Pretend the cap is not there.** `MEDIA_QUARANTINE_MAX_ENTRIES` is a hard
 * refusal at 2000, and the failure mode of a full list is "a takedown
 * silently did not land". The count rides on every answer.
 *
 * ## THE WHOLE DENY LIST (AGL-1700)
 *
 * Everything above is per-FILE: you name a file and learn what refuses it.
 * That is the right shape for an incident that starts with a report, and the
 * wrong shape for the one situation the 2000-entry cap exists for — the list
 * is full, the next takedown is refused with a 409, and the remedy is
 * "release stale entries". You cannot release what you cannot enumerate, and
 * the only route to a stale entry used to be knowing a media id it covers,
 * which for a hash-keyed entry set months ago is exactly what nobody
 * remembers.
 *
 * So the second half of the page is the index document as a TABLE, over the
 * `GET` that has returned `records` since AGL-1512 and that nothing had ever
 * rendered. Three things it is careful about:
 *
 * **A row is a KEY, not a file.** Release posts `by: "key"` and clears that
 * one entry. Media mode's "clear every key that could refuse this file" is
 * correct there and wrong here: the entry may cover a document that has since
 * been deleted, and a hash key covers files in workspaces this row knows
 * nothing about.
 *
 * **Oldest first**, because the whole point is finding what has been sitting
 * there. An entry with no `atMs` at all predates the field and sorts first.
 *
 * **Expired-but-unreleased rows are called out.** `isMediaQuarantineActive`
 * stops enforcing the moment `untilMs` passes, with no write — so those rows
 * refuse nothing and still consume the cap. They are the safest thing to
 * clear first, and nothing else on the platform would ever have told you they
 * were there.
 */

import {
  isMediaQuarantineActive,
  MEDIA_QUARANTINE_MESSAGE_MAX,
  MEDIA_QUARANTINE_NOTE_MAX,
  MEDIA_QUARANTINE_REASON_LABELS,
  MEDIA_QUARANTINE_REASONS,
  normalizeMediaQuarantine,
} from '@aglyn/aglyn'
import { ICON_VARIANT_SYMBOL_SECURE } from '@aglyn/shared-data-enums'
import { CardDisplay, Container } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Chip,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import DashboardLayout from '../../../../components/layouts/dashboard.layout'
import StaffOnly from '../../../../components/staff-only.component'
import { docsHelp } from '../../../../constants/docs-links'
import { buildRoute, Route } from '../../../../constants/route-links'
import { CONTENT_MAX_WIDTH } from '../../../../constants/shared'
import { useStaffRole } from '../../../../hooks/use-is-staff'

/** One key that could refuse the looked-up asset, and whether it is set. */
interface AssetKey {
  key: string
  kind: 'sha256' | 'legacy' | 'asset'
  set?: boolean
  state?: {
    reason: string
    message?: string
    atMs?: number
    untilMs?: number
    actorUid?: string
  } | null
  /** Staff-only rationale. This page is staff-gated; the DAM never sees it. */
  note?: string | null
}

interface AssetLookup {
  asset: {
    scopeSegment: string
    mediaId: string
    fileName: string | null
    hasStrongDigest: boolean
    hasLegacyDigest: boolean
    deleted: boolean
  }
  keys: AssetKey[]
  quarantined: boolean
  count: number
  maxEntries: number
  readAtMs: number
}

/**
 * One row of the whole deny list — the plain `GET`'s `records` shape, which
 * is the stored entry with its map key spread on top. Everything but `key` is
 * optional: entries written before a field existed simply do not carry it,
 * and those are the oldest rows, which is to say the ones this table is for.
 */
interface QuarantineRecord {
  key: string
  reason?: string | null
  message?: string | null
  /** Staff-only rationale. Rendered here and nowhere a customer can reach. */
  note?: string | null
  atMs?: number | null
  untilMs?: number | null
  actorUid?: string | null
  /** The copy an operator was looking at when they set it — often the only
   * breadcrumb from a hash key back to a file. In the payload since AGL-1512
   * and unrendered until now. */
  originScopeSegment?: string | null
  originMediaId?: string | null
}

interface DenyListing {
  records: QuarantineRecord[]
  count: number
  maxEntries: number
  readAtMs: number
}

/** Enforced now / expired with no write / unenforceable and unexplainable. */
type RowState = 'active' | 'expired' | 'malformed'

/**
 * What kind of key a deny-list ROW holds, read from the key alone.
 *
 * The lookup card above gets `kind` from the server, which holds the media
 * document to compare against. A row has no document — the deny list is keys
 * and nothing else, which is the whole reason enumerating it needed its own
 * surface. So a digest's LENGTH is the only signal there is: 64 hex
 * characters is `contentSha256`, 16 is the legacy truncated digest, and
 * anything else is a digest whose provenance this page will not guess at.
 */
function listedKeyKind(key: string): 'sha256' | 'legacy' | 'asset' | 'digest' {
  if (key.startsWith('asset--')) return 'asset'
  if (!key.startsWith('hash--')) return 'digest'
  const digest = key.slice('hash--'.length)
  if (digest.length === 64) return 'sha256'
  if (digest.length === 16) return 'legacy'
  return 'digest'
}

const LISTED_KIND_LABEL: Record<
  ReturnType<typeof listedKeyKind>,
  string
> = {
  sha256: 'sha256',
  legacy: 'legacy digest',
  asset: 'per-asset',
  digest: 'digest',
}

/**
 * Enforced, expired, or neither — decided against the server's own read time
 * rather than the browser's clock, so the verdict on screen is the verdict at
 * the moment the list was read. `normalizeMediaQuarantine` returns `null` for
 * an entry whose reason nothing recognises, and the readers refuse such an
 * entry WHOLE — so it enforces nothing while still consuming a slot, and it
 * is the one row a release cannot be talked out of.
 */
function rowState(record: QuarantineRecord, nowMs: number): RowState {
  const state = normalizeMediaQuarantine(record as any, record.key)
  if (!state) return 'malformed'
  return isMediaQuarantineActive(state, nowMs) ? 'active' : 'expired'
}

/** What a key of each kind actually reaches, in the operator's words. */
const KEY_REACH: Record<AssetKey['kind'], string> = {
  sha256:
    'the full sha256 of the bytes — covers EVERY copy of this file, in every workspace',
  legacy:
    'the legacy 64-bit digest — same reach, weaker key, and the only one some files have',
  asset: 'this one document in this one workspace',
}

function AdminMediaQuarantine() {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const staffRole = useStaffRole()
  const canWrite = staffRole === 'super'

  const [scopeKind, setScopeKind] = useState<'org' | 'host'>('org')
  const [scopeId, setScopeId] = useState('')
  const [mediaId, setMediaId] = useState('')
  const [reason, setReason] = useState<string>('malware')
  const [message, setMessage] = useState('')
  const [note, setNote] = useState('')
  const [until, setUntil] = useState('')
  const [narrow, setNarrow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [lookup, setLookup] = useState<AssetLookup | null>(null)
  const [listing, setListing] = useState<DenyListing | null>(null)
  const [log, setLog] = useState<
    { atMs: number; text: string; confirmed: boolean }[]
  >([])

  const idToken = useCallback(
    async () => (await (user as any)?.getIdToken?.()) as string | undefined,
    [user],
  )

  /**
   * Read the asset and the keys, without writing anything. Open to every
   * staff role, deliberately: during an incident the person asking "is this
   * already disabled?" is usually support.
   */
  const look = useCallback(async () => {
    const token = await idToken()
    if (!token || !scopeId.trim() || !mediaId.trim()) return
    const params = new URLSearchParams({ mediaId: mediaId.trim() })
    params.set(scopeKind === 'org' ? 'orgId' : 'hostId', scopeId.trim())
    setBusy(true)
    try {
      const response = await fetch(
        `/api/admin/media-quarantine?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error ?? `Failed (${response.status})`)
      }
      setLookup(payload as AssetLookup)
    } catch (error: any) {
      console.error(error)
      // Clear rather than keep. A panel about the PREVIOUS file, sitting
      // beside a new id, is the stale-verdict bug wearing a new face.
      setLookup(null)
      enqueueSnackbar(error?.message ?? 'Looking up that file failed', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [idToken, scopeKind, scopeId, mediaId, enqueueSnackbar])

  /**
   * The whole deny list. One document read, no media reads at all, and it
   * runs on arrival rather than behind a button: an operator who came here
   * because a takedown was refused with a 409 already knows the list is full
   * and should not have to ask a second time to see what is in it.
   */
  const loadList = useCallback(async () => {
    const token = await idToken()
    if (!token) return
    try {
      const response = await fetch('/api/admin/media-quarantine', {
        headers: { Authorization: `Bearer ${token}` },
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(payload.error ?? `Failed (${response.status})`)
      }
      setListing({
        records: Array.isArray(payload.records) ? payload.records : [],
        count: Number(payload.count ?? 0),
        maxEntries: Number(payload.maxEntries ?? 0),
        readAtMs: Number(payload.readAtMs ?? Date.now()),
      })
    } catch (error: any) {
      console.error(error)
      // Cleared, not kept. A table that silently goes stale is a table an
      // operator releases from twice and believes once.
      setListing(null)
      enqueueSnackbar(error?.message ?? 'Reading the deny list failed', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [idToken, enqueueSnackbar])

  const signedInUid = (user as any)?.uid
  useEffect(() => {
    if (!signedInUid) return
    void loadList()
    // Keyed on WHO is signed in, not on `loadList`. `useUser` hands back a
    // fresh object on every render, so `idToken` and therefore `loadList`
    // change identity every render too — depending on the callback re-reads
    // the index document on each one, which on this page means a Firestore
    // read per keystroke typed into the form above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signedInUid])

  /**
   * Release ONE key — the entry this row is, not every key that could refuse
   * some file. `by: "key"` exists for exactly this: the row may be a hash
   * entry covering workspaces this page never looked at, or a per-asset entry
   * whose document was deleted years ago, and clearing anything beyond the
   * named key would be a takedown lifted by a click that never mentioned it.
   */
  const releaseKey = useCallback(
    async (target: string) => {
      const token = await idToken()
      if (!token) return
      setBusy(true)
      try {
        const response = await fetch('/api/admin/media-quarantine', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ action: 'release', by: 'key', key: target }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(payload.error ?? `Failed (${response.status})`)
        }
        const confirmed = payload.confirmed !== false
        const what = `Released ${target}`
        setLog((entries) =>
          [{ atMs: Date.now(), text: what, confirmed }, ...entries].slice(0, 25),
        )
        enqueueSnackbar(
          confirmed
            ? `${what} — verified on the server (audited)`
            : `${what} was accepted, but re-reading the deny list still shows it SET. Do not walk away.`,
          { variant: confirmed ? 'success' : 'error', allowDuplicate: true },
        )
        await loadList()
      } catch (error: any) {
        console.error(error)
        enqueueSnackbar(error?.message ?? 'The release failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        setBusy(false)
      }
    },
    [idToken, enqueueSnackbar, loadList],
  )

  const act = useCallback(
    async (action: 'quarantine' | 'release') => {
      const token = await idToken()
      if (!token || !scopeId.trim() || !mediaId.trim()) return
      const untilMs = until ? new Date(until).getTime() : null
      setBusy(true)
      try {
        const response = await fetch('/api/admin/media-quarantine', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            action,
            by: 'media',
            [scopeKind === 'org' ? 'orgId' : 'hostId']: scopeId.trim(),
            mediaId: mediaId.trim(),
            prefer: narrow ? 'asset' : 'hash',
            ...(action === 'quarantine'
              ? {
                  reason,
                  message: message.trim() || undefined,
                  note: note.trim() || undefined,
                  untilMs:
                    untilMs && Number.isFinite(untilMs) ? untilMs : undefined,
                }
              : {}),
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          throw new Error(payload.error ?? `Failed (${response.status})`)
        }
        // A 200 says the request was accepted. Only `confirmed` says the
        // state changed, and on a release it means NO key can still refuse
        // the file — the two are not the same claim.
        const confirmed = payload.confirmed !== false
        const what = `${action === 'quarantine' ? 'Disabled' : 'Released'} ${mediaId.trim()} (${(
          payload.keys ?? [payload.key]
        ).length} key${(payload.keys ?? [payload.key]).length === 1 ? '' : 's'})`
        setLog((entries) =>
          [{ atMs: Date.now(), text: what, confirmed }, ...entries].slice(0, 25),
        )
        enqueueSnackbar(
          confirmed
            ? `${what} — verified on the server (audited)`
            : `${what} was accepted, but re-reading the deny list shows the OPPOSITE state. Do not walk away.`,
          { variant: confirmed ? 'success' : 'error', allowDuplicate: true },
        )
        await look()
        // The table below is now wrong by exactly this action. Re-reading it
        // costs one document and stops the two halves of the page from
        // disagreeing about the same index.
        await loadList()
      } catch (error: any) {
        console.error(error)
        enqueueSnackbar(error?.message ?? 'The quarantine action failed', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        setBusy(false)
      }
    },
    [
      idToken,
      scopeKind,
      scopeId,
      mediaId,
      narrow,
      reason,
      message,
      note,
      until,
      enqueueSnackbar,
      look,
      loadList,
    ],
  )

  // The key a quarantine would be written under, right now. The route makes
  // the same choice from the same document; showing it here means the reach
  // is on screen BEFORE the button, not explained after it.
  const pendingKey = lookup
    ? narrow
      ? lookup.keys.find((entry) => entry.kind === 'asset')
      : lookup.keys[0]
    : undefined
  const full = lookup ? lookup.count >= lookup.maxEntries : false

  /**
   * Oldest first — the table's entire job is surfacing what has been sitting
   * there, and an entry with no `atMs` predates the field, so it sorts ahead
   * of every dated one rather than behind them.
   */
  const rows = useMemo(() => {
    if (!listing) return []
    return [...listing.records]
      .map((record) => ({
        record,
        state: rowState(record, listing.readAtMs),
      }))
      .sort(
        (a, b) =>
          (typeof a.record.atMs === 'number' ? a.record.atMs : 0) -
          (typeof b.record.atMs === 'number' ? b.record.atMs : 0),
      )
  }, [listing])
  const clearable = rows.filter((row) => row.state !== 'active').length
  const listFull = listing ? listing.count >= listing.maxEntries : false

  return (
    <DashboardLayout
      breadcrumbItems={[
        { children: 'Staff', href: buildRoute(Route.ADMIN_OVERVIEW) },
        {
          children: 'Disabled files',
          href: buildRoute(Route.ADMIN_MEDIA_QUARANTINE),
        },
      ]}
      help="lockdown"
      header={{
        children: 'Disabled files',
        icon: { path: ICON_VARIANT_SYMBOL_SECURE.path },
      }}
    >
      <Container gutterY maxWidth={CONTENT_MAX_WIDTH}>
        <StaffOnly>
          <Stack spacing={2}>
            <Alert severity="info">
              {
                'Quarantine takes ONE uploaded file off the CDN worldwide while the workspace keeps serving. It is reversible and it does not delete anything — the file still exists and still counts toward the customer’s storage. Setting and lifting requires the super staff role; every action is audited.'
              }
            </Alert>

            {busy ? <LinearProgress /> : null}

            <CardDisplay
              header={'The file'}
              help={docsHelp('lockdown', { anchor: '#which-digest' })}
              contentGutterX
              contentGutterY
            >
              <Stack spacing={2}>
                <Typography variant="body2" color="text.secondary">
                  {
                    'Name the file, not a digest. Both halves are in its CDN URL: the scope segment (org:{orgId} or the site id) and the media id after /media/. The server reads the document and derives the keys, so it always picks the strongest digest the file has and always produces the scope segment the CDN actually looks up.'
                  }
                </Typography>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ flexWrap: 'wrap', rowGap: 1 }}
                >
                  <TextField
                    select
                    size="small"
                    label="Library"
                    value={scopeKind}
                    onChange={(event) =>
                      setScopeKind(event.target.value as 'org' | 'host')
                    }
                    sx={{ minWidth: 180 }}
                  >
                    <MenuItem value="org">{'Workspace (org)'}</MenuItem>
                    <MenuItem value="host">{'Site (host)'}</MenuItem>
                  </TextField>
                  <TextField
                    size="small"
                    label={scopeKind === 'org' ? 'Workspace id' : 'Site id'}
                    value={scopeId}
                    onChange={(event) => setScopeId(event.target.value)}
                    sx={{ minWidth: 220 }}
                  />
                  <TextField
                    size="small"
                    label="Media id"
                    value={mediaId}
                    onChange={(event) => setMediaId(event.target.value)}
                    sx={{ minWidth: 220 }}
                  />
                  <Button
                    variant="outlined"
                    disabled={busy || !scopeId.trim() || !mediaId.trim()}
                    onClick={() => void look()}
                  >
                    {'Look it up'}
                  </Button>
                </Stack>
              </Stack>
            </CardDisplay>

            {lookup ? (
              <CardDisplay
                header={'What is set right now'}
                help={docsHelp('lockdown', { anchor: '#quarantine-keys' })}
                contentGutterX
                contentGutterY
              >
                <Stack spacing={2}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
                  >
                    <Chip
                      size="small"
                      color={lookup.quarantined ? 'error' : 'success'}
                      label={lookup.quarantined ? 'DISABLED' : 'NOT DISABLED'}
                    />
                    <Typography variant="body2">
                      {`${lookup.asset.fileName ?? lookup.asset.mediaId} — ${lookup.asset.scopeSegment}`}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {`read ${new Date(lookup.readAtMs).toLocaleString()}`}
                    </Typography>
                  </Stack>

                  {lookup.asset.deleted ? (
                    <Alert severity="info">
                      {
                        'This file is in the trash. Quarantining it is still worth doing — a restore would bring the bytes straight back, and a takedown notice does not stop applying because the customer tidied up.'
                      }
                    </Alert>
                  ) : null}

                  {!lookup.asset.hasStrongDigest ? (
                    <Alert severity="warning">
                      {lookup.asset.hasLegacyDigest
                        ? 'This file carries only the legacy 64-bit digest — it predates the strong one, or it came in through the signed-upload route. A takedown on it still bites, but it is the weaker key and it does not match the same bytes re-uploaded through a different route.'
                        : 'This file carries NO digest at all (a composite object, or a pre-digest upload). Only the per-asset key can cover it, and only at delivery: with nothing to compare, the upload gate cannot refuse a fresh copy of these bytes.'}
                    </Alert>
                  ) : null}

                  <Stack spacing={1}>
                    {lookup.keys.map((entry) => (
                      <Stack
                        key={entry.key}
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'baseline', flexWrap: 'wrap' }}
                      >
                        <Chip
                          size="small"
                          color={entry.state ? 'error' : 'default'}
                          label={entry.state ? 'set' : 'not set'}
                        />
                        <Typography
                          variant="caption"
                          sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                        >
                          {entry.key}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {KEY_REACH[entry.kind]}
                        </Typography>
                        {entry.state ? (
                          <Typography variant="caption">
                            {`${entry.state.reason}${
                              entry.state.untilMs
                                ? ` — until ${new Date(entry.state.untilMs).toLocaleString()}`
                                : ''
                            }${entry.note ? ` — note: ${entry.note}` : ''}`}
                          </Typography>
                        ) : null}
                      </Stack>
                    ))}
                  </Stack>

                  <Typography
                    variant="caption"
                    color={full ? 'error' : 'text.secondary'}
                  >
                    {full
                      ? `The deny list is FULL (${lookup.count} of ${lookup.maxEntries}). The next new takedown will be refused with a 409 — release stale entries first.`
                      : `Deny list: ${lookup.count} of ${lookup.maxEntries} entries in use.`}
                  </Typography>
                </Stack>
              </CardDisplay>
            ) : null}

            {lookup ? (
              <CardDisplay
                header={'Disable or release'}
                help={docsHelp('lockdown', { anchor: '#disabled-files-page' })}
                contentGutterX
                contentGutterY
              >
                <Stack spacing={2}>
                  {!canWrite ? (
                    <Alert severity="warning">
                      {
                        'Setting and lifting a quarantine requires the super staff role. Reading this page does not — and the route refuses the write regardless of what this page renders.'
                      }
                    </Alert>
                  ) : null}

                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ flexWrap: 'wrap', rowGap: 1 }}
                  >
                    <TextField
                      select
                      size="small"
                      label="Reason"
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      sx={{ minWidth: 240 }}
                    >
                      {MEDIA_QUARANTINE_REASONS.map((code) => (
                        <MenuItem key={code} value={code}>
                          {MEDIA_QUARANTINE_REASON_LABELS[code]}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      size="small"
                      type="datetime-local"
                      label="Until (optional)"
                      value={until}
                      onChange={(event) => setUntil(event.target.value)}
                      slotProps={{ inputLabel: { shrink: true } }}
                    />
                  </Stack>

                  <TextField
                    size="small"
                    label="Customer-facing message (optional)"
                    helperText={`Replaces the notice body the workspace sees in its media library. Write it for the customer. Max ${MEDIA_QUARANTINE_MESSAGE_MAX} characters.`}
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    slotProps={{ htmlInput: { maxLength: MEDIA_QUARANTINE_MESSAGE_MAX } }}
                    fullWidth
                  />
                  <TextField
                    size="small"
                    label="Internal note (optional)"
                    helperText={`Staff only — the notice number, the complainant, the assessment. Never rendered to the customer. Max ${MEDIA_QUARANTINE_NOTE_MAX} characters.`}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    slotProps={{ htmlInput: { maxLength: MEDIA_QUARANTINE_NOTE_MAX } }}
                    fullWidth
                  />

                  <FormControlLabel
                    control={
                      <Switch
                        checked={narrow}
                        onChange={(event) => setNarrow(event.target.checked)}
                      />
                    }
                    label="Disable only this copy (per-asset key)"
                  />
                  <Typography variant="caption" color="text.secondary">
                    {
                      'Reach for this when the same bytes are legitimate elsewhere and only this workspace’s copy is the subject of the report. Otherwise leave it off: the digest key is stronger and it survives a re-upload.'
                    }
                  </Typography>

                  {pendingKey ? (
                    <Alert severity={narrow ? 'info' : 'warning'}>
                      {`This will be written under `}
                      <Typography
                        component="span"
                        variant="caption"
                        sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
                      >
                        {pendingKey.key}
                      </Typography>
                      {` — ${KEY_REACH[pendingKey.kind]}.`}
                    </Alert>
                  ) : null}

                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ flexWrap: 'wrap', rowGap: 1 }}
                  >
                    <Button
                      variant="contained"
                      color="error"
                      disabled={busy || !canWrite || (full && !lookup.quarantined)}
                      onClick={() => void act('quarantine')}
                    >
                      {'Disable this file'}
                    </Button>
                    <Button
                      variant="contained"
                      color="success"
                      disabled={busy || !canWrite}
                      onClick={() => void act('release')}
                    >
                      {'Release'}
                    </Button>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {
                      'Release clears EVERY key currently refusing this file, not just the preferred one — an asset can be covered by two at once, and a half-lift leaves the Disabled badge up and reads exactly like a lift that failed.'
                    }
                  </Typography>
                </Stack>
              </CardDisplay>
            ) : null}

            <CardDisplay
              header={'The whole deny list'}
              help={docsHelp('lockdown', { anchor: '#quarantine-keys' })}
              contentGutterX
              contentGutterY
            >
              <Stack spacing={2}>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
                >
                  <Typography
                    variant="body2"
                    color={listFull ? 'error.main' : 'text.secondary'}
                  >
                    {listing
                      ? `${listing.count} of ${listing.maxEntries} entries in use`
                      : 'Reading the deny list…'}
                  </Typography>
                  {listing ? (
                    <Typography variant="caption" color="text.secondary">
                      {`read ${new Date(listing.readAtMs).toLocaleString()}`}
                    </Typography>
                  ) : null}
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={busy}
                    onClick={() => void loadList()}
                  >
                    {'Refresh'}
                  </Button>
                </Stack>

                {listFull ? (
                  <Alert severity="error">
                    {
                      'The deny list is FULL. Until an entry is released the next NEW takedown is refused with a 409 — a report you cannot action. Releasing expired entries costs nothing: they already refuse nothing.'
                    }
                  </Alert>
                ) : null}

                {listing && clearable > 0 ? (
                  <Alert severity="warning">
                    {`${clearable} of these ${listing.count} entries enforce nothing right now — their expiry has passed, or their reason is one no reader recognises — and every one of them still occupies a slot. Clear these first.`}
                  </Alert>
                ) : null}

                {listing && !rows.length ? (
                  <Typography variant="body2" color="text.secondary">
                    {
                      'The deny list is empty. Nothing on the platform is taken down.'
                    }
                  </Typography>
                ) : null}

                {rows.length ? (
                  <Stack sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>{'Key'}</TableCell>
                          <TableCell>{'Reason'}</TableCell>
                          <TableCell>{'Set'}</TableCell>
                          <TableCell>{'Expires'}</TableCell>
                          <TableCell>{'Set from'}</TableCell>
                          <TableCell>{'Note'}</TableCell>
                          <TableCell>{''}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rows.map(({ record, state }) => (
                          <TableRow key={record.key}>
                            <TableCell>
                              <Stack spacing={0.5}>
                                <Stack
                                  direction="row"
                                  spacing={0.5}
                                  sx={{ alignItems: 'center' }}
                                >
                                  <Chip
                                    size="small"
                                    label={
                                      LISTED_KIND_LABEL[
                                        listedKeyKind(record.key)
                                      ]
                                    }
                                  />
                                  <Chip
                                    size="small"
                                    color={
                                      state === 'active' ? 'error' : 'default'
                                    }
                                    label={
                                      state === 'active'
                                        ? 'enforcing'
                                        : state === 'expired'
                                          ? 'EXPIRED'
                                          : 'UNREADABLE'
                                    }
                                  />
                                </Stack>
                                <Typography
                                  variant="caption"
                                  sx={{
                                    fontFamily: 'monospace',
                                    wordBreak: 'break-all',
                                  }}
                                >
                                  {record.key}
                                </Typography>
                              </Stack>
                            </TableCell>
                            <TableCell>
                              <Typography variant="caption">
                                {(record.reason &&
                                  (MEDIA_QUARANTINE_REASON_LABELS as any)[
                                    record.reason
                                  ]) ||
                                  record.reason ||
                                  'none recorded'}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Typography variant="caption">
                                {typeof record.atMs === 'number'
                                  ? new Date(record.atMs).toLocaleString()
                                  : 'unknown'}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Typography variant="caption">
                                {typeof record.untilMs === 'number'
                                  ? new Date(record.untilMs).toLocaleString()
                                  : 'no expiry'}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Typography
                                variant="caption"
                                sx={{ wordBreak: 'break-all' }}
                              >
                                {record.originScopeSegment || record.originMediaId
                                  ? `${record.originScopeSegment ?? '?'} / ${record.originMediaId ?? '?'}`
                                  : 'not recorded'}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Typography
                                variant="caption"
                                color="text.secondary"
                              >
                                {record.note || '—'}
                              </Typography>
                            </TableCell>
                            <TableCell>
                              <Button
                                size="small"
                                color="success"
                                disabled={busy || !canWrite}
                                onClick={() => void releaseKey(record.key)}
                              >
                                {'Release'}
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Stack>
                ) : null}

                <Typography variant="caption" color="text.secondary">
                  {
                    'A row is a KEY, not a file, and Release removes only the key it names. A file covered by two keys stays disabled until both rows are gone — look it up above if you need to be sure. The "set from" column records the one copy an operator was looking at when they set the entry; a digest key covers every copy of those bytes in every workspace, so it is a breadcrumb, not the reach.'
                  }
                </Typography>
                {!canWrite ? (
                  <Typography variant="caption" color="text.secondary">
                    {
                      'Releasing requires the super staff role. Reading this list does not.'
                    }
                  </Typography>
                ) : null}
              </Stack>
            </CardDisplay>

            <CardDisplay
              header={'Actions taken in this session'}
              help={docsHelp('lockdown', {
                anchor: '#never-take-a-lock-or-a-lift-on-trust',
              })}
              contentGutterX
              contentGutterY
            >
              {log.length ? (
                <Stack spacing={0.5}>
                  {log.map((entry) => (
                    <Typography
                      key={`${entry.atMs}-${entry.text}`}
                      variant="body2"
                      color={entry.confirmed ? 'text.primary' : 'error.main'}
                    >
                      {`${new Date(entry.atMs).toLocaleTimeString()} — ${entry.text}${
                        entry.confirmed ? '' : ' — NOT CONFIRMED'
                      }`}
                    </Typography>
                  ))}
                </Stack>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  {
                    'Nothing yet. If you pressed a button and no line appeared here, the click did not reach the server — look the file up again and press it again.'
                  }
                </Typography>
              )}
            </CardDisplay>
          </Stack>
        </StaffOnly>
      </Container>
    </DashboardLayout>
  )
}
AdminMediaQuarantine.displayName = 'Page:AdminMediaQuarantine'

export default AdminMediaQuarantine
