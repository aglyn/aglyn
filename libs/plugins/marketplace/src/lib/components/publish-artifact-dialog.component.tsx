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
  isBelowMarketplacePriceFloor,
  marketplacePriceCostNote,
  marketplacePriceFloorHint,
} from '../model/listing-price-floor'
import type {
  ConsoleArtifactPublishZoneProps,
  ConsolePublishableArtifact,
} from '@aglyn/aglyn'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { PrerequisiteNotice } from '@aglyn/shared-ui-jsx/components/prerequisite-notice.component'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useStarterPublishFacts,
  type StarterPublishFactsState,
} from '../hooks/use-starter-publish-facts'
import {
  starterPublishBody,
  starterPublishSteps,
  starterRefusalLink,
  type StarterThemeChoice,
} from '../model/starter-publish'
import {
  PublisherAgreementCheckbox,
  usePublisherAgreementConsent,
} from './publisher-agreement-checkbox.component'
import { PublishStarterFields } from './publish-starter-fields.component'

/** One kind's publish route, and the words a person reads about it. */
interface PublishRequest {
  /** Plugin API path, e.g. `marketplace/publish-layout`. */
  endpoint: string
  /** Extra body fields identifying what is being published. */
  payload: Record<string, unknown>
  /** Noun used in copy: "layout", "component", … */
  noun: string
  categoryPlaceholder?: string
  /** The category field's label, where the kind names it otherwise. */
  categoryLabel?: string
}

/**
 * WHERE EACH KIND GOES, which is the knowledge that used to sit in the app
 * (AGL-3080).
 *
 * A console page hands over what it has — a kind, the scope holding it, the
 * document — and this is the only place that turns it into a request. The
 * pages that offer publishing named the endpoint, the payload key and the
 * noun themselves, which made them files that could not compile without a
 * marketplace and could not be right without being kept in step with one.
 *
 * ⚠️ A KIND THIS DOES NOT KNOW IS SAID OUT LOUD, not drawn as nothing. It
 * means a console offering to publish something this marketplace does not
 * sell — the two lists have gone out of step — and the person has already
 * clicked. Drawing nothing would make the control look broken with no way to
 * tell what happened, and guessing an endpoint from the kind would post to a
 * route that does not exist and report the 404 to the publisher.
 *
 * The control itself is a separate matter: a page only offers the publish
 * when this zone has a widget at all, so a workspace with no marketplace
 * never gets here.
 */
function publishRequestFor(
  artifact: ConsolePublishableArtifact,
): PublishRequest | null {
  const hostId = artifact.hostId ?? ''
  const orgId = artifact.orgId ?? ''
  const artifactId = artifact.artifactId ?? ''
  switch (artifact.kind) {
    case 'layout':
      return {
        endpoint: 'marketplace/publish-layout',
        payload: { hostId, layoutId: artifactId },
        noun: 'layout',
        categoryPlaceholder: 'e.g. Marketing, Docs, Storefront',
      }
    case 'component':
      return {
        endpoint: 'marketplace/publish',
        payload: { hostId, componentId: artifactId },
        noun: 'component',
        categoryPlaceholder: 'e.g. Hero, Footer, Pricing',
      }
    case 'site':
      return {
        endpoint: 'marketplace/publish-template',
        payload: { hostId },
        noun: 'site template',
        categoryPlaceholder: 'e.g. Portfolio, Restaurant',
      }
    case 'theme':
      return {
        endpoint: 'marketplace/publish-theme',
        payload: { hostId },
        noun: 'theme',
      }
    // Datasets are org-scoped, so this route takes orgId rather than hostId.
    case 'datasetSchema':
      return {
        endpoint: 'marketplace/publish-dataset-schema',
        payload: { orgId, datasetId: artifactId },
        noun: 'dataset schema',
      }
    case 'emailTemplate':
      return {
        endpoint: 'marketplace/publish-email-template',
        payload: { hostId, templateKey: artifactId },
        noun: 'email template',
      }
    case 'emailStarter':
      return {
        endpoint: 'marketplace/publish-email-starter',
        payload: { hostId, screenId: artifactId },
        noun: 'email starter',
      }
    // A whole site, as a site starter people create a new site from (AGL-4049).
    case 'siteStarter':
      return {
        endpoint: 'marketplace/publish-starter',
        payload: { hostId },
        noun: 'starter',
        categoryLabel: 'What kind of site is it?',
        categoryPlaceholder: 'e.g. Bakery, Law firm, Wedding',
      }
    default:
      return null
  }
}

/**
 * Publish an artifact to the marketplace (AGL-672, moved out of the console
 * app by AGL-3080).
 *
 * The publish form is identical across artifact types — name, description,
 * category, price — and only the endpoint and identifying fields differ, so
 * this takes both rather than being copied per type. Every gate that
 * matters (plan, publisher profile, payouts, host role) lives on the server;
 * this surfaces the server's message rather than trying to predict it.
 *
 * Drawn through the `hostArtifactPublish` zone, so the page that offers the
 * publish keeps the control that opens it and never imports this. A page
 * with no widget on that zone leaves the offer out entirely, which is why
 * this may safely draw nothing for a kind it does not sell.
 */
