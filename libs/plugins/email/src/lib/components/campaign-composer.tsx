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

import { buildRoute, checkQuota, Route } from '@aglyn/aglyn'
import { CAMPAIGN_MERGE_TAGS } from '../model'
import CampaignTopicSelect from './campaign-topic-select'
import { useConfirmationContext } from '@aglyn/shared-ui-jsx'
import QuotaReadoutComponent from '@aglyn/shared-ui-jsx/components/quota-readout.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Box,
  Button,
  Chip,
  Divider,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { collection, doc, limit, query } from 'firebase/firestore'
import { createEmailScreen } from '../utils/create-email-screen'
import { useCampaignSendApi } from './use-campaign-send-api'
import { useSendingApi } from './use-sending-identity-api'
import { describeCallFailure } from '@aglyn/shared-util-http/authorized-token'
import CampaignTestSendDrawer from './campaign-test-send-drawer'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  useConsoleHostRoute,
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  useOrgDataScope,
  useHostOrgId,
  useOrgPlan,
  useHostResourceApi,
  useHostVersionApi,
} from '@aglyn/tenant-feature-instance'

// The besigner route is `/[orgSlug]/hosts/[host]/screens/[screenId]/
// versions/[versionId]/besigner`. Takes the resolved org slug + subdomain,
// not a host doc id.
const besignerHref = (
  orgSlug: string,
  host: string,
  screenId: string,
  versionId: string,
) => buildRoute(Route.SCREEN_BESIGNER, { orgSlug, host, screenId, versionId })

/**
 * How long the composer waits after a keystroke before asking the server to
 * re-render the message.
 *
 * Longer than the audience debounce below because it fires on typing rather
 * than on a picker: a merchant writing a paragraph would otherwise issue a
 * render for every pause in it.
 */
const RENDER_DEBOUNCE_MS = 600

/** How long the audience picker settles before the count is re-resolved. */
const COUNT_DEBOUNCE_MS = 400

/** The counts a dry run of the send path reports. */
interface AudiencePreview {
  sendable: number
  suppressed: number
  /** The whole audience, before the per-send cap. */
  audienceSize: number
  /** `audienceSize` is a floor — the resolution hit its read ceiling. */
  audienceTruncated: boolean
  /** Of `audienceSize`, how many carry a recorded consent basis. */
  consented: number
  /** Of `audienceSize`, how many are reachable only by grandfathering. */
  grandfathered: number
  /** Of `audienceSize`, how many the consent rule refuses. */
  consentWithheld: number
  /**
   * Of `recipients`, how many asked this site for mail less often than this
   * send would arrive. They are still subscribed and the next campaign
   * outside their interval reaches them.
   */
  cadenceHeld: number
  /** Which address this send would leave on, in the server's own words. */
  identity: string
  identitySource: 'custom' | 'shared' | 'platform' | null
}

/** The message itself, rendered by the send path's own renderer. */
interface RenderedPreview {
  subject: string
  html: string
  text: string
}

const plural = (count: number, noun: string): string =>
  `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`

export interface CampaignComposerProps {
  hostId: string
  /**
   * The campaign this send joins. Every send composed here carries it, so the
   * campaign's rollup covers the send without anything re-scanning.
   */
  emailCampaignId?: string
  /** The campaign's lists — the audience picker opens on the first of them. */
  campaignListIds?: string[]
  /**
   * The campaign's topic, which its emails open on.
   *
   * A default and not a constraint: the topic is a property of the MESSAGE —
   * it decides who this send skips, what the preference page highlights, and
   * which stream a resulting opt-out is recorded against — and one campaign
   * may legitimately carry a newsletter and a promotion.
   */
  campaignTopicId?: string
  /**
   * What the merchant called this email when they created it, for the record
   * rather than for the recipient.
   *
   * Collected by the create drawer on the Emails list, which asks for a name
   * the way every other create in the console does. It is NOT the subject: an
   * email's subject is written for the person opening it and gets edited
   * until the moment it sends, and a merchant looking for "the one with the
   * discount code" months later has nothing else to look for.
   */
  displayName?: string
  /**
   * The email record this composer is writing, when it is editing one.
   *
   * Present on an email's own page and absent nowhere else that matters: it
   * is what makes Save, Schedule and Send land on the record the reader
   * already has open rather than minting a second one. The id is the email's
   * identity for its whole life — `performCampaignSend` adopts it, so the URL
   * a merchant has open is the URL the sent email keeps, and the `cid=`
   * inside every unsubscribe link it later mints names this same document.
   */
  campaignId?: string
  /**
   * What the record already holds, for a composer opened on an existing
   * email.
   *
   * Passed down rather than read here: the email's page has the document
   * open already, and a second listen on it would be a second read of the
   * same thing on every mount of this component.
   */
  initial?: {
    subject?: string
    body?: string
    fromName?: string
    replyTo?: string
    preheader?: string
    audience?: string
    listId?: string
    segmentId?: string
    topicId?: string
    templateScreenId?: string
    sendAtMs?: number
    /** `platform`, or absent for the site's standing selection. */
    sendingIdentity?: string
  }
  /** Called once a send or a schedule lands. */
  onSent?: () => void
}

/**
 * COMPOSE AND SEND ONE EMAIL.
 *
 * Everything a merchant decides about a single message: who it goes to, what
 * it says, who it appears to come from, what it will look like, and — before
 * the button that cannot be taken back — how many people it reaches and how
 * many it does not.
 */
