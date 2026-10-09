package com.aglyn.contracts

import kotlin.math.floor

/*
 * The funnels plugin's pure rules, ported once from its model
 * (`funnel-definition.ts`, `funnel-inventory.ts`, `drop-off.ts`,
 * `funnel-format.ts`) and held to the console's own answers by the function
 * cases. A native editor checks a funnel as the save route does, and a result
 * reads as the Funnels card reads it. The route checks again; these exist so a
 * person is told before the round trip.
 */

private val EVENT_NAME = Regex("^[a-z][a-z0-9_]{0,39}$")

private val ANY_ALLOWED = setOf(
  SiteJourneyStepType.FORM,
  SiteJourneyStepType.BOOKING,
  SiteJourneyStepType.CART,
  SiteJourneyStepType.ORDER,
  SiteJourneyStepType.OVERLAY,
)

/** Every step type a person can pick, in the console editor's order. */
val FUNNEL_STEP_TYPES: List<SiteJourneyStepType> = listOf(
  SiteJourneyStepType.PAGE,
  SiteJourneyStepType.FORM,
  SiteJourneyStepType.BOOKING,
  SiteJourneyStepType.CART,
  SiteJourneyStepType.ORDER,
  SiteJourneyStepType.OVERLAY,
  SiteJourneyStepType.EVENT,
  SiteJourneyStepType.EMAIL,
)

/** The keys an `email` step carries. */
val FUNNEL_EMAIL_KEYS = listOf("opened", "clicked")

/** What a step type is called in the editor and the results (`FUNNEL_STEP_TYPE_LABELS`). */
fun funnelStepTypeLabel(type: SiteJourneyStepType): String = Contracts.funnelStepTypeLabels[type.raw] ?: type.raw

/** What the editor offers a person to start with: the step as typed, before any check. */
data class FunnelStepInput(val type: String?, val key: String? = null, val match: String? = null, val label: String? = null)

/** A cleaned funnel, or the first reason it cannot be saved. */
data class FunnelCheck(val funnel: FunnelDefinition? = null, val error: String? = null)

/** A path with no query, no fragment and no trailing slash (except `/`). */
fun normalizeFunnelPath(raw: String): String {
  var path = raw.trim()
  val cut = path.indexOfFirst { it == '?' || it == '#' }
  if (cut >= 0) path = path.substring(0, cut)
  if (!path.startsWith("/")) path = "/$path"
  path = path.replace(Regex("/{2,}"), "/")
  if (path.length > 1) path = path.trimEnd('/').ifEmpty { "/" }
  return path.take(Contracts.siteJourneyKeyMax.toInt())
}

private fun stepTypeOf(raw: String?): SiteJourneyStepType? =
  FUNNEL_STEP_TYPES.firstOrNull { it.raw == raw }

/** One step, cleaned, or the reason it cannot be a step. */
fun normalizeFunnelStep(input: FunnelStepInput): Pair<FunnelStep?, String?> {
  val type = stepTypeOf(input.type) ?: return null to "Pick what the step is."
  var key = (input.key ?: "").trim().take(Contracts.siteJourneyKeyMax.toInt())
  val label = (input.label ?: "").trim().take(Contracts.funnelLabelMax.toInt()).ifEmpty { null }
  when (type) {
    SiteJourneyStepType.PAGE -> {
      if (key.isEmpty()) return null to "A page step needs a path."
      key = normalizeFunnelPath(key)
      val match = if (input.match == "prefix") FunnelPageMatch.PREFIX else FunnelPageMatch.EXACT
      return FunnelStep(key = key, label = label, match = match, type = type) to null
    }
    SiteJourneyStepType.ORDER -> return FunnelStep(key = "", label = label, type = type) to null
    SiteJourneyStepType.EMAIL -> {
      if (key !in FUNNEL_EMAIL_KEYS) return null to "An email step is an email opened or a link in it clicked."
      return FunnelStep(key = key, label = label, type = type) to null
    }
    SiteJourneyStepType.EVENT -> {
      if (!EVENT_NAME.matches(key)) return null to "A custom event step needs the event’s name, as the interaction sends it."
    }
    else -> if (key.isEmpty() && type !in ANY_ALLOWED) return null to "Pick what the step names."
  }
  return FunnelStep(key = key, label = label, type = type) to null
}

