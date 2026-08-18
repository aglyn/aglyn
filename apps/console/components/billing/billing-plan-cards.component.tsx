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
  PLAN_ENTITLEMENTS,
  PLAN_LABELS,
  PLAN_PRICING,
  SELF_SERVE_PLANS,
  type OrgPlan,
  UNLIMITED,
} from '@aglyn/aglyn'
import {
  ICON_VARIANT_SYMBOL_CONFIRMED,
  ICON_VARIANT_SYMBOL_MINUS,
} from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  Stack,
  Typography,
} from '@mui/material'
import { useState } from 'react'
import { ENTERPRISE_CONTACT_URL } from '../../constants/shared'
import { DocsHelpTip } from '../docs-help-tip.component'

/**
 * The tiers this grid sells, in ladder order. Enterprise is deliberately NOT
 * here (AGL-1118) — it has no list price and is provisioned by staff, so it
 * gets its own contact-sales card below the grid instead of an Upgrade button.
 */
export const PLAN_ORDER: OrgPlan[] = SELF_SERVE_PLANS

export { PLAN_LABELS }

const PLAN_TAGLINES: Record<OrgPlan, string> = {
  free: 'Try Aglyn and publish your first site.',
  starter: 'Everything a single production site needs.',
  pro: 'For growing teams shipping several sites.',
  business: 'Subscriptions, scheduling, and priority limits.',
  scale: 'Room to grow — 15 sites and a 1% platform fee.',
  advanced: 'High-volume commerce with zero platform fees.',
  agency: 'Run many sites under one org at agency scale.',
  enterprise: 'Unlimited everything, SSO, and a dedicated agreement.',
}

/** What the Enterprise card promises over Agency (the top self-serve tier). */
const ENTERPRISE_HIGHLIGHTS = [
  'Unlimited sites, screens, seats, and storage',
  'SAML / OIDC single sign-on for your whole team',
  'Full white-label — your brand, not ours',
  '0% platform fees on every sale',
  'Custom pricing, invoicing, and terms',
]

const quotaLabel = (value: number, unit?: string) =>
  value === UNLIMITED ? 'Unlimited' : unit ? `${value} ${unit}` : String(value)

