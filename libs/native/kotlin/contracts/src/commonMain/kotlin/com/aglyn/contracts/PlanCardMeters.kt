package com.aglyn.contracts

/*
 * THE PLAN CARD'S METERS (AGL-3992), the console's `plan-card-meters.ts`.
 *
 * Which of the Usage page's meters the sidebar's plan card rotates through, the one that leads for the screen in front,
 * and the order the rest follow. The mapping is generated (`PLAN_CARD_*` in the contract values) and FunctionCasesTest
 * replays function-cases.generated.json, so the Kotlin and Apple cards give the console's answers.
 */

/** One meter's reading: null where the read failed, or where the plan does not cap it (an unlimited quota). */
data class PlanCardReading(val meter: String, val used: Double?, val limit: Double?) {
  /** The share of the limit in use, for a meter the card can draw. */
  val share: Double?
    get() {
      val u = used ?: return null
      val l = limit ?: return null
      return if (u.isFinite() && l.isFinite() && l > 0) u / l else null
    }
}

/** The context of the screen in front: a site's Home is its website; a screen not mapped has none (`planCardContext`). */
fun planCardContext(screen: String?, inSite: Boolean): String? {
  if (screen.isNullOrEmpty()) return null
  if (screen == Contracts.planCardHomeScreen) return if (inSite) "website" else null
  return Contracts.planCardScreenContexts[screen]
}

/**
 * The order the card shows its meters in: the context's meters first, then the rest fullest first (a tie keeps
 * `PLAN_CARD_METERS`' order); failed and uncapped meters left out; Sites leads only on the Sites list
 * (`planCardMeterOrder`).
 */
fun planCardMeterOrder(readings: List<PlanCardReading>, context: String?): List<String> {
  val meters = Contracts.planCardMeters
  val seen = mutableSetOf<String>()
  val shown = readings.filter { it.share != null && seen.add(it.meter) }
  val leading = context?.let { Contracts.planCardContextMeters[it] }.orEmpty()
  val lead = leading.filter { meter -> shown.any { it.meter == meter } }
  fun rank(meter: String) = meters.indexOf(meter).let { if (it < 0) meters.size else it }
  val rest = shown.filter { it.meter !in lead }.sortedWith { a, b ->
    val aSites = a.meter == "sites"
    val bSites = b.meter == "sites"
    when {
      aSites != bSites -> if (aSites) 1 else -1
      a.share!! != b.share!! -> b.share!!.compareTo(a.share!!)
      else -> rank(a.meter).compareTo(rank(b.meter))
    }
  }
  return lead + rest.map { it.meter }
}

/** Whether the card shows: a meter to draw, and a plan the viewer can upgrade or a meter at its warning share. */
fun planCardShows(readings: List<PlanCardReading>, offersUpgrade: Boolean): Boolean {
  val shares = readings.mapNotNull { it.share }
  if (shares.isEmpty()) return false
  return offersUpgrade || shares.any { it >= Contracts.planCardWarningShare }
}
