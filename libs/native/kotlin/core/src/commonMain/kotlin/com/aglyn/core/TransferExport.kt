package com.aglyn.core

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/*
 * The platform's export, as every console export dialog makes it: the
 * resource's fields (`POST /api/transfer/fields`), then the file
 * (`POST /api/transfer/export`) with the fields the person picked, the
 * records it covers, and the format.
 */

data class TransferFieldInfo(val id: String, val label: String, val group: String?, val description: String?)

data class TransferFieldGroupInfo(val id: String, val label: String)

data class TransferFields(val groups: List<TransferFieldGroupInfo>, val fields: List<TransferFieldInfo>)

/** The export file formats (`TransferFormat`). */
enum class TransferFormat(val wire: String, val label: String) {
  CSV("csv", "CSV, for spreadsheets"),
  JSON("json", "JSON"),
  NDJSON("ndjson", "NDJSON, one record per line"),
}

class TransferApi(private val api: ConsoleApiClient, private val orgId: String?) {
  suspend fun fields(resource: String, hostId: String?, filter: Map<String, Any?>? = null): TransferFields {
    val answer = api.request(
      "/api/transfer/fields",
      ApiMethod.POST,
      jsonBody("orgId" to orgId, "resource" to resource, "hostId" to hostId, "filter" to filter),
    ) as? JsonObject
    fun text(obj: JsonObject, key: String) = (obj[key] as? JsonPrimitive)?.contentOrNull
    val groups = (answer?.get("groups") as? JsonArray)?.mapNotNull { entry ->
      (entry as? JsonObject)?.let { obj -> text(obj, "id")?.let { TransferFieldGroupInfo(it, text(obj, "label") ?: it) } }
    }.orEmpty()
    val fields = (answer?.get("fields") as? JsonArray)?.mapNotNull { entry ->
      (entry as? JsonObject)?.let { obj ->
        text(obj, "id")?.let { TransferFieldInfo(it, text(obj, "label") ?: it, text(obj, "group"), text(obj, "description")) }
      }
    }.orEmpty()
    return TransferFields(groups, fields)
  }

  /**
   * The file: [fieldIds] in column order, over [scope] (`{kind: 'all'}`,
   * `{kind: 'filter', filter}` or `{kind: 'selection', ids}`).
   */
  suspend fun export(resource: String, hostId: String?, fieldIds: List<String>, scope: Map<String, Any?>, format: TransferFormat): DownloadedFile =
    api.download(
      "/api/transfer/export",
      jsonBody(
        "orgId" to orgId,
        "hostId" to hostId,
        "resource" to resource,
        "fieldIds" to fieldIds,
        "scope" to scope,
        "format" to format.wire,
        "bom" to (format == TransferFormat.CSV),
      ),
    )
}