export function CampaignComposer(props: CampaignComposerProps) {
  const {
    hostId,
    emailCampaignId,
    campaignListIds,
    campaignTopicId,
    displayName,
    campaignId,
    initial,
    onSent,
  } = props
  const { orgSlug, subdomain } = useConsoleHostRoute(hostId)
  // Org-shared data root. Null until the org lookup settles, and for a host
  // with no owning org — so the audience picker offers the built-ins alone
  // rather than segments and lists from a dead path.
  const { scope: dataScope } = useOrgDataScope({ hostId })
  const firestore = useFirestore()
  const createHostResource = useHostResourceApi()
  const createHostVersion = useHostVersionApi()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const router = useRouter()

  // Contact segments join the built-in audiences.
  const { data: segmentDocs } = useFirestoreCollection<any>(
    () =>
      dataScope
        ? query(
            collection(
              firestore,
              dataScope[0],
              dataScope[1],
              'contactSegments',
            ),
            limit(50),
          )
        : null,
    [firestore, dataScope],
    { idField: '$id' },
  )
  const segments = [...(segmentDocs ?? [])].sort((a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )
  // Org email lists join the audiences.
  const { data: listDocs } = useFirestoreCollection<any>(
    () =>
      dataScope
        ? query(
            collection(firestore, dataScope[0], dataScope[1], 'lists'),
            limit(50),
          )
        : null,
    [firestore, dataScope],
    { idField: '$id' },
  )
  const lists = [...(listDocs ?? [])].sort((a, b) =>
    String(a.name ?? '').localeCompare(String(b.name ?? '')),
  )

  /**
   * The monthly campaign allowance, standing rather than only on refusal.
   *
   * READ THE ENFORCEABLE METER, NOT THE COST ONE. `emailSends` beside it
   * counts every receipt, booking reminder and password reset the site sent;
   * showing that total against this cap would tell a merchant they had spent
   * their campaign allowance on order confirmations.
   *
   * PER ORG, because that is where the cap is enforced.
   * `emailSendsPerMonth` is an ORG entitlement and `reserveCampaignEmailSends`
   * claims against `orgs/{orgId}/counters/campaignEmailSends[YYYY-MM]`. A
   * readout and its gate must read the same counter — the number a merchant
   * checks before pressing Send is the worst possible place for a second
   * opinion.
   */
  const { org, ready: orgReady } = useOrgPlan(hostId)
  const campaignOrgId = useHostOrgId(hostId)
  const campaignMonthKey = new Date().toISOString().slice(0, 7)
  const { data: campaignSendCounter } = useFirestoreDoc<
    Record<string, unknown>
  >(
    () =>
      campaignOrgId
        ? doc(firestore, 'orgs', campaignOrgId, 'counters', 'campaignEmailSends')
        : null,
    [firestore, campaignOrgId],
  )
  // An org that has never sent a campaign has no counter document at all;
  // that is a settled zero, and the same zero `orgCampaignEmailSendsForMonth`
  // resolves it to on the server.
  const campaignSendsUsed = Number(
    campaignSendCounter?.[campaignMonthKey] ?? 0,
  )

  // Email A/B experiments: running (or winner-decided) email experiments the
  // composer can attach.
  const { data: experimentDocs } = useFirestoreCollection<any>(
    () =>
      query(collection(firestore, 'hosts', hostId, 'experiments'), limit(50)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const emailExperiments = [...(experimentDocs ?? [])]
    .filter(
      (experiment: any) =>
        !experiment.deletedAt &&
        experiment.target === 'email' &&
        (experiment.status === 'running' || experiment.winnerVariantId),
    )
    .sort((a: any, b: any) =>
      String(a.name ?? '').localeCompare(String(b.name ?? '')),
    )

  // Designed emails: besigner email documents are screens with kind 'email';
  // campaigns reference them by screen id.
  const { data: screenDocs } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'screens'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )
  const emailScreens = [...(screenDocs ?? [])]
    .filter((screen: any) => !screen.deletedAt && screen.kind === 'email')
    .sort((a: any, b: any) =>
      String(a.displayName ?? '').localeCompare(String(b.displayName ?? '')),
    )

  /*
   * The stored audience, back in the picker's own `kind:id` form.
   *
   * The record keeps the kind and the id in two fields because that is what
   * the send path reads; the picker is one control, so the two are rejoined
   * here. A composer opened on an existing email that defaulted to Leads
   * would be one save away from silently re-aiming it.
   */
  const storedAudience = initial?.audience
    ? initial.audience === 'list' && initial.listId
      ? `list:${initial.listId}`
      : initial.audience === 'segment' && initial.segmentId
        ? `segment:${initial.segmentId}`
        : initial.audience
    : ''

  const [subject, setSubject] = useState(initial?.subject ?? '')
  const [body, setBody] = useState(initial?.body ?? '')
  const [fromName, setFromName] = useState(initial?.fromName ?? '')
  const [replyTo, setReplyTo] = useState(initial?.replyTo ?? '')
  const [preheader, setPreheader] = useState(initial?.preheader ?? '')
  /**
   * WHICH OF THIS SITE'S IDENTITIES THIS EMAIL LEAVES ON.
   *
   * Two values and no more — empty for the site's standing selection, and
   * `platform` for the shared Aglyn domain. It is deliberately not a domain
   * name: which custom domain a site may use is an org-admin decision stored
   * on the host, and a composer that could name one would be a way for a site
   * editor to send as a domain their site was never given.
   */
  const [sendingIdentity, setSendingIdentity] = useState(
    initial?.sendingIdentity ?? '',
  )
  /*
   * The campaign's own list is where the composer opens, because a send
   * composed inside a campaign aimed at a list is overwhelmingly a send to
   * that list — and an audience picker that defaults to Leads inside such a
   * campaign is one wrong keystroke away from mailing the wrong people.
   */
  const [audience, setAudience] = useState<string>(
    storedAudience || (campaignListIds?.[0] ? `list:${campaignListIds[0]}` : 'leads'),
  )
  const [experimentId, setExperimentId] = useState('')
  /*
   * WHICH STREAM this email belongs to.
   *
   * Empty until the picker settles it against the org's catalog, and sent on
   * every request that resolves an audience — the count as much as the send.
   * `filterTopicSendable` removes the people who have left this stream, so a
   * preview taken without the topic reports a reach the send will not deliver,
   * and a send taken without it records `marketing` for a sales campaign,
   * which is the opt-out a recipient already exercised being ignored.
   */
  const [topicId, setTopicId] = useState(
    initial?.topicId ?? campaignTopicId ?? '',
  )
  const [templateScreenId, setTemplateScreenId] = useState(
    initial?.templateScreenId ?? '',
  )
  // Scheduling: a future timestamp turns Send into Schedule.
  const [sendAt, setSendAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const selectedTemplate = emailScreens.find(
    (screen: any) => screen.$id === templateScreenId,
  )

  const handleCreateTemplate = useCallback(async () => {
    try {
      const { screenId, versionId } = await createEmailScreen(
        hostId,
        createHostResource,
        createHostVersion,
      )
      if (orgSlug && subdomain) {
        void router.push(besignerHref(orgSlug, subdomain, screenId, versionId))
      }
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'Creating the email template failed', {
        variant: 'error',
      })
    }
  }, [
    hostId,
    createHostResource,
    createHostVersion,
    orgSlug,
    subdomain,
    router,
    enqueueSnackbar,
  ])

  /*
   * The one authorized caller of the campaign API, shared with the email
   * detail page's "send to more people". It holds the user in a ref for a
   * reason the preview effects below depend on — see the hook.
   */
  const authorizedPost = useCampaignSendApi(hostId)

  /*
   * Proofing is a drawer now, not a button that mails you.
   *
   * "Send test to me" could only ever answer one of the three questions a
   * proof is asked: what does this look like, to somebody with real data, at
   * an address I can actually open. It mailed the caller, rendered against
   * the caller, from whatever identity the site happened to hold — so a
   * merchant checking their merge tags saw the fallbacks every time.
   */
  const [testOpen, setTestOpen] = useState(false)

  /*
   * The audience select's value packs the kind and the id into one string
   * (`list:abc`). Decomposed ONCE here so the preview and the send cannot
   * disagree about what they are asking for — they had two copies of this
   * split, which is how a preview counts a segment while the send resolves
   * a list.
   */
  const audienceKind = audience.startsWith('segment:')
    ? 'segment'
    : audience.startsWith('list:')
      ? 'list'
      : audience
  const segmentId = audience.startsWith('segment:')
    ? audience.slice('segment:'.length)
    : ''
  const listId = audience.startsWith('list:')
    ? audience.slice('list:'.length)
    : ''

  /**
   * HOW MANY PEOPLE, AND ON WHAT BASIS — a dry run of the real send path.
   *
   * It comes from the send path rather than a count of its own, so it has
   * already been through audience resolution, de-duplication, the consent
   * rule, the per-send cap, the suppression list and the monthly quota.
   * Counting the audience here instead would be a second set of rules to
   * drift from the one that decides what actually goes out — on the one
   * number a merchant checks before pressing Send.
   */
  const [preview, setPreview] = useState<
    AudiencePreview | { error: string; blocking?: boolean } | null
  >(null)
  useEffect(() => {
    let active = true
    setPreview(null)
    // Debounced: switching audience with the keyboard walks the whole
    // list, and each stop would otherwise be a full audience resolution.
    const timer = setTimeout(async () => {
      try {
        /*
         * NO SUBJECT AND NO BODY, and that is the point of this request.
         *
         * The count is a fact about the AUDIENCE. Nothing in resolving it
         * reads the copy, so nothing about the copy may gate it — a merchant
         * asks "how many people is this" before writing the email, which is
         * when the answer is worth having. Sending the draft along would also
         * put the composer's whole audience resolution — up to five thousand
         * documents — behind every keystroke, for a number that had not moved.
         * The message itself is previewed by `rendered` below, which resolves
         * nobody.
         */
        const { response, payload } = await authorizedPost({
          action: 'preview',
          audience: audienceKind,
          ...(segmentId ? { segmentId } : {}),
          ...(listId ? { listId } : {}),
          ...(topicId ? { topicId } : {}),
          /*
           * The identity rides the count, which is what puts the refusal in
           * front of the Send button instead of behind it. The dry run
           * resolves the sending identity on exactly the terms a real send
           * does and answers 409 the same way, so an unverified domain is
           * refused here — before any copy is written — rather than after
           * somebody presses Send.
           */
          ...(sendingIdentity ? { sendingIdentity } : {}),
        })
        if (!active) return
        if (!response.ok) {
          // The refusals are useful, not noise: "The audience is empty"
          // and the monthly-cap message are exactly what a merchant needs
          // BEFORE writing the email rather than after.
          //
          // A 409 is the one that must also STOP the send. Every other
          // refusal here is about the audience and can be true while the
          // email is still worth composing; this one says the message has
          // nowhere to leave from, and letting Send stay live would trade a
          // sentence the merchant can act on for the same 409 arriving after
          // the click.
          return setPreview({
            error: String(payload?.error ?? ''),
            blocking: response.status === 409,
          })
        }
        setPreview({
          sendable: Number(payload?.sendable ?? 0),
          suppressed: Number(payload?.suppressed ?? 0),
          audienceSize: Number(payload?.audienceSize ?? 0),
          audienceTruncated: Boolean(payload?.audienceTruncated),
          consented: Number(payload?.consented ?? 0),
          grandfathered: Number(payload?.grandfathered ?? 0),
          consentWithheld: Number(payload?.consentWithheld ?? 0),
          cadenceHeld: Number(payload?.cadenceHeld ?? 0),
          identity: String(payload?.identity ?? ''),
          identitySource: (payload?.identitySource ?? null) as
            | 'custom'
            | 'shared'
            | 'platform'
            | null,
        })
      } catch (error) {
        /*
         * A REFUSAL IS NOT A LOADING STATE.
         *
         * `null` is the value this holds before the first answer, and the
         * readout renders it as "Counting recipients…". A call that failed
         * before it ever reached the route — authorization that could not be
         * obtained — has to read as the refusal it is, or the composer sits
         * on a sentence about work it has stopped doing and the confirm
         * dialog reports an unreadable count without saying why.
         */
        if (active)
          setPreview({
            error: describeCallFailure(error, 'Could not count this audience'),
          })
      }
    }, COUNT_DEBOUNCE_MS)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [authorizedPost, audienceKind, segmentId, listId, topicId, sendingIdentity])

  /**
   * THE IDENTITIES THIS SITE MAY SEND AS, for the picker.
   *
   * One cheap read — the host document and at most one org subcollection
   * document — issued once, and NOT part of the debounced count above: it
   * answers a question about the site rather than about the message, so it
   * cannot move while somebody types.
   *
   * The picker is only offered when there is a choice to make. A site with no
   * verified domain has exactly one identity, and a select with one option is
   * a control that reads as a decision the person failed to take.
   */
  const [identityOptions, setIdentityOptions] = useState<
    { value: string; from: string | null; selectable: boolean }[] | null
  >(null)
  /**
   * The value that means "the site's standing selection" in the picker.
   *
   * The picker's options are keyed by domain (and `platform`), while the SEND
   * carries the two-valued thing — empty or `platform`. This is the join
   * between them, and it is derived from the options rather than stored: the
   * site's own domain is whichever offered option is not the platform one.
   */
  const siteDefaultIdentity =
    identityOptions?.find((one) => one.value !== 'platform')?.value ?? 'platform'
  const sendingApi = useSendingApi()
  useEffect(() => {
    let active = true
    void (async () => {
      const { response, payload } = await sendingApi({
        path: 'sending-identity',
        method: 'GET',
        query: { hostId },
      })
      if (!active || !response.ok) return
      setIdentityOptions(payload?.options ?? [])
    })().catch(() => undefined)
    return () => {
      active = false
    }
  }, [sendingApi, hostId])

  /**
   * WHAT THE EMAIL LOOKS LIKE, rendered by the code that will mail it.
   *
   * Re-rendered as the copy changes and resolving no audience at all, which
   * is why it is a second request rather than a field on the count above.
   * Only while the pane is open: it reads the designed template and its
   * products, and a merchant who never opens the preview should not pay for
   * one on every campaign.
   */
  const [rendered, setRendered] = useState<
    RenderedPreview | { error: string } | null
  >(null)
  useEffect(() => {
    if (!showPreview) return setRendered(null)
    let active = true
    setRendered(null)
    const timer = setTimeout(async () => {
      try {
        const { response, payload } = await authorizedPost({
          action: 'renderPreview',
          subject: subject.trim(),
          body: body.trim(),
          preheader: preheader.trim(),
          ...(templateScreenId ? { templateScreenId } : {}),
        })
        if (!active) return
        if (!response.ok) {
          return setRendered({
            error: String(payload?.error ?? 'Could not render this email'),
          })
        }
        setRendered({
          subject: String(payload?.subject ?? ''),
          html: String(payload?.html ?? ''),
          text: String(payload?.text ?? ''),
        })
      } catch (error) {
        if (active)
          setRendered({
            error: describeCallFailure(error, 'Could not render this email'),
          })
      }
    }, RENDER_DEBOUNCE_MS)
    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [
    authorizedPost,
    showPreview,
    subject,
    body,
    preheader,
    templateScreenId,
  ])

  const audienceLabel =
    audience === 'leads'
      ? 'lead'
      : audience === 'members'
        ? 'site member'
        : audience.startsWith('list:')
          ? 'list subscriber'
          : 'contact in the segment'

  /**
   * WHAT THE CONFIRM DIALOG SAYS, and why it says a number.
   *
   * A dialog for an irreversible bulk action has one job: state the size of
   * what is about to happen. "goes to every list subscriber who hasn't
   * unsubscribed" states a RULE, and a merchant cannot tell from a rule
   * whether they are about to mail forty people or four thousand.
   *
   * Three cases, and the third is the one worth being careful about:
   *
   *  - the audience fits in one send — say how many;
   *  - it does not — say how many of how many, because "every subscriber" is
   *    then simply false and the remainder is never mailed by this send;
   *  - the count could not be read — say THAT, and do not fall back to a
   *    sentence that implies completeness. A confirm dialog that asserts a
   *    reach it does not know is worse than one that admits it.
   */
  const counts = preview && !('error' in preview) ? preview : null
  const confirmDescription = useCallback(
    (scheduling: boolean, sendAtMs: number): string => {
      const quoted = `"${subject.trim()}"`
      const when = scheduling
        ? ` on ${new Date(sendAtMs).toLocaleString()}`
        : ''
      if (!counts) {
        const reason =
          preview && 'error' in preview && preview.error
            ? ` (${preview.error})`
            : ''
        return (
          `${quoted} goes to every ${audienceLabel} who hasn't ` +
          `unsubscribed${when}. The recipient count could not be read${reason}, ` +
          `so this send's size is unknown.`
        )
      }
      const short = counts.audienceSize > counts.sendable
      const reach = short
        ? `${plural(counts.sendable, `${audienceLabel}`)} of ` +
          `${counts.audienceSize.toLocaleString()}${
            counts.audienceTruncated ? ' or more' : ''
          } in this audience`
        : plural(counts.sendable, audienceLabel)
      const withheld: string[] = []
      if (counts.consentWithheld) {
        withheld.push(
          `${counts.consentWithheld.toLocaleString()} withheld — no marketing ` +
            `consent on record`,
        )
      }
      if (counts.suppressed) {
        withheld.push(
          `${counts.suppressed.toLocaleString()} unsubscribed or suppressed`,
        )
      }
      /*
       * Named separately from `suppressed`, because the two ask different
       * things of a merchant. An address that unsubscribed is gone; one
       * holding for its own cadence arrives at the next campaign outside its
       * interval, and reading that as an unsubscribe would send somebody
       * looking for a broken audience that is not broken.
       */
      if (counts.cadenceHeld) {
        withheld.push(
          `${counts.cadenceHeld.toLocaleString()} asked for mail less often ` +
            `than this`,
        )
      }
      if (counts.grandfathered) {
        withheld.push(
          `${counts.grandfathered.toLocaleString()} reachable only because ` +
            `consent is not enforced retroactively`,
        )
      }
      return (
        `${quoted} goes to ${reach}${when}.` +
        (withheld.length ? ` Not counted: ${withheld.join('; ')}.` : '')
      )
    },
    [counts, preview, subject, audienceLabel],
  )

  const handleSend = useCallback(async () => {
    if (!subject.trim() || (!templateScreenId && !body.trim()) || busy) return
    const sendAtMs = sendAt ? new Date(sendAt).getTime() : 0
    const scheduling = Boolean(sendAtMs)
    if (scheduling && sendAtMs <= Date.now()) {
      return void enqueueSnackbar('Pick a future send time', {
        variant: 'warning',
        persist: false,
      })
    }
    const confirmed = await confirm({
      title: scheduling ? 'Schedule this campaign?' : 'Send this campaign?',
      description: confirmDescription(scheduling, sendAtMs),
      confirmationText: scheduling ? 'Schedule' : 'Send',
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    setBusy(true)
    try {
      const { response, payload } = await authorizedPost({
        ...(scheduling ? { action: 'schedule', sendAtMs } : {}),
        /*
         * The record this composer is editing, when it is editing one. The
         * send path adopts the id rather than minting a new one, so sending a
         * draft turns THAT document into the sent email — the page the
         * merchant is looking at stays the page the email lives at, and the
         * `cid=` in its unsubscribe links names it.
         */
        ...(campaignId ? { campaignId } : {}),
        subject: subject.trim(),
        body: body.trim(),
        audience: audienceKind,
        ...(segmentId ? { segmentId } : {}),
        ...(listId ? { listId } : {}),
        ...(experimentId ? { experimentId } : {}),
        ...(templateScreenId ? { templateScreenId } : {}),
        ...(emailCampaignId ? { emailCampaignId } : {}),
        ...(displayName ? { displayName } : {}),
        ...(topicId ? { topicId } : {}),
        fromName: fromName.trim(),
        replyTo: replyTo.trim(),
        preheader: preheader.trim(),
      })
      if (response.status === 501) {
        return void enqueueSnackbar(
          'Campaigns are not configured on this deployment',
          { variant: 'info', persist: false },
        )
      }
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Send failed', {
          variant: 'warning',
          allowDuplicate: true,
        })
      }
      enqueueSnackbar(
        scheduling
          ? `Scheduled for ${new Date(sendAtMs).toLocaleString()}`
          : `Sent to ${payload.sent} of ${payload.recipients} recipients`,
        { variant: 'success', persist: false },
      )
      /*
       * Cleared only when this composer mints its own sends.
       *
       * On an email's own page the fields ARE that email, and the record now
       * holds exactly what was just sent — blanking them would show the
       * merchant an empty composer for a message that went out a second ago.
       */
      if (!campaignId) {
        setSubject('')
        setBody('')
        setSendAt('')
        setPreheader('')
      }
      onSent?.()
    } catch (error) {
      /*
       * A CLICK THAT DID NOTHING HAS TO SAY SO.
       *
       * This covers the failures that never reach the route at all — chiefly
       * an ID token that cannot be obtained, which is awaited in front of the
       * request. `describeCallFailure` lets that one name itself, because
       * "nothing was sent, you are signed out" and "the send failed" call for
       * different things from the person reading it.
       */
      console.error(error)
      enqueueSnackbar(describeCallFailure(error, 'An error has occurred'), {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [
    subject,
    body,
    audienceKind,
    segmentId,
    listId,
    experimentId,
    templateScreenId,
    emailCampaignId,
    topicId,
    fromName,
    replyTo,
    preheader,
    sendAt,
    busy,
    campaignId,
    displayName,
    authorizedPost,
    confirm,
    confirmDescription,
    enqueueSnackbar,
    onSent,
  ])

  /*==========================================
   * SAVING WITHOUT SENDING.
   *
   * The draft is the working document, and it has to be savable on its own —
   * a composer whose only way out is Send is a composer that makes a merchant
   * choose between mailing something half-written and losing it.
   *
   * Only offered when this composer is editing a record. Without a
   * `campaignId` there is nothing to save INTO, and minting a draft from a
   * surface that did not ask for one would leave unsent records behind every
   * time somebody opened a composer and changed their mind.
   *=========================================*/
  const [saving, setSaving] = useState(false)
  const handleSaveDraft = useCallback(async () => {
    if (!campaignId || saving) return
    setSaving(true)
    try {
      const { response, payload } = await authorizedPost({
        action: 'draft',
        campaignId,
        subject: subject.trim(),
        body: body.trim(),
        audience: audienceKind,
        ...(segmentId ? { segmentId } : {}),
        ...(listId ? { listId } : {}),
        ...(experimentId ? { experimentId } : {}),
        ...(templateScreenId ? { templateScreenId } : {}),
        ...(emailCampaignId ? { emailCampaignId } : {}),
        ...(displayName ? { displayName } : {}),
        ...(topicId ? { topicId } : {}),
        fromName: fromName.trim(),
        replyTo: replyTo.trim(),
        preheader: preheader.trim(),
      })
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'Draft not saved', {
          variant: 'warning',
          allowDuplicate: true,
        })
      }
      enqueueSnackbar('Draft saved', { variant: 'success', persist: false })
    } catch (error) {
      console.error(error)
      enqueueSnackbar(describeCallFailure(error, 'Draft not saved'), {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setSaving(false)
    }
  }, [
    campaignId,
    saving,
    authorizedPost,
    subject,
    body,
    audienceKind,
    segmentId,
    listId,
    experimentId,
    templateScreenId,
    emailCampaignId,
    displayName,
    topicId,
    fromName,
    replyTo,
    preheader,
    enqueueSnackbar,
  ])

  const quotaLimit = useMemo(
    () =>
      checkQuota(org as never, 'emailSendsPerMonth', campaignSendsUsed).limit,
    [org, campaignSendsUsed],
  )

  return (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        {'Send an update to your leads or site members. Every email ' +
          'carries an unsubscribe link; monthly sends are capped by ' +
          'your plan.'}
      </Typography>
      <Stack direction="row" spacing={1}>
        <TextField
          label="Subject"
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          size="small"
          sx={{ flex: 1 }}
        />
        <TextField
          select
          label="Audience"
          value={audience}
          onChange={(event) => setAudience(event.target.value as any)}
          size="small"
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="leads">{'Leads'}</MenuItem>
          <MenuItem value="members">{'Site members'}</MenuItem>
          {segments.map((segment: any) => (
            <MenuItem key={segment.$id} value={`segment:${segment.$id}`}>
              {`Segment: ${segment.name}`}
            </MenuItem>
          ))}
          {lists.map((list: any) => (
            <MenuItem key={list.$id} value={`list:${list.$id}`}>
              {`List: ${list.name}`}
            </MenuItem>
          ))}
        </TextField>
      </Stack>
      {/*
        The readout beside the audience picker. It reports what the SEND
        resolved, so an empty audience or a monthly cap is said here — before
        the email is written — instead of after the Send button.

        It reports the AUDIENCE beside the send size whenever the two differ.
        One send carries a bounded number of recipients, and a readout showing
        only that number tells a merchant with a 3,000 person list that their
        audience is 500 — the other 2,500 are never mailed and nothing
        anywhere says so.
       */}
      <Typography variant="caption" color="text.secondary">
        {preview === null
          ? 'Counting recipients…'
          : 'error' in preview
            ? preview.error || 'Could not count this audience'
            : `Recipients ${preview.sendable.toLocaleString()}` +
              (preview.audienceSize > preview.sendable
                ? ` of ${preview.audienceSize.toLocaleString()}${
                    preview.audienceTruncated ? '+' : ''
                  } in this audience`
                : '') +
              (preview.suppressed
                ? ` · ${preview.suppressed.toLocaleString()} unsubscribed or suppressed`
                : '') +
              (preview.cadenceHeld
                ? ` · ${preview.cadenceHeld.toLocaleString()} asked for mail less often than this`
                : '')}
      </Typography>
      {/*
        THE SAME READOUT, BROKEN DOWN BY BASIS.

        The line above says how many of this audience one send reaches. This
        one says what that audience is MADE OF, and the numbers are over the
        same `audienceSize` so the two read as one statement rather than two
        competing counts.

        The breakdown matters because "in this audience" covers two
        populations that are not the same thing: people who ticked a box, and
        people reachable only because enforcement is not retroactive. The
        second group is exactly who disappears if this org ever turns the
        retroactive mode on, so a merchant is owed it BEFORE they write the
        email rather than after an audience collapses.
       */}
      {counts && (
        <Typography variant="caption" color="text.secondary">
          {`In this audience: ${counts.consented.toLocaleString()} with a recorded consent basis`}
          {counts.grandfathered
            ? ` · ${counts.grandfathered.toLocaleString()} grandfathered (captured before consent was required)`
            : ''}
          {counts.consentWithheld
            ? ` · ${counts.consentWithheld.toLocaleString()} withheld — no consent on record, never mailed`
            : ''}
        </Typography>
      )}
      {/*
        The monthly campaign cap, standing rather than only on refusal.
        `campaignSendsUsed` is the same counter+month `campaign-send.ts`
        reads, and the limit comes from the same `checkQuota` call, so the
        readout and the gate cannot disagree. `period` says "this month"
        because this allowance resets; without it the shared readout says "on
        your plan", which for a monthly quota reads as a lifetime allowance.
       */}
      <QuotaReadoutComponent
        ready={orgReady}
        used={campaignSendsUsed}
        limit={quotaLimit}
        noun="campaign email"
        nounPlural="campaign emails"
        period="this month"
      />
      <Divider />
      {/*
        The stream this email belongs to. Its own component and its own read of
        the org's catalog, so the picker a merchant chooses from and the list
        the preference page renders cannot drift apart.
       */}
      <CampaignTopicSelect
        hostId={hostId}
        value={topicId}
        onChange={setTopicId}
        disabled={busy}
      />
      {/*
        WHO THE EMAIL COMES FROM.

        The address itself is not here and cannot be: it is the site's
        verified sending identity, resolved on the server from the org
        document. These three are what a merchant is allowed to choose — the
        display name in front of that address, where a reply lands, and the
        line an inbox shows after the subject.
       */}
      {/*
        THE ADDRESS, when this site has more than one it may use.

        Offered only when there is a choice: a site with no verified domain
        has exactly one identity, and a select with a single option reads as a
        decision somebody forgot to take. The options come from the server and
        carry the whole address — a control that assembled `${localPart}@${domain}`
        itself would be a second place the address is derived from, and the
        two would disagree the first time either moved.
       */}
      {(identityOptions?.filter((one) => one.selectable).length ?? 0) > 1 ? (
        <TextField
          select
          label="From address"
          value={sendingIdentity || siteDefaultIdentity}
          onChange={(event) =>
            setSendingIdentity(
              event.target.value === siteDefaultIdentity
                ? ''
                : event.target.value,
            )
          }
          size="small"
          helperText="Which verified address this email leaves on"
        >
          {(identityOptions ?? [])
            .filter((one) => one.selectable)
            .map((one) => (
              <MenuItem key={one.value} value={one.value}>
                {one.from ?? one.value}
              </MenuItem>
            ))}
        </TextField>
      ) : null}
      <Stack direction="row" spacing={1}>
        <TextField
          label="From name"
          value={fromName}
          onChange={(event) => setFromName(event.target.value)}
          size="small"
          sx={{ flex: 1 }}
          helperText="Shown in front of your verified sending address"
        />
        <TextField
          label="Reply-to"
          value={replyTo}
          onChange={(event) => setReplyTo(event.target.value)}
          size="small"
          type="email"
          sx={{ flex: 1 }}
          helperText="Where replies go, if not the sending address"
        />
      </Stack>
      <TextField
        label="Preheader"
        value={preheader}
        onChange={(event) => setPreheader(event.target.value)}
        size="small"
        helperText="The preview line inboxes show after the subject"
      />
      {emailExperiments.length ? (
        // Email A/B: variant subject/body overrides apply per recipient; a
        // decided experiment sends the winner copy.
        <TextField
          select
          label="A/B test"
          value={experimentId}
          onChange={(event) => setExperimentId(event.target.value)}
          size="small"
          sx={{ minWidth: 150 }}
        >
          <MenuItem value="">{'None'}</MenuItem>
          {emailExperiments.map((experiment: any) => (
            <MenuItem key={experiment.$id} value={experiment.$id}>
              {experiment.name ?? experiment.$id}
              {experiment.winnerVariantId ? ' (winner decided)' : ''}
            </MenuItem>
          ))}
        </TextField>
      ) : null}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <TextField
          select
          label="Email design"
          value={templateScreenId}
          onChange={(event) => setTemplateScreenId(event.target.value)}
          size="small"
          sx={{ minWidth: 220 }}
          helperText="Designed emails are built in the besigner"
        >
          <MenuItem value="">{'Plain text (message below)'}</MenuItem>
          {emailScreens.map((screen: any) => (
            <MenuItem key={screen.$id} value={screen.$id}>
              {screen.displayName ?? screen.$id}
            </MenuItem>
          ))}
        </TextField>
        {selectedTemplate ? (
          <Button
            size="small"
            disabled={!orgSlug || !subdomain}
            onClick={() =>
              void router.push(
                besignerHref(
                  orgSlug,
                  subdomain,
                  selectedTemplate.$id,
                  selectedTemplate.versionId,
                ),
              )
            }
          >
            {'Edit design'}
          </Button>
        ) : null}
        <Button size="small" onClick={() => void handleCreateTemplate()}>
          {'New email template'}
        </Button>
      </Stack>
      {!templateScreenId ? (
        <TextField
          label="Message"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          size="small"
          multiline
          minRows={4}
        />
      ) : null}
      {/*
        THE MERGE TAGS, LISTED RATHER THAN REMEMBERED.

        `resolveMergeTags` recognizes exactly these three and substitutes the
        fallback for everything else — so a tag typed from memory that is not
        one of them does not fail, it renders as nothing in mail that has
        already gone out. Clicking appends the tag rather than explaining it,
        because the syntax that matters is the pipe: a tag with no fallback
        renders empty for every recipient whose name was never captured.
       */}
      {!templateScreenId ? (
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
        >
          <Typography variant="caption" color="text.secondary">
            {'Personalize:'}
          </Typography>
          {CAMPAIGN_MERGE_TAGS.map((tag) => (
            <Chip
              key={tag.token}
              size="small"
              variant="outlined"
              label={tag.token}
              title={tag.description}
              onClick={() =>
                setBody((current) =>
                  current ? `${current}${tag.token}` : tag.token,
                )
              }
            />
          ))}
          <Typography variant="caption" color="text.secondary">
            {'— resolved per recipient at send time'}
          </Typography>
        </Stack>
      ) : null}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Button size="small" onClick={() => setShowPreview((open) => !open)}>
          {showPreview ? 'Hide preview' : 'Preview email'}
        </Button>
        <Typography variant="caption" color="text.secondary">
          {'Rendered by the send path, personalized for your own account'}
        </Typography>
      </Stack>
      {showPreview ? (
        rendered === null ? (
          <Typography variant="caption" color="text.secondary">
            {'Rendering…'}
          </Typography>
        ) : 'error' in rendered ? (
          <Alert severity="warning">{rendered.error}</Alert>
        ) : (
          <Stack spacing={0.5}>
            <Typography variant="caption" color="text.secondary">
              {`Subject: ${rendered.subject || '(none)'}`}
            </Typography>
            {/*
              SANDBOXED, and with an empty attribute rather than a permissive
              one. The document inside is tenant-authored — besigner nodes and
              typed copy — and it is being rendered inside the console origin,
              where a script would run against the operator's own session.
              `sandbox=""` withholds every capability there is to withhold:
              no scripts, no forms, no top-level navigation, and a unique
              opaque origin, which is also what stops a preview reading the
              console's storage.
             */}
            <Box
              component="iframe"
              title="Email preview"
              sandbox=""
              srcDoc={rendered.html}
              sx={{
                width: '100%',
                height: 420,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1,
                backgroundColor: 'background.paper',
              }}
            />
          </Stack>
        )
      ) : null}
      {/*
        WHICH ADDRESS THIS LEAVES ON, or why it cannot leave at all.

        Both come from the dry run, which resolves the identity through the
        same function the send does — so this is the answer a campaign would
        actually get and not a second opinion. The refusing case is an Alert
        rather than a caption because it is the one that stops the send, and
        it names the domain and the records still to publish.
       */}
      {preview && 'error' in preview && preview.blocking ? (
        <Alert severity="warning">
          <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
            {'This email cannot be sent yet'}
          </Typography>
          <Typography variant="body2">{preview.error}</Typography>
          <Typography variant="body2" sx={{ mt: 0.5 }}>
            {'Nothing has been sent, and nothing about this draft is lost. ' +
              'Emails → Sending is where this is settled — it says what this ' +
              'site sends as and what it would take to change it.'}
          </Typography>
        </Alert>
      ) : preview && !('error' in preview) && preview.identity ? (
        <Typography variant="caption" color="text.secondary">
          {preview.identity}
        </Typography>
      ) : null}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <Button
          variant="contained"
          color="primary"
          disabled={
            busy ||
            !subject.trim() ||
            (!templateScreenId && !body.trim()) ||
            /*
             * REFUSED BEFORE THE CLICK, not after it.
             *
             * The send would answer 409 anyway — that boundary holds whatever
             * this component does. What a disabled button buys is that the
             * merchant reads the reason instead of pressing Send and being
             * told; the two are the same information, and only one of them
             * arrives while there is still something to do about it.
             */
            Boolean(preview && 'error' in preview && preview.blocking)
          }
          onClick={handleSend}
        >
          {busy ? 'Working…' : sendAt ? 'Schedule campaign' : 'Send campaign'}
        </Button>
        {/*
          Never hidden while there is a record to save into. Leaving without
          saving is the ordinary way to use a composer, and a surface that
          only offers Send makes a half-written email something you either
          mail or lose.
         */}
        {campaignId ? (
          <Button
            size="small"
            variant="outlined"
            disabled={saving || busy}
            onClick={() => void handleSaveDraft()}
          >
            {saving ? 'Saving…' : 'Save draft'}
          </Button>
        ) : null}
        <Button
          size="small"
          disabled={busy || (!templateScreenId && !body.trim())}
          onClick={() => setTestOpen(true)}
        >
          {'Send test'}
        </Button>
        <TextField
          size="small"
          type="datetime-local"
          label="Send at (optional)"
          slotProps={{ inputLabel: { shrink: true } }}
          value={sendAt}
          onChange={(event) => setSendAt(event.target.value)}
        />
      </Stack>
      {/*
        The proof drawer takes the message as it stands, so a test mails what
        is composed rather than a reconstruction of it. It shares the one
        authorized POST with every other action on this surface.
       */}
      <CampaignTestSendDrawer
        open={testOpen}
        onClose={() => setTestOpen(false)}
        post={authorizedPost}
        identity={
          preview && !('error' in preview) ? preview.identity : ''
        }
        message={{
          subject: subject.trim() || 'Test send',
          body: body.trim(),
          fromName: fromName.trim(),
          replyTo: replyTo.trim(),
          preheader: preheader.trim(),
          ...(templateScreenId ? { templateScreenId } : {}),
          ...(sendingIdentity ? { sendingIdentity } : {}),
        }}
      />
    </Stack>
  )
}
CampaignComposer.displayName = 'CampaignComposer'

export default CampaignComposer
