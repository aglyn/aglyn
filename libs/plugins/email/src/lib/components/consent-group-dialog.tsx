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

import type { ConsolePluginOrgHost } from '@aglyn/aglyn'
import { consentGroupsAwaitConfirmation } from '@aglyn/aglyn/app-utils/consent-groups'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  buildConsentGroupDeclaration,
  describeConsentGroupDraft,
  draftDisclosure,
  expectedConsentGroups,
  listConsentGroups,
  validateConsentGroupDraft,
  type ConsentGroupDraft,
  type ListedConsentGroup,
} from './consent-group-editing'
import { describeConsentGroupReview, joinNames } from './consent-group-review'
import ConsentGroupSitePicker from './consent-group-site-picker'
import {
  CONSENT_GROUP_NAME_MAX,
  consentGroupIssueCode,
  consentGroupIssueMessage,
  postConsentGroups,
  type ConsentGroupChangePreview,
  type ConsentGroupsFailure,
  type ConsentGroupsPreviewResponse,
  type ConsentGroupsProgressResponse,
  type ConsentGroupValidationIssue,
} from './consent-groups-api'

export type ConsentGroupDialogMode = 'create' | 'edit' | 'dissolve'

export interface ConsentGroupDialogProps {
  open: boolean
  mode: ConsentGroupDialogMode
  /** The group to edit or dissolve; ignored when creating. */
  groupId: string | null
  /** The org document, kept live by the shell. */
  org: Record<string, unknown> | null | undefined
  orgId: string
  /** Every site the organization has. */
  sites: readonly ConsolePluginOrgHost[]
  onClose: () => void
  /**
   * The route accepted the change. `done` when it already finished — a
   * rename moves no data, so it can complete inside the request.
   */
  onApplied: (result: { changeId: string; done: boolean }) => void
}

/** The declaration the dialog was opened against, held until it is applied. */
interface Snapshot {
  expected: Record<string, unknown> | null
  groups: ListedConsentGroup[]
}

/** The route's refusals, sorted onto the fields they belong to. */
interface Issues {
  name?: string
  sites?: string
  hostIds: Set<string>
  general: string[]
}

const NO_ISSUES: Issues = { hostIds: new Set(), general: [] }

const NAME_CODES = new Set(['name-empty', 'name-too-long', 'name-duplicate'])
const SITE_CODES = new Set([
  'too-few-sites',
  'too-many-sites',
  'group-replaced',
  'unknown-site',
  'site-in-two-groups',
])

/**
 * Declare, change or dissolve one consent group (AGL-3320).
 *
 * ## Two steps, because the second one is the consequence
 *
 * The EDIT step is the declaration: a name, which every signup form on the
 * group's sites will show, and the sites. The REVIEW step is what that
 * declaration does to people — who stops getting mail, who can still be
 * mailed, what happens to the CRM's records — counted by the route before
 * anything is written. Nothing changes until the review's button is pressed,
 * and that button is named for what it does.
 *
 * ## The whole declaration is sent, against the one that was read
 *
 * The route takes the org's complete next declaration and the raw one the
 * dialog was opened against, so a change somebody else made meanwhile is
 * refused rather than overwritten. The dialog snapshots that declaration
 * when it opens and edits against the snapshot; when the route says it is
 * stale, the dialog reloads the current one and asks again.
 *
 * ## Dissolving is where a group with too few sites ends up
 *
 * A group of one site is not a group, so unticking all but one site of an
 * existing group does not produce an invalid form — it becomes the dissolve,
 * and the dialog says so before anything is reviewed.
 */
