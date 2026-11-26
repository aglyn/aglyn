package com.aglyn.plugins.commerce.pos

import com.aglyn.contracts.ModifierSelection
import com.aglyn.contracts.OrderLineModifier
import com.aglyn.contracts.ProductModifierGroup
import com.aglyn.contracts.ProductModifierOption

/*
 * Register modifiers (`product-modifiers.ts`): choices added to an item as it
 * is rung up ("Oat milk", "Extra shot +$1.00") that are not stocked variants.
 * The register sends only the chosen option ids; the SERVER prices them from
 * the product, so the figures here are a preview checked by the same rules.
 *
 * WRITE-INS (write-ins). A group of `kind: "text"` asks for a typed
 * answer instead of a pick: a name to print, an engraving, a cake message. It holds
 * exactly one option, which prices it and carries its helper note; the pick
 * adds the `text`, which prints on the line as "Engraving: For Sam".
 */

const val POS_MAX_MODIFIER_GROUPS = 10
const val POS_MAX_MODIFIER_OPTIONS = 20
const val POS_MAX_MODIFIER_PRICE_CENTS = 100_000

/** The longest answer a write-in can take (`MAX_WRITE_IN_LENGTH`). */
const val MAX_WRITE_IN_LENGTH = 40

/** A write-in's length when the merchant sets none (`DEFAULT_WRITE_IN_LENGTH`). */
const val DEFAULT_WRITE_IN_LENGTH = 20

/** How much of a typed answer is carried before its group checks it. */
private const val WRITE_IN_INPUT_BOUND = 200

/** The group kind that makes a write-in. */
const val WRITE_IN_KIND = "text"

/** A chosen modifier as a line carries it: names and price as sold. */
data class LineModifier(
  val groupId: String,
  val optionId: String,
  val group: String,
  val name: String,
  val priceCents: Long,
  /** A write-in's answer as sold, such as the text to engrave. */
  val text: String? = null,
  /** The group's name prints before the choice on the line ("Size: M"). */
  val nameOnOrder: Boolean = false,
)

/** Whether a group is a write-in the shopper types (`modifierGroupIsWriteIn`). */
fun ProductModifierGroup.isWriteIn(): Boolean = kind == WRITE_IN_KIND

/** A write-in's longest answer (`writeInMaxLength`). */
fun writeInMaxLength(maxLength: Double?): Int =
  if (maxLength != null && maxLength.isWhole() && maxLength >= 1 && maxLength <= MAX_WRITE_IN_LENGTH) maxLength.toInt() else DEFAULT_WRITE_IN_LENGTH

fun ProductModifierGroup.writeInMaxLength(): Int = writeInMaxLength(maxLength)

/** The characters of [text] as JavaScript's `Array.from` counts them: one per code point. */
internal fun codePoints(text: String): List<String> {
  val points = ArrayList<String>(text.length)
  var at = 0
  while (at < text.length) {
    val pair = text[at].isHighSurrogate() && at + 1 < text.length && text[at + 1].isLowSurrogate()
    points += text.substring(at, if (pair) at + 2 else at + 1)
    at += if (pair) 2 else 1
  }
  return points
}

/** What a write-in's field keeps as it is typed: at most [limit] characters, as the web field's `maxLength` holds it. */
fun writeInInput(text: String, limit: Int): String = codePoints(text).take(limit).joinToString("")

/** How many characters a write-in's answer counts as. */
fun writeInLength(text: String): Int = codePoints(text).size

/** JavaScript's control characters and line separators, which an answer never keeps. */
private val WRITE_IN_CONTROL = Regex("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]")

/** JavaScript's `\\s`, spelled out so every platform reads the same spaces. */
private val WRITE_IN_SPACES = Regex("[\\t\\n\\u000b\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]+")

/**
 * A write-in's answer cleaned for the order (`cleanWriteIn`): control characters and runs of spaces gone, trimmed, cut
 * at the group's length. Empty when nothing is left. Without a length the answer is only bounded, so a too-long one
 * still reaches the check that names it.
 */
fun cleanWriteIn(raw: String?, maxLength: Int? = null): String {
  if (raw == null) return ""
  val limit = maxLength ?: WRITE_IN_INPUT_BOUND
  val flat = raw.replace(WRITE_IN_CONTROL, " ").replace(WRITE_IN_SPACES, " ").trim(' ')
  return codePoints(flat).take(limit).joinToString("").trim(' ')
}

