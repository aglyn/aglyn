package com.aglyn.plugins.data

import com.aglyn.contracts.ContractJsonFormat
import com.aglyn.contracts.DatasetFieldDefinition
import com.aglyn.contracts.DatasetFieldEntry
import com.aglyn.contracts.DatasetFieldType
import com.aglyn.contracts.DatasetModel
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.firestoreJson
import com.aglyn.pluginhost.jsNumber
import com.aglyn.pluginhost.jsString
import com.aglyn.pluginhost.jsonStringify
import com.aglyn.pluginhost.utcMinute

/*
 * The dataset model's pure half (libs/plugins/data/src/lib/model/
 * dataset-model-core.ts), ported once: the v1 shim, a stored value as the
 * records table shows it and as its input reads, and the field-id rules.
 * DataCasesTest replays the console's own answers for every function here.
 *
 * Stored values are what the Firestore reader hands over: String, Long,
 * Double, Boolean, null, FirestoreTimestamp, List and Map.
 */

/** "roast_preference" → "Roast preference" (`humanizeDatasetFieldId`). */
fun humanizeDatasetFieldId(id: String): String {
  val words = jsTrim(id.replace('_', ' '))
  return if (words.isEmpty()) id else words.substring(0, 1).uppercase() + words.substring(1)
}

/** The v1 shim: every flat column a text field (`deriveModelFromFields`). */
fun deriveModelFromFields(fields: List<String>): DatasetModel =
  DatasetModel(fields = fields.associateWith { DatasetFieldDefinition(name = humanizeDatasetFieldId(it), type = DatasetFieldType.TEXT) }, order = fields)

/** A model from quick-creator entries, every field text (`modelFromFieldEntries`). */
fun modelFromFieldEntries(entries: List<DatasetFieldEntry>): DatasetModel =
  DatasetModel(fields = entries.associate { it.id to DatasetFieldDefinition(name = it.name, type = DatasetFieldType.TEXT) }, order = entries.map { it.id })

/** The stored `model`, decoded; null when the document holds none (or a shape no model has). */
fun decodeDatasetModel(raw: Any?): DatasetModel? =
  (raw as? Map<*, *>)?.let { runCatching { ContractJsonFormat.decodeFromJsonElement(DatasetModel.serializer(), firestoreJson(it)) }.getOrNull() }

/** The dataset's model, deriving one from v1 `fields` when absent (`effectiveDatasetModel`). */
fun effectiveDatasetModel(data: Map<String, Any?>): DatasetModel {
  val model = decodeDatasetModel(data["model"])
  if (model?.fields != null && !model.order.isNullOrEmpty()) return model
  return deriveModelFromFields((data["fields"] as? List<*>)?.mapNotNull { it as? String }.orEmpty())
}

/** A model's fields in display order, each with its id; a missing definition is skipped. */
fun DatasetModel.orderedFields(): List<Pair<String, DatasetFieldDefinition>> =
  order.orEmpty().mapNotNull { id -> fields?.get(id)?.let { id to it } }

/** The name a field is shown under: its name, else its id. */
fun DatasetFieldDefinition.label(id: String): String = name?.takeIf { it.isNotEmpty() } ?: id

private fun finite(value: Any?): Double? = (value as? Number)?.toDouble()?.takeIf { it.isFinite() }

/** A stored value as a grid cell (`formatDatasetValue`). */
fun formatDatasetValue(field: DatasetFieldDefinition, value: Any?): String {
  if (value == null || value == "") return ""
  return when (field.type) {
    DatasetFieldType.BOOL -> when (value) {
      true -> "✓"
      false -> "—"
      else -> jsString(value)
    }
    DatasetFieldType.TIMESTAMP -> finite(value)?.let { utcMinute(it.toLong()).replace('T', ' ') } ?: jsString(value)
    DatasetFieldType.COORDINATES -> {
      val map = value as? Map<*, *>
      val latitude = finite(map?.get("latitude"))
      val longitude = finite(map?.get("longitude"))
      if (latitude != null && longitude != null) "${jsNumber(latitude)}, ${jsNumber(longitude)}" else jsString(value)
    }
    DatasetFieldType.SORTED -> if (value is List<*>) value.joinToString(", ") { if (it == null) "" else jsString(it) } else jsString(value)
    DatasetFieldType.MAP -> jsonStringify(value)
    else -> jsString(value)
  }
}

