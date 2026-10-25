package com.aglyn.core

/**
 * The plan the platform team proposed for a workspace (`upgradeProposal` on the org document, AGL-3466), read the way the
 * console's `standingUpgradeProposal` reads it (libs/aglyn/src/lib/app-utils/upgrade-proposal.ts): only a self-serve
 * paid plan, and only while no subscription is live. The workspace Home's card shows it to the people who may buy it
 * (AGL-4011). Twin of the Apple kit's `UpgradeProposal`.
 */
data class UpgradeProposal(
  val plan: String,
  val note: String?,
  /** `month` or `year` when the proposal named a cadence. */
  val interval: String?,
  /** Add-ons, a cadence or a coupon beside the plan: Billing will have chosen a whole bundle. */
  val bundled: Boolean,
  /** The AI add-on is part of it. */
  val ai: Boolean,
) {
  /** "Acme's Aglyn team proposed the Starter plan" (`upgradeProposalHeadline`). */
  fun headline(orgName: String?, productName: String): String {
    val workspace = orgName?.trim().orEmpty()
    val team = if (workspace.isEmpty()) "Your $productName team" else "$workspace's $productName team"
    return "$team proposed the ${OnboardingPlanIntent.PLAN_LABELS[plan] ?: plan.replaceFirstChar { it.uppercase() }} plan"
  }

  /** The card's sentence: Billing has the plan (or the whole bundle) chosen, and nothing changes until they buy. */
  val body: String
    get() = "When you are ready, start the subscription from Billing, where the ${if (bundled) "whole bundle is" else "plan is"} already selected. Nothing changes until you do."

  /** Billing with the plan chosen (`upgradeProposalDestination`). */
  fun destination(orgSlug: String): String =
    OnboardingPlanIntent(plan, interval ?: "month", intervalStated = interval != null, contactSales = false, ai = ai).destination(orgSlug)

  companion object {
    /** The subscription statuses that mean one is live (`LIVE_SUBSCRIPTION_STATUSES`). */
    private val LIVE_STATUSES = setOf("active", "trialing", "past_due")

    /** The proposal that stands for this org document, or null. */
    fun standing(org: Map<String, Any?>?): UpgradeProposal? {
      if (org == null) return null
      if ((org["billingStatus"] as? String) in LIVE_STATUSES) return null
      val raw = org["upgradeProposal"] as? Map<*, *> ?: return null
      val plan = raw["plan"] as? String ?: return null
      if (plan !in OnboardingPlanIntent.SELF_SERVE_PLANS) return null
      val note = (raw["note"] as? String)?.trim()?.takeIf { it.isNotEmpty() }?.take(500)
      val interval = (raw["interval"] as? String)?.takeIf { it == "month" || it == "year" }
      val addons = raw["addons"] as? Map<*, *>
      val anyAddon = addons.orEmpty().values.any { ((it as? Number)?.toDouble() ?: 0.0) > 0 }
      val coupon = (raw["coupon"] as? String)?.isNotEmpty() == true
      val ai = ((addons?.get("aiAddon") as? Number)?.toDouble() ?: 0.0) > 0
      return UpgradeProposal(plan, note, interval, anyAddon || interval != null || coupon, ai)
    }
  }
}
