package com.aglyn.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/*
 * The platform's export, as every console export dialog makes it: the
 * resource's fields (`POST /api/transfer/fields`), then the file
 * (`POST /api/transfer/export`) with the fields the person picked, the
 * records it covers, and the format.
 */

data class TransferFieldInfo(
  val id: String,
  val label: String,
  val group: String?,
  val description: String?,
  /** Exported, never written from a file. */
  val readOnly: Boolean = false,
  /** Computed from other fields; exported, never written. */
  val derived: Boolean = false,
  /** Written by the platform (id, created, updated); exported, never written. */
  val system: Boolean = false,
  /** Defined by the organization rather than the resource. */
  val custom: Boolean = false,
  /** A new record cannot be created without it. */
  val required: Boolean = false,
  /** May be mapped on import to identify an existing record. */
  val matchKey: Boolean = false,
  /** Header spellings that mean this field, beside its label and id. */
  val aliases: List<String> = emptyList(),
) {
  /** Whether a file's cell may be written to the field (the console's `isTransferFieldWritable`). */
  val writable: Boolean get() = !readOnly && !derived && !system

  /** What kind of field it is, when it is not a plain one: how the console's picker labels it. */
  val kind: String?
    get() = when {
      custom -> "Custom"
      system -> "System"
      derived -> "Computed"
      readOnly -> "Read-only"
      else -> null
    }

  companion object {
    /** A field from the fields route's answer (an entry without an id is left out). */
    fun decode(entry: JsonObject): TransferFieldInfo? {
      fun text(key: String) = (entry[key] as? JsonPrimitive)?.contentOrNull
      fun flag(key: String) = (entry[key] as? JsonPrimitive)?.booleanOrNull == true
      val id = text("id") ?: return null
      return TransferFieldInfo(
        id, text("label") ?: id, text("group"), text("description"), flag("readOnly"), flag("derived"), flag("system"), flag("custom"),
        flag("required"), flag("matchKey"), (entry["aliases"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull },
      )
    }
  }
}

data class TransferFieldGroupInfo(val id: String, val label: String)

/** A preset a person saved, or one the resource offers (listed after the built-in ones). */
data class TransferSavedPreset(
  val id: String,
  val label: String,
  val fieldIds: List<String>,
  /** One sentence beside the preset in the picker (a resource's preset). */
  val description: String? = null,
  /** Field id → the CSV column name written instead of the field's label (a resource's preset for another product). */
  val headers: Map<String, String> = emptyMap(),
) {
  fun json(): JsonObject = JsonObject(mapOf("id" to JsonPrimitive(id), "label" to JsonPrimitive(label), "fieldIds" to JsonArray(fieldIds.map { JsonPrimitive(it) })))

  companion object {
    fun decode(entry: JsonObject): TransferSavedPreset? {
      val id = (entry["id"] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() } ?: return null
      val label = (entry["label"] as? JsonPrimitive)?.contentOrNull ?: return null
      return TransferSavedPreset(
        id, label, (entry["fieldIds"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull },
        (entry["description"] as? JsonPrimitive)?.contentOrNull,
        (entry["headers"] as? JsonObject).orEmpty().mapNotNull { (key, value) -> (value as? JsonPrimitive)?.contentOrNull?.let { key to it } }.toMap(),
      )
    }
  }
}

/** What a resource says about its own presets (the console's `TransferPresetHints`). */
data class TransferPresetHints(
  /** The fields a re-import matches on (the id is always included). */
  val matchKeyFieldIds: List<String> = emptyList(),
  /** Fields the minimal preset adds beyond the id, match keys and required ones. */
  val minimalFieldIds: List<String> = emptyList(),
)

/** The export choice a person made last, remembered per person and resource. */
data class TransferExportPrefs(
  /** A built-in preset id, a saved preset's id, or null for a hand-picked list. */
  val presetId: String?,
  val fieldIds: List<String>,
  val format: TransferFormat,
  val bom: Boolean,
  /** `selection`, `filter` or `all`. */
  val scope: String,
) {
  companion object {
    fun decode(entry: JsonElement?): TransferExportPrefs? {
      val record = entry as? JsonObject ?: return null
      val format = (record["format"] as? JsonPrimitive)?.contentOrNull?.let { wire -> TransferFormat.entries.firstOrNull { it.wire == wire } } ?: return null
      val scope = (record["scope"] as? JsonPrimitive)?.contentOrNull
      return TransferExportPrefs(
        (record["presetId"] as? JsonPrimitive)?.takeIf { it.isString }?.content,
        (record["fieldIds"] as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull },
        format, (record["bom"] as? JsonPrimitive)?.booleanOrNull == true, if (scope in listOf("selection", "filter", "all")) scope!! else "all",
      )
    }
  }
}

data class TransferFields(
  val groups: List<TransferFieldGroupInfo>,
  val fields: List<TransferFieldInfo>,
  /** The resource's label (`Contacts`), for a title and "All contacts". */
  val resourceLabel: String? = null,
  /** The file formats the resource takes; a CSV when it names none. */
  val formats: List<TransferFormat> = listOf(TransferFormat.CSV),
  /** A resource nothing is imported into: its fields are all read-only, so Re-importable is not offered. */
  val exportOnly: Boolean = false,
  val presetHints: TransferPresetHints = TransferPresetHints(),
  /** The resource's own presets, after the built-in ones. */
  val resourcePresets: List<TransferSavedPreset> = emptyList(),
  /** The person's saved presets for the resource, in the order they saved them. */
  val savedPresets: List<TransferSavedPreset> = emptyList(),
  /** The export choice the person made last. */
  val lastExport: TransferExportPrefs? = null,
) {
  companion object {
    /** The route's answer, keeping the entries that carry an id. */
    fun decode(answer: JsonObject?): TransferFields {
      fun text(obj: JsonObject, key: String) = (obj[key] as? JsonPrimitive)?.contentOrNull
      val resource = answer?.get("resource") as? JsonObject
      val hints = answer?.get("presetHints") as? JsonObject
      fun strings(value: JsonElement?) = (value as? JsonArray).orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
      val formats = strings(resource?.get("formats")).mapNotNull { wire -> TransferFormat.entries.firstOrNull { it.wire == wire } }
      val prefs = answer?.get("prefs") as? JsonObject
      return TransferFields(
        groups = (answer?.get("groups") as? JsonArray).orEmpty().mapNotNull { entry ->
          (entry as? JsonObject)?.let { obj -> text(obj, "id")?.let { TransferFieldGroupInfo(it, text(obj, "label") ?: it) } }
        },
        fields = (answer?.get("fields") as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.let(TransferFieldInfo::decode) },
        resourceLabel = resource?.let { text(it, "label") },
        formats = formats.ifEmpty { listOf(TransferFormat.CSV) },
        exportOnly = (resource?.get("exportOnly") as? JsonPrimitive)?.booleanOrNull == true,
        presetHints = TransferPresetHints(strings(hints?.get("matchKeyFieldIds")), strings(hints?.get("minimalFieldIds"))),
        resourcePresets = (answer?.get("resourcePresets") as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.let(TransferSavedPreset::decode) },
        savedPresets = (prefs?.get("presets") as? JsonArray).orEmpty().mapNotNull { (it as? JsonObject)?.let(TransferSavedPreset::decode) },
        lastExport = TransferExportPrefs.decode(prefs?.get("export")),
      )
    }
  }
}

/** The export file formats (`TransferFormat`). */
enum class TransferFormat(val wire: String, val label: String) {
  CSV("csv", "CSV — opens in a spreadsheet"),
  JSON("json", "JSON — one array of records"),
  NDJSON("ndjson", "NDJSON — one record per line"),
}

class TransferApi(private val api: ConsoleApiClient, private val orgId: String?) {
  suspend fun fields(resource: String, hostId: String?, filter: Map<String, Any?>? = null): TransferFields =
    TransferFields.decode(
      api.request(
        "/api/transfer/fields",
        ApiMethod.POST,
        jsonBody("orgId" to orgId, "resource" to resource, "hostId" to hostId, "filter" to filter),
      ) as? JsonObject,
    )

  /**
   * The file: [fieldIds] in column order, over [scope] (`{kind: 'all'}`,
   * `{kind: 'filter', filter}` or `{kind: 'selection', ids}`). [bom] starts a
   * CSV with a byte-order mark (for Excel); [headers] are a resource preset's
   * column names for the chosen fields, sent only for a CSV, as the console sends them.
   */
  suspend fun export(
    resource: String,
    hostId: String?,
    fieldIds: List<String>,
    scope: Map<String, Any?>,
    format: TransferFormat,
    bom: Boolean = false,
    headers: Map<String, String> = emptyMap(),
  ): DownloadedFile {
    val body = linkedMapOf<String, Any?>(
      "orgId" to orgId,
      "hostId" to hostId,
      "resource" to resource,
      "fieldIds" to fieldIds,
      "scope" to scope,
      "format" to format.wire,
      "bom" to (format == TransferFormat.CSV && bom),
    )
    if (headers.isNotEmpty() && format == TransferFormat.CSV) body["headers"] = headers
    return api.download("/api/transfer/export", jsonBody(*body.toList().toTypedArray()))
  }
}
