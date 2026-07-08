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
  createResourceUid,
  isSelfRedirect,
  normalizeRedirectDestination,
  normalizeRedirectSource,
  REDIRECT_STATUS_CODES,
} from '@aglyn/aglyn'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  doc,
  getDoc,
  limit,
  query,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollectionData,
  useFirestoreDocData,
} from 'reactfire'
import { checkTenantQuota, hasEntitlement } from '../constants/entitlements'
import useCurrentTenant from '../hooks/use-current-tenant'

interface RedirectDraft {
  id: string | null
  source: string
  destination: string
  statusCode: number
}

/**
 * Redirect manager (AGL-156): CRUD over `hosts/{hostId}/redirects` with
 * the shared AGL-154 validation (normalized sources, https-or-internal
 * destinations, self-redirect refusal, duplicate-source check). Paid
 * (`redirects` flag + `redirectsPerHost` quota); rules take effect on the
 * site within ~30 seconds (AGL-155 ISR window).
 */
export function HostRedirects(props: { hostId: string }) {
  const { hostId } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { tenant } = useCurrentTenant()
  const entitled = hasEntitlement('redirects', tenant)

  const { data: redirectDocs } = useFirestoreCollectionData<any>(
    query(collection(firestore, 'hosts', hostId, 'redirects'), limit(200)),
    { idField: '$id' },
  )
  const redirects = [...(redirectDocs ?? [])]
    .filter((redirect: any) => !redirect.deletedAt)
    .sort((a: any, b: any) =>
      String(a.source ?? '').localeCompare(String(b.source ?? '')),
    )

  const [draft, setDraft] = useState<RedirectDraft | null>(null)

  // Host routing map for the screen-collision warning (AGL-156 spec).
  const { data: host } = useFirestoreDocData<any>(
    doc(firestore, 'hosts', hostId),
    { idField: '$id' },
  )

  // Sampled hit counts (AGL-157): summed from the last 30 analytics day
  // docs' `redirects` maps written by enforcement. Counts are sampled —
  // one per ISR revalidation window with traffic, not per request.
  const [hits, setHits] = useState<Record<string, number> | null>(null)
  useEffect(() => {
    if (!entitled) return
    let active = true
    const ids = Array.from({ length: 30 }, (_, index) => {
      const date = new Date()
      date.setDate(date.getDate() - index)
      return date.toISOString().slice(0, 10)
    })
    void Promise.all(
      ids.map((id) =>
        getDoc(doc(firestore, 'hosts', hostId, 'analytics', id))
          .then((snapshot) => (snapshot.get('redirects') ?? {}) as Record<string, number>)
          .catch(() => ({}) as Record<string, number>),
      ),
    ).then((days) => {
      if (!active) return
      const totals: Record<string, number> = {}
      for (const dayMap of days) {
        for (const [redirectId, count] of Object.entries(dayMap)) {
          totals[redirectId] = (totals[redirectId] ?? 0) + Number(count)
        }
      }
      setHits(totals)
    })
    return () => {
      active = false
    }
  }, [entitled, firestore, hostId])
  const idKey = (value: string) => value.replace(/[.$#[\]/]/g, '_')
  const totalHits = Object.values(hits ?? {}).reduce(
    (sum, count) => sum + count,
    0,
  )

  const handleAdd = useCallback(() => {
    if (!entitled) {
      return void enqueueSnackbar(
        'URL redirects require a Starter plan — see Billing to upgrade',
        { variant: 'warning', persist: false },
      )
    }
    const quota = checkTenantQuota(tenant, 'redirectsPerHost', redirects.length)
    if (!quota.allowed) {
      return void enqueueSnackbar(
        `Redirect limit reached (${quota.limit}) — upgrade in Billing`,
        { variant: 'warning', persist: false },
      )
    }
    setDraft({ id: null, source: '', destination: '', statusCode: 302 })
  }, [entitled, tenant, redirects.length, enqueueSnackbar])

  const handleSave = useCallback(async () => {
    if (!draft) return
    const source = normalizeRedirectSource(draft.source)
    if (!source) {
      return void enqueueSnackbar(
        'Sources are site paths like /old-page — no full URLs',
        { variant: 'warning', persist: false },
      )
    }
    const destination = normalizeRedirectDestination(draft.destination)
    if (!destination) {
      return void enqueueSnackbar(
        'Destinations are internal paths or https:// URLs',
        { variant: 'warning', persist: false },
      )
    }
    if (isSelfRedirect({ source, destination })) {
      return void enqueueSnackbar('That would redirect the path to itself', {
        variant: 'warning',
        persist: false,
      })
    }
    const duplicate = redirects.find(
      (redirect: any) =>
        redirect.source === source && redirect.$id !== draft.id,
    )
    if (duplicate) {
      return void enqueueSnackbar(`A rule for ${source} already exists`, {
        variant: 'warning',
        persist: false,
      })
    }
    // Chain-loop detection (AGL-156): follow internal destinations through
    // the rule set; a walk that returns to this source can never execute.
    if (destination.startsWith('/')) {
      const bySource = new Map<string, string>(
        redirects
          .filter((redirect: any) => redirect.$id !== draft.id)
          .map((redirect: any) => [redirect.source, redirect.destination]),
      )
      let cursor: string | undefined = destination.toLowerCase()
      for (let hop = 0; hop < 10 && cursor; hop += 1) {
        if (cursor === source) {
          return void enqueueSnackbar(
            'That destination chains back to this rule — a redirect loop',
            { variant: 'warning', persist: false },
          )
        }
        const next: string | undefined = bySource.get(cursor)
        cursor = next && next.startsWith('/') ? next.toLowerCase() : undefined
      }
    }
    // Screen-route collision: shadowing a live page may be intentional
    // (moved pages) — warn, don't block (decision per the issue).
    const routedPaths = Object.values(
      (host?.screens ?? {}) as Record<string, string>,
    ).map((path) => (path === '/' ? '/' : `/${path}`))
    if (routedPaths.includes(source)) {
      enqueueSnackbar(
        `${source} is a published page — the redirect takes precedence`,
        { variant: 'info', persist: false },
      )
    }
    try {
      const id = draft.id ?? createResourceUid()
      await setDoc(
        doc(firestore, 'hosts', hostId, 'redirects', id),
        {
          source,
          destination,
          statusCode: (REDIRECT_STATUS_CODES as readonly number[]).includes(
            draft.statusCode,
          )
            ? draft.statusCode
            : 302,
          kind: 'exact',
          enabled: true,
          updatedAt: Timestamp.now(),
          ...(draft.id ? {} : { createdAt: Timestamp.now() }),
        },
        { merge: true },
      )
      setDraft(null)
      enqueueSnackbar('Redirect saved — live within ~30 seconds', {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [draft, redirects, host, firestore, hostId, enqueueSnackbar])

  const handleToggle = useCallback(
    (redirect: any) => async (event: { target: { checked: boolean } }) => {
      await updateDoc(
        doc(firestore, 'hosts', hostId, 'redirects', redirect.$id),
        { enabled: event.target.checked, updatedAt: Timestamp.now() },
      )
    },
    [firestore, hostId],
  )

  const handleDelete = useCallback(
    (redirect: any) => async () => {
      const confirmed = await confirm({
        title: 'Delete this redirect?',
        description: `${redirect.source} stops redirecting.`,
        confirmationText: 'Delete',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      await updateDoc(
        doc(firestore, 'hosts', hostId, 'redirects', redirect.$id),
        { deletedAt: Timestamp.now(), enabled: false },
      )
    },
    [confirm, firestore, hostId],
  )

  return (
    <CardDisplay header={'URL redirects'} contentGutterX contentGutterY>
      {!entitled ? (
        <Alert severity="info">
          {'URL redirects are included from the Starter plan — point old ' +
            'addresses at new pages or outside URLs. See Billing to upgrade.'}
        </Alert>
      ) : (
        <Stack spacing={1}>
          <Typography variant="body2" color="text.secondary">
            {'Exact-path rules; 302 while testing, promote to 301 when ' +
              'sure (browsers cache 301 aggressively). Changes go live ' +
              'within ~30 seconds.'}
          </Typography>
          {hits && totalHits > 0 ? (
            <Typography variant="caption" color="text.secondary">
              {`${totalHits} redirect hit${totalHits === 1 ? '' : 's'} in ` +
                'the last 30 days (sampled — one per cache window with ' +
                'traffic).'}
            </Typography>
          ) : null}
          {redirects.map((redirect: any) => (
            <Stack
              key={redirect.$id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <Switch
                size="small"
                checked={redirect.enabled !== false}
                onChange={handleToggle(redirect)}
              />
              <Chip size="small" label={redirect.statusCode ?? 302} />
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {`${redirect.source} → ${redirect.destination}`}
                </Typography>
                {hits || redirect.lastHitAt ? (
                  <Typography variant="caption" color="text.secondary">
                    {[
                      hits
                        ? `${hits[idKey(redirect.$id)] ?? 0} hits (30d, sampled)`
                        : null,
                      redirect.lastHitAt
                        ? `last ${redirect.lastHitAt
                            .toDate()
                            .toLocaleString()}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Typography>
                ) : null}
              </Stack>
              <Button
                size="small"
                onClick={() =>
                  setDraft({
                    id: redirect.$id,
                    source: redirect.source ?? '',
                    destination: redirect.destination ?? '',
                    statusCode: redirect.statusCode ?? 302,
                  })
                }
              >
                {'Edit'}
              </Button>
              <Button
                size="small"
                color="error"
                onClick={handleDelete(redirect)}
              >
                {'Delete'}
              </Button>
            </Stack>
          ))}
          <Button
            size="small"
            color="secondary"
            sx={{ alignSelf: 'flex-start' }}
            onClick={handleAdd}
          >
            {'Add redirect'}
          </Button>
        </Stack>
      )}

      <Dialog
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{draft?.id ? 'Edit redirect' : 'Add redirect'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          <TextField
            label="From path"
            placeholder="/old-page"
            value={draft?.source ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, source: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
          />
          <TextField
            label="To"
            placeholder="/new-page or https://example.com"
            value={draft?.destination ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, destination: event.target.value } : prev,
              )
            }
            size="small"
          />
          <TextField
            select
            label="Status code"
            value={draft?.statusCode ?? 302}
            onChange={(event) =>
              setDraft((prev) =>
                prev
                  ? { ...prev, statusCode: Number(event.target.value) }
                  : prev,
              )
            }
            size="small"
          >
            <MenuItem value={302}>{'302 — temporary (default)'}</MenuItem>
            <MenuItem value={301}>{'301 — permanent'}</MenuItem>
            <MenuItem value={307}>{'307 — temporary, keep method'}</MenuItem>
            <MenuItem value={308}>{'308 — permanent, keep method'}</MenuItem>
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="secondary"
            disabled={!draft?.source.trim() || !draft?.destination.trim()}
            onClick={handleSave}
          >
            {'Save redirect'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
HostRedirects.displayName = 'HostRedirects'

export default HostRedirects
