package com.aglyn.contracts

/*
 * A product's option axes and the variant matrix they generate, ported once
 * from libs/plugins/commerce/src/lib/model/commerce.ts (`expandVariantMatrix`,
 * `renameProductOptions`). The cases in function-cases.generated.json are the
 * TypeScript's own answers, and the tests replay every one. The caps are the
 * console's `COMMERCE_MAX_VARIANTS`, `COMMERCE_MAX_OPTIONS` and
 * `COMMERCE_MAX_OPTION_VALUES`; the save route validates them again.
 */

const val COMMERCE_MAX_VARIANTS = 100
const val COMMERCE_MAX_OPTIONS = 3
const val COMMERCE_MAX_OPTION_VALUES = 25

/**
 * The Cartesian product of the options' values: one selection per variant, the
 * first option varying slowest. No usable option (a name and at least one
 * value) yields the single default selection, `{}`. Capped at
 * [COMMERCE_MAX_VARIANTS].
 */
fun expandVariantMatrix(options: List<ProductOption>?): List<Map<String, String>> {
  val usable = options.orEmpty().filter { it.name.isNotEmpty() && it.values.isNotEmpty() }
  if (usable.isEmpty()) return listOf(emptyMap())
  var combos: List<Map<String, String>> = listOf(emptyMap())
  for (option in usable) {
    combos = combos.flatMap { combo -> option.values.map { value -> combo + (option.name to value) } }
    if (combos.size > COMMERCE_MAX_VARIANTS) return combos.take(COMMERCE_MAX_VARIANTS)
  }
  return combos
}

/**
 * The option axes renamed, with every variant's selection carried to the new
 * name in place, so a variant keeps its id, price, codes and stock (AGL-3066).
 * `names` holds one entry per option, in order; a null keeps that option's
 * name. While the new names are not all different nothing is moved.
 */
fun renameProductOptions(
  options: List<ProductOption>,
  variants: List<ProductVariant>,
  names: List<String?>,
): Pair<List<ProductOption>, List<ProductVariant>> {
  val renamed = options.mapIndexed { index, option -> names.getOrNull(index)?.let { option.copy(name = it) } ?: option }
  val next = renamed.map { it.name }
  if (next.toSet().size != next.size) return renamed to variants
  val moved = variants.map { variant ->
    val selections = variant.options ?: return@map variant
    val axisOf = optionAxesOf(options, selections)
    val carried = LinkedHashMap<String, String>()
    var changed = false
    for ((key, value) in selections) {
      val axis = axisOf[key]
      val name = if (axis == null) key else next[axis]
      if (name != key) changed = true
      carried[name] = value
    }
    if (changed) variant.copy(options = carried) else variant
  }
  return renamed to moved
}

/** Which option each selection belongs to: the same name first, then, for a name no option has, the one untaken option whose values hold it. */
private fun optionAxesOf(options: List<ProductOption>, selections: Map<String, String>): Map<String, Int> {
  val axisOf = LinkedHashMap<String, Int>()
  val taken = mutableSetOf<Int>()
  options.forEachIndexed { index, option ->
    if (option.name in selections && option.name !in axisOf) {
      axisOf[option.name] = index
      taken += index
    }
  }
  for ((key, value) in selections) {
    if (key in axisOf) continue
    val axis = options.indices.firstOrNull { it !in taken && value in options[it].values } ?: continue
    axisOf[key] = axis
    taken += axis
  }
  return axisOf
}
