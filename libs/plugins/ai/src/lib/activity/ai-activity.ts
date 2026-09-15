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
 * The AI writers over the two customer-visible activity logs (AGL-2929).
 *
 * Every generation, applied edit and control change lands in
 * `orgs/{orgId}/activity` (and, for a host-scoped output, in
 * `hosts/{hostId}/activity`) through {@link logOrgActivity} and
 * {@link logHostActivity} — never a collection of its own, so the retention
 * `docs/DATA_RETENTION.md` already promises for the activity logs covers
 * these rows without a new entry, and the one permission-gated route that
 * serves the org feed serves them.
 *
 * Each helper owns ONE action code from `AI_ACTIVITY_ACTIONS` and the shape
 * of its target, so a caller cannot store a code the viewers do not know or
 * a target the presenter cannot label. What varies per row is folded into
 * `target.name`, which is the only free text the row carries: the feed reads
 * `<label> — <name>`, and a name like `screen · 240-character brief · Acme`
 * is what makes two jobs distinguishable in a list of them.
 *
 * Attribution follows `logOrgActivity`'s rule: `uid` is nullable because
 * some of these acts HAVE no actor — a job paused by the band with nobody
 * present, an add-on Stripe removed at the period end — and naming the last
 * person who touched the thing would file an act under someone who did not
 * perform it. A caller passes what it verified and nothing more.
 *
 * The control-change writers answer whether a row was written: a control set
 * to the value it already had is not a change, and a feed that said "AI
 * overage ceiling — $25" twice for one decision would read as two decisions.
 */

