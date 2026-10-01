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

// Types only: the manifest generator loads this module on its own to compile
// the plan figures, so nothing here may reach a core module at runtime.
import type { OrgPlan } from '@aglyn/aglyn/foundation/definitions/org-billing.types'
import type { PluginPlanEntitlementsDeclaration } from '@aglyn/aglyn/plugin-manager/plugin-plan-entitlements'

/**
 * THE CRM'S PLAN BAND (AGL-3080): the one-to-one email pace each plan
 * includes. Compiled into core's `PLAN_ENTITLEMENTS` by the manifest
 * generator (`register.planEntitlements`); this is where the figure is
 * written, beside the reasoning that sized it.
 */
declare module '@aglyn/aglyn/plugin-manager/plugin-entitlement-keys' {
  interface PluginEntitlementQuotas {
    /**
     * One-to-one emails a workspace may send from CRM records per UTC day —
     * the message a rep writes to one person from their contact page, as
     * against a campaign (`emailSendsPerMonth`) or transactional mail.
     *
     * A HARD cap on every tier and a daily one, because it is the only send
     * class a person can produce by hand at volume: a campaign is one act
     * over a metered audience, and a receipt follows an order somebody paid
     * for, but a rep with a template and a list can put a thousand messages
     * onto the platform's sending reputation in an afternoon. The day
     * boundary is what makes the cap a pace rather than a wall — tomorrow the
     * count is zero again — and the number is sized so that every tier holds
     * its margin with the whole day spent, which is the arithmetic the Drive
     * pricing decision of 2026-09-05 records. `checkCrmEmailQuota` reads it;
     * the counter it is enforced against is
     * `orgs/{orgId}/crmEmailUsage/{day}`.
     *
     * Every send still counts on the org's `emailSends` cost meter, like any
     * other message the provider charged for. 0 on Free, which has no CRM,
     * and finite on every paid tier, Enterprise's 2,000 included.
     *
     * ## This ladder and `emailSendsPerMonth` are NOT the same ladder
     *
     * They answer to different principles, deliberately, and a tier's two
     * numbers are not expected to look like each other. `emailSendsPerMonth`
     * is sized against SHARED-DOMAIN REPUTATION: campaign mail is bulk on a
     * pool every tier without its own verified sending domain rides under
     * `p=reject`, so what one workspace sends is a cost every other workspace
     * pays. This one is sized against COGS SHARE: one-to-one mail is a
     * per-tier margin question, which is why it is a daily pace rather than a
     * monthly band.
     *
     * The two are far apart at the entry tier — a band of 0 beside a real
     * daily allowance — and that reads as an inconsistency until the
     * principles are named. It is not one. One-to-one mail is addressed to a
     * single person, usually inside a relationship the recipient started, and
     * it reaches the provider through a per-user pace limit, both suppression
     * lists, a `declined` consent basis as a hard stop, and an atomic daily
     * reservation. Complaint rates on it are structurally unlike bulk.
     * Reconciling the two ladders would price a reply to one customer as
     * though it carried a campaign's reputation risk.
     */
    crmEmailsPerDay?: number
  }
}

/** The one-to-one emails each plan may send a UTC day — see the key's docblock. */
export const CRM_EMAILS_PER_DAY_BY_PLAN: Readonly<Record<OrgPlan, number>> = {
  // No one-to-one email on Free, which has no CRM: the send lives on a
  // record's page, and Free opens no record. Zero here is what
  // `checkCrmEmailQuota` refuses against, so a per-org grant of
  // `features.crm` alone still sends nothing until the band is raised with
  // it.
  free: 0,
  // One-to-one email from a CRM record, per UTC day (AGL-2611). A hard daily
  // pace rather than a monthly meter, sized so the whole day spent at $0.0009
  // a message leaves the tier's CRM axis inside the 20% cost share the Drive
  // pricing decision of 2026-09-05 sets. 50 a day is $1.35 a month against a
  // $16 annual price. Every send still lands on the `emailSends` cost meter
  // beside the transactional mail this tier already sends.
  starter: 50,
  pro: 150,
  business: 200,
  scale: 300,
  advanced: 500,
  agency: 1000,
  // Finite like the campaign allowance beside it, and for the same reason
  // one-to-one mail is capped on every other tier: a rep with a template and
  // a list can put thousands of messages onto the platform's sending
  // reputation in an afternoon. A negotiated agreement whose reps need more
  // than 2,000 a day says so, and the override is what carries it.
  enterprise: 2_000,
}

/** The CRM's plan figures, for the manifest generator. */
export function crmPlanEntitlements(): PluginPlanEntitlementsDeclaration {
  return {
    quotas: [
      {
        key: 'crmEmailsPerDay',
        label: 'One-to-one emails / day',
        byPlan: CRM_EMAILS_PER_DAY_BY_PLAN,
      },
    ],
  }
}
