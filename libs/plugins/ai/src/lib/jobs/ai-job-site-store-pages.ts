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

import { checkEntitlement } from '@aglyn/aglyn/app-utils/plan-entitlements'
import { hostRoleCanWrite } from '@aglyn/aglyn/app-utils/organizations'
import { ACCOUNTS_PLUGIN_ID } from '@aglyn/aglyn/plugin-manager/enabled-plugins'
import { HostScreenVisibility } from '@aglyn/aglyn/foundation/definitions/platform.types'
import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import { FieldValue } from 'firebase-admin/firestore'
import type { AiJob, AiJobOutput } from '../model/ai-jobs.types'
import {
  aiStorePageNodes,
  aiStorePagesToWrite,
  AI_STORE_PAGES,
  type AiStorePageFacts,
  type AiStorePagePlan,
} from '../model/ai-site-store-pages'
import { aiModelForStep } from '../providers/routing'
import { aiOriginJobId } from './ai-job-draft-ids'
import { writeAiDraft, writeAiDraftScreenSeo } from './ai-job-drafts'
import { aiUnspentOutcome } from './ai-job-generation'
import { aiPluginDraftAdmissionRefusal } from './ai-job-plugin-drafts'
import type { AiJobStepContext, AiJobStepOutcome, AiJobStepRunner } from './ai-job-text-step'

/**
 * The store pages' unit of a site start (AGL-3676): the account, cart and
 * policy pages a paid store gets beside its planned pages
 * (`model/ai-site-store-pages.ts`), written by code in one pass that asks no
 * model and costs no credits.
 *
 * Each page is a draft written through the same writer, under the same pages
 * allowance, as every page the start builds (`writeAiDraft`), under an id
 * derived from the unit's job, so a pass run again finds its own drafts. The
 * guided start's publish then puts them live with the rest.
 *
 * The site's user accounts are turned on here too: the Customer account's
 * sign-in, and the platform's /signin and /signup, answer only where the site
 * serves accounts (`accounts` is off by default on a site that predates
 * 2026-08; every new site is born with it). A site whose owner switched them
 * off keeps them off: an explicit deny is theirs.
 */

/** The unit input a store pages unit carries what it writes in. */
export const AI_SITE_STORE_PAGES_INPUT = 'storePages'

/** What a store pages unit is told: the store pages the plan implies, and what their words link. */
export interface AiSiteStorePagesInput {
  pages: AiStorePagePlan[]
  facts: AiStorePageFacts
  /** The layout the start built, which the pages render inside; the site's otherwise. */
  layoutId: string | null
}

/** The commerce plugin's name, in the refusal that asks for it. */
const STORE_LABEL = 'Commerce'

/** What a store pages row says where nothing could be written: our failure. */
export const AI_SITE_STORE_PAGES_NOT_WRITTEN_COPY = 'Your account, cart and policy pages could not be added this time.'

/** The id of the store page a unit writes for `key`. */
export function aiSiteStorePageId(unitJobId: string, key: string): string {
  return `${unitJobId}-${key}`
}

const PATH = /^\/[a-z0-9-]*$/

function inputOf(job: Pick<AiJob, 'inputs'>): AiSiteStorePagesInput | null {
  const raw = job.inputs?.[AI_SITE_STORE_PAGES_INPUT] as Partial<AiSiteStorePagesInput> | undefined
  if (!raw || !Array.isArray(raw.pages) || !raw.facts) return null
  const keys = new Set(AI_STORE_PAGES.map((page) => page.key))
  const pages = raw.pages.filter((page) => page && keys.has(page.key) && typeof page.slug === 'string')
  const path = (value: unknown, fallback: string) => (typeof value === 'string' && PATH.test(value) ? value : fallback)
  return {
    pages,
    facts: {
      contactPath: raw.facts.contactPath ? path(raw.facts.contactPath, '') || null : null,
      shopPath: path(raw.facts.shopPath, '/shop'),
      shippingPath: path(raw.facts.shippingPath, '/shipping-returns'),
    },
    layoutId: typeof raw.layoutId === 'string' && raw.layoutId ? raw.layoutId : null,
  }
}

/**
 * Whether the store pages may be added for this member on this site, asked
 * before their pass so a refusal spends nothing; `null` admits. The plan must
 * include a store (Starter and up), the commerce plugin must run here, and the
 * member must be able to edit the site's pages.
 */
