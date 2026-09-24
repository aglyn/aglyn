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

/**
 * What the admin is told before a consent group change is applied.
 *
 * A change here decides who may email whom, so the review says it in the
 * terms the admin will be held to rather than in the terms the code uses:
 * what signup forms will say, who stops getting mail, who can still be
 * mailed, and what happens to the CRM's records. Every number comes from the
 * route's preview, which counted it without writing anything; a sentence
 * whose number the preview did not supply is said without one rather than
 * with a guess.
 *
 * Pure, so each wording can be asserted against a preview without rendering.
 */

import type {
  ConsentGroupChangeEstimate,
  ConsentGroupChangePreview,
  ConsentGroupParticipantLine,
} from './consent-groups-api'
import {
  draftDisclosure,
  type ConsentGroupDraftChange,
} from './consent-group-editing'

/** One sentence of the review. `warning` is the tone of an irreversible loss. */
export interface ConsentGroupReviewItem {
  id: string
  text: string
  tone: 'info' | 'warning'
}

export interface ConsentGroupReviewSection {
  id: string
  heading: string | null
  items: ConsentGroupReviewItem[]
}

export interface ConsentGroupReview {
  title: string
  /** The primary button, named for what it does. */
  confirmLabel: string
  sections: ConsentGroupReviewSection[]
}

export interface ConsentGroupReviewInput {
  change: ConsentGroupDraftChange
  /** `null` while the preview is still being counted. */
  preview: ConsentGroupChangePreview | null
  siteName: (hostId: string) => string
  /** The org's switch: a confirmation one site waits on holds its siblings. */
  awaitsConfirmation: boolean
}

/*==========================================
 * WORDS
 *=========================================*/

const listFormat = new Intl.ListFormat('en-US', {
  style: 'long',
  type: 'conjunction',
})

/** `A`, `A and B`, `A, B, and C`. */
export function joinNames(names: readonly string[]): string {
  return listFormat.format(names)
}

const count = (n: number) => n.toLocaleString('en-US')
const people = (n: number) => `${count(n)} ${n === 1 ? 'person' : 'people'}`

const sum = (values: readonly number[]) =>
  values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0)

const dateFormat = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
})

/** What an estimate means for the person about to wait on it. */
export const CONSENT_GROUP_ESTIMATE_TEXT: Readonly<
  Record<ConsentGroupChangeEstimate, string>
> = {
  instant: 'This takes effect right away.',
  'under-a-minute': 'This should take less than a minute.',
  minutes: 'This will take a few minutes.',
  long: 'This will take a while — longer for organizations with many contacts.',
}

/** What a capture surface is called where a sentence names it. */
const CAPTURE_SURFACE_NAMES: Readonly<Record<string, string>> = {
  form: 'signup forms',
  newsletter: 'newsletter signups',
}

/*==========================================
 * THE PARTICIPANTS' OWN LINES
 *=========================================*/

/**
 * The CRM's counted lines the review writes its own sentences around.
 *
 * The CRM reports what the change does to its records as lines with these
 * ids; the review folds each count into the sentence it belongs to, so the
 * admin reads one account of the change rather than two. A line with any
 * other id is printed as the plugin wrote it.
 */
const FOLDED_LINE_IDS = new Set([
  'crm.combine',
  'crm.copy',
  'crm.figures',
  'crm.refusals',
  'crm.grants',
  'crm.visibility',
])

function participantLines(
  preview: ConsentGroupChangePreview | null,
): ConsentGroupParticipantLine[] {
  return (preview?.participants ?? []).flatMap((participant) =>
    Array.isArray(participant?.lines) ? participant.lines : [],
  )
}

/** A folded line's count, or `null` when it was not reported or not counted. */
function lineCount(
  preview: ConsentGroupChangePreview | null,
  id: string,
): number | null {
  const line = participantLines(preview).find((entry) => entry?.id === id)
  return line && typeof line.count === 'number' ? line.count : null
}