/** A whole definition, cleaned, or the first reason it cannot be saved. */
fun normalizeFunnelDefinition(name: String?, steps: List<FunnelStepInput>): FunnelCheck {
  val clean = (name ?: "").trim().take(Contracts.funnelNameMax.toInt())
  if (clean.isEmpty()) return FunnelCheck(error = "Name the funnel.")
  val min = Contracts.funnelMinSteps.toInt()
  val max = Contracts.funnelMaxSteps.toInt()
  if (steps.size < min || steps.size > max) return FunnelCheck(error = "A funnel has $min to $max steps.")
  val cleaned = mutableListOf<FunnelStep>()
  for ((index, input) in steps.withIndex()) {
    val (step, error) = normalizeFunnelStep(input)
    if (step == null) return FunnelCheck(error = "Step ${index + 1}: $error")
    cleaned += step
  }
  return FunnelCheck(funnel = FunnelDefinition(clean, cleaned))
}

/** The words a result shows for a step: its label, else a description. */
fun funnelStepTitle(step: FunnelStep): String {
  step.label?.takeIf { it.isNotEmpty() }?.let { return it }
  val what = funnelStepTypeLabel(step.type)
  return when (step.type) {
    SiteJourneyStepType.PAGE -> if (step.match == FunnelPageMatch.PREFIX) "$what: ${step.key} and below" else "$what: ${step.key}"
    SiteJourneyStepType.ORDER -> what
    SiteJourneyStepType.EMAIL -> "$what: ${Contracts.funnelEmailKeyLabels[step.key] ?: step.key}"
    else -> if (step.key.isNotEmpty()) "$what: ${step.key}" else "$what (any)"
  }
}

/** The inventory list a step type picks from, or null for types with none. */
fun funnelInventoryList(inventory: FunnelInventory, type: SiteJourneyStepType): List<FunnelInventoryItem>? = when (type) {
  SiteJourneyStepType.FORM -> inventory.forms
  SiteJourneyStepType.BOOKING -> inventory.services
  SiteJourneyStepType.CART -> inventory.products
  SiteJourneyStepType.OVERLAY -> inventory.overlays
  else -> null
}

/** Why a step names something the site does not have, or null. */
fun stepInventoryProblem(step: FunnelStep, inventory: FunnelInventory): String? {
  if (step.type == SiteJourneyStepType.PAGE) {
    if (step.match == FunnelPageMatch.PREFIX) {
      val covered = step.key == "/" || inventory.pages.any { it == step.key || it.startsWith("${step.key}/") }
      return if (covered) null else "No page on this site is at or under ${step.key}."
    }
    return if (step.key in inventory.pages) null else "This site has no page at ${step.key}."
  }
  val list = funnelInventoryList(inventory, step.type)
  if (list == null || step.key.isEmpty()) return null
  return if (list.any { it.id == step.key }) null else "${funnelStepTitle(step.copy(label = null))} is not on this site."
}

/** A step's label from the inventory, when the step has none of its own. */
fun labelStepFromInventory(step: FunnelStep, inventory: FunnelInventory): FunnelStep {
  if (!step.label.isNullOrEmpty()) return step
  val item = funnelInventoryList(inventory, step.type)?.firstOrNull { it.id == step.key }
  return if (item != null) step.copy(label = item.name) else step
}

/** How a wait reads: "1 hour", "3 days". */
fun waitLabel(hours: Int): String {
  if (hours % 24 == 0) {
    val days = hours / 24
    return if (days == 1) "1 day" else "$days days"
  }
  return if (hours == 1) "1 hour" else "$hours hours"
}

private fun jsRound(value: Double): Long = floor(value + 0.5).toLong()

/** A share (0-1) as the card reads it: `33.3%`, or a dash for none. */
fun formatShare(value: Double?): String {
  if (value == null) return "—"
  val rounded = jsRound(value * 1000) / 10.0
  return if (rounded == floor(rounded)) "${rounded.toLong()}%" else "$rounded%"
}

/** A duration as a person reads it: `45s`, `3m 05s`, `2h 10m`, `3d 4h`. */
fun formatDuration(ms: Double?): String {
  if (ms == null) return "—"
  val seconds = jsRound(ms / 1000)
  if (seconds < 60) return "${seconds}s"
  val minutes = seconds / 60
  if (minutes < 60) return "${minutes}m ${(seconds % 60).toString().padStart(2, '0')}s"
  val hours = minutes / 60
  if (hours < 48) return "${hours}h ${minutes % 60}m"
  return "${hours / 24}d ${hours % 24}h"
}
