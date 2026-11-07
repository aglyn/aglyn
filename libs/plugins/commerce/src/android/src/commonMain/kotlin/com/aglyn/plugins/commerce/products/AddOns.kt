package com.aglyn.plugins.commerce.products

import com.aglyn.contracts.COMMERCE_MAX_VARIANTS
import com.aglyn.contracts.ProductModifierGroup
import com.aglyn.contracts.ProductModifierOption
import com.aglyn.plugins.commerce.pos.POS_MAX_MODIFIER_GROUPS
import com.aglyn.plugins.commerce.pos.POS_MAX_MODIFIER_OPTIONS
import com.aglyn.plugins.commerce.orders.parseMoneyCents
import com.aglyn.plugins.commerce.pos.modifierGroupsProblem
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.uuid.ExperimentalUuidApi
import kotlin.uuid.Uuid

/*
 * A product's add-ons (AGL-4100), as the console's editor makes them
 * (product-add-ons-fields.component.tsx): groups of choices that are added to
 * the item and need no stock of their own, each free or adding to the price,
 * and costing more on a larger size where the product has sizes. A group is
 * offered at the register always, and on the product's page on the website
 * when "Show on the website" is on, which a new group starts with.
 *
 * A draft keeps prices as typed. On save each group and choice is written over
 * its stored record, so what the apps do not edit (a choice's picture, its
 * note, what a combo includes) is kept as it was.
 */

/** One choice as the editor holds it: its prices in dollars as typed, the per-variant ones by variant id. */
data class AddOnChoiceDraft(
  val id: String,
  val name: String = "",
  val price: String = "",
  val byVariant: Map<String, String> = emptyMap(),
)

/** One group as the editor holds it. `online` absent reads as register only, as the console reads it. */
data class AddOnGroupDraft(
  val id: String,
  val name: String = "",
  val min: Int = 0,
  val max: Int = 1,
  val online: Boolean? = null,
  val choices: List<AddOnChoiceDraft> = emptyList(),
) {
  /** Whether a pick is required before the item can be added. */
  val required: Boolean get() = min > 0
}

@OptIn(ExperimentalUuidApi::class)
private fun newAddOnId(prefix: String): String = prefix + Uuid.random().toHexString().take(8)

/** A new group, as the console makes one: optional, pick one, shown on the website, with one empty choice. */
fun newAddOnGroup(mintId: (String) -> String = ::newAddOnId): AddOnGroupDraft =
  AddOnGroupDraft(id = mintId("g"), online = true, choices = listOf(AddOnChoiceDraft(id = mintId("o"))))

fun newAddOnChoice(mintId: (String) -> String = ::newAddOnId): AddOnChoiceDraft = AddOnChoiceDraft(id = mintId("o"))

/** "Price by size" where the product varies by one option, else "Price by variant", as the console says it. */
fun priceByLabel(options: List<OptionDraft>): String {
  val named = options.filter { it.name.isNotBlank() }
  return if (named.size == 1) "Price by ${named[0].name.trim().lowercase()}" else "Price by variant"
}

private fun dollarsText(cents: Double?): String =
  cents?.takeIf { it > 0 }?.let { value -> kotlin.math.round(value).toLong().let { "${it / 100}.${(it % 100).toString().padStart(2, '0')}" } }.orEmpty()

/** The add-ons a stored product has, as drafts. */
fun addOnDrafts(data: Map<String, Any?>): List<AddOnGroupDraft> =
  (data["modifierGroups"] as? List<*>).orEmpty().mapNotNull { entry ->
    val group = entry as? Map<*, *> ?: return@mapNotNull null
    val id = group["id"] as? String ?: return@mapNotNull null
    AddOnGroupDraft(
      id = id,
      name = group["name"] as? String ?: "",
      min = (group["min"] as? Number)?.toInt() ?: 0,
      max = (group["max"] as? Number)?.toInt() ?: 1,
      online = group["online"] as? Boolean,
      choices = (group["options"] as? List<*>).orEmpty().mapNotNull { raw ->
        val option = raw as? Map<*, *> ?: return@mapNotNull null
        AddOnChoiceDraft(
          id = option["id"] as? String ?: return@mapNotNull null,
          name = option["name"] as? String ?: "",
          price = dollarsText((option["priceCents"] as? Number)?.toDouble()),
          byVariant = (option["priceCentsByVariant"] as? Map<*, *>).orEmpty().mapNotNull { (key, value) ->
            val variant = key as? String ?: return@mapNotNull null
            variant to dollarsText((value as? Number)?.toDouble()).ifEmpty { "0.00" }
          }.toMap(),
        )
      },
    )
  }