const mbLabel = (mb: number) => (mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`)

/** Feature checklist rows, in display order (AGL-69 flags). */
const FEATURE_ROWS: Array<{
  key: keyof (typeof PLAN_ENTITLEMENTS)['free']['features']
  label: string
}> = [
  { key: 'reusableComponents', label: 'Reusable components' },
  { key: 'versioning', label: 'Screen versioning' },
  { key: 'scheduledPublishing', label: 'Scheduled publishing' },
  { key: 'customDomain', label: 'Custom domain' },
  { key: 'removeBranding', label: 'Remove Aglyn branding' },
  { key: 'marketplaceSelling', label: 'Sell on the marketplace' },
  { key: 'aiAssist', label: 'AI assist' },
  { key: 'workflows', label: 'Workflows & automations' },
  { key: 'dataStore', label: 'Datasets & dynamic data' },
  { key: 'bookings', label: 'Appointment bookings' },
  { key: 'videoMedia', label: 'Video & file uploads' },
  { key: 'actions', label: 'Actions builder' },
  { key: 'siteExport', label: 'Site backup & restore' },
  { key: 'redirects', label: 'URL redirects' },
  { key: 'webhooks', label: 'Webhooks' },
  { key: 'multilingual', label: 'Multilingual sites' },
  { key: 'screenAnalytics', label: 'Per-screen traffic analytics' },
  { key: 'marketingOverlays', label: 'Announcement bar & popups' },
  { key: 'mediaCdn', label: 'CDN delivery & responsive images' },
]

export interface BillingPlanCardsProps {
  /** The tenant's current plan; undefined when no plan is assigned yet. */
  plan: OrgPlan | undefined
  /**
   * Billing interval from the page's monthly/annual toggle (AGL-532):
   * 'year' shows the discounted annual headline price on every card.
   */
  interval?: 'month' | 'year'
  /**
   * True when the org reads as Enterprise (`isEnterpriseOrg`) — either on the
   * real `enterprise` plan or on a legacy custom-priced/comped arrangement
   * (AGL-1118). Marks the Enterprise card as the current plan and suppresses
   * every self-serve CTA: an enterprise agreement is changed by talking to
   * us, not by clicking Downgrade.
   */
  enterprise?: boolean
  /**
   * Plan the visitor already chose on the marketing site (AGL-1117), read off
   * `?plan=` by the billing page. It emphasizes that card instead of the
   * next-tier-up default, so the deep link lands on the plan they clicked.
   * Never auto-submits: preselecting a card is a hint, and starting a
   * checkout is a decision the person still has to make here.
   */
  highlight?: OrgPlan
  onSelect: (plan: OrgPlan) => void
}

/**
 * Tiers BELOW the org's current plan, collapsed behind a disclosure (AGL-1859
 * §1: "hide or de-emphasize the lower subscription tiers … upgrade paths
 * prominent and one-click").
 *
 * They are hidden, never removed. A customer looking for a cheaper plan finds
 * it in one click and the copy says exactly where it is — a grid that pretends
 * the lower tiers do not exist is a dark pattern, and it also loses the
 * downsell the retention funnel depends on (AGL-1863). What changes is the
 * DEFAULT: the upgrade path is what the page leads with.
 */
function LowerTierDisclosure(props: {
  count: number
  expanded: boolean
  onToggle: () => void
}) {
  const { count, expanded, onToggle } = props
  if (count < 1) return null
  return (
    <Grid size={{ xs: 12 }}>
      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
        <Button
          size="small"
          color="inherit"
          onClick={onToggle}
          aria-expanded={expanded}
          sx={{ color: 'text.secondary', textTransform: 'none' }}
        >
          {expanded
            ? 'Hide lower plans'
            : `Looking for something smaller? Show ${count} lower plan${
                count === 1 ? '' : 's'
              }`}
        </Button>
        {/* The tip appears only once the lower plans are actually on screen
            (AGL-1929). Collapsed, this is a disclosure control and there is
            nothing yet to explain; expanded, the customer is looking at a
            downgrade, and the one thing no card can say in its own corner is
            WHEN picking it takes effect — end of the paid period, $0 today,
            unlike every upgrade beside it. That asymmetry is invisible on
            the card and is the whole subject of the section this links to. */}
        {expanded ? (
          <DocsHelpTip
            topic="downgradingAndCanceling"
            anchor="#when-changes-take-effect"
            title="Moving to a lower plan takes effect later"
            excerpt="Upgrades apply immediately and prorate. A downgrade waits for the end of the period you already paid for, and $0 is due today."
          />
        ) : null}
      </Stack>
    </Grid>
  )
}

/**
 * Pricing-page plan picker (AGL-71): quota summary + feature checklist per
 * tier, driven entirely from PLAN_ENTITLEMENTS/PLAN_PRICING. The current
 * plan is outlined and the next tier up is emphasized as the recommended
 * upgrade.
 *
 * Tier visibility is ASYMMETRIC (AGL-1859): tiers above the current plan are
 * shown by default with a contained one-click Upgrade; tiers below it are
 * collapsed behind {@link LowerTierDisclosure} and, once shown, dimmed with a
 * quiet text CTA. Nothing is removed and nothing is disabled — the whole
 * ladder stays one click away, which is the line between de-emphasis and a
 * dark pattern.
 *
 * Only the SELF-SERVE tiers appear in the grid (AGL-1118). Enterprise is
 * custom-priced and staff-provisioned, so it gets a full-width contact-sales
 * card after the grid — never a price and never a checkout button.
 */
export function BillingPlanCardsComponent(props: BillingPlanCardsProps) {
  const {
    plan,
    interval = 'month',
    enterprise = false,
    highlight,
    onSelect,
  } = props
  // An enterprise org sits above the ladder: nothing in the grid is its
  // "current" plan, and nothing there is an upgrade for it either.
  const currentIndex = enterprise || !plan ? -1 : PLAN_ORDER.indexOf(plan)
  // A deep-linked plan wins over the next-tier-up heuristic — the visitor
  // told us which one they want. Still suppressed for an enterprise org,
  // whose grid carries no self-serve CTA to emphasize, and ignored when the
  // highlighted tier is the one they are already on.
  const highlightIndex =
    !enterprise && highlight && highlight !== plan
      ? PLAN_ORDER.indexOf(highlight)
      : -1
  const recommendedIndex =
    highlightIndex >= 0
      ? highlightIndex
      : !enterprise && currentIndex >= 0 && currentIndex < PLAN_ORDER.length - 1
        ? currentIndex + 1
        : -1

  // Lower tiers start collapsed (AGL-1859). Only ever collapsed for an org
  // that HAS a plan to be below: a visitor with no plan yet, or an enterprise
  // org, sees the whole ladder, because for them nothing is a downgrade.
  //
  // Except when a deep link asked for one of them. `?plan=starter` arriving
  // from the marketing site while the org is on Pro must still land on the
  // Starter card (AGL-1117) — collapsing the tier the visitor explicitly
  // clicked would make the link look broken, and de-emphasis is a default,
  // not an override of a stated intent.
  const [showLowerTiers, setShowLowerTiers] = useState(
    () => highlightIndex >= 0 && currentIndex >= 0 && highlightIndex < currentIndex,
  )
  const lowerTierCount = currentIndex > 0 ? currentIndex : 0

  return (
    <Grid container spacing={2} id="plans">
      {PLAN_ORDER.map((tier, index) => {
        const entitlements = PLAN_ENTITLEMENTS[tier]
        const pricing = PLAN_PRICING[tier]
        // Below the current plan: de-emphasized, and behind the disclosure.
        const isLower = currentIndex >= 0 && index < currentIndex
        if (isLower && !showLowerTiers) return null
        // An enterprise org's stored `plan` may still be the base tier it was
        // provisioned on (AGL-1110) — marking that tier "Current plan" put a
        // second green badge in the grid next to the Enterprise card's. The
        // Enterprise card is the only current one for such an org.
        const isCurrent = !enterprise && tier === plan
        const isRecommended = index === recommendedIndex
        return (
          <Grid key={tier} size={{ xs: 12, sm: 6, lg: 3 }}>
            <Card
              variant="outlined"
              sx={{
                height: '100%',
                position: 'relative',
                borderColor: isCurrent
                  ? 'success.main'
                  : isRecommended
                    ? 'primary.main'
                    : 'divider',
                borderWidth: isCurrent || isRecommended ? 2 : 1,
                // De-emphasis is visual only — every figure stays readable and
                // no control is disabled. Dimming a card the customer just
                // asked to see would be a dark pattern, not a nudge.
                ...(isLower ? { opacity: 0.66 } : {}),
              }}
            >
              <CardContent>
                <Stack
                  direction="row"
                  sx={{ justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <Typography variant="h6">{PLAN_LABELS[tier]}</Typography>
                  {isCurrent ? (
                    <Chip label="Current plan" color="success" size="small" />
                  ) : isRecommended ? (
                    <Chip label="Recommended" color="primary" size="small" />
                  ) : null}
                </Stack>
                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{ alignItems: 'baseline', my: 1 }}
                >
                  <Typography variant="h4" component="span">
                    {`$${
                      interval === 'year'
                        ? pricing.basePriceAnnualMonthlyUsd
                        : pricing.basePriceMonthlyUsd
                    }`}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {interval === 'year' && tier !== 'free'
                      ? '/month, billed yearly'
                      : '/month'}
                  </Typography>
                </Stack>
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1.5, minHeight: 40 }}
                >
                  {PLAN_TAGLINES[tier]}
                </Typography>
                {enterprise ? (
                  // An enterprise agreement is not swapped for a list-price
                  // tier from this grid (AGL-1118) — the change goes through
                  // whoever owns the contract.
                  <Button fullWidth size="small" disabled sx={{ mb: 1.5 }}>
                    {'Contact us to change'}
                  </Button>
                ) : !isCurrent ? (
                  <Button
                    fullWidth
                    size="small"
                    // Asymmetric by design (AGL-1859 §2). An upgrade is the
                    // page's loudest control; a downgrade is a quiet text
                    // button that opens the deliberate confirm flow the
                    // billing page owns — never a one-click peer of Upgrade
                    // sitting at equal weight beside it.
                    variant={
                      index > currentIndex
                        ? 'contained'
                        : isLower
                          ? 'text'
                          : 'outlined'
                    }
                    color={isLower ? 'inherit' : 'primary'}
                    // Free has no Stripe price to check out; moving down to
                    // it means canceling the subscription (Stripe portal,
                    // not built yet).
                    disabled={tier === 'free'}
                    onClick={() => onSelect(tier)}
                    sx={{ mb: 1.5, ...(isLower ? { color: 'text.secondary' } : {}) }}
                  >
                    {/* AGL-1178: while pre-release, the Free card must not
                        promise the price is permanent — no price locks, no
                        grandfathering. Enforced by no-price-commitment.spec. */}
                    {tier === 'free'
                      ? 'No credit card required'
                      : currentIndex < 0 || index > currentIndex
                        ? 'Upgrade'
                        : 'Downgrade'}
                  </Button>
                ) : (
                  <Button fullWidth size="small" disabled sx={{ mb: 1.5 }}>
                    {'Your plan'}
                  </Button>
                )}
                <Divider sx={{ mb: 1.5 }} />
                <Stack spacing={0.5} sx={{ mb: 1.5 }}>
                  <Typography variant="body2">
                    {`${quotaLabel(entitlements.hostLimit)} host${
                      entitlements.hostLimit === 1 ? '' : 's'
                    }`}
                    {pricing.extraHostMonthlyUsd != null
                      ? ` (+$${pricing.extraHostMonthlyUsd}/extra)`
                      : ''}
                  </Typography>
                  <Typography variant="body2">
                    {`${quotaLabel(entitlements.screensPerHost)} screens per host`}
                  </Typography>
                  <Typography variant="body2">
                    {`${quotaLabel(entitlements.sharedLayoutsPerHost)} shared layouts`}
                  </Typography>
                  {/* Media storage only. The `totalSiteSizeMb` figure used to
                      sit beside it and was dropped in AGL-1370: it is
                      structurally unreachable (the 900 KB node-map wall of
                      AGL-678 bounds a whole site to a few percent of the
                      advertised cap), so the card was publishing a number we
                      do not back. The entitlement stays as an internal
                      signal. */}
                  <Typography variant="body2">
                    {`${mbLabel(entitlements.storagePerHostMb)} storage`}
                  </Typography>
                  <Typography variant="body2">
                    {`${entitlements.bandwidthGb} GB bandwidth`}
                  </Typography>
                  <Typography variant="body2">
                    {`${entitlements.managersPerOrg} team seat${
                      entitlements.managersPerOrg === 1 ? '' : 's'
                    }`}
                    {pricing.extraSeatMonthlyUsd != null
                      ? ` (+$${pricing.extraSeatMonthlyUsd}/extra, ` +
                        `max ${entitlements.maxManagersPerOrg})`
                      : ''}
                  </Typography>
                  {/* Per-site console collaborators (AGL-888) — end-user
                      member accounts are unlimited and listed separately. */}
                  <Typography variant="body2">
                    {`${entitlements.membersPerHost} site collaborator${
                      entitlements.membersPerHost === 1 ? '' : 's'
                    }`}
                    {pricing.extraCollaboratorMonthlyUsd != null
                      ? ` (+$${pricing.extraCollaboratorMonthlyUsd}/extra, ` +
                        `max ${entitlements.maxMembersPerHost})`
                      : ''}
                  </Typography>
                  {/* Visitor signups are never capped (AGL-889). */}
                  <Typography variant="body2">
                    {'Unlimited member accounts'}
                  </Typography>
                  {/* Audience band (AGL-890): paid tiers meter overage. */}
                  <Typography variant="body2">
                    {`${entitlements.contactsPerHost.toLocaleString()} contacts`}
                    {pricing.extraContactsUsdPer1k != null
                      ? ` (+$${pricing.extraContactsUsdPer1k}/1k over)`
                      : ''}
                  </Typography>
                  <Typography variant="body2">
                    {`${quotaLabel(entitlements.variablesPerHost)} variables · ` +
                      `${quotaLabel(entitlements.functionsPerHost)} functions · ` +
                      `${quotaLabel(entitlements.workflowsPerHost)} workflows`}
                  </Typography>
                  <Typography variant="body2">
                    {entitlements.datasetsPerOrg > 0
                      ? `${quotaLabel(entitlements.datasetsPerOrg)} org datasets × ` +
                        `${quotaLabel(entitlements.recordsPerDataset)} records · ` +
                        `${Math.round(entitlements.dataStorageMbPerOrg / 1024)} GB data`
                      : 'No datasets'}
                  </Typography>
                  <Typography variant="body2">
                    {entitlements.apiRequestsPerMonth > 0
                      ? `${entitlements.apiRequestsPerMonth.toLocaleString()} API requests/mo` +
                        (pricing.extraApiRequestsUsdPer1k != null
                          ? ` (+$${pricing.extraApiRequestsUsdPer1k}/1k over)`
                          : '')
                      : 'No API access'}
                  </Typography>
                  {/* Declining platform-fee ladder (AGL-892): charged at
                      checkout as the Stripe Connect application fee;
                      memberships/gated content bill at the digital rate. */}
                  <Typography variant="body2">
                    {entitlements.features.commerce
                      ? entitlements.transactionFeePhysicalPct > 0 ||
                        entitlements.transactionFeeDigitalPct > 0
                        ? `${entitlements.transactionFeePhysicalPct}% physical · ` +
                          `${entitlements.transactionFeeDigitalPct}% digital & ` +
                          'membership fees'
                        : '0% platform fees'
                      : 'No storefront'}
                  </Typography>
                </Stack>
                <Stack spacing={0.5}>
                  {FEATURE_ROWS.map(({ key, label }) => {
                    const enabled = entitlements.features[key]
                    return (
                      <Stack
                        key={key}
                        direction="row"
                        spacing={0.75}
                        sx={{
                          alignItems: 'center',
                          color: enabled ? 'text.primary' : 'text.disabled',
                        }}
                      >
                        <MdiIcon
                          fontSize="inherit"
                          sx={{
                            color: enabled ? 'success.main' : 'text.disabled',
                          }}
                          path={
                            enabled
                              ? ICON_VARIANT_SYMBOL_CONFIRMED.path
                              : ICON_VARIANT_SYMBOL_MINUS.path
                          }
                        />
                        <Typography variant="body2">{label}</Typography>
                      </Stack>
                    )
                  })}
                </Stack>
              </CardContent>
            </Card>
          </Grid>
        )
      })}
      <LowerTierDisclosure
        count={lowerTierCount}
        expanded={showLowerTiers}
        onToggle={() => setShowLowerTiers((shown) => !shown)}
      />
      {/* Enterprise (AGL-1118): custom-priced, so it shows what it includes
          and how to get it — never a headline price or a checkout button. */}
      <Grid size={{ xs: 12 }}>
        <Card
          variant="outlined"
          sx={{
            borderColor: enterprise ? 'success.main' : 'divider',
            borderWidth: enterprise ? 2 : 1,
          }}
        >
          <CardContent>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              sx={{ justifyContent: 'space-between' }}
            >
              <Stack spacing={1} sx={{ flex: 1 }}>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center' }}
                >
                  <Typography variant="h6">
                    {PLAN_LABELS.enterprise}
                  </Typography>
                  {enterprise ? (
                    <Chip label="Current plan" color="success" size="small" />
                  ) : null}
                </Stack>
                <Typography variant="h5" component="p">
                  {'Custom pricing'}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {PLAN_TAGLINES.enterprise}
                </Typography>
              </Stack>
              <Stack spacing={0.5} sx={{ flex: 2 }}>
                {ENTERPRISE_HIGHLIGHTS.map((label) => (
                  <Stack
                    key={label}
                    direction="row"
                    spacing={0.75}
                    sx={{ alignItems: 'center' }}
                  >
                    <MdiIcon
                      fontSize="inherit"
                      sx={{ color: 'success.main' }}
                      path={ICON_VARIANT_SYMBOL_CONFIRMED.path}
                    />
                    <Typography variant="body2">{label}</Typography>
                  </Stack>
                ))}
              </Stack>
              <Stack
                spacing={1}
                sx={{ flex: 1, justifyContent: 'center', minWidth: 200 }}
              >
                {enterprise ? (
                  <Typography variant="body2" color="text.secondary">
                    {'Your organization is on an Enterprise agreement — ' +
                      'reach out for any change to it.'}
                  </Typography>
                ) : (
                  <Button
                    fullWidth
                    variant="contained"
                    color="primary"
                    href={ENTERPRISE_CONTACT_URL}
                    target="_blank"
                    rel="noopener"
                  >
                    {'Contact sales'}
                  </Button>
                )}
              </Stack>
            </Stack>
          </CardContent>
        </Card>
      </Grid>
    </Grid>
  )
}
BillingPlanCardsComponent.displayName = 'BillingPlanCardsComponent'

export default BillingPlanCardsComponent