/** A stored value as its input's text (`datasetValueToInput`); timestamps as `YYYY-MM-DDTHH:mm` in UTC. */
fun datasetValueToInput(field: DatasetFieldDefinition, value: Any?): String {
  if (value == null) return ""
  if (field.type == DatasetFieldType.TIMESTAMP) finite(value)?.let { return utcMinute(it.toLong()) }
  if (field.type == DatasetFieldType.BOOL) return when (value) {
    true -> "true"
    false -> "false"
    else -> jsString(value)
  }
  if (field.type == DatasetFieldType.COORDINATES || field.type == DatasetFieldType.SORTED || field.type == DatasetFieldType.MAP) {
    return formatDatasetValue(field, value)
  }
  return jsString(value)
}

/** Field ids: a letter, then letters, digits and underscores (`DATASET_FIELD_PATTERN`). */
private val FIELD_PATTERN = Regex("^[A-Za-z][A-Za-z0-9_]*$")

// JavaScript's `\s`, which a `String.trim()` and the slug's dash rule mean.
private const val JS_SPACE = "\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF"
private val JS_TRIM = Regex("^[$JS_SPACE]+|[$JS_SPACE]+$")

private fun jsTrim(text: String): String = text.replace(JS_TRIM, "")

/** "Roast preference" → "roast_preference"; '' when nothing salvageable (`slugifyDatasetFieldId`). */
fun slugifyDatasetFieldId(name: String): String {
  val slug = jsTrim(name).lowercase()
    .replace(Regex("[$JS_SPACE-]+"), "_")
    .replace(Regex("[^a-z0-9_]"), "")
    .replace(Regex("^[0-9_]+"), "")
    .replace(Regex("_+$"), "")
  return if (FIELD_PATTERN.matches(slug)) slug else ""
}

/** A new field's id: the slug, suffixed `_2`, `_3`… to stay unique (`defaultDatasetFieldId`). */
fun defaultDatasetFieldId(name: String, taken: Collection<String>): String {
  val base = slugifyDatasetFieldId(name)
  if (base.isEmpty()) return ""
  val used = taken.map { it.lowercase() }.toSet()
  var candidate = base
  var suffix = 2
  while (candidate.lowercase() in used) candidate = "${base}_${suffix++}"
  return candidate
}

/** A typed reference id's problem, or null when it is usable (`validateDatasetFieldId`). */
fun validateDatasetFieldId(id: String, taken: Collection<String>): String? {
  val trimmed = jsTrim(id)
  if (trimmed.isEmpty()) return "A reference ID is required"
  if (!FIELD_PATTERN.matches(trimmed)) return "Start with a letter; use only letters, numbers, and underscores"
  if (trimmed.lowercase() in taken.map { it.lowercase() }) return "Another field already uses this reference ID"
  return null
}

/** Comma- or line-separated human names as `{id, name}` entries (`parseDatasetFieldEntries`). */
fun parseDatasetFieldEntries(input: String): List<DatasetFieldEntry> {
  val seen = HashSet<String>()
  val entries = mutableListOf<DatasetFieldEntry>()
  for (raw in input.split(',', '\n')) {
    val trimmed = jsTrim(raw)
    if (trimmed.isEmpty()) continue
    val id = slugifyDatasetFieldId(trimmed)
    if (id.isEmpty() || !seen.add(id)) continue
    entries += DatasetFieldEntry(id = id, name = if (FIELD_PATTERN.matches(trimmed)) humanizeDatasetFieldId(trimmed) else trimmed)
  }
  return entries
}

/** The name a dataset is shown under: `displayName`, then the pre-migration `name` (`datasetDisplayName`). */
fun datasetDisplayName(data: Map<String, Any?>?): String {
  for (candidate in listOf(data?.get("displayName"), data?.get("name"))) {
    if (candidate is String && jsTrim(candidate).isNotEmpty()) return jsTrim(candidate)
  }
  return ""
}