fun cleanWriteIn(raw: String?, group: ProductModifierGroup): String = cleanWriteIn(raw, group.writeInMaxLength())

private val DIGITS = Regex("^[0-9]+$")

/** Why a write-in's answer cannot be sold, or null when it can (`writeInProblem`). An empty answer is the minimum's business. */
fun writeInProblem(group: ProductModifierGroup, raw: String?): String? {
  val typed = cleanWriteIn(raw)
  if (typed.isEmpty()) return null
  val limit = group.writeInMaxLength()
  if (writeInLength(typed) > limit) return "${group.name} takes up to $limit characters."
  if (group.digitsOnly == true && !DIGITS.matches(typed)) return "${group.name} takes numbers only."
  return null
}

/**
 * The picks with a write-in's answer set (`withWriteInAnswer`): an empty answer leaves the group unanswered, and the
 * picks stay in the product's group order. The answer is kept as typed; the server cleans and checks it.
 */
fun withWriteInAnswer(groups: List<ProductModifierGroup>, picks: List<ModifierSelection>, group: ProductModifierGroup, text: String): List<ModifierSelection> {
  val option = group.options.firstOrNull()
  val others = picks.filter { it.groupId != group.id }
  val answer = if (option != null && text.isNotBlank()) listOf(ModifierSelection(group.id, option.id, text)) else emptyList()
  val order = groups.mapIndexed { index, entry -> entry.id to index }.toMap()
  return (others + answer).sortedBy { order[it.groupId] ?: 0 }
}

/** A write-in's answer among the picks, as typed. */
fun writeInAnswer(picks: List<ModifierSelection>, group: ProductModifierGroup): String =
  picks.firstOrNull { it.groupId == group.id }?.text.orEmpty()

private fun Double.isWhole() = isFinite() && this == kotlin.math.floor(this)

private fun modifierPriceIsValid(cents: Double): Boolean = cents.isWhole() && cents >= 0 && cents <= POS_MAX_MODIFIER_PRICE_CENTS

/**
 * A choice's price on the picked variant: its price by that variant where it has one, else its own
 * (`modifierOptionPriceCents`). A product with no options sells a `default` variant, which no price list names.
 */
fun modifierOptionPriceCents(option: ProductModifierOption, variantId: String?): Long {
  val byVariant = if (variantId != null && variantId != "default") option.priceCentsByVariant?.get(variantId) else null
  return (if (byVariant != null && byVariant.isFinite()) byVariant else option.priceCents).toLong()
}

