package com.aglyn.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * What a person has chosen in the export dialog, and how it opens: the logic of the console's `TransferExportDialog` apart
 * from its drawing (the Apple kit's `TransferExportChoice` holds the same).
 */

/** One entry of the preset picker. */
data class TransferPresetOption(val id: String, val label: String, val description: String)

data class TransferExportChoice(
  /** The preset id the field list came from: a built-in one, the resource's or a saved one, or [CUSTOM]. */
  val presetId: String,
  /** The fields to export, in file order. */
  val fieldIds: List<String>,
  /** Ids of a remembered choice that no longer exist, left out. */
  val unknown: List<String> = emptyList(),
  val format: TransferFormat,
  /** A CSV starts with a byte-order mark, for Excel. */
  val bom: Boolean,
  /** `selection`, `filter` or `all`. */
  val scope: String,
) {
  /** A preset chosen: the resource's or a saved one resolved against the catalog, or a built-in one; [CUSTOM] keeps the fields. */
  fun choose(preset: String, catalog: TransferFieldCatalog, info: TransferFields, saved: List<TransferSavedPreset>): TransferExportChoice {
    if (preset == CUSTOM) return copy(presetId = CUSTOM)
    val named = info.resourcePresets.firstOrNull { it.id == preset } ?: saved.firstOrNull { it.id == preset }
    val selection = when {
      named != null -> catalog.resolve(named)
      else -> catalog.resolve(TransferPreset.entries.firstOrNull { it.wire == preset } ?: return copy(presetId = preset), info.presetHints)
    }
    return copy(presetId = preset, fieldIds = selection.fieldIds, unknown = selection.unknown)
  }

  /** A change to the fields after a preset is a hand-picked list. */
  fun pick(ids: List<String>): TransferExportChoice = copy(fieldIds = ids, presetId = CUSTOM, unknown = emptyList())

  /**
   * The column names a resource preset writes, while it is chosen as it stands (the moment a field changes, the columns are
   * the fields' labels); only a CSV carries them.
   */
  fun headers(info: TransferFields): Map<String, String> =
    if (format != TransferFormat.CSV) emptyMap() else info.resourcePresets.firstOrNull { it.id == presetId }?.headers.orEmpty()

  /** What is remembered for the next export of the resource. */
  val prefs: TransferExportPrefs get() = TransferExportPrefs(if (presetId == CUSTOM) null else presetId, fieldIds, format, bom, scope)

  /** A preset the person saved from the fields as they stand, ready to keep: null without a name or any field. */
  fun saving(name: String, id: String): TransferSavedPreset? {
    val label = name.trim().take(120)
    if (label.isEmpty() || fieldIds.isEmpty()) return null
    return TransferSavedPreset(id, label, fieldIds)
  }

  companion object {
    /** The preset id of a hand-picked list. */
    const val CUSTOM = "custom"

    /**
     * How the dialog opens: on the resource's preset it was asked for, else the person's last choice, else Re-importable
     * (Everything for a resource nothing is imported into, whose fields are all read-only).
     */
    fun opening(
      info: TransferFields,
      catalog: TransferFieldCatalog,
      selectionCount: Int = 0,
      hasFilter: Boolean = false,
      preset: String? = null,
    ): TransferExportChoice {
      val last = info.lastExport
      val format = last?.format?.takeIf { it in info.formats } ?: info.formats.first()
      val scope = when {
        selectionCount > 0 -> "selection"
        hasFilter -> if (last?.scope == "all") "all" else "filter"
        else -> "all"
      }
      val base = TransferExportChoice(TransferPreset.REIMPORTABLE.wire, emptyList(), emptyList(), format, last?.bom ?: false, scope)
      val asked = preset?.let { id -> info.resourcePresets.firstOrNull { it.id == id } }
      return when {
        asked != null -> base.copy(presetId = asked.id, fieldIds = catalog.resolve(asked).fieldIds)
        last != null && last.fieldIds.isNotEmpty() -> {
          val resolved = catalog.resolveSelection(last.fieldIds)
          base.copy(presetId = last.presetId ?: CUSTOM, fieldIds = resolved.fieldIds, unknown = resolved.unknown)
        }
        else -> {
          val first = if (info.exportOnly) TransferPreset.EVERYTHING else TransferPreset.REIMPORTABLE
          base.copy(presetId = first.wire, fieldIds = catalog.resolve(first, info.presetHints).fieldIds)
        }
      }
    }

    /**
     * The preset picker's entries: the built-in ones (Re-importable only where a file can come back in), the resource's
     * own, the person's saved ones, then a hand-picked list.
     */
    fun presetOptions(info: TransferFields, saved: List<TransferSavedPreset>, brand: String = AglynConfig.DEFAULT_BRAND_NAME): List<TransferPresetOption> {
      fun count(n: Int) = "$n ${if (n == 1) "field" else "fields"}"
      // The built-in presets in the console's order: Everything, Re-importable, Minimal.
      val builtIn = listOf(TransferPreset.EVERYTHING, TransferPreset.REIMPORTABLE, TransferPreset.MINIMAL)
        .filter { it != TransferPreset.REIMPORTABLE || !info.exportOnly }
        .map { TransferPresetOption(it.wire, it.label, it.description(brand)) }
      return builtIn +
        info.resourcePresets.map { TransferPresetOption(it.id, it.label, it.description ?: count(it.fieldIds.size)) } +
        saved.map { TransferPresetOption(it.id, it.label, count(it.fieldIds.size)) } +
        TransferPresetOption(CUSTOM, "Hand-picked", "The fields as you chose them below.")
    }
  }
}

/** The document body the person's choice is remembered as, `users/{uid}/transferPrefs/{resource}`. */
fun TransferExportPrefs.json(): JsonObject = JsonObject(
  mapOf(
    "presetId" to (presetId?.let { JsonPrimitive(it) } ?: JsonNull),
    "fieldIds" to JsonArray(fieldIds.take(500).map { JsonPrimitive(it) }),
    "format" to JsonPrimitive(format.wire),
    "bom" to JsonPrimitive(bom),
    "scope" to JsonPrimitive(scope),
  ),
)
