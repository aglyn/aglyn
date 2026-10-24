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
import { platformConsoleOrigin } from '@aglyn/aglyn/app-utils/platform-brand'
import {
  standingUpgradeProposal,
  upgradeProposalDestination,
  upgradeProposalSummary,
} from '@aglyn/aglyn/app-utils/upgrade-proposal'
import { PLAN_LABELS } from '@aglyn/aglyn/app-utils/plan-entitlements'
import type { AglynOrgBilling } from '@aglyn/aglyn/server'
import { isEmailConfigured, sendEmail } from '@aglyn/shared-util-email'
import { meterOrgEmail } from './email-metering'
import { firebaseAdmin } from './firebase-admin'
import {
  renderSystemEmailContent,
  systemEmailBrand,
} from './render-system-email'

export interface OwnerHandoffEmailsOptions {
  orgId: string
  newOwner: { email: string; displayName?: string | null }
  previousOwner: { email: string | null; displayName?: string | null }
  /** `stay` keeps the previous owner on as an admin; `leave` removes them. */
  previousOwnerStays: boolean
}

/**
 * The two emails a completed workspace handoff sends (AGL-4023): one to the
 * new owner, one to the person who handed it over.
 *
 * A handoff changes who holds the workspace, every site in it and its
 * billing, and both sides need to hear it from the platform, not only from
 * a console notification one of them may never open: the new owner because
 * an invitation now takes effect on its own, with nothing for them to press,
 * and the previous owner because it is the moment their workspace stopped
 * being theirs.
 *
 * Sent after the handoff's transaction has committed, from
 * `acceptOwnerHandoff`, so every way a handoff completes sends them. Never
 * throws: the handoff has happened whether or not the mail goes.
 */
export async function sendOwnerHandoffEmails(
  options: OwnerHandoffEmailsOptions,
): Promise<void> {
  if (!isEmailConfigured()) return
  try {
    for (const message of await buildOwnerHandoffEmails(options)) {
      await sendEmail(message)
      await meterOrgEmail(options.orgId)
    }
  } catch (error) {
    console.error('owner handoff emails failed', error)
  }
}

/** One message {@link buildOwnerHandoffEmails} renders, ready for `sendEmail`. */
export interface OwnerHandoffEmail {
  to: string
  subject: string
  text: string
  html?: string
  fromName?: string
  context: string
}

/**
 * The two messages, rendered in the workspace's brand and not sent: the new
 * owner's, then the previous owner's when they have an address.
 */
export async function buildOwnerHandoffEmails(
  options: OwnerHandoffEmailsOptions,
): Promise<OwnerHandoffEmail[]> {
  const { orgId, newOwner, previousOwner, previousOwnerStays } = options
  const messages: OwnerHandoffEmail[] = []
  {
    const orgSnapshot = await firebaseAdmin
      .app()
      .firestore()
      .collection('orgs')
      .doc(orgId)
      .get()
    const org = (orgSnapshot.data() ?? {}) as Partial<AglynOrgBilling> & {
      name?: string
      slug?: string
    }
    const orgName = String(org.name ?? 'your workspace')
    const slug = String(org.slug ?? '')
    const origin = platformConsoleOrigin()
    const brand = systemEmailBrand(
      orgSnapshot.exists ? (orgSnapshot.data() ?? null) : null,
    )
    const newOwnerName = newOwner.displayName?.trim() || newOwner.email
    const previousOwnerName =
      previousOwner.displayName?.trim() ||
      previousOwner.email ||
      'The previous owner'

    // The new owner: theirs now, and the next step. A handoff that proposed
    // its plan (AGL-3956) still has it standing, so the button is Billing
    // with that plan chosen; otherwise it opens the workspace.
    const proposal = standingUpgradeProposal(org)
    const planLabel = proposal
      ? (PLAN_LABELS[proposal.plan] ?? proposal.plan)
      : ''
    const nextStep = proposal
      ? `Your plan is ready to start: ${upgradeProposalSummary(proposal, {
          brand: brand.merge['brand.productName'],
        })}. Billing opens with it already chosen, and nothing is charged ` +
        'until you confirm.'
      : 'Open the workspace to see its sites, its team and Billing.'
    const newOwnerCta =
      proposal && slug
        ? {
            label: `Start the ${planLabel} plan`,
            url: `${origin}${upgradeProposalDestination(slug, proposal)}`,
          }
        : { label: `Open ${orgName}`, url: slug ? `${origin}/${slug}` : origin }
    const previousOwnerLine = previousOwnerStays
      ? `${previousOwnerName} stays on as an admin.`
      : `${previousOwnerName} has left the workspace.`
    const toNewOwner = await renderSystemEmailContent(
      'org-owner-handoff-new-owner',
      {
        'org.name': orgName,
        'handoff.previousOwner': previousOwnerLine,
        nextStep,
        'cta.label': newOwnerCta.label,
        'cta.url': newOwnerCta.url,
      },
      brand,
      {
        subject: `${orgName} is yours`,
        text:
          `You now own ${orgName}: the workspace, every site in it, and its ` +
          `billing. ${previousOwnerLine}\n\n${nextStep}\n\n${newOwnerCta.url}`,
      },
    )
    messages.push({
      to: newOwner.email,
      ...toNewOwner,
      ...(brand.fromName ? { fromName: brand.fromName } : {}),
      context: 'org-owner-handoff-new-owner',
    })

    // The person who handed it over: who holds it now, and where that
    // leaves them.
    if (previousOwner.email) {
      const outcome = previousOwnerStays
        ? 'You stay on as an admin, so you can keep helping with the workspace and its sites.'
        : 'You have left the workspace and no longer have access to it.'
      const previousOwnerCta =
        previousOwnerStays && slug
          ? { label: 'Open the team', url: `${origin}/${slug}/team` }
          : { label: 'Open your workspaces', url: origin }
      const toPreviousOwner = await renderSystemEmailContent(
        'org-owner-handoff-previous-owner',
        {
          'org.name': orgName,
          'newOwner.name': newOwnerName,
          'newOwner.email': newOwner.email,
          'previousOwner.role': previousOwnerStays
            ? 'Admin'
            : 'Left the workspace',
          'previousOwner.outcome': outcome,
          'cta.label': previousOwnerCta.label,
          'cta.url': previousOwnerCta.url,
        },
        brand,
        {
          subject: `${newOwnerName} now owns ${orgName}`,
          text:
            `${newOwnerName} took over ${orgName}. They now hold the ` +
            `workspace, every site in it, and its billing.\n\n${outcome}\n\n` +
            previousOwnerCta.url,
        },
      )
      messages.push({
        to: previousOwner.email,
        ...toPreviousOwner,
        ...(brand.fromName ? { fromName: brand.fromName } : {}),
        context: 'org-owner-handoff-previous-owner',
      })
    }
  }
  return messages
}