export function PublishArtifactDialog(props: ConsoleArtifactPublishZoneProps) {
  return props.artifact?.kind === 'siteStarter' ? (
    <PublishStarterDialog {...props} />
  ) : (
    <PublishArtifactForm {...props} starterReads={null} />
  )
}

PublishArtifactDialog.displayName = 'PublishArtifactDialog'

/**
 * The form for a site starter (AGL-4049), with what it reads before the
 * click: the site's theme and pages, the org's publisher profile and plan.
 * Its own component so no other kind ever issues those reads.
 */
function PublishStarterDialog(props: ConsoleArtifactPublishZoneProps) {
  const reads = useStarterPublishFacts({
    hostId: props.artifact?.hostId,
    orgId: props.artifact?.orgId,
  })
  return <PublishArtifactForm {...props} starterReads={reads} />
}

/** The listing form every kind shares, with a starter's half when it has one. */
function PublishArtifactForm({
  artifact,
  onClose,
  starterReads,
}: ConsoleArtifactPublishZoneProps & {
  /** A site starter's reads, or `null` for every other kind. */
  starterReads: StarterPublishFactsState | null
}) {
  // Memoized because it is a dependency of the publish callback: rebuilt
  // every render, it would rebuild that callback every render too.
  const target = useMemo(
    () => (artifact ? publishRequestFor(artifact) : null),
    [artifact],
  )
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [price, setPrice] = useState('')
  const [busy, setBusy] = useState(false)
  // The publisher agreement, agreed to on this publish (AGL-4105): the box
  // above the button, unticked for every artifact the dialog opens on.
  const agreement = usePublisherAgreementConsent()
  const { reset: resetAgreement } = agreement

  /*
   * A SITE STARTER'S OWN HALF (AGL-4049). Its theme shape is the
   * publisher's choice and starts unchosen; what it captures and every setup
   * step in its way are read before the click, so they are said with where
   * each is fixed rather than refused after it. For any other kind the facts
   * hook is handed no site and reads nothing.
   */
  const starter = !!starterReads && !!target
  const [themeChoice, setThemeChoice] = useState<StarterThemeChoice | null>(null)
  const [styleKind, setStyleKind] = useState('')
  // What the door last refused, in its words, shown in the form to fix it.
  const [refusal, setRefusal] = useState<{
    status: number
    error: string
    more: string[]
  } | null>(null)
  const starterFacts = starterReads
    ? { ...starterReads.facts, priceUsd: Number(price) || 0 }
    : null
  const steps = starter && starterFacts ? starterPublishSteps(starterFacts) : []
  const starterBody =
    starter && starterReads
      ? starterPublishBody({
          choice: themeChoice,
          builtin: starterReads.builtin,
          kind: styleKind || null,
        })
      : null
  const agreementRefused = refusal && (refusal.status === 428 || refusal.status === 409)

  useEffect(() => {
    if (!artifact) return
    setName(artifact.displayName ?? '')
    setDescription(artifact.description ?? '')
    setCategory('')
    setPrice('')
    setThemeChoice(null)
    setStyleKind('')
    setRefusal(null)
    resetAgreement()
  }, [artifact, resetAgreement])

  const handlePublish = useCallback(async () => {
    if (!target || !name.trim() || busy || !agreement.consent) return
    if (starter && (!starterBody || steps.length)) return
    setBusy(true)
    setRefusal(null)
    try {
      const response = await authorizedFetch(user, `/api/${target.endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...target.payload,
          displayName: name.trim(),
          description: description.trim(),
          category: category.trim(),
          priceUsd: Number(price) || 0,
          agreement: agreement.consent,
          ...starterBody,
        }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok && starter) {
        // In the form, in the door's words, so the publisher can fix it
        // there: another theme, a page, a setup step. Every problem a
        // theme check names is listed, not only the first.
        const error = typeof payload?.error === 'string' && payload.error ? payload.error : 'Publish failed'
        const more = Array.isArray(payload?.errors)
          ? payload.errors
              .map((entry: { message?: unknown }) => entry?.message)
              .filter((message: unknown): message is string => typeof message === 'string' && message !== error)
          : []
        setRefusal({ status: response.status, error, more })
        // An agreement refused is asked for again, by a fresh tick.
        if (response.status === 428 || response.status === 409) resetAgreement()
        return
      }
      if (!response.ok) {
        // 412 means a setup step is missing (publisher profile, payouts) —
        // actionable, so it reads as a warning rather than an error.
        return void enqueueSnackbar(payload?.error ?? 'Publish failed', {
          variant: response.status === 412 ? 'warning' : 'error',
          allowDuplicate: true,
        })
      }
      enqueueSnackbar(
        starter
          ? Number(payload.version) > 1
            ? `Published v${payload.version} of your starter`
            : 'Sent your starter for review. It is listed once it has been reviewed.'
          : `Published v${payload.version} to the marketplace`,
        { variant: 'success', persist: false },
      )
      // Each publish is its own agreement: the next one ticks the box again.
      resetAgreement()
      onClose()
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [
    target,
    name,
    description,
    category,
    price,
    busy,
    user,
    enqueueSnackbar,
    onClose,
    agreement.consent,
    resetAgreement,
    starter,
    starterBody,
    steps.length,
  ])

  if (artifact && !target) {
    return (
      <Dialog open onClose={onClose} maxWidth="xs" fullWidth>
        <DialogTitle>{'Nothing publishes this'}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            {`This marketplace does not publish a ${artifact.kind}, so there ` +
              'is nowhere to send it. Nothing was changed.'}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={onClose}>
            {'Close'}
          </Button>
        </DialogActions>
      </Dialog>
    )
  }

  return (
    <>
      <Dialog
        open={!!target}
        onClose={busy ? undefined : onClose}
        maxWidth={starter ? 'sm' : 'xs'}
        fullWidth
      >
        <DialogTitle>
          {starter ? 'Publish as a starter' : `Publish ${target?.noun ?? 'artifact'}`}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <Typography variant="body2" color="text.secondary">
              {starter
                ? 'Publishes this site as a site starter: a ready-made website ' +
                  'people create a new site from. A new starter is reviewed ' +
                  'before anyone else can see it. Your site is unaffected.'
                : `Publishes the current published version of this ` +
                  `${target?.noun ?? 'artifact'} so other organizations can ` +
                  'install it. Your site is unaffected.'}
            </Typography>
            <TextField
              autoFocus
              size="small"
              label="Listing name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
              fullWidth
            />
            <TextField
              size="small"
              label="Description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={busy}
              multiline
              minRows={2}
              fullWidth
            />
            <TextField
              size="small"
              label={target?.categoryLabel ?? 'Category'}
              placeholder={
                target?.categoryPlaceholder ?? 'e.g. Marketing, Docs'
              }
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              disabled={busy}
              fullWidth
            />
            <TextField
              size="small"
              label="Price (USD)"
              placeholder="0 = free"
              // The minimum price (AGL-2343). Marketplace checkout is a
              // destination charge, so Stripe's fee comes out of the PLATFORM's
              // balance while the seller is transferred a fixed share — at $1 the
              // fee is larger than the whole platform cut. The publish route
              // refuses anything under the floor, so the field says so before the
              // publisher gets there and the button holds.
              error={isBelowMarketplacePriceFloor(price)}
              helperText={
                marketplacePriceCostNote(price) ??
                marketplacePriceFloorHint(
                  'Paid listings need payouts set up on your marketplace profile.',
                )
              }
              value={price}
              onChange={(event) =>
                setPrice(event.target.value.replace(/[^0-9]/g, ''))
              }
              disabled={busy}
              fullWidth
            />
            {starter && starterReads ? (
              <PublishStarterFields
                builtin={starterReads.builtin}
                hostReady={starterReads.hostReady}
                pages={starterReads.facts.pages}
                steps={steps}
                choice={themeChoice}
                onChoiceChange={setThemeChoice}
                styleKind={styleKind}
                onStyleKindChange={setStyleKind}
                disabled={busy}
              />
            ) : null}
            {refusal && !agreementRefused ? (
              refusal.status === 412 && starterFacts ? (
                <PrerequisiteNotice
                  severity="warning"
                  href={starterRefusalLink(starterFacts).href ?? undefined}
                  actionLabel={starterRefusalLink(starterFacts).actionLabel}
                >
                  {refusal.error}
                </PrerequisiteNotice>
              ) : (
                <Alert severity="error" data-starter-publish="refusal">
                  {refusal.error}
                  {refusal.more.length ? (
                    <Stack component="ul" spacing={0.5} sx={{ m: 0, mt: 1, pl: 2.5 }}>
                      {refusal.more.map((message) => (
                        <Typography key={message} component="li" variant="body2">
                          {message}
                        </Typography>
                      ))}
                    </Stack>
                  ) : null}
                </Alert>
              )
            ) : null}
            {/* Directly above Publish (AGL-4105), which waits for it. */}
            <PublisherAgreementCheckbox
              checked={agreement.agreed}
              onChange={agreement.setAgreed}
              disabled={busy}
              error={agreementRefused ? refusal.error : null}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={onClose} disabled={busy}>
            {'Cancel'}
          </Button>
          <BlockedControl blocked={steps.length > 0} reason={steps[0]?.text ?? ''}>
            <Button
              size="small"
              variant="contained"
              color="primary"
              disabled={
                busy ||
                !name.trim() ||
                isBelowMarketplacePriceFloor(price) ||
                !agreement.agreed ||
                (starter && !starterBody)
              }
              onClick={() => void handlePublish()}
            >
              {busy ? 'Publishing…' : 'Publish'}
            </Button>
          </BlockedControl>
        </DialogActions>
      </Dialog>
    </>
  )
}

PublishArtifactForm.displayName = 'PublishArtifactForm'

export default PublishArtifactDialog
