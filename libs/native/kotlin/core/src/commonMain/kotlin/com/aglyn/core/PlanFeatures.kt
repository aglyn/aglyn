package com.aglyn.core

private val DEAD_SUBSCRIPTION_STATUSES = setOf("canceled", "unpaid", "incomplete", "incomplete_expired")

/**
 * The plan a workspace's entitlements resolve from, as the console's
 * `resolveEffectivePlan`: a comp when no subscription is live, else the
 * stored plan, which a dead subscription takes back to free.
 */
@Suppress("UNCHECKED_CAST")
fun effectivePlan(org: Map<String, Any?>?): String {
  val mirrored = (org?.get("billingStatus") as? String)?.takeIf { it.isNotEmpty() }
  val status = mirrored ?: ((org?.get("subscription") as? Map<String, Any?>)?.get("status") as? String)
  val live = status != null && status.isNotEmpty() && status !in DEAD_SUBSCRIPTION_STATUSES
  val comp = ((org?.get("entitlements") as? Map<String, Any?>)?.get("planComp") as? Map<String, Any?>)?.get("plan") as? String
  if (!live && comp != null && comp != "free" && comp in PlanFeatureDefaults.byPlan) return comp
  val plan = org?.get("plan") as? String
  if (plan == null || plan !in PlanFeatureDefaults.byPlan) return "free"
  if (plan != "free" && status != null && status in DEAD_SUBSCRIPTION_STATUSES) return "free"
  return plan
}

/**
 * Whether the workspace carries a plan feature, as the console's
 * `checkEntitlement` answers for the features native screens gate on: a
 * per-org override first, else the effective plan's default.
 */
@Suppress("UNCHECKED_CAST")
fun planFeatureCarried(org: Map<String, Any?>?, feature: String): Boolean {
  val override = ((org?.get("entitlements") as? Map<String, Any?>)?.get("features") as? Map<String, Any?>)?.get(feature) as? Boolean
  return override ?: (PlanFeatureDefaults.byPlan[effectivePlan(org)]?.get(feature) ?: false)
}
