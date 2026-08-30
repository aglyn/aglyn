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

import { checkQuota, pluginDocsHelp } from '@aglyn/aglyn'
import { type ConsolePluginPageProps } from '@aglyn/aglyn'
import { isExternalRedirectDestination, isSelfRedirect, matchRedirect, normalizeRedirectDestination, normalizeRedirectSource, REDIRECT_DEFAULT_PRIORITY, validateRedirectRule, REDIRECT_STATUS_CODES } from '../model'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import QuotaReadoutComponent from '@aglyn/shared-ui-jsx/components/quota-readout.component'
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
  deleteField,
  doc,
  getCountFromServer,
  getDoc,
  setDoc,
  updateDoc,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import {
  ceilingedWindow,
  collectionCeiling,
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  useHostResourceApi,
  useUser,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'

/**
 * How many redirect documents this page reads.
 *
 * A CEILING, not a page size. Everything the page decides is computed over
 * the WHOLE rule set: the duplicate-source check, the chain-loop walk that
 * follows internal destinations through the rules, and the inline tester that
 * runs the enforcement matcher. A server page would give each of them a
 * tenth of the rules to reason about, and the duplicate check would then
 * create exactly the collision it exists to prevent.
 */
const REDIRECT_CEILING = 200

interface RedirectDraft {
  id: string | null
  source: string
  destination: string
  statusCode: number
  /** Match mode (AGL-375): exact | prefix | regex. */
  kind: string
  /** Lower fires first. */
  priority: number
  /**
   * The rule's on/off state, carried through the editor rather than reset by
   * it (AGL-1372). The save used to hardcode `true`, so changing a **disabled**
   * rule's target turned it back on and rerouted the site without the author
   * asking. A new rule seeds this `true`; an edit seeds it from the stored
   * rule, which is also where the row's switch reads from.
   */
  enabled: boolean
}

/**
 * Redirect manager (AGL-156): CRUD over `hosts/{hostId}/redirects` with
 * the shared AGL-154 validation (normalized sources, https-or-internal
 * destinations, self-redirect refusal, duplicate-source check). Paid
 * (`redirects` flag + `redirectsPerHost` quota); rules take effect on the
 * site within ~30 seconds (AGL-155 ISR window).
 *
 * The plan gate is the SHELL's, and it runs before this component exists
 * (AGL-2484): the console resolves `redirects` from the org billing doc and
 * renders its own refusal notice in place of the surface, so this card is
 * only ever mounted for an entitled org and states no plan terms of its own.
 * Redirects registers no `upgradeNotice` override because it is a genuine
 * upgrade — free denies it, Starter and above grant it — which makes the
 * shell's plan-derived sentence the accurate one already.
 *
 * `entitled` is still read below, where it is not redundant: it holds back
 * the thirty analytics day-doc reads behind the hit counts, and refuses the
 * add path ahead of the server that enforces it.
 */
export function RedirectsConsolePage(props: ConsolePluginPageProps) {
  const { hostId, entitled, org } = props
  const firestore = useFirestore()
  const createHostResource = useHostResourceApi()
  const { data: currentUser } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()

  const {
    data: redirectDocs,
    status: redirectsStatus,
    /**
     * The rows this editor is seeded from are unconfirmed by the server
     * (AGL-1358). Editing copies every field the form owns out of the stored
     * rule and writes all of them back, so `merge: true` protects only the
     * fields written elsewhere (`lastHitAt`, `deletedAt`). This is the site
     * where a rollback is hardest to undo: a reverted `destination` on a
     * **301** is cached by every browser that has already followed it, so the
     * stale target outlives the fix in the console. `kind` reverting from
     * exact to prefix silently widens a rule over a whole subtree, and
     * `priority` reorders which rule fires when several match.
     */
    fromCache: redirectsFromCache,
  } = useFirestoreCollection<any>(
    /*
     * ORDERED AND CEILINGED, with a probe (AGL-2501).
     *
     * `limit(200)` alone is answered in DOCUMENT-ID order and the ids are
     * generated, so the window was a pseudo-random two hundred of the site's
     * rules — sorted by `source` in the browser afterwards, which is what
     * made it invisible: the rules on screen run alphabetically and are
     * simply the wrong rules, and the ones missing leave no gap to notice.
     *
     * `orderBy('source')` is the tempting fix and the dangerous one. It
     * matches only documents that HAVE the field, and nothing validates
     * `source` for presence — `/api/hosts/resources` stores an allow-list of
     * fields and checks none of them — so a rule saved without one would
     * vanish from this page while still redirecting live traffic. The
     * document NAME cannot be absent, so the walk is total: every rule is
     * reachable, and the alphabetical order stays where it belongs, in the
     * sort below over a window the page holds whole.
     */
    () =>
      collectionCeiling(
        collection(firestore, 'hosts', hostId, 'redirects'),
        REDIRECT_CEILING,
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const { rows: readRedirects, truncated: redirectsTruncated } =
    ceilingedWindow<any>(redirectDocs, REDIRECT_CEILING)
  const redirects = [...readRedirects]
    .filter((redirect: any) => !redirect.deletedAt)
    .sort((a: any, b: any) =>
      String(a.source ?? '').localeCompare(String(b.source ?? '')),
    )

  /*
   * The page is a SLICE of the ceiling, which is what the three whole-set
   * consumers above require. The count is the rules this page HOLDS, after
   * soft-deleted ones are dropped — not the quota, which is a server count of
   * every document including the soft-deleted, and is read separately below.
   */
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const visibleRedirects = useMemo(
    () => redirects.slice(page * pageSize, page * pageSize + pageSize),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [redirectDocs, page, pageSize],
  )

  /**
   * What the ENFORCING route counts, which is not what this page was counting.
   *
   * `hosts/{id}/redirects` is read here as an unordered `limit(200)` window
   * and then filtered to drop soft-deleted rows, and that filtered length was
   * feeding both `checkQuota('redirectsPerHost')` and the readout beside it.
   * The route in `app/api/hosts/resources` counts the collection plainly —
   * `collectionRef.count()`, every document, soft-deleted ones included — so
   * the two disagreed on both counts at once: a rule deleted in this console
   * still occupies a slot on the server, and a site past 200 rules has rows
   * the window never saw.
   *
   * The visible effect is the worst kind: the page shows room, the author
   * fills in the form, and the save is refused by a server counting something
   * else. Same shape as AGL-1716.
   *
   * An aggregation query, so it costs one read unit per thousand documents
   * rather than reading them. Re-run when the document set changes, which
   * covers an add; a soft delete leaves the document in place and so does not
   * move this number — correctly, because it does not move the server's
   * either.
   *
   * Only the COUNT is corrected here. Whether a soft-deleted rule should go on
   * occupying a slot is the quota RULE, and that lives with the enforcing
   * route.
   */
  const [enforcedCount, setEnforcedCount] = useState<number | null>(null)
  const redirectDocCount = redirectDocs?.length ?? 0

  /**
   * `null` when the count cannot be taken, never a number.
   *
   * `try`, not `.catch()`: `getCountFromServer` validates its reference and
   * THROWS synchronously on a bad one, so a rejection handler alone leaves the
   * error to escape the effect and take the page down with it. Unreadable is
   * also not zero — answering zero would tell an author at their cap that the
   * whole allowance is free.
   */
  const countRedirects = useCallback(async (): Promise<number | null> => {
    try {
      const snapshot = await getCountFromServer(
        collection(firestore, 'hosts', hostId, 'redirects'),
      )
      return snapshot.data().count
    } catch {
      return null
    }
  }, [firestore, hostId])

  useEffect(() => {
    let active = true
    void countRedirects().then((count) => {
      if (active && count != null) setEnforcedCount(count)
    })
    return () => {
      active = false
    }
  }, [countRedirects, redirectDocCount])

  const [draft, setDraft] = useState<RedirectDraft | null>(null)
  const [testPath, setTestPath] = useState('')

  // Host routing map for the screen-collision warning (AGL-156 spec).
  const { data: host } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
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
    /*
     * The SERVER's count, not the rows on screen — the whole point of this
     * fix. Read from the polled value rather than re-counted on the click:
     * this gate is a courtesy that spares the author a form they are about to
     * be refused, the route is the actual enforcer, and making the button
     * await an aggregation would delay the dialog on every press to sharpen a
     * number the server re-checks anyway.
     *
     * `null` means the count could not be read, and that lets the add through:
     * refusing on a number we do not have would block an author who may well
     * be inside their cap.
     */
    const quota = checkQuota(org, 'redirectsPerHost', enforcedCount ?? 0)
    if (!quota.allowed) {
      return void enqueueSnackbar(
        `Redirect limit reached (${quota.limit}) — upgrade in Billing`,
        { variant: 'warning', persist: false },
      )
    }
    setDraft({
      id: null,
      source: '',
      destination: '',
      statusCode: 302,
      kind: 'exact',
      priority: REDIRECT_DEFAULT_PRIORITY,
      // A NEW rule is on: the author is adding it to make it fire, and
      // enforcement queries `where('enabled', '==', true)`, so a rule created
      // without the field would never resolve (AGL-1372).
      enabled: true,
    })
  }, [entitled, org, enforcedCount, enqueueSnackbar])

  const handleSave = useCallback(async () => {
    if (!draft) return
    const kind = draft.kind || 'exact'
    // Shared v2 validation (AGL-375): regex patterns must compile; path
    // kinds keep the v1 normalization.
    const problem = validateRedirectRule({
      kind,
      source: draft.source,
      destination: draft.destination,
    })
    if (problem) {
      return void enqueueSnackbar(problem, {
        variant: 'warning',
        persist: false,
      })
    }
    const source =
      kind === 'regex'
        ? draft.source.trim()
        : (normalizeRedirectSource(draft.source) as string)
    const destination = normalizeRedirectDestination(
      draft.destination,
    ) as string
    if (kind !== 'regex' && isSelfRedirect({ source, destination })) {
      return void enqueueSnackbar('That would redirect the path to itself', {
        variant: 'warning',
        persist: false,
      })
    }
    const duplicate = redirects.find(
      (redirect: any) =>
        redirect.source === source &&
        (redirect.kind ?? 'exact') === kind &&
        redirect.$id !== draft.id,
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
    const fields = {
      source,
      destination,
      statusCode: (REDIRECT_STATUS_CODES as readonly number[]).includes(
        draft.statusCode,
      )
        ? draft.statusCode
        : 302,
      kind,
      priority: Number.isFinite(Number(draft.priority))
        ? Number(draft.priority)
        : REDIRECT_DEFAULT_PRIORITY,
      /**
       * Whatever the rule already was (AGL-1372). This was `true`, so editing
       * a **disabled** rule's target silently re-enabled it — a deliberate
       * "off" (a retired campaign, a rule that broke something) undone by a
       * routine save, changing site routing without the author asking.
       *
       * `!== false` rather than the raw value, because the switch below reads
       * the stored field the same way: absent means on. Enforcement's query is
       * `where('enabled', '==', true)`, so a rule missing the field is not
       * served, and normalising it here makes the console's claim true.
       *
       * The create default lives in `handleAdd` — a new rule seeds the draft
       * `true`, so both defaults hold without either one reading the other.
       */
      enabled: draft.enabled !== false,
    }
    /**
     * The publisher's stamp on an external destination (AGL-1881).
     *
     * `matchRedirect` will not send traffic off the platform without it, and
     * `cloud/firebase-firestore.rules` admits no write to this collection from
     * anyone but `canPublishHostContent` — so reaching this line at all is the
     * approval, and saving is how a rule written before that fix starts firing
     * again.
     *
     * Written on EDIT only. A create rides /api/hosts/resources, which stamps
     * the same field from the id token's verified uid; sending it from here
     * would be the client supplying its own provenance, and that route drops
     * it for exactly that reason.
     *
     * Cleared with `deleteField()` when the destination is internal, rather
     * than left standing. `merge: true` never removes a key, so an edit from
     * `https://elsewhere.example` back to `/pricing` would otherwise leave a
     * stamp behind that a LATER edit back to an external target would inherit
     * — approval carried across a destination nobody approved.
     */
    const approval = isExternalRedirectDestination(destination)
      ? { externalDestinationApprovedBy: currentUser?.uid ?? null }
      : { externalDestinationApprovedBy: deleteField() }
    try {
      if (draft.id) {
        /**
         * Edit stays client-direct (no quota consumed) — and is refused when
         * its seed was never confirmed by the server (AGL-1358); the eight
         * validation refusals above have all already returned by here.
         *
         * `merge: true` is load-bearing, contrary to what this said before
         * (AGL-1372): `fields` is every key the FORM owns, not every key the
         * document holds. `lastHitAt` is written by enforcement
         * (`resolve-redirect`), and `deletedAt` by the delete below — a
         * replacing write would erase both.
         *
         * The guard WRAPS the write. An early return is a shape you can keep
         * while losing the protection; here the write is only reachable
         * through the verdict.
         */
        const verdict = await writeGuardedBySeed(
          {
            subject: 'redirect',
            unreadable: redirectsStatus === 'error',
            fromCache: redirectsFromCache,
          },
          async () => {
            await setDoc(
              doc(firestore, 'hosts', hostId, 'redirects', draft.id),
              { ...fields, ...approval, updatedAt: Timestamp.now() },
              { merge: true },
            )
          },
        )
        // Before `setDraft(null)`, so a refusal keeps the dialog open with
        // what was typed, in the same warning vocabulary as the validation
        // refusals above it.
        if (!verdict.ok) {
          return void enqueueSnackbar(verdict.message, {
            variant: 'warning',
            persist: false,
          })
        }
      } else {
        // New redirect rides the quota-enforcing resources API (AGL-473) —
        // it also re-checks the `redirects` entitlement server-side.
        await createHostResource({ hostId, resource: 'redirect', data: fields })
      }
      setDraft(null)
      enqueueSnackbar('Redirect saved — live within ~30 seconds', {
        variant: 'success',
        persist: false,
      })
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    }
  }, [
    draft,
    redirects,
    host,
    firestore,
    hostId,
    createHostResource,
    currentUser,
    enqueueSnackbar,
    redirectsStatus,
    redirectsFromCache,
  ])

  /**
   * A refusal has to be visible (AGL-1881).
   *
   * These two writes were bare `await`s. The rules now gate this collection on
   * a publishing role, so an `author` reaching either gets a
   * permission-denied — and an unhandled rejection renders as a control that
   * flips back with no error, which is the worst way to say no. `handleSave`
   * has always ended in a snackbar; these now match it.
   *
   * The card is not role-gated on purpose: it is entitlement-gated, and the
   * rules leave READ to the catch-all so an author can still see the rules
   * that affect the pages they write.
   */
  const reportWriteFailure = useCallback(
    (error: any) => {
      enqueueSnackbar(
        error?.code === 'permission-denied'
          ? 'Changing a redirect needs a publishing role — ask an editor or admin'
          : (error?.message ?? 'An error has occurred'),
        { variant: 'warning', persist: false },
      )
    },
    [enqueueSnackbar],
  )

  const handleToggle = useCallback(
    (redirect: any) => async (event: { target: { checked: boolean } }) => {
      try {
        await updateDoc(
          doc(firestore, 'hosts', hostId, 'redirects', redirect.$id),
          { enabled: event.target.checked, updatedAt: Timestamp.now() },
        )
      } catch (error: any) {
        reportWriteFailure(error)
      }
    },
    [firestore, hostId, reportWriteFailure],
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
      try {
        await updateDoc(
          doc(firestore, 'hosts', hostId, 'redirects', redirect.$id),
          { deletedAt: Timestamp.now(), enabled: false },
        )
      } catch (error: any) {
        reportWriteFailure(error)
      }
    },
    [confirm, firestore, hostId, reportWriteFailure],
  )

  return (
    <CardDisplay
      header={'URL redirects'}
      help={pluginDocsHelp('redirects', { anchor: '#manage-redirects' })}
      contentGutterX
      contentGutterY
    >
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
        {visibleRedirects.map((redirect: any) => (
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
            {(redirect.kind ?? 'exact') !== 'exact' ? (
              <Chip
                size="small"
                variant="outlined"
                label={redirect.kind}
              />
            ) : null}
            {/* An external rule with no publisher stamp is not being served
                (AGL-1881) — `matchRedirect` skips it. Say so on the row
                rather than letting it read as live: a rule that silently
                stops firing is the failure mode a fail-closed gate owes an
                explanation for, and pressing Edit → Save is the whole fix.
                Shown for external destinations only, since that is the only
                case the gate applies to. */}
            {isExternalRedirectDestination(redirect.destination) &&
            !redirect.externalDestinationApprovedBy ? (
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                label="not serving"
                title={
                  'This rule sends visitors to another site. Open it and ' +
                  'save to confirm the destination — until then it is ' +
                  'skipped.'
                }
              />
            ) : null}
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
                  kind: redirect.kind ?? 'exact',
                  priority: redirect.priority ?? REDIRECT_DEFAULT_PRIORITY,
                  // Read exactly as the switch beside it does (AGL-1372):
                  // an edit must not be a way to turn a rule back on.
                  enabled: redirect.enabled !== false,
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
        {redirects.length === 0 ? null : (
          <ListPagination
            page={page}
            pageSize={pageSize}
            rowCount={visibleRedirects.length}
            // The rules this page HOLDS, after the soft-deleted ones are
            // dropped. Not the quota figure below it: that is a server
            // count over every document, soft-deleted rows included,
            // because a deleted rule still occupies a slot.
            count={redirects.length}
            onPageChange={setPage}
            onPageSizeChange={setPageSize}
          />
        )}
        {redirectsTruncated ? (
          <Alert severity="info">
            {`Showing ${REDIRECT_CEILING} rules, ordered by id. This site ` +
              'has more — the duplicate check and the tester below only ' +
              'cover the ones listed here.'}
          </Alert>
        ) : null}
        <Button
          size="small"
          color="primary"
          sx={{ alignSelf: 'flex-start' }}
          onClick={handleAdd}
        >
          {'Add redirect'}
        </Button>
        {/* The cap, standing rather than only on refusal (AGL-2113).
            `enforcedCount` is what the enforcing route counts and what
            `handleAdd` checks against, so the readout, the gate and the
            server cannot disagree. It is deliberately NOT the number of rows
            on screen: a soft-deleted rule still occupies a slot, so showing
            the visible count here would promise room the server refuses. */}
        <QuotaReadoutComponent
          ready={org != null && enforcedCount != null}
          used={enforcedCount ?? 0}
          limit={
            checkQuota(org, 'redirectsPerHost', enforcedCount ?? 0).limit
          }
          noun="redirect"
        />
        {/* Inline tester (AGL-375): same matcher as enforcement. */}
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <TextField
            size="small"
            label="Test a path"
            placeholder="/old-page"
            value={testPath}
            onChange={(event) => setTestPath(event.target.value)}
            sx={{ maxWidth: 260 }}
          />
          {testPath.trim() ? (
            <Typography variant="caption" color="text.secondary">
              {(() => {
                const normalized =
                  normalizeRedirectSource(testPath) ?? testPath.trim()
                const result = matchRedirect(redirects as any, normalized)
                return result
                  ? `→ ${result.destination} (${result.statusCode})`
                  : 'No rule matches'
              })()}
            </Typography>
          ) : null}
        </Stack>
      </Stack>

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
            select
            label="Match mode"
            value={draft?.kind ?? 'exact'}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, kind: event.target.value } : prev,
              )
            }
            size="small"
            sx={{ mt: 1 }}
          >
            <MenuItem value="exact">{'Exact path'}</MenuItem>
            <MenuItem value="prefix">{'Path prefix'}</MenuItem>
            <MenuItem value="regex">{'Regular expression'}</MenuItem>
          </TextField>
          <TextField
            label={draft?.kind === 'regex' ? 'Pattern' : 'From path'}
            placeholder={
              draft?.kind === 'regex' ? '/product/(\\d+)' : '/old-page'
            }
            helperText={
              draft?.kind === 'regex'
                ? 'Anchored to the whole path; use $1, $2 in the destination'
                : draft?.kind === 'prefix'
                  ? 'Matches the path and everything under it'
                  : undefined
            }
            value={draft?.source ?? ''}
            onChange={(event) =>
              setDraft((prev) =>
                prev ? { ...prev, source: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
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
          <TextField
            label="Priority"
            type="number"
            helperText="Lower fires first when several rules match"
            value={draft?.priority ?? REDIRECT_DEFAULT_PRIORITY}
            onChange={(event) =>
              setDraft((prev) =>
                prev
                  ? { ...prev, priority: Number(event.target.value) }
                  : prev,
              )
            }
            size="small"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDraft(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
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
RedirectsConsolePage.displayName = 'RedirectsConsolePage'

export default RedirectsConsolePage
