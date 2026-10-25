package com.aglyn.core

/**
 * The plan the platform team proposed for a workspace (`upgradeProposal` on the org document, AGL-3466), read the way the
 * console's `standingUpgradeProposal` reads it (libs/aglyn/src/lib/app-utils/upgrade-proposal.ts): only a self-serve
 * paid plan, and only while no subscription is live; its add-ons, cadence and code normalized as
 * `normalizeUpgradeProposalBundle` does, from the generated [BundleWords]. The workspace Home's card shows it to the
 * people who may buy it (AGL-4011). Twin of the Apple kit's `UpgradeProposal`; both replay the console's answers in
 * derived-values.generated.json.
 */
data class UpgradeProposal(
  val plan: String,
  val note: String?,
  /** Each add-on kind and how many, as the plan sells them. */
  val addons: Map<String, Int>,
  /** `month` or `year` when the proposal named a cadence. */
  val interval: String?,
  val coupon: String?,
  /** The Aglyn AI tier, named with the AI add-on. */
  val aiTier: String?,
) {
  private val planLabel: String get() = BundleWords.planLabels[plan] ?: plan

  /** "Starter with Site Care and Aglyn AI, billed yearly, code BOOTH25" (`describeBundle`). */
  val summary: String
    get() {
      val parts = BundleWords.kinds.mapNotNull { kind ->
        val quantity = addons[kind] ?: 0
        if (quantity <= 0) return@mapNotNull null
        val label = if (kind == "aiAddon") aiTier?.let { BundleWords.aiTierNames[it] } ?: BundleWords.labels[kind] ?: kind else BundleWords.labels[kind] ?: kind
        if (quantity > 1) "$quantity × $label" else label
      }
      val joined = when (parts.size) {
        0 -> ""
        1 -> " with ${parts[0]}"
        else -> " with ${parts.dropLast(1).joinToString(", ")} and ${parts.last()}"
      }
      val cadence = when (interval) {
        "year" -> ", billed yearly"
        "month" -> ", billed monthly"
        else -> ""
      }
      return "$planLabel$joined$cadence${coupon?.let { ", code $it" }.orEmpty()}"
    }

  /** Billing will have chosen a whole bundle, not just the plan: the card names it. */
  val bundled: Boolean get() = summary != planLabel

  /** "Acme's Aglyn team proposed the Starter plan" (`upgradeProposalHeadline`). */
  fun headline(orgName: String?, productName: String): String {
    val workspace = orgName?.trim().orEmpty()
    val team = if (workspace.isEmpty()) "Your $productName team" else "$workspace's $productName team"
    return "$team proposed the $planLabel plan"
  }

  /** The card's sentence: Billing has the plan (or the whole bundle) chosen, and nothing changes until they buy. */
  val body: String
    get() = "When you are ready, start the subscription from Billing, where the ${if (bundled) "whole bundle is" else "plan is"} already selected. Nothing changes until you do."

  /** Billing with the plan chosen (`upgradeProposalDestination`). */
  fun destination(orgSlug: String): String =
    OnboardingPlanIntent(plan, interval ?: "month", intervalStated = interval != null, contactSales = false, ai = (addons["aiAddon"] ?: 0) > 0)
      .destination(orgSlug)

  companion object {
    /** The subscription statuses that mean one is live (`LIVE_SUBSCRIPTION_STATUSES`). */
    private val LIVE_STATUSES = setOf("active", "trialing", "past_due")
    private val COUPON = Regex("^[A-Za-z0-9_-]+$")

    /** The proposal that stands for this org document, or null. */
    fun standing(org: Map<String, Any?>?): UpgradeProposal? {
      if (org == null) return null
      if ((org["billingStatus"] as? String) in LIVE_STATUSES) return null
      val raw = org["upgradeProposal"] as? Map<*, *> ?: return null
      val plan = raw["plan"] as? String ?: return null
      if (plan !in OnboardingPlanIntent.SELF_SERVE_PLANS) return null
      val note = (raw["note"] as? String)?.trim()?.takeIf { it.isNotEmpty() }?.take(500)
      val (parsed, parsedTier) = parseAddons(raw["addons"])
      val addons = fit(parsed, plan)
      val interval = (raw["interval"] as? String)?.takeIf { it == "month" || it == "year" }
      val tier = if ((addons["aiAddon"] ?: 0) > 0) (raw["aiTier"] as? String)?.takeIf { it in BundleWords.aiTierNames } ?: parsedTier else null
      val coupon = (raw["coupon"] as? String)?.trim()?.takeIf { it.isNotEmpty() && it.length <= 64 && COUPON.matches(it) }
      return UpgradeProposal(plan, note, addons, interval, coupon, tier)
    }

    /** `parseBundleAddons` over a stored object: each key the parser knows, its quantity (a 0/1 kind counts once). */
    internal fun parseAddons(input: Any?): Pair<Map<String, Int>, String?> {
      val addons = mutableMapOf<String, Int>()
      var tier: String? = null
      val entries = (input as? Map<*, *>)?.entries ?: return emptyMap<String, Int>() to null
      for ((rawName, value) in entries.sortedBy { it.key.toString() }) {
        val quantityText = when (value) {
          null, false -> continue
          true -> ""
          is Number -> if (value.toDouble() == 0.0) continue else if (value.toDouble() % 1.0 == 0.0) value.toLong().toString() else value.toString()
          is String -> if (value.isEmpty() || value == "false" || value == "0") continue else if (value == "true") "" else value
          else -> ""
        }
        val kind = BundleWords.tokens[rawName.toString().trim().lowercase()] ?: continue
        val toggle = kind in BundleWords.toggles
        when {
          quantityText.isEmpty() -> addons[kind] = maxOf(addons[kind] ?: 0, 1)
          quantityText.all { it.isDigit() } -> {
            val quantity = minOf(999L, quantityText.take(9).toLong()).toInt()
            if (quantity >= 1) addons[kind] = maxOf(addons[kind] ?: 0, if (toggle) 1 else quantity)
          }
          kind == "aiAddon" && quantityText.lowercase() in BundleWords.aiTierNames -> {
            addons[kind] = maxOf(addons[kind] ?: 0, 1)
            if (tier == null) tier = quantityText.lowercase()
          }
        }
      }
      return addons to tier
    }

    /** `fitBundleAddonsToPlan`: each kind the plan sells, at most what it sells. */
    internal fun fit(addons: Map<String, Int>, plan: String): Map<String, Int> =
      BundleWords.kinds.mapNotNull { kind ->
        val wanted = addons[kind] ?: 0
        val most = BundleWords.planMax[plan]?.get(kind) ?: 0
        if (wanted > 0 && most > 0) kind to minOf(wanted, most) else null
      }.toMap()
  }
}
