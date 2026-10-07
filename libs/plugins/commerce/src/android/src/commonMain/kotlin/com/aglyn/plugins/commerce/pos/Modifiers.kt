package com.aglyn.plugins.commerce.pos

import com.aglyn.contracts.ModifierSelection
import com.aglyn.contracts.ProductModifierGroup
import com.aglyn.contracts.ProductModifierOption

/*
 * Register modifiers (`product-modifiers.ts`): choices added to an item as it
 * is rung up ("Oat milk", "Extra shot +$1.00") that are not stocked variants.
 * The register sends only the chosen option ids; the SERVER prices them from
 * the product, so the figures here are a preview checked by the same rules.
 */

const val POS_MAX_MODIFIER_GROUPS = 10
const val POS_MAX_MODIFIER_OPTIONS = 20
const val POS_MAX_MODIFIER_PRICE_CENTS = 100_000

/** A chosen modifier as a line carries it: names and price as sold. */
data class LineModifier(
  val groupId: String,
  val optionId: String,
  val group: String,
  val name: String,
  val priceCents: Long,
)

private fun Double.isWhole() = isFinite() && this == kotlin.math.floor(this)

/** Why groups cannot be used, or null when they are well formed (`modifierGroupsProblem`). */
fun modifierGroupsProblem(groups: List<ProductModifierGroup>): String? {
  if (groups.size > POS_MAX_MODIFIER_GROUPS) return "At most $POS_MAX_MODIFIER_GROUPS modifier groups per product"
  val groupIds = mutableSetOf<String>()
  for (group in groups) {
    if (group.id.isEmpty() || !groupIds.add(group.id)) return "Modifier groups need unique ids"
    if (group.name.isBlank()) return "Name every modifier group"
    if (group.options.isEmpty()) return "Add a choice to “${group.name}”"
    if (group.options.size > POS_MAX_MODIFIER_OPTIONS) return "“${group.name}” has more than $POS_MAX_MODIFIER_OPTIONS choices"
    val optionIds = mutableSetOf<String>()
    for (option in group.options) {
      if (option.id.isEmpty() || !optionIds.add(option.id)) return "Modifier choices need unique ids"
      if (option.name.isBlank()) return "Name every choice in “${group.name}”"
      if (!option.priceCents.isWhole() || option.priceCents < 0 || option.priceCents > POS_MAX_MODIFIER_PRICE_CENTS) {
        return "“${option.name}” needs a price of $0 to $1,000"
      }
    }
    if (!group.min.isWhole() || group.min < 0) return "“${group.name}” needs a minimum of 0 or more"
    if (!group.max.isWhole() || group.max < 1 || group.max > group.options.size) return "“${group.name}” allows 1 to ${group.options.size} choices"
    if (group.min > group.max) return "“${group.name}” requires more choices than it allows"
  }
  return null
}

/** The product's groups, or none when they are malformed. */
fun usableModifierGroups(groups: List<ProductModifierGroup>): List<ProductModifierGroup> =
  if (modifierGroupsProblem(groups) == null) groups else emptyList()

fun ProductModifierGroup.required(): Boolean = min > 0

/** Pick one (radio) rather than pick several (checkboxes). */
fun ProductModifierGroup.single(): Boolean = max.toInt() == 1

sealed interface ResolvedModifiers {
  data class Ok(val modifiers: List<LineModifier>, val extraCents: Long) : ResolvedModifiers
  data class Refused(val error: String) : ResolvedModifiers
}

/**
 * Prices a line's chosen modifiers from the product, in group order, and
 * checks each group's minimum and maximum (`resolveLineModifiers`).
 */
fun resolveLineModifiers(productName: String, groups: List<ProductModifierGroup>, picks: List<ModifierSelection>): ResolvedModifiers {
  val usable = usableModifierGroups(groups)
  val seen = mutableSetOf<String>()
  for (pick in picks.take(POS_MAX_MODIFIER_GROUPS * POS_MAX_MODIFIER_OPTIONS)) {
    if (!seen.add("${pick.groupId}:${pick.optionId}")) return ResolvedModifiers.Refused("A choice on $productName was picked twice.")
    val group = usable.firstOrNull { it.id == pick.groupId }
    if (group == null || group.options.none { it.id == pick.optionId }) {
      return ResolvedModifiers.Refused("A choice on $productName is no longer offered. Remove it and add it again.")
    }
  }
  val modifiers = mutableListOf<LineModifier>()
  for (group in usable) {
    val chosen: List<ProductModifierOption> = group.options.filter { option ->
      picks.any { it.groupId == group.id && it.optionId == option.id }
    }
    if (chosen.size < group.min) return ResolvedModifiers.Refused("Choose ${group.name.lowercase()} for $productName.")
    if (chosen.size > group.max) {
      return ResolvedModifiers.Refused("Choose at most ${group.max.toInt()} for ${group.name.lowercase()} on $productName.")
    }
    chosen.mapTo(modifiers) { LineModifier(group.id, it.id, group.name, it.name, it.priceCents.toLong()) }
  }
  return ResolvedModifiers.Ok(modifiers, modifiers.sumOf { it.priceCents })
}

/** The label a line prints: the variant, then each modifier (`Large / Oat milk, Extra shot`). */
fun lineLabelWithModifiers(variantLabel: String?, modifierNames: List<String>): String =
  listOfNotNull(variantLabel?.ifEmpty { null }, modifierNames.joinToString(", ").ifEmpty { null }).joinToString(" / ")

/** Two lines merge only when they are the same item with the same choices. */
fun modifierSelectionKey(selection: List<ModifierSelection>): String =
  selection.map { "${it.groupId}:${it.optionId}" }.sorted().joinToString("|")
