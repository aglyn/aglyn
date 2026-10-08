package com.aglyn.core

/** A release flag's published value: on, a rollout percentage, and the plans it is limited to. */
data class ReleaseFlagValue(val enabled: Boolean, val rolloutPercent: Int, val plans: List<String>)

/** `releaseFlagBucket`: FNV-1a over `flag:subject`, 0 to 99. */
fun releaseFlagBucket(flag: String, subject: String): Int {
  var hash = 0x811c9dc5.toInt()
  for (ch in "$flag:$subject") {
    hash = hash xor ch.code
    hash *= 0x01000193
  }
  return (hash.toUInt() % 100u).toInt()
}

/** `isReleaseFlagOnForOrg`: the org's override first, then the plan targeting, then on, then the rollout bucket. */
fun isReleaseFlagOn(flag: String, value: ReleaseFlagValue, orgId: String?, plan: String?, overrides: Map<String, Any?>?): Boolean {
  (overrides?.get(flag) as? Boolean)?.let { return it }
  if (value.plans.isNotEmpty() && (plan == null || plan !in value.plans)) return false
  if (value.enabled) return true
  val percent = value.rolloutPercent.coerceIn(0, 100)
  if (percent <= 0 || orgId.isNullOrEmpty()) return false
  if (percent >= 100) return true
  return releaseFlagBucket(flag, orgId) < percent
}

/**
 * Whether a release flag is on for a workspace as the console decides it,
 * from the published value; [staff] previews every flag, as the console's
 * staff session does.
 */
@Suppress("UNCHECKED_CAST")
fun releaseFlagOn(flag: String, org: Map<String, Any?>?, orgId: String?, staff: Boolean): Boolean {
  if (staff) return true
  val value = ReleaseFlagDefaults.byKey[flag] ?: ReleaseFlagValue(false, 0, emptyList())
  return isReleaseFlagOn(flag, value, orgId, effectivePlan(org), org?.get("releaseFlags") as? Map<String, Any?>)
}
