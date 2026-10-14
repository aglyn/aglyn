package com.aglyn.plugins.commerce.products

import com.aglyn.contracts.COMMERCE_MAX_OPTIONS
import com.aglyn.contracts.COMMERCE_MAX_OPTION_VALUES
import com.aglyn.contracts.COMMERCE_MAX_VARIANTS
import com.aglyn.contracts.ProductOption
import com.aglyn.contracts.ProductVariant
import com.aglyn.contracts.expandVariantMatrix
import com.aglyn.contracts.renameProductOptions
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/*
 * The product editor's options and variant matrix (AGL-3652), as the
 * console's product editor does them (product-editor-dialog.component.tsx):
 * a product has up to three options, each a name and its values; the variants
 * are the Cartesian product of the values; a change of values rebuilds the
 * matrix and carries every variant's price, codes and stock over by its
 * selections, while a rename moves the selections in place (AGL-3066) so no
 * variant is replaced. A variant new to the matrix starts from the first
 * variant's price and stock, as the console's does. The matrix itself
 * (`expandVariantMatrix`, `renameProductOptions`) is the contracts port the
 * console's own cases replay.
 */

/** One option as typed: its name and its values as a comma-separated line, kept as typed. */
data class OptionDraft(val name: String = "", val valuesText: String = "") {
  /** The values: split at commas and line breaks, trimmed, blanks and repeats dropped. */
  val values: List<String> get() = parseOptionValues(valuesText)

  fun toOption(): ProductOption = ProductOption(name = name.trim(), values = values)
}

fun parseOptionValues(text: String): List<String> = text.split(',', '\n').map(String::trim).filter(String::isNotEmpty).distinct()

/** Stable key for matching variants across matrix rebuilds (the console's `comboKey`). */
fun comboKey(selections: Map<String, String>): String =
  selections.entries.sortedBy { it.key }.joinToString("|") { "${it.key}:${it.value}" }

fun comboLabel(selections: Map<String, String>): String = selections.values.filter(String::isNotBlank).joinToString(" / ").ifEmpty { "Default" }

@OptIn(ExperimentalUuidApi::class)
fun newVariantId(): String = "v" + Uuid.random().toHexString().take(10)

/** The variants for the options as they now are, keeping each one whose selections still exist. */
fun rebuildVariants(options: List<OptionDraft>, previous: List<VariantDraft>, mintId: () -> String = ::newVariantId): List<VariantDraft> {
  val kept = previous.associateBy { comboKey(it.selections) }
  val fallback = previous.firstOrNull()
  return expandVariantMatrix(options.map(OptionDraft::toOption)).map { combo ->
    kept[comboKey(combo)] ?: VariantDraft(
      id = mintId(),
      label = comboLabel(combo),
      price = fallback?.price.orEmpty(),
      stock = fallback?.stock.orEmpty(),
      selections = combo,
      fresh = true,
    )
  }
}

/** The draft with option [index]'s values changed: the matrix is rebuilt. */
fun ProductDraft.withOptionValues(index: Int, text: String, mintId: () -> String = ::newVariantId): ProductDraft {
  val next = options.toMutableList().also { it[index] = it[index].copy(valuesText = text) }
  return copy(options = next, variants = rebuildVariants(next, variants, mintId))
}

/**
 * The draft with option [index] renamed. Every variant's selection moves to
 * the new name in place; an option that had no name yet joins the matrix now.
 */
fun ProductDraft.withOptionName(index: Int, name: String, mintId: () -> String = ::newVariantId): ProductDraft {
  val current = options[index]
  if (current.name.isBlank() && current.values.isNotEmpty()) {
    val next = options.toMutableList().also { it[index] = current.copy(name = name) }
    return copy(options = next, variants = rebuildVariants(next, variants, mintId))
  }
  val (renamed, moved) = renameProductOptions(
    options.map(OptionDraft::toOption),
    variants.map { ProductVariant(id = it.id, options = it.selections) },
    options.indices.map { if (it == index) name else null },
  )
  val next = options.mapIndexed { i, option -> if (i == index) option.copy(name = name) else option }
  // Nothing moves while two options share a name; the draft still shows what was typed.
  val selections = if (renamed.map { it.name }.toSet().size == renamed.size) moved.map { it.options.orEmpty() } else variants.map { it.selections }
  return copy(options = next, variants = variants.mapIndexed { i, variant -> variant.copy(selections = selections[i]) })
}

fun ProductDraft.withOptionAdded(): ProductDraft =
  if (options.size >= COMMERCE_MAX_OPTIONS) this else copy(options = options + OptionDraft())

fun ProductDraft.withOptionRemoved(index: Int, mintId: () -> String = ::newVariantId): ProductDraft {
  val next = options.toMutableList().also { it.removeAt(index) }
  return copy(options = next, variants = rebuildVariants(next, variants, mintId))
}

/** How many variants the options make, uncapped. */
fun variantCountOf(options: List<OptionDraft>): Int {
  val usable = options.filter { it.name.isNotBlank() && it.values.isNotEmpty() }
  return usable.fold(1) { count, option -> (count.toLong() * option.values.size).coerceAtMost(Int.MAX_VALUE.toLong()).toInt() }
}

/** Why the options cannot be stored (the console's `validateProduct`), or null. */
fun checkOptions(options: List<OptionDraft>): String? {
  if (options.size > COMMERCE_MAX_OPTIONS) return "At most $COMMERCE_MAX_OPTIONS options per product"
  for (option in options) {
    if (option.name.isBlank()) return "Option names are required"
    if (option.values.isEmpty()) return "Option \"${option.name.trim()}\" needs at least one value"
    if (option.values.size > COMMERCE_MAX_OPTION_VALUES) return "Option \"${option.name.trim()}\" has too many values"
  }
  if (options.map { it.name.trim() }.toSet().size != options.size) return "Each option needs its own name"
  if (variantCountOf(options) > COMMERCE_MAX_VARIANTS) return "At most $COMMERCE_MAX_VARIANTS variants per product"
  return null
}