/** Why groups cannot be used, or null when they are well formed (`modifierGroupsProblem`). */
fun modifierGroupsProblem(groups: List<ProductModifierGroup>): String? {
  if (groups.size > POS_MAX_MODIFIER_GROUPS) return "At most $POS_MAX_MODIFIER_GROUPS modifier groups per product"
  val groupIds = mutableSetOf<String>()
  for (group in groups) {
    if (group.id.isEmpty() || !groupIds.add(group.id)) return "Modifier groups need unique ids"
    if (group.name.isBlank()) return "Name every modifier group"
    if (group.kind != null && group.kind != WRITE_IN_KIND) return "“${group.name}” is a list of choices or a write-in"
    if (group.isWriteIn()) {
      if (group.options.size != 1) return "“${group.name}” is a write-in and holds one field"
      if (group.max != 1.0 || (group.min != 0.0 && group.min != 1.0)) return "“${group.name}” is a write-in: required or not, one answer"
      val length = group.maxLength
      if (length != null && (!length.isWhole() || length < 1 || length > MAX_WRITE_IN_LENGTH)) {
        return "“${group.name}” takes 1 to $MAX_WRITE_IN_LENGTH characters"
      }
    }
    if (group.options.isEmpty()) return "Add a choice to “${group.name}”"
    if (group.options.size > POS_MAX_MODIFIER_OPTIONS) return "“${group.name}” has more than $POS_MAX_MODIFIER_OPTIONS choices"
    val optionIds = mutableSetOf<String>()
    for (option in group.options) {
      if (option.id.isEmpty() || !optionIds.add(option.id)) return "Modifier choices need unique ids"
      if (option.name.isBlank()) return "Name every choice in “${group.name}”"
      if (!modifierPriceIsValid(option.priceCents)) return "“${option.name}” needs a price of $0 to $1,000"
      if (option.priceCentsByVariant?.values?.any { !modifierPriceIsValid(it) } == true) {
        return "“${option.name}” needs a price of $0 to $1,000 for each option it is priced by"
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

/** A pick as the line keeps it: a choice, or a write-in with its answer (`soldModifier`). */
private fun soldModifier(group: ProductModifierGroup, option: ProductModifierOption, variantId: String?, text: String?) = LineModifier(
  groupId = group.id,
  optionId = option.id,
  group = group.name,
  name = option.name,
  priceCents = modifierOptionPriceCents(option, variantId),
  text = text?.ifEmpty { null },
  nameOnOrder = group.nameOnOrder == true,
)

sealed interface ResolvedModifiers {
  data class Ok(val modifiers: List<LineModifier>, val extraCents: Long) : ResolvedModifiers
  data class Refused(val error: String) : ResolvedModifiers
}

/**
 * Prices a line's chosen modifiers from the product, in group order, and
 * checks each group's minimum and maximum (`resolveLineModifiers`).
 */
fun resolveLineModifiers(productName: String, groups: List<ProductModifierGroup>, picks: List<ModifierSelection>, variantId: String? = null): ResolvedModifiers {
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
    if (group.isWriteIn()) {
      // A write-in (write-ins): its answer is checked, cleaned and kept.
      val option = group.options.first()
      val pick = picks.firstOrNull { it.groupId == group.id && it.optionId == option.id }
      writeInProblem(group, pick?.text)?.let { return ResolvedModifiers.Refused("$it ($productName)") }
      val text = cleanWriteIn(pick?.text, group)
      if (text.isEmpty()) {
        if (group.min > 0) return ResolvedModifiers.Refused("Fill in ${group.name.lowercase()} for $productName.")
        continue
      }
      modifiers += soldModifier(group, option, variantId, text)
      continue
    }
    val chosen: List<ProductModifierOption> = group.options.filter { option ->
      picks.any { it.groupId == group.id && it.optionId == option.id }
    }
    if (chosen.size < group.min) return ResolvedModifiers.Refused("Choose ${group.name.lowercase()} for $productName.")
    if (chosen.size > group.max) {
      return ResolvedModifiers.Refused("Choose at most ${group.max.toInt()} for ${group.name.lowercase()} on $productName.")
    }
    chosen.mapTo(modifiers) { soldModifier(group, it, variantId, null) }
  }
  return ResolvedModifiers.Ok(modifiers, modifiers.sumOf { it.priceCents })
}

/**
 * How one modifier prints on a line (`modifierLineText`): its name (`Oat milk`), its group and name when the group asks
 * for it (`Size: M`), or a write-in's name and answer (`Engraving: For Sam`).
 */
fun modifierLineText(name: String, group: String?, text: String?, nameOnOrder: Boolean?): String = when {
  !text.isNullOrEmpty() -> "${group?.ifEmpty { null } ?: name}: $text"
  nameOnOrder == true && !group.isNullOrEmpty() -> "$group: $name"
  else -> name
}

fun LineModifier.lineText(): String = modifierLineText(name, group, text, nameOnOrder)

fun OrderLineModifier.lineText(): String = modifierLineText(name, group, text, nameOnOrder)

/** The label a line prints: the variant, then each modifier (`Large / Oat milk, Extra shot`). */
fun lineLabelWithModifiers(variantLabel: String?, modifiers: List<LineModifier>): String =
  listOfNotNull(variantLabel?.ifEmpty { null }, modifiers.joinToString(", ") { it.lineText() }.ifEmpty { null }).joinToString(" / ")

/** The picks a priced line keeps (`modifierSelectionOf`): ids, and a write-in's answer. */
fun modifierSelectionOf(modifiers: List<LineModifier>): List<ModifierSelection> =
  modifiers.map { ModifierSelection(it.groupId, it.optionId, it.text?.ifEmpty { null }) }

/** Two lines merge only when they are the same item with the same choices, and the same answers: two answers are two lines. */
fun modifierSelectionKey(selection: List<ModifierSelection>): String =
  selection.map { if (!it.text.isNullOrEmpty()) "${it.groupId}:${it.optionId}=${it.text}" else "${it.groupId}:${it.optionId}" }.sorted().joinToString("|")