export async function aiSiteStorePagesRefusal(
  context: Pick<AiJobStepContext, 'firestore' | 'org' | 'now'> & { job: Pick<AiJob, 'orgId' | 'hostId' | 'createdBy'> },
  deps: { admission?: typeof aiPluginDraftAdmissionRefusal } = {},
): Promise<string | null> {
  const { job, firestore } = context
  if (!job.hostId) return 'Open the site first.'
  if (!checkEntitlement((context.org ?? null) as never, 'commerce')) return 'Your plan does not include a store.'
  const refused = await (deps.admission ?? aiPluginDraftAdmissionRefusal)(
    { firestore, orgId: job.orgId, hostId: job.hostId, inputs: {}, org: context.org ?? null },
    { kind: 'site', drafts: [{ resource: 'product', label: STORE_LABEL }], now: context.now },
  )
  if (refused) return refused.error
  const host = await firestore.collection('hosts').doc(job.hostId).get()
  return hostRoleCanWrite((host.get('memberRoles') ?? {})[job.createdBy]) ? null : 'Editing requires the editor role'
}

export interface AiSiteStorePagesRunnerDeps {
  write?: typeof writeAiDraft
  writeSeo?: typeof writeAiDraftScreenSeo
}

/** The store pages' pass: every page written, user accounts on, one output a page. */
export function createAiSiteStorePagesRunner(deps: AiSiteStorePagesRunnerDeps = {}): AiJobStepRunner {
  const write = deps.write ?? writeAiDraft
  const writeSeo = deps.writeSeo ?? writeAiDraftScreenSeo
  return async (context): Promise<AiJobStepOutcome> => {
    const { job, firestore, now } = context
    const model = context.modelFor?.('job.plan') ?? aiModelForStep('job.plan')
    const input = inputOf(job)
    const hostId = job.hostId
    if (!input || !hostId) return { ...aiUnspentOutcome(model), failure: AI_SITE_STORE_PAGES_NOT_WRITTEN_COPY }
    const outputs: AiJobOutput[] = []
    let refusal: string | null = null
    for (const page of aiStorePagesToWrite(input.pages)) {
      const definition = AI_STORE_PAGES.find((one) => one.key === page.key)
      if (!definition) continue
      const id = aiSiteStorePageId(job.$id, page.key)
      const draft = await write(firestore, {
        kind: 'screen',
        hostId,
        id,
        uid: job.createdBy,
        org: context.org ?? null,
        name: definition.title,
        slug: page.slug,
        nodes: aiStorePageNodes(page.key, input.facts) as unknown as NodesMap,
        layoutId: input.layoutId,
        // The account and the cart are a shopper's own pages: unlisted, noindex (AGL-3676).
        ...(definition.noindex ? { visibility: HostScreenVisibility.UNLISTED } : {}),
        aiJobId: aiOriginJobId(job),
        now,
      })
      if (draft.ok === false) {
        // The pages allowance is full, or the site is gone: what was written stays.
        refusal = draft.error
        break
      }
      await writeSeo(firestore, { hostId, id, seo: definition.seo, now })
      outputs.push({
        resource: 'screen',
        id,
        versionId: draft.versionId,
        hostId,
        hostSubdomain: draft.hostSubdomain,
        label: draft.name,
        proposal: { storePage: page.key, path: page.href },
      })
    }
    if (outputs.length) await turnOnSiteAccounts(firestore, hostId, now)
    if (!outputs.length) {
      return refusal
        ? aiUnspentOutcome(model, { review: { reason: 'limit', message: refusal, findings: [] } })
        : { ...aiUnspentOutcome(model), failure: AI_SITE_STORE_PAGES_NOT_WRITTEN_COPY }
    }
    return aiUnspentOutcome(model, { outputs })
  }
}

export const runAiSiteStorePagesUnit = createAiSiteStorePagesRunner()

/**
 * Turns on the site's user accounts (`accounts`, default-off per site), so
 * the account page's sign-in and the platform's /signin and /signup answer.
 * An owner's explicit switch-off is left as it is.
 */
export async function turnOnSiteAccounts(firestore: FirebaseFirestore.Firestore, hostId: string, now: Date): Promise<boolean> {
  const hostRef = firestore.collection('hosts').doc(hostId)
  const host = await hostRef.get()
  if (!host.exists) return false
  const disabled = (host.get('disabledPlugins') ?? []) as unknown[]
  const enabled = (host.get('enabledPlugins') ?? []) as unknown[]
  if (disabled.includes(ACCOUNTS_PLUGIN_ID) || enabled.includes(ACCOUNTS_PLUGIN_ID)) return false
  await hostRef.update({ enabledPlugins: FieldValue.arrayUnion(ACCOUNTS_PLUGIN_ID), updatedAt: now })
  return true
}