/** Cents from a typed price: empty is free; anything else must be a number of dollars. */
private fun addOnCents(text: String): Double? = if (text.isBlank()) 0.0 else parseMoneyCents(text)?.toDouble()

/** The groups as the contract holds them; a price that is not a number reads as -1, which the check refuses. */
fun addOnGroups(drafts: List<AddOnGroupDraft>): List<ProductModifierGroup> =
  drafts.map { group ->
    ProductModifierGroup(
      id = group.id,
      max = group.max.toDouble(),
      min = group.min.toDouble(),
      name = group.name,
      online = group.online,
      options = group.choices.map { choice ->
        val byVariant = choice.byVariant.filterValues { it.isNotBlank() }.mapValues { addOnCents(it.value) ?: -1.0 }
        ProductModifierOption(
          id = choice.id,
          name = choice.name,
          priceCents = addOnCents(choice.price) ?: -1.0,
          priceCentsByVariant = byVariant.ifEmpty { null },
        )
      },
    )
  }

/** Why the add-ons cannot be saved, in the console's words, or null. */
fun checkAddOns(drafts: List<AddOnGroupDraft>): String? = if (drafts.isEmpty()) null else modifierGroupsProblem(addOnGroups(drafts))

fun AddOnGroupDraft.withChoiceAdded(mintId: (String) -> String = ::newAddOnId): AddOnGroupDraft =
  if (choices.size >= POS_MAX_MODIFIER_OPTIONS) this else copy(choices = choices + newAddOnChoice(mintId))

/** The group without choice `index`; "at most" never asks for more choices than are left. */
fun AddOnGroupDraft.withChoiceRemoved(index: Int): AddOnGroupDraft {
  val left = choices.filterIndexed { at, _ -> at != index }
  return copy(choices = left, max = max.coerceAtMost(left.size).coerceAtLeast(1), min = min.coerceAtMost(left.size))
}

/** A choice with its price on one variant set, or cleared to the choice's own price when left empty. */
fun AddOnChoiceDraft.withVariantPrice(variantId: String, text: String): AddOnChoiceDraft =
  copy(byVariant = if (text.isBlank()) byVariant - variantId else byVariant + (variantId to text))

fun canAddAddOnGroup(drafts: List<AddOnGroupDraft>): Boolean = drafts.size < POS_MAX_MODIFIER_GROUPS

/**
 * The `modifierGroups` a save sends: each group and choice over its stored
 * record, so fields the apps do not edit are kept.
 */
fun addOnsJson(drafts: List<AddOnGroupDraft>, stored: JsonElement?): JsonArray {
  val storedGroups = (stored as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }
  fun idOf(record: JsonObject) = (record["id"] as? JsonPrimitive)?.content
  return JsonArray(
    addOnGroups(drafts).map { group ->
      val storedGroup = storedGroups.firstOrNull { idOf(it) == group.id }
      val storedOptions = (storedGroup?.get("options") as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }
      val fields = storedGroup?.toMutableMap() ?: mutableMapOf()
      fields["id"] = JsonPrimitive(group.id)
      fields["name"] = JsonPrimitive(group.name.trim())
      fields["min"] = JsonPrimitive(group.min.toLong())
      fields["max"] = JsonPrimitive(group.max.toLong())
      group.online?.let { fields["online"] = JsonPrimitive(it) }
      fields["options"] = JsonArray(
        group.options.map { option ->
          val choice = storedOptions.firstOrNull { idOf(it) == option.id }?.toMutableMap() ?: mutableMapOf()
          choice["id"] = JsonPrimitive(option.id)
          choice["name"] = JsonPrimitive(option.name.trim())
          choice["priceCents"] = JsonPrimitive(option.priceCents.toLong())
          val byVariant = option.priceCentsByVariant
          if (byVariant.isNullOrEmpty()) choice.remove("priceCentsByVariant")
          else choice["priceCentsByVariant"] = JsonObject(byVariant.mapValues { JsonPrimitive(it.value.toLong()) })
          JsonObject(choice)
        },
      )
      JsonObject(fields)
    },
  )
}

/**
 * More combinations than a product holds (AGL-4100), in the console's words:
 * the count, and the way out, since the values typed are kept, not dropped.
 */
fun variantMatrixProblem(options: List<OptionDraft>): String? {
  val count = variantCountOf(options)
  if (count <= COMMERCE_MAX_VARIANTS) return null
  val shown = count.toString().reversed().chunked(3).joinToString(",").reversed()
  return "These options make $shown combinations, and a product holds at most $COMMERCE_MAX_VARIANTS. Remove some values, or move " +
    "choices that don’t need their own stock (walls, printing, extras) to Add-ons, priced by option where they cost more on a larger size."
}