/** Whether the CRM spoke at all — its sentences are said only if it did. */
function crmReported(preview: ConsentGroupChangePreview | null): boolean {
  return participantLines(preview).some((line) =>
    String(line?.id ?? '').startsWith('crm.'),
  )
}

/*==========================================
 * THE REVIEW
 *=========================================*/

function confirmLabel(change: ConsentGroupDraftChange): string {
  if (change.kind === 'create') return 'Create group'
  if (change.kind === 'dissolve') return 'Dissolve group'
  const joining = change.added.length + change.movedIn.length
  const leaving = change.removed.length
  if (change.renamed && !joining && !leaving) return 'Rename group'
  if (!change.renamed && joining && !leaving) {
    return joining === 1 ? 'Add site' : 'Add sites'
  }
  if (!change.renamed && leaving && !joining) {
    return leaving === 1 ? 'Remove site' : 'Remove sites'
  }
  return 'Apply changes'
}

function title(change: ConsentGroupDraftChange): string {
  if (change.kind === 'create') return `Create “${change.name}”`
  if (change.kind === 'dissolve') return `Dissolve “${change.name}”`
  return `Change “${change.previousName ?? change.name}”`
}

/** Builds every section of the review, in the order it is read. */
export function describeConsentGroupReview(
  input: ConsentGroupReviewInput,
): ConsentGroupReview {
  const { change, preview, siteName, awaitsConfirmation } = input
  const names = (ids: readonly string[]) => joinNames(ids.map(siteName))
  const group = change.name
  const joining = [...change.added, ...change.movedIn.map((move) => move.hostId)]
  const joins = change.kind === 'create' || joining.length > 0
  const dissolving = change.kind === 'dissolve'
  const leaving = dissolving ? change.previousHostIds : change.removed
  const crm = crmReported(preview)

  const summary: ConsentGroupReviewItem[] = []
  const forms: ConsentGroupReviewItem[] = []
  const consent: ConsentGroupReviewItem[] = []
  const optOuts: ConsentGroupReviewItem[] = []
  const records: ConsentGroupReviewItem[] = []
  const other: ConsentGroupReviewItem[] = []
  const say = (
    into: ConsentGroupReviewItem[],
    id: string,
    text: string,
    tone: ConsentGroupReviewItem['tone'] = 'info',
  ) => into.push({ id, text, tone })

  /*---- What changes ----*/
  if (change.kind === 'create') {
    say(summary, 'summary.create', `Create ${group} with ${names(change.hostIds)}.`)
  }
  if (change.tooFewSites) {
    say(
      summary,
      'summary.too-few',
      change.unselected.length
        ? `A consent group needs at least two sites. Removing ${names(change.unselected)} dissolves ${group}.`
        : `A consent group needs at least two sites, so this dissolves ${group}.`,
      'warning',
    )
  } else if (dissolving) {
    say(summary, 'summary.dissolve', `Dissolve ${group}.`)
  }
  if (change.renamed) {
    say(
      summary,
      'summary.rename',
      `Rename ${change.previousName} to ${group}.`,
    )
  }
  if (change.kind === 'edit' && change.added.length) {
    say(summary, 'summary.add', `Add ${names(change.added)} to ${group}.`)
  }
  for (const move of change.movedIn) {
    say(
      summary,
      `summary.move.${move.hostId}`,
      `Move ${siteName(move.hostId)} from ${move.fromName} to ${group}.`,
    )
  }
  if (change.kind === 'edit' && change.removed.length) {
    say(summary, 'summary.remove', `Remove ${names(change.removed)} from ${group}.`)
  }
  for (const donor of change.donors) {
    if (donor.absorbed) {
      say(
        summary,
        `summary.absorb.${donor.groupId}`,
        `${donor.name} will be merged into ${group}, so ${donor.name} stops existing.`,
      )
    } else if (donor.dissolves) {
      say(
        summary,
        `summary.donor-dissolve.${donor.groupId}`,
        `Moving ${names(donor.losing)} dissolves ${donor.name}, because a consent group needs at least two sites. ${names(donor.remaining)} will send on its own.`,
        'warning',
      )
    }
  }

  /*---- Signup forms ----*/
  if (!dissolving) {
    const disclosure =
      preview?.disclosures?.find(
        (entry) =>
          entry &&
          entry.after &&
          (entry.groupId === change.groupId ||
            (Array.isArray(entry.hostIds) &&
              entry.hostIds.length === change.hostIds.length &&
              entry.hostIds.every((hostId) => change.hostIds.includes(hostId)))),
      )?.after ?? draftDisclosure(group, change.hostIds, change.groupId ?? 'new')
    if (disclosure && (joins || change.renamed || change.removed.length)) {
      say(
        forms,
        'forms.disclosure',
        change.kind === 'create'
          ? `Signup forms on these sites will say: “${disclosure}”`
          : `Signup forms on ${group}’s sites will say: “${disclosure}”`,
      )
    }
    if (change.renamed) {
      say(
        forms,
        'forms.rename',
        `Signup forms and preference pages will show ${group} from now on. People who already signed up saw ${change.previousName}; their records keep it.`,
      )
    }
    const surfaces = (preview?.capturesDisclosing ?? [])
      .map((surface) => CAPTURE_SURFACE_NAMES[surface] ?? surface)
      .filter(Boolean)
    if (joins && surfaces.length) {
      say(
        forms,
        'forms.surfaces',
        `Only ${joinNames(surfaces)} show this name for now. Anywhere else someone signs up, their consent is recorded for the one site they used.`,
      )
    }
  }
  if (leaving.length) {
    say(
      forms,
      'forms.leave',
      dissolving
        ? `${names(leaving)} will each send on their own again; their signup forms will stop naming ${group}.`
        : leaving.length === 1
          ? `${names(leaving)} will send on its own again; its signup forms will stop naming ${group}.`
          : `${names(leaving)} will each send on their own again; their signup forms will stop naming ${group}.`,
    )
  }

  /*---- Who may be emailed: grants ----*/
  if (change.kind === 'create') {
    say(
      consent,
      'consent.forward',
      'People who signed up before now agreed to hear from one site. They are not shared; only people who sign up after this change, on a form that shows this name, are.',
    )
  } else if (joins) {
    say(
      consent,
      'consent.forward',
      `People who signed up before now keep what they agreed to: nobody who signed up on ${names(joining)} is shared with ${group}’s other sites, or the other way around. Only people who sign up after this change, on a form that shows this name, are.`,
    )
  }
  for (const donor of change.donors) {
    if (donor.absorbed) continue
    say(
      consent,
      `consent.kept.${donor.groupId}`,
      `${names(donor.losing)} can still email the people who signed up to ${donor.name} while ${
        donor.losing.length === 1 ? 'it was' : 'they were'
      } part of it.`,
    )
  }
  if (leaving.length) {
    const kept = lineCount(preview, 'crm.grants')
    const who = kept != null ? `the ${people(kept)}` : 'the people'
    say(
      consent,
      'consent.kept',
      dissolving || leaving.length > 1
        ? `Each site can still email ${who} who signed up to ${group} while it was part of it.`
        : `${names(leaving)} can still email ${who} who signed up to ${group} while it was part of it.`,
    )
  }

  /*---- Who stops getting mail: refusals ----*/
  if (joins) {
    const inherited = sum((preview?.inherited ?? []).map((entry) => entry?.refusals ?? 0))
    say(
      optOuts,
      'opt-outs.inherit',
      `Anyone who unsubscribed from, opted out on, or declined email from any of these sites will stop getting marketing email from all of them${preview ? ` (${count(inherited)} ${inherited === 1 ? 'opt-out' : 'opt-outs'} on record)` : ''}.`,
    )
    if (awaitsConfirmation) {
      say(
        optOuts,
        'opt-outs.confirmation',
        'A confirmation one site is waiting for will hold the other sites’ email on that topic.',
      )
    }
  }
  /*
   * Separations: every pair of sites that stops reading each other keeps the
   * other's refusals. The copies are counted once over the whole plan, so the
   * count rides on the sentence when there is one, and on a total when there
   * are several.
   */
  const separations: Array<{ id: string; text: string }> = []
  if (dissolving) {
    separations.push({
      id: 'opt-outs.dissolve',
      text: `Everyone who opted out on any of ${group}’s sites stays opted out on every one of them`,
    })
  } else if (change.removed.length === 1) {
    const site = siteName(change.removed[0])
    separations.push({
      id: 'opt-outs.leave',
      text: `Everyone who opted out on any of ${group}’s sites stays opted out on ${site}, and everyone who opted out on ${site} stays opted out on ${group}’s other sites`,
    })
  } else if (change.removed.length > 1) {
    separations.push({
      id: 'opt-outs.leave',
      text: `Everyone who opted out on any of ${group}’s sites stays opted out on each site that leaves, and everyone who opted out on a site that leaves stays opted out on the rest`,
    })
  }
  for (const donor of change.donors) {
    if (donor.absorbed) continue
    separations.push({
      id: `opt-outs.donor.${donor.groupId}`,
      text: `Everyone who opted out on any of ${donor.name}’s sites stays opted out on ${names(donor.losing)}, and everyone who opted out on ${names(donor.losing)} stays opted out on ${names(donor.remaining)}`,
    })
  }
  const copied =
    sum(
      (preview?.carries ?? []).map(
        (carry) => (carry?.siteSuppressions ?? 0) + (carry?.topicOptOuts ?? 0),
      ),
    ) + (lineCount(preview, 'crm.refusals') ?? 0)
  const paces = sum((preview?.carries ?? []).map((carry) => carry?.paces ?? 0))
  const copiedNote = preview
    ? `${count(copied)} ${copied === 1 ? 'opt-out' : 'opt-outs'} copied${
        paces ? `, and ${count(paces)} email frequency ${paces === 1 ? 'choice' : 'choices'} kept` : ''
      }`
    : ''
  if (separations.length === 1) {
    say(
      optOuts,
      separations[0].id,
      `${separations[0].text}${copiedNote ? ` (${copiedNote})` : ''}.`,
    )
  } else if (separations.length > 1) {
    for (const separation of separations) {
      say(optOuts, separation.id, `${separation.text}.`)
    }
    if (copiedNote) {
      say(optOuts, 'opt-outs.total', `In all: ${copiedNote}.`)
    }
  }
  const holds = sum((preview?.pendingHolds ?? []).map((hold) => hold?.count ?? 0))
  if (holds > 0 && (leaving.length || change.donors.length)) {
    say(
      optOuts,
      'opt-outs.pending',
      leaving.length === 1 && !dissolving && !change.donors.length
        ? `${people(holds)} waiting to confirm on ${names(leaving)} will no longer hold ${group}’s email, and vice versa.`
        : `${people(holds)} waiting to confirm on one of these sites will no longer hold the email of the sites it separates from.`,
    )
  }

  /*---- CRM records ----*/
  if (crm && joins) {
    const combined = lineCount(preview, 'crm.combine')
    say(
      records,
      'records.combine',
      `The CRM records these sites keep about the same person will be combined into one record, visible to everyone who works on any of these sites. Where two records disagree about one value, such as the owner or stage, ${
        change.kind === 'create'
          ? 'the record from the site that met the person first'
          : `${group}’s record`
      } is kept.${combined != null ? ` This combines records for ${people(combined)}.` : ''}`,
    )
  }
  if (crm && leaving.length) {
    const copies = lineCount(preview, 'crm.copy')
    const met = copies != null ? `the ${people(copies)}` : 'the people'
    say(
      records,
      'records.copy',
      dissolving || leaving.length > 1
        ? `Each site keeps a copy of the CRM record for ${met} it met itself.`
        : `${names(leaving)} keeps a copy of the CRM record for ${met} it met itself. ${group} keeps its records, including order totals for people who also bought elsewhere.`,
    )
    const seen = lineCount(preview, 'crm.visibility')
    if (seen != null && seen > 0) {
      say(
        records,
        'records.visibility',
        dissolving || leaving.length > 1
          ? `Each site will still see the ${people(seen)} it met only through ${group}’s other sites, without their CRM details.`
          : `${names(leaving)} will still see ${people(seen)} it met only through ${group}’s other sites, without their CRM details.`,
      )
    }
  }
  if (crm && dissolving) {
    const figures = lineCount(preview, 'crm.figures')
    if (figures == null || figures > 0) {
      say(
        records,
        'records.figures',
        figures != null
          ? `Order totals for ${people(figures)} who bought on more than one of these sites can’t be split and will be removed.`
          : 'Order totals for people who bought on more than one of these sites can’t be split and will be removed.',
        'warning',
      )
    }
  }
  if (joins) {
    const partial = Number(preview?.partialAccessMembers ?? 0)
    if (partial > 0) {
      say(
        records,
        'records.partial-access',
        `${count(partial)} team ${partial === 1 ? 'member' : 'members'} can open only some of these sites. They’ll keep seeing only those sites’ records.`,
      )
    }
    const forward = preview?.forwardPolicyWarning
    if (forward && typeof forward === 'object') {
      const hostIds = Array.isArray(forward.hostIds) ? forward.hostIds : joining
      const before =
        typeof forward.enforceFromMs === 'number'
          ? ` before ${dateFormat.format(new Date(forward.enforceFromMs))}`
          : ''
      say(
        records,
        'records.forward',
        `${names(hostIds.length ? hostIds : change.hostIds)} will be able to email people these sites captured${before} without a recorded opt-in.`,
        'warning',
      )
    }
  }

  /*---- Anything else the plugins reported, as they wrote it ----*/
  for (const line of participantLines(preview)) {
    if (!line || FOLDED_LINE_IDS.has(line.id) || !line.text) continue
    say(other, `line.${line.id}`, line.text, line.severity === 'warning' ? 'warning' : 'info')
  }
  if ((preview?.participants ?? []).some((participant) => participant && participant.lines === null)) {
    say(
      other,
      'line.unanswered',
      'Part of this change couldn’t be counted ahead of time. It still runs, and nobody who opted out starts getting email.',
    )
  }
  const discarded = (preview?.discarded ?? []).filter(
    (id) => typeof id === 'string' && id !== '',
  )
  if (discarded.length) {
    say(
      other,
      'discarded',
      `${discarded.length === 1 ? 'One saved consent group' : `${count(discarded.length)} saved consent groups`} can’t be used — no name, too few or too many sites, or a site another group also claims — so nothing honors ${discarded.length === 1 ? 'it' : 'them'} today. This change removes ${discarded.length === 1 ? 'it' : 'them'}: ${joinNames(discarded)}.`,
    )
  }

  /*---- How long ----*/
  const timing: ConsentGroupReviewItem[] = []
  if (preview?.estimate && CONSENT_GROUP_ESTIMATE_TEXT[preview.estimate]) {
    say(timing, 'timing.estimate', CONSENT_GROUP_ESTIMATE_TEXT[preview.estimate])
  }
  say(timing, 'timing.leave', 'You can leave this page; it finishes on its own.')

  return {
    title: title(change),
    confirmLabel: confirmLabel(change),
    sections: [
      { id: 'summary', heading: null, items: summary },
      { id: 'forms', heading: 'Signup forms', items: forms },
      { id: 'consent', heading: 'Who can be emailed', items: consent },
      { id: 'opt-outs', heading: 'Opt-outs', items: optOuts },
      { id: 'records', heading: 'CRM records and access', items: records },
      { id: 'other', heading: 'Also', items: other },
      { id: 'timing', heading: null, items: timing },
    ].filter((section) => section.items.length > 0),
  }
}