import type { HostActivityActor } from '@aglyn/aglyn/app-utils/activity-presenter'
import {
  AI_ACTIVITY_ACTIONS,
  AI_JOB_NEEDS_INPUT_REASON_LABELS,
  type AiJobNeedsInputReason,
} from './ai-activity-actions'
import {
  aiAddonName,
  aiAddonUnits,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { OrgSeatAddons } from '@aglyn/aglyn/server'
import {
  logHostActivity,
  logOrgActivity,
  type HostActivityTarget,
  type OrgActivityTarget,
} from '@aglyn/tenant-data-admin/server/organizations'

/** Who performed the act — `uid: null` when nobody was present. */
export interface AiActivityActor {
  uid: string | null
  email?: string | null
}

/** The resource kinds a generation job can produce. */
export type AiOutputResourceType = Extract<
  OrgActivityTarget['type'],
  HostActivityTarget['type']
>

/** The pieces a target name is built from, blanks dropped. */
const named = (...parts: Array<string | number | null | undefined>): string =>
  parts
    .map((part) => (part === null || part === undefined ? '' : String(part).trim()))
    .filter(Boolean)
    .join(' · ')

/** A verified uid, or nothing: the host log has no anonymous actor. */
const hostActor = (actor: AiActivityActor): HostActivityActor | null =>
  actor.uid ? { uid: actor.uid, email: actor.email ?? null } : null

/**
 * `ai.job.created` — a generation job was briefed (AGL-2904).
 *
 * Names the job's kind, how long the brief was and the site it targets, so
 * the row says what was asked for without storing the brief itself.
 */
export async function logAiJobCreated(
  orgId: string,
  actor: AiActivityActor,
  job: {
    jobId: string
    /** What the job builds — a screen, a site, a section. */
    kind: string
    briefLength: number
    hostId?: string | null
    hostName?: string | null
  },
): Promise<void> {
  await logOrgActivity(orgId, actor, AI_ACTIVITY_ACTIONS.jobCreated, {
    type: 'aiJob',
    id: job.jobId,
    name: named(
      job.kind,
      `${Math.max(0, Math.floor(job.briefLength))}-character brief`,
      job.hostName ?? job.hostId,
    ),
  })
}

/**
 * `ai.job.output` — one resource a job produced, one row per output.
 *
 * The org row names the resource, and a host-scoped output is copied into
 * the site's own feed so a site's activity shows what was generated on it.
 * The copy needs a uid: the host log's contract has no anonymous actor, so a
 * job that finished with nobody present still lands in the org feed and
 * only there.
 */
export async function logAiJobOutput(
  orgId: string,
  actor: AiActivityActor,
  output: {
    jobId: string
    hostId?: string | null
    resource: {
      type: AiOutputResourceType
      id: string
      name?: string | null
      versionId?: string | null
    }
  },
): Promise<void> {
  const target = {
    type: output.resource.type,
    id: output.resource.id,
    ...(output.resource.name ? { name: output.resource.name } : {}),
    ...(output.resource.versionId ? { versionId: output.resource.versionId } : {}),
  }
  await logOrgActivity(orgId, actor, AI_ACTIVITY_ACTIONS.jobOutput, target)
  const onHost = hostActor(actor)
  if (output.hostId && onHost) {
    await logHostActivity(output.hostId, onHost, AI_ACTIVITY_ACTIONS.jobOutput, target)
  }
}

/** `ai.job.canceled` — a job was stopped before it finished. */
export async function logAiJobCanceled(
  orgId: string,
  actor: AiActivityActor,
  job: { jobId: string; kind?: string | null; name?: string | null },
): Promise<void> {
  await logOrgActivity(orgId, actor, AI_ACTIVITY_ACTIONS.jobCanceled, {
    type: 'aiJob',
    id: job.jobId,
    ...(named(job.kind, job.name) ? { name: named(job.kind, job.name) } : {}),
  })
}

/**
 * `ai.job.needs_input` — a job stopped and asked for a person, and why.
 * Usually actorless: the band, the ceiling or the budget stopped it, not a
 * member.
 */
export async function logAiJobNeedsInput(
  orgId: string,
  actor: AiActivityActor,
  job: { jobId: string; kind?: string | null; reason: AiJobNeedsInputReason },
): Promise<void> {
  await logOrgActivity(orgId, actor, AI_ACTIVITY_ACTIONS.jobNeedsInput, {
    type: 'aiJob',
    id: job.jobId,
    name: named(job.kind, AI_JOB_NEEDS_INPUT_REASON_LABELS[job.reason]),
  })
}

/**
 * `ai.edit.applied` — a proposal's edits landed on a besigner document
 * (AGL-2906).
 *
 * The edits are applied in the author's own editor, as unsaved changes, so
 * no server sees them land. The row is written by the door the editor
 * reports the apply to, and only once that door has found the proposal on an
 * exchange the same member had about the same document — so it stands on a
 * proposal the server issued rather than on the client's word alone. Op
 * counts are folded into the name (`Home · 3 set, 1 insert`); the edits
 * themselves are the site's content and are not logged.
 */
export async function logAiEditApplied(
  hostId: string,
  actor: HostActivityActor,
  edit: {
    /** The kind of document the edits landed on. */
    type: 'screen' | 'component' | 'layout'
    id: string
    name?: string | null
    versionId: string
    /** Edits applied, by operation — `{ set: 3, insert: 1 }`. */
    opCounts: Record<string, number>
  },
): Promise<void> {
  const counts = Object.entries(edit.opCounts)
    .filter(([, count]) => Number.isFinite(count) && count > 0)
    .map(([op, count]) => `${Math.floor(count)} ${op}`)
    .join(', ')
  await logHostActivity(hostId, actor, AI_ACTIVITY_ACTIONS.editApplied, {
    type: edit.type,
    id: edit.id,
    name: named(edit.name, counts),
    versionId: edit.versionId,
  })
}

/**
 * `ai.assist.section` — the assist door returned a section subtree.
 *
 * Into the site's feed when the request named a site, else the org's, so
 * the act is never unlogged for want of a host. Element rewrites are not
 * logged here at all — too chatty — and the per-user rollup carries their
 * count. The instruction is the customer's own copy and is not stored.
 */
export async function logAiAssistSection(
  actor: AiActivityActor,
  section: {
    orgId: string
    hostId?: string | null
    hostName?: string | null
    nodeCount: number
  },
): Promise<void> {
  const nodes = Math.max(0, Math.floor(section.nodeCount))
  const size = `${nodes} ${nodes === 1 ? 'element' : 'elements'}`
  const onHost = hostActor(actor)
  if (section.hostId && onHost) {
    await logHostActivity(section.hostId, onHost, AI_ACTIVITY_ACTIONS.assistSection, {
      type: 'host',
      id: section.hostId,
      name: named(section.hostName, size),
    })
    return
  }
  await logOrgActivity(section.orgId, actor, AI_ACTIVITY_ACTIONS.assistSection, {
    type: 'org',
    name: named(section.hostName ?? section.hostId, size),
  })
}

/** The two overage controls a customer holds (AGL-2653, AGL-2898). */
export type AiOverageControlChange =
  | { control: 'hardCap'; before: boolean; after: boolean }
  | { control: 'cap'; before: number | null; after: number | null }

const usd = (value: number): string => `$${value.toLocaleString('en-US')}`

/**
 * `ai.overage.hardCap` / `ai.overage.cap` — a control moved.
 *
 * The routes already write `adminAudit`; this is the org-feed row that
 * lets the customer see who set the control. Answers `false`, and writes
 * nothing, when the value did not move.
 */
export async function logAiOverageControl(
  orgId: string,
  actor: AiActivityActor,
  change: AiOverageControlChange,
): Promise<boolean> {
  if (change.before === change.after) return false
  if (change.control === 'hardCap') {
    await logOrgActivity(orgId, actor, AI_ACTIVITY_ACTIONS.overageHardCap, {
      type: 'org',
      name: change.after ? 'On' : 'Off',
    })
    return true
  }
  await logOrgActivity(orgId, actor, AI_ACTIVITY_ACTIONS.overageCap, {
    type: 'org',
    name: change.after === null ? 'Cleared' : usd(change.after),
  })
  return true
}

/**
 * `ai.allotment.changed` — a manager set, changed or removed an AI allotment
 * (AGL-2942): a member's, a collaborator's on one site, a site's, or the
 * org-wide model restriction. The subject is the row's target; what it was
 * set to is the name, in credits, never dollars.
 */
export async function logAiAllotmentChanged(
  orgId: string,
  actor: AiActivityActor,
  change: {
    subject: {
      type: 'org' | 'member' | 'host'
      id?: string | null
      name?: string | null
    }
    /** `null` when the allotment was removed. */
    after: {
      credits: number | null
      mode: 'hard' | 'soft'
      models: readonly string[] | null
    } | null
  },
): Promise<void> {
  const after = change.after
  await logOrgActivity(orgId, actor, AI_ACTIVITY_ACTIONS.allotmentChanged, {
    type: change.subject.type,
    ...(change.subject.id ? { id: change.subject.id } : {}),
    name: named(
      change.subject.name,
      after === null
        ? 'removed'
        : after.credits === null
          ? null
          : `${after.credits.toLocaleString('en-US')} credits a month (${after.mode})`,
      after?.models?.length ? `${after.models.length} models allowed` : null,
    ),
  })
}

/**
 * `ai.permission.changed` — an AI permission moved on a role, a member's
 * override, a collaborator's site toggle or the org's default. The subject
 * is the row's target; the permission and its direction are the name.
 */
export async function logAiPermissionChanged(
  orgId: string,
  actor: AiActivityActor,
  change: {
    subject: {
      type: 'org' | 'role' | 'member' | 'host'
      id?: string | null
      name?: string | null
    }
    /** The permission key that moved — `ai.assist`, `ai.generate`. */
    permission: string
    granted: boolean
  },
): Promise<void> {
  await logOrgActivity(orgId, actor, AI_ACTIVITY_ACTIONS.permissionChanged, {
    type: change.subject.type,
    ...(change.subject.id ? { id: change.subject.id } : {}),
    name: named(
      change.subject.name,
      `${change.permission} ${change.granted ? 'granted' : 'revoked'}`,
    ),
  })
}

/**
 * `ai.addon.purchased` / `ai.addon.removed` — the AI add-on came or went.
 *
 * Decided off the mirrored `seatAddons` maps rather than told, because the
 * add-ons route mirrors the purchase at once and the webhook re-derives the
 * same map on every subscription event: comparing before and after is what
 * keeps a redelivery, or the webhook confirming a purchase the route already
 * logged, from writing the row twice. Answers `false` when nothing moved.
 */
export async function logAiAddonChanged(
  orgId: string,
  actor: AiActivityActor,
  change: {
    before: OrgSeatAddons | null | undefined
    after: OrgSeatAddons | null | undefined
  },
): Promise<boolean> {
  const before = aiAddonUnits(change.before)
  const after = aiAddonUnits(change.after)
  if (before === after) return false
  await logOrgActivity(
    orgId,
    actor,
    after === 1 ? AI_ACTIVITY_ACTIONS.addonPurchased : AI_ACTIVITY_ACTIONS.addonRemoved,
    { type: 'subscription', name: aiAddonName() },
  )
  return true
}
