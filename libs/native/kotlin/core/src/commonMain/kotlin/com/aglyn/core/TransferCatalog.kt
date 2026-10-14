package com.aglyn.core

/*
 * A resource's fields in the order a person picks them, and the presets that fill the picker: the port of the console's
 * `field-catalog.ts` (`buildTransferFieldCatalog`, `groupTransferFields`, `searchTransferFields`,
 * `resolveTransferFieldSelection`, `resolveTransferPreset`, `moveTransferField`), replayed from
 * `libs/native/contracts/transfer-catalog-cases.json` (the Apple kit holds the same port).
 */

/** The field id every resource uses for the record's Aglyn id. */
const val TRANSFER_ID_FIELD = "id"

/** The built-in presets. */
enum class TransferPreset(val wire: String, val label: String) {
  /** The default for an export: the Aglyn id, the match keys and every writable field, so the file comes back in. */
  REIMPORTABLE("reimportable", "Re-importable"),

  /** Every field, in catalog order. */
  EVERYTHING("everything", "Everything"),

  /** The id, the match keys, the required fields and whatever short list the resource names as its minimum. */
  MINIMAL("minimal", "Minimal");

  fun description(brand: String): String = when (this) {
    REIMPORTABLE -> "The $brand ID, the match keys and every field an import can write."
    EVERYTHING -> "Every field, including computed and system fields."
    MINIMAL -> "The $brand ID, the match keys and the required fields."
  }
}

/** A resolved selection: the ids to export, in order, and the ids that no longer exist. */
data class TransferFieldSelection(val fieldIds: List<String>, val unknown: List<String> = emptyList())

class TransferFieldCatalog(declared: List<TransferFieldInfo>, declaredGroups: List<TransferFieldGroupInfo>, brand: String = AglynConfig.DEFAULT_BRAND_NAME) {
  /** Every field, in picker order: group by group, declaration order within. */
  val fields: List<TransferFieldInfo>

  /** The groups that hold at least one field, in order. */
  val groups: List<TransferFieldGroupInfo>
  private val index: Map<String, TransferFieldInfo>

  init {
    // The Aglyn id is added when the resource does not name it; a field id declared twice keeps its first declaration.
    val all = declared.toMutableList()
    if (all.none { it.id == TRANSFER_ID_FIELD }) {
      all += TransferFieldInfo(
        TRANSFER_ID_FIELD, "$brand ID", "system", null, readOnly = true, system = true, matchKey = true,
        aliases = listOf("${brand.lowercase()} id", "aglyn id", "record id", "id").distinct(),
      )
    }
    val unique = all.distinctBy { it.id }
    // The declared groups in their order, then any group a field names that was not declared, then the built-in tail.
    val ordered = mutableListOf<TransferFieldGroupInfo>()
    val known = mutableSetOf<String>()
    fun add(group: TransferFieldGroupInfo) {
      if (known.add(group.id)) ordered += group
    }
    val builtIn = listOf(TransferFieldGroupInfo("custom", "Custom fields"), TransferFieldGroupInfo("system", "System"), TransferFieldGroupInfo("other", "Other"))
    declaredGroups.forEach(::add)
    for (field in unique) {
      val id = field.group
      if (!id.isNullOrEmpty() && builtIn.none { it.id == id }) add(TransferFieldGroupInfo(id, id))
    }
    builtIn.forEach(::add)
    fun groupOf(field: TransferFieldInfo): String = field.group?.takeIf { it.isNotEmpty() && it in known } ?: "other"
    val arranged = ordered.flatMap { group -> unique.filter { groupOf(it) == group.id } }
    fields = arranged
    groups = ordered.filter { group -> arranged.any { groupOf(it) == group.id } }
    index = arranged.associateBy { it.id }
  }

  fun field(id: String): TransferFieldInfo? = index[id]

  operator fun contains(id: String): Boolean = id in index

  /** The fields under each group, in catalog order; [ids] narrows and keeps catalog order. */
  fun grouped(ids: List<String>? = null): List<Pair<TransferFieldGroupInfo, List<TransferFieldInfo>>> {
    val wanted = ids?.toSet()
    fun groupOf(field: TransferFieldInfo): String = field.group?.takeIf { id -> groups.any { it.id == id } } ?: "other"
    return groups.map { group -> group to fields.filter { groupOf(it) == group.id && (wanted == null || it.id in wanted) } }.filter { it.second.isNotEmpty() }
  }

  /** The fields whose label, id or an alias contains every word of [query]. */
  fun search(query: String): List<TransferFieldInfo> {
    val words = query.lowercase().split(Regex("\\s+")).filter { it.isNotEmpty() }
    if (words.isEmpty()) return fields
    return fields.filter { field ->
      val haystack = (listOf(field.label, field.id) + field.aliases).joinToString(" ").lowercase()
      words.all { it in haystack }
    }
  }

  /**
   * A list of field ids against the catalog: unknown ids dropped (and reported), duplicates dropped, the given order kept,
   * and every id in [ensure] present, added in catalog order at the front when missing.
   */
  fun resolveSelection(selected: List<String>, ensure: List<String> = emptyList()): TransferFieldSelection {
    val seen = mutableSetOf<String>()
    val ids = mutableListOf<String>()
    val unknown = mutableListOf<String>()
    for (id in selected) {
      if (!seen.add(id)) continue
      if (id in this) ids += id else unknown += id
    }
    val missing = fields.map { it.id }.filter { it in ensure && it !in ids }
    return TransferFieldSelection(missing + ids, unknown)
  }

  /** The fields a built-in preset exports, in order (the re-importable and minimal ones lead with the id and the match keys). */
  fun resolve(preset: TransferPreset, hints: TransferPresetHints = TransferPresetHints()): TransferFieldSelection {
    val keys = (listOf(TRANSFER_ID_FIELD) + hints.matchKeyFieldIds).distinct().filter { it in this }
    fun lead(ids: List<String>): List<String> {
      val rest = ids.toSet() - keys.toSet()
      return keys + fields.map { it.id }.filter { it in rest }
    }
    return when (preset) {
      TransferPreset.EVERYTHING -> TransferFieldSelection(fields.map { it.id })
      TransferPreset.REIMPORTABLE -> TransferFieldSelection(lead(fields.filter { it.writable }.map { it.id }))
      TransferPreset.MINIMAL -> {
        val minimal = hints.minimalFieldIds.toSet()
        TransferFieldSelection(lead(fields.filter { it.required || it.id in minimal }.map { it.id }), hints.minimalFieldIds.filter { it !in this })
      }
    }
  }

  /** A saved or resource preset resolved against the catalog. */
  fun resolve(preset: TransferSavedPreset): TransferFieldSelection = resolveSelection(preset.fieldIds)
}

/** [ids] with the entry at [from] moved to [to]: the picker's reorder. */
fun moveTransferField(ids: List<String>, from: Int, to: Int): List<String> {
  val next = ids.toMutableList()
  if (from < 0 || from >= next.size) return next
  val moved = next.removeAt(from)
  next.add(to.coerceIn(0, next.size), moved)
  return next
}