export function ConsentGroupDialog(props: ConsentGroupDialogProps) {
  const { open, mode, groupId, org, orgId, sites, onClose, onApplied } = props
  const { data: user } = useUser()

  const [snapshot, setSnapshot] = useState<Snapshot>({ expected: null, groups: [] })
  const [name, setName] = useState('')
  const [hostIds, setHostIds] = useState<string[]>([])
  const [step, setStep] = useState<'edit' | 'review'>('edit')
  const [preview, setPreview] = useState<ConsentGroupChangePreview | null>(null)
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)
  const [alert, setAlert] = useState<{
    severity: 'error' | 'warning' | 'info'
    message: string
  } | null>(null)
  const [issues, setIssues] = useState<Issues>(NO_ISSUES)
  const [touched, setTouched] = useState(false)
  /**
   * Set when a review should be asked for as soon as the snapshot it depends
   * on has rendered: a dissolve on open, and a dissolve reloaded after a
   * stale answer. State rather than a call, because the call made in the
   * same pass as the load would post the declaration from before it.
   */
  const [autoPreview, setAutoPreview] = useState(false)
  /** Bumped on every open, so an answer to a closed dialog is dropped. */
  const session = useRef(0)

  const orgRef = useRef(org)
  orgRef.current = org

  /**
   * Starts (or restarts, after a stale answer) from a declaration.
   *
   * A new group's draft survives a restart — the name and the sites mean the
   * same against the declaration as it now stands, and any site somebody
   * else grouped meanwhile shows it on its badge. An edit's draft does not:
   * it was made to a group that has since changed.
   */
  const load = useCallback(
    (raw: Record<string, unknown> | null, keepDraft = false) => {
      const groups = listConsentGroups(raw ? { consentGroups: raw } : {})
      setSnapshot({ expected: raw, groups })
      setPreview(null)
      setIssues(NO_ISSUES)
      if (keepDraft) return groups
      const group = groupId ? groups.find((entry) => entry.id === groupId) : null
      setName(mode === 'create' ? '' : (group?.name ?? ''))
      setHostIds(mode === 'create' ? [] : [...(group?.hostIds ?? [])])
      setTouched(false)
      return groups
    },
    [groupId, mode],
  )

  const draft: ConsentGroupDraft = useMemo(
    () => ({ mode, groupId: mode === 'create' ? null : groupId, name, hostIds }),
    [mode, groupId, name, hostIds],
  )
  const change = useMemo(
    () => describeConsentGroupDraft(snapshot.groups, draft),
    [snapshot.groups, draft],
  )
  const localErrors = useMemo(
    () => validateConsentGroupDraft(snapshot.groups, draft),
    [snapshot.groups, draft],
  )
  const groupExists =
    mode === 'create' || snapshot.groups.some((group) => group.id === groupId)

  const siteName = useCallback(
    (hostId: string) => {
      const site = sites.find((entry) => entry.id === hostId)
      return site?.name || site?.subdomain || hostId
    },
    [sites],
  )

  /** Sorts a validation answer onto the name, the sites or the banner. */
  const placeIssues = useCallback(
    (errors: ConsentGroupValidationIssue[], editedIndex: number | null) => {
      const placed: Issues = { hostIds: new Set(), general: [] }
      const posted = buildConsentGroupDeclaration(snapshot.groups, draft).groups
      for (const issue of errors) {
        const code = consentGroupIssueCode(issue.code)
        const message = consentGroupIssueMessage(issue, siteName)
        // A dissolve has no fields on screen, so everything goes to the banner.
        const ours =
          editedIndex != null &&
          (issue.groupIndex == null || issue.groupIndex === editedIndex)
        if (issue.hostId) placed.hostIds.add(issue.hostId)
        if (ours && NAME_CODES.has(code)) {
          placed.name ??= message
        } else if (ours && SITE_CODES.has(code)) {
          placed.sites ??= message
        } else {
          const other =
            issue.groupIndex != null ? posted[issue.groupIndex]?.name : undefined
          placed.general.push(other ? `${other}: ${message}` : message)
        }
      }
      setIssues(placed)
    },
    [snapshot.groups, draft, siteName],
  )

  /** What every refused call does, whichever step made it. */
  const handleFailure = useCallback(
    (failure: ConsentGroupsFailure, editedIndex: number | null) => {
      if (failure.kind === 'invalid') {
        placeIssues(failure.errors, editedIndex)
        setAlert(
          failure.errors.length
            ? null
            : { severity: 'error', message: failure.message },
        )
        if (mode !== 'dissolve') setStep('edit')
        return
      }
      if (failure.kind === 'stale') {
        // Reload what is there now, and let the admin look again.
        const groups = load(
          failure.current ?? expectedConsentGroups(orgRef.current),
          mode === 'create',
        )
        const stillThere =
          mode === 'create' || groups.some((group) => group.id === groupId)
        setAlert({
          severity: 'warning',
          message: stillThere
            ? `${failure.message} This shows what they saved; check your change and review it again.`
            : `${failure.message} This consent group no longer exists.`,
        })
        setStep(mode === 'dissolve' ? 'review' : 'edit')
        if (mode === 'dissolve' && stillThere) setAutoPreview(true)
        return
      }
      setAlert({
        severity: failure.kind === 'in-flight' ? 'info' : 'error',
        message: failure.message,
      })
    },
    [placeIssues, load, mode, groupId],
  )

  const requestPreview = useCallback(async () => {
    if (!user) return
    const ticket = session.current
    const { groups, editedIndex } = buildConsentGroupDeclaration(
      snapshot.groups,
      draft,
    )
    setBusy('preview')
    setAlert(null)
    setIssues(NO_ISSUES)
    setPreview(null)
    setStep('review')
    const result = await postConsentGroups<ConsentGroupsPreviewResponse>(user, {
      orgId,
      action: 'preview',
      expected: snapshot.expected,
      groups,
    })
    if (ticket !== session.current) return
    setBusy(null)
    if (result.ok) {
      setPreview(result.body.preview ?? null)
      return
    }
    handleFailure(result.failure, editedIndex)
  }, [user, snapshot, draft, orgId, handleFailure])

  const apply = useCallback(async () => {
    if (!user || !preview) return
    const ticket = session.current
    const { groups, editedIndex } = buildConsentGroupDeclaration(
      snapshot.groups,
      draft,
    )
    setBusy('apply')
    setAlert(null)
    const result = await postConsentGroups<ConsentGroupsProgressResponse>(user, {
      orgId,
      action: 'apply',
      expected: snapshot.expected,
      groups,
    })
    if (ticket !== session.current) return
    setBusy(null)
    if (result.ok) {
      onApplied({ changeId: result.body.changeId, done: result.body.done === true })
      return
    }
    handleFailure(result.failure, editedIndex)
  }, [user, preview, snapshot, draft, orgId, onApplied, handleFailure])

  /*
   * Open: snapshot the declaration as it stands, and start from the group as
   * it is. A dissolve has nothing to edit, so it asks for its review at once.
   */
  useEffect(() => {
    if (!open) return
    session.current += 1
    setAlert(null)
    setBusy(null)
    setStep(mode === 'dissolve' ? 'review' : 'edit')
    load(expectedConsentGroups(orgRef.current))
    setAutoPreview(mode === 'dissolve')
  }, [open, mode, groupId, load])
  useEffect(() => {
    if (!open || !autoPreview) return
    setAutoPreview(false)
    void requestPreview()
  }, [open, autoPreview, requestPreview])

  const review = useMemo(
    () =>
      step === 'review'
        ? describeConsentGroupReview({
            change,
            preview,
            siteName,
            awaitsConfirmation: consentGroupsAwaitConfirmation(org),
          })
        : null,
    [step, change, preview, siteName, org],
  )

  const nameError = issues.name ?? (touched ? localErrors.name : undefined)
  const sitesError =
    issues.sites ??
    (touched && change.kind !== 'dissolve' ? localErrors.sites : undefined)
  const disclosure = draftDisclosure(name, hostIds)
  const dissolving = change.kind === 'dissolve'
  const canReview =
    !busy &&
    groupExists &&
    !change.empty &&
    (dissolving || (!localErrors.name && !localErrors.sites))

  const close = () => {
    if (busy === 'apply') return
    session.current += 1
    onClose()
  }

  const title =
    step === 'review' && review
      ? review.title
      : mode === 'create'
        ? 'New consent group'
        : `Edit “${snapshot.groups.find((group) => group.id === groupId)?.name ?? name}”`

  return (
    <Dialog open={open} onClose={close} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {alert ? <Alert severity={alert.severity}>{alert.message}</Alert> : null}
          {issues.general.map((message) => (
            <Alert key={message} severity="error">
              {message}
            </Alert>
          ))}
          {step === 'edit' ? (
            <>
              <TextField
                label="Name"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setIssues((current) => ({ ...current, name: undefined }))
                }}
                onBlur={() => setTouched(true)}
                error={Boolean(nameError)}
                helperText={
                  nameError ??
                  'Signup forms on these sites show it, so use the name people know you by.'
                }
                slotProps={{ htmlInput: { maxLength: CONSENT_GROUP_NAME_MAX + 20 } }}
                autoFocus={mode === 'create'}
                required
                fullWidth
              />
              <Box>
                <Typography variant="subtitle2">{'What signup forms will say'}</Typography>
                <Typography
                  variant="body2"
                  color={disclosure ? 'text.primary' : 'text.secondary'}
                  data-testid="consent-group-disclosure"
                >
                  {disclosure ?? 'Choose a name and at least two sites to see it.'}
                </Typography>
              </Box>
              <ConsentGroupSitePicker
                sites={sites}
                groups={snapshot.groups}
                groupId={mode === 'create' ? null : groupId}
                selected={hostIds}
                onChange={(next) => {
                  setHostIds(next)
                  setTouched(true)
                  setIssues((current) => ({
                    ...current,
                    sites: undefined,
                    hostIds: new Set(),
                  }))
                }}
                error={sitesError}
                refusedHostIds={issues.hostIds}
              />
              {dissolving && change.kind === 'dissolve' && change.tooFewSites ? (
                <Alert severity="warning">
                  {`A consent group needs at least two sites. ${
                    change.unselected.length
                      ? `Removing ${joinNames(change.unselected.map(siteName))} dissolves ${change.name}.`
                      : `This dissolves ${change.name}.`
                  } Review it to see what that changes.`}
                </Alert>
              ) : null}
            </>
          ) : (
            <>
              {busy === 'preview' ? (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <CircularProgress size={16} />
                  <Typography variant="body2" color="text.secondary">
                    {'Counting what this changes — nothing is written yet…'}
                  </Typography>
                </Stack>
              ) : null}
              {review && preview
                ? review.sections.map((section) => (
                    <Box key={section.id} component="section">
                      {section.heading ? (
                        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                          {section.heading}
                        </Typography>
                      ) : null}
                      <Stack spacing={0.75}>
                        {section.items.map((item) =>
                          item.tone === 'warning' ? (
                            <Alert key={item.id} severity="warning" sx={{ py: 0 }}>
                              {item.text}
                            </Alert>
                          ) : (
                            <Typography key={item.id} variant="body2">
                              {item.text}
                            </Typography>
                          ),
                        )}
                      </Stack>
                    </Box>
                  ))
                : null}
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        {step === 'review' && mode !== 'dissolve' ? (
          <Button
            onClick={() => {
              setStep('edit')
              setAlert(null)
            }}
            disabled={Boolean(busy)}
          >
            {'Back'}
          </Button>
        ) : (
          <Button onClick={close} disabled={busy === 'apply'}>
            {'Cancel'}
          </Button>
        )}
        {step === 'edit' ? (
          <Button
            variant="contained"
            onClick={() => {
              setTouched(true)
              if (canReview) void requestPreview()
            }}
            disabled={!canReview}
          >
            {dissolving ? 'Review dissolving' : 'Review'}
          </Button>
        ) : (
          <Button
            variant="contained"
            color={dissolving ? 'error' : 'primary'}
            onClick={() => void apply()}
            disabled={!preview || Boolean(busy) || !groupExists}
            startIcon={busy === 'apply' ? <CircularProgress size={16} /> : undefined}
          >
            {review?.confirmLabel ?? 'Apply'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}
ConsentGroupDialog.displayName = 'ConsentGroupDialog'

export default ConsentGroupDialog
