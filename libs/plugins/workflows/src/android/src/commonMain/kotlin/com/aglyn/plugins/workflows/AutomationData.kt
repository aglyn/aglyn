package com.aglyn.plugins.workflows

import com.aglyn.contracts.CLIENT_ACTION_STEP_TYPES
import com.aglyn.contracts.Doc
import com.aglyn.contracts.LEAF_SELECTOR
import com.aglyn.contracts.ORG_SCOPE_TOKEN
import com.aglyn.contracts.actionRunResult
import com.aglyn.contracts.actionRunSummary
import com.aglyn.contracts.asDoc
import com.aglyn.contracts.formatEnUs
import com.aglyn.contracts.hostEventLabel
import com.aglyn.contracts.hostScopeToken
import com.aglyn.contracts.interactionPlaceholders
import com.aglyn.contracts.isWorkflowActionStep
import com.aglyn.contracts.jsString
import com.aglyn.contracts.localParts
import com.aglyn.contracts.orgAutomationPausedHostIds
import com.aglyn.contracts.runTriggeredByLabel
import com.aglyn.contracts.stepLabel
import com.aglyn.contracts.str
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.DEFAULT_TENANT_APEX
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.put

/*
 * A SITE'S AUTOMATION, as the console's Automation page reads and writes it:
 * `hosts/{hostId}/workflows`, `actions` and `webhooks`, the run history in
 * `hosts/{hostId}/activity`, the organization's own automations at
 * `orgs/{orgId}/automations`, and this month's run counters. Pure: the
 * paths, the query shapes, the rows a list draws and the bodies a route is
 * sent, so the specs hold each to the console's.
 */

const val HOST_RESOURCES_ROUTE = "/api/hosts/resources"
const val WHERE_USED_ROUTE = "/api/hosts/where-used"
const val ACTION_TEST_RUN_ROUTE = "/api/automations/actions/test-run"
const val ORG_AUTOMATIONS_MANAGE_ROUTE = "/api/automations/manage"
const val ORG_AUTOMATIONS_PAUSE_ROUTE = "/api/automations/pause"
const val ENTITLEMENTS_ROUTE = "/api/orgs/entitlements"

/** How many workflows, actions and editor options a list reads: a ceiling, with one probe row past it. */
const val WORKFLOW_CEILING = 100
const val ACTION_CEILING = 100
const val WEBHOOK_CEILING = 20
const val EDITOR_OPTION_CEILING = 100
const val ORG_SITE_LIST_ROWS = 10
const val ORG_SITE_LIST_OPEN_SITES = 5
const val ORG_SITE_LIST_MAX_SITES = 25
const val DUPLICATE_NAME_MAX = 200
const val DUPLICATE_NAME_PREFIX = "Copy of "

/** The list page sizes the console's tables offer; the first is where a list opens. */
val PAGE_SIZES = listOf(10, 25, 50)

fun workflowsPath(hostId: String) = "hosts/$hostId/workflows"
fun actionsPath(hostId: String) = "hosts/$hostId/actions"
fun webhooksPath(hostId: String) = "hosts/$hostId/webhooks"
fun functionsPath(hostId: String) = "hosts/$hostId/functions"
fun variablesPath(hostId: String) = "hosts/$hostId/variables"
fun overlaysPath(hostId: String) = "hosts/$hostId/overlays"
fun formsPath(hostId: String) = "hosts/$hostId/forms"
fun activityPath(hostId: String) = "hosts/$hostId/activity"
fun orgAutomationsPath(orgId: String) = "orgs/$orgId/automations"
fun datasetsPath(orgId: String) = "orgs/$orgId/datasets"
fun listsPath(orgId: String) = "orgs/$orgId/lists"
fun campaignsPath(orgId: String) = "orgs/$orgId/emailCampaigns"

enum class RunCounter(val key: String, val label: String, val quota: String) {
  WORKFLOW_RUNS("workflowRuns", "workflow runs", "workflowRunsPerMonth"),
  ACTION_RUNS("actionRuns", "action runs", "actionRunsPerMonth"),
}

/** The counter document: the workspace's, or the site's when it has no workspace. */
fun runCounterPath(counter: RunCounter, orgId: String?, hostId: String?): String? = when {
  !orgId.isNullOrEmpty() -> "orgs/$orgId/counters/${counter.key}"
  !hostId.isNullOrEmpty() -> "hosts/$hostId/counters/${counter.key}"
  else -> null
}

/** The counter field this month writes to: the UTC `YYYY-MM`. */
fun utcMonthKey(nowMs: Long): String = localParts(nowMs, "UTC").let { "${it.year}-${it.month.toString().padStart(2, '0')}" }

/** A collection read to a ceiling in document-id order, with one probe row that says whether it was cut. */
fun ceilingQuery(path: String, ceiling: Int, filters: List<FirestoreFilter> = emptyList()): FirestoreQuery =
  FirestoreQuery(path, filters = filters, orderBy = listOf(FirestoreOrder("__name__")), limit = ceiling + 1)

/** The rows under the ceiling, and whether there were more. */
data class Window<T>(val rows: List<T>, val truncated: Boolean)

fun <T> windowOf(rows: List<T>, ceiling: Int): Window<T> = Window(rows.take(ceiling), rows.size > ceiling)

fun scopeTokensForHost(hostId: String) = listOf(ORG_SCOPE_TOKEN, hostScopeToken(hostId))

/** The org automations that run on a site: live, placed on every site or on this one. */
fun siteOrgAutomationsQuery(orgId: String, hostId: String): FirestoreQuery = FirestoreQuery(
  orgAutomationsPath(orgId),
  filters = listOf(
    FirestoreFilter("deletedAt", FilterOp.EQ, null),
    FirestoreFilter("visibleTo", FilterOp.ARRAY_CONTAINS_ANY, scopeTokensForHost(hostId)),
  ),
  limit = com.aglyn.contracts.ORG_AUTOMATIONS_MAX + 1,
)

/** Every live org automation of a workspace, in id order. */
fun orgAutomationsQuery(orgId: String): FirestoreQuery = FirestoreQuery(
  orgAutomationsPath(orgId),
  filters = listOf(FirestoreFilter("deletedAt", FilterOp.EQ, null)),
  orderBy = listOf(FirestoreOrder("__name__")),
  limit = com.aglyn.contracts.ORG_AUTOMATIONS_MAX + 1,
)

/** The site's datasets the step pickers offer: shared with every site or with this one. */
fun siteDatasetsQuery(orgId: String, hostId: String): FirestoreQuery =
  ceilingQuery(datasetsPath(orgId), EDITOR_OPTION_CEILING, listOf(FirestoreFilter("visibleTo", FilterOp.ARRAY_CONTAINS_ANY, scopeTokensForHost(hostId))))

/** The site's campaigns the step pickers offer. */
fun siteCampaignsQuery(orgId: String, hostId: String): FirestoreQuery =
  ceilingQuery(campaignsPath(orgId), EDITOR_OPTION_CEILING, listOf(FirestoreFilter("visibleTo", FilterOp.ARRAY_CONTAINS_ANY, scopeTokensForHost(hostId))))

// ── Values ────────────────────────────────────────────────────────────────

fun Any?.timestampMs(): Long? = when (this) {
  is FirestoreTimestamp -> epochMillis
  is Number -> toLong()
  else -> null
}

private fun Any?.docs(): List<Doc> = (this as? List<*>)?.mapNotNull { it.asDoc() } ?: emptyList()

private fun Doc.live(): Boolean = this["deletedAt"] == null

/** A name for sorting the way `localeCompare` does closely enough: case-folded, then as written. */
val nameOrder: Comparator<String> = compareBy<String> { it.lowercase() }.thenBy { it }

// ── Workflows ─────────────────────────────────────────────────────────────

data class WorkflowRow(
  val id: String,
  val name: String,
  val steps: List<Doc>,
  val returnValue: String,
  val trigger: Doc?,
  val raw: Doc,
) {
  /** `3 steps · on New lead · double → quote`, as the console's row reads. */
  val caption: String
    get() {
      val count = "${steps.size} step${if (steps.size == 1) "" else "s"}"
      val event = trigger.str("event")?.takeIf { it.isNotEmpty() }?.let { " · on ${hostEventLabel(it)}" } ?: ""
      // `step.functionName` joined: an Actions step has none, and JavaScript joins it as nothing.
      val calls = steps.joinToString(" → ") { it["functionName"]?.let(::jsString) ?: "" }
      return "$count$event · $calls"
    }
}

fun workflowRowOf(doc: FirestoreDoc): WorkflowRow = WorkflowRow(
  id = doc.id,
  name = doc.data["name"]?.let(::jsString) ?: "",
  steps = doc.data["steps"].docs(),
  returnValue = doc.data["returnValue"] as? String ?: "",
  trigger = doc.data["trigger"].asDoc(),
  raw = doc.data,
)

/** The console's list: live workflows by name, out of the ceilinged window. */
fun visibleWorkflows(docs: List<FirestoreDoc>): List<WorkflowRow> =
  docs.filter { it.data["deletedAt"] == null }.map(::workflowRowOf).sortedWith(compareBy(nameOrder) { it.name })

/** Whether another workflow already has [name] (case-insensitive, the computed-variable lookup's rule). */
fun workflowNameTaken(rows: List<WorkflowRow>, name: String, selfId: String?): Boolean =
  rows.any { it.name.lowercase() == name.trim().lowercase() && it.id != selfId }

// ── Actions ───────────────────────────────────────────────────────────────

data class ActionRow(
  val id: String,
  val name: String,
  val trigger: Doc,
  val steps: List<Doc>,
  val enabled: Boolean,
  val raw: Doc,
) {
  val event: String get() = trigger.str("event") ?: ""

  /** `on Form submitted · Send an email → Wait`. */
  val caption: String get() = "on ${hostEventLabel(event)} · ${steps.joinToString(" → ") { stepLabel(it.str("type")) }}"

  val placeholders: Int get() = interactionPlaceholders(raw).size

  /** A row bound to one element: an interaction that lives on its page, counted rather than listed. */
  val elementScoped: Boolean get() = LEAF_SELECTOR.matches(trigger["selector"]?.let(::jsString) ?: "")
}

fun actionRowOf(doc: FirestoreDoc): ActionRow = ActionRow(
  id = doc.id,
  name = doc.data["name"]?.let(::jsString) ?: "",
  trigger = doc.data["trigger"].asDoc() ?: emptyMap(),
  steps = doc.data["steps"].docs(),
  enabled = doc.data["enabled"] != false,
  raw = doc.data,
)

/** The site's actions (live, not element interactions, by name) and how many element interactions there are. */
data class ActionList(val actions: List<ActionRow>, val elementInteractions: Int)

fun actionListOf(docs: List<FirestoreDoc>): ActionList {
  val live = docs.filter { it.data["deletedAt"] == null }.map(::actionRowOf)
  val (element, site) = live.partition { it.elementScoped }
  return ActionList(site.sortedWith(compareBy(nameOrder) { it.name }), element.size)
}

fun placeholderLine(count: Int): String? = when (count) {
  0 -> null
  1 -> "1 placeholder to fill in"
  else -> "$count placeholders to fill in"
}

fun elementInteractionLine(count: Int): String? = when (count) {
  0 -> null
  else -> (if (count == 1) "1 interaction is set up on its own element — " else "$count interactions are set up on their own elements — ") +
    "open the element in the besigner to edit it. Interactions belong to the page they are on, so they publish and roll back with it."
}

// ── Webhooks ──────────────────────────────────────────────────────────────

data class WebhookRow(
  val id: String,
  val name: String,
  val direction: String,
  val url: String,
  val workflowName: String,
  val secret: String,
) {
  val inbound: Boolean get() = direction == "inbound"

  fun endpoint(siteBase: String, hostId: String) = "$siteBase/api/hooks/$hostId/$id"

  fun caption(siteBase: String, hostId: String): String =
    if (inbound) "inbound · ${endpoint(siteBase, hostId)} → $workflowName" else "outbound · $url"
}

fun webhookRowOf(doc: FirestoreDoc): WebhookRow = WebhookRow(
  id = doc.id,
  name = doc.data["name"]?.let(::jsString) ?: "",
  direction = doc.data["direction"] as? String ?: "outbound",
  url = doc.data["url"]?.let(::jsString) ?: "",
  workflowName = doc.data["workflowName"]?.let(::jsString) ?: "",
  secret = doc.data["secret"] as? String ?: "",
)

fun visibleWebhooks(docs: List<FirestoreDoc>): List<WebhookRow> =
  docs.filter { it.data["deletedAt"] == null }.map(::webhookRowOf).sortedWith(compareBy(nameOrder) { it.name })

/** A site's public address: its custom domain, else its subdomain on the platform's domain (`hostPublicOrigin`). */
fun hostPublicOrigin(host: Doc?, apex: String = DEFAULT_TENANT_APEX): String? {
  host.str("cname")?.takeIf { it.isNotEmpty() }?.let { return "https://$it" }
  host.str("subdomain")?.takeIf { it.isNotEmpty() }?.let { return "https://$it.$apex" }
  return null
}

/** The console's hint for an outbound URL: https, and not an obvious private address (`WEBHOOK_URL_PATTERN`). */
val WEBHOOK_URL_PATTERN = Regex(
  "^https://(?!localhost)(?!127\\.)(?!0\\.)(?!10\\.)(?!172\\.(1[6-9]|2\\d|3[01])\\.)(?!192\\.168\\.)(?!169\\.254\\.)[^\\s]+$",
  RegexOption.IGNORE_CASE,
)

// ── Org automations ───────────────────────────────────────────────────────

data class OrgAutomationRow(
  val id: String,
  val name: String,
  val trigger: Doc,
  val steps: List<Doc>,
  val enabled: Boolean,
  val visibleTo: List<String>,
  val pausedHostIds: List<String>,
  val raw: Doc,
) {
  val caption: String get() = "on ${hostEventLabel(trigger.str("event"))} · ${steps.joinToString(" → ") { stepLabel(it.str("type")) }}"
  val everySite: Boolean get() = ORG_SCOPE_TOKEN in visibleTo
}

fun orgAutomationRowOf(doc: FirestoreDoc): OrgAutomationRow = OrgAutomationRow(
  id = doc.id,
  name = doc.data["name"]?.let(::jsString) ?: "",
  trigger = doc.data["trigger"].asDoc() ?: emptyMap(),
  steps = doc.data["steps"].docs(),
  enabled = doc.data["enabled"] != false,
  visibleTo = (doc.data["visibleTo"] as? List<*>)?.filterIsInstance<String>() ?: emptyList(),
  pausedHostIds = orgAutomationPausedHostIds(doc.data),
  raw = doc.data,
)

fun sortedOrgAutomations(docs: List<FirestoreDoc>, limit: Int = com.aglyn.contracts.ORG_AUTOMATIONS_MAX): List<OrgAutomationRow> =
  docs.take(limit).map(::orgAutomationRowOf).sortedWith(compareBy(nameOrder) { it.name })

/** A site of the workspace, as the org hub names it. */
data class OrgSite(val id: String, val name: String, val subdomain: String)

/** Every site an org automation is placed on: all of them for `org`, else the ones it names. */
fun placedSiteIds(row: OrgAutomationRow, sites: List<OrgSite>): List<String> =
  if (row.everySite) sites.map { it.id } else com.aglyn.contracts.hostIdsFromScope(row.visibleTo)

fun orgSiteName(sites: List<OrgSite>, hostId: String): String = sites.firstOrNull { it.id == hostId }?.name?.ifEmpty { null } ?: hostId

/** `Runs on every site` / `Runs on Demo, Shop` / `Runs on no site`. */
fun placementLine(row: OrgAutomationRow, sites: List<OrgSite>): String {
  if (row.everySite) return "Runs on every site"
  val names = com.aglyn.contracts.hostIdsFromScope(row.visibleTo).map { orgSiteName(sites, it) }
  return if (names.isNotEmpty()) "Runs on ${names.joinToString(", ")}" else "Runs on no site"
}

/** How an org automation stands on one site: switched off, paused here, or running here. */
enum class SitePlacement(val label: String) { OFF("Switched off"), PAUSED("Paused here"), RUNS("Runs here") }

fun sitePlacement(row: OrgAutomationRow, hostId: String): SitePlacement = when {
  !row.enabled -> SitePlacement.OFF
  hostId in row.pausedHostIds -> SitePlacement.PAUSED
  else -> SitePlacement.RUNS
}

// ── Org hub lists ─────────────────────────────────────────────────────────

enum class SiteListKind(val key: String, val header: String, val noun: String, val plural: String, val intro: String) {
  WORKFLOWS(
    "workflows", "Workflows on every site", "workflow", "workflows",
    "Every site’s workflows, side by side. A workflow calls its own site’s functions and variables, so it is built and edited in that site’s Automation.",
  ),
  ACTIONS(
    "actions", "Actions on every site", "action", "actions",
    "Every site’s own actions, side by side. To run one automation on several sites, make it an org automation instead.",
  ),
  WEBHOOKS(
    "webhooks", "Webhooks on every site", "webhook", "webhooks",
    "Every site’s webhooks, side by side. A webhook holds its site’s address and secret, so it is managed in that site’s Automation.",
  ),
}

data class SiteListRow(val id: String, val name: String, val trigger: String, val status: String)

/** One site's rows in an org hub list: live, actions without element interactions. */
fun siteListRows(kind: SiteListKind, docs: List<FirestoreDoc>): List<SiteListRow> = docs
  .filter { it.data["deletedAt"] == null }
  .filterNot { kind == SiteListKind.ACTIONS && LEAF_SELECTOR.matches((it.data["trigger"].asDoc()?.get("selector"))?.let(::jsString) ?: "") }
  .map { doc ->
    val data = doc.data
    val trigger = when (kind) {
      SiteListKind.WEBHOOKS -> if (data["direction"] == "inbound") "Inbound" else "Outbound"
      else -> data["trigger"].asDoc().str("event")?.takeIf { it.isNotEmpty() }?.let(::hostEventLabel)
        ?: if (kind == SiteListKind.WORKFLOWS) "Run by other automations" else "—"
    }
    val status = if (kind == SiteListKind.WORKFLOWS) "Ready" else if (data["enabled"] == false) "Off" else "On"
    SiteListRow(doc.id, (data["name"] as? String)?.ifEmpty { null } ?: doc.id, trigger, status)
  }

// ── Picker options ────────────────────────────────────────────────────────

data class PickOption(val id: String, val name: String)

private fun named(docs: List<FirestoreDoc>, name: (Doc) -> String?): List<PickOption> = docs
  .filter { it.data["deletedAt"] == null }
  .mapNotNull { doc -> name(doc.data)?.trim()?.takeIf { it.isNotEmpty() }?.let { PickOption(doc.id, it) } }
  .sortedWith(compareBy(nameOrder) { it.name })

fun workflowOptions(docs: List<FirestoreDoc>) = named(docs) { it["name"] as? String }
fun listOptions(docs: List<FirestoreDoc>) = named(docs) { it["name"] as? String }
fun campaignOptions(docs: List<FirestoreDoc>) = named(docs) { it["name"] as? String }
fun functionOptions(docs: List<FirestoreDoc>) = named(docs) { it["name"] as? String }

/** Outbound, live webhooks: the ones a `webhookPost` step may deliver to. */
fun webhookOptions(docs: List<FirestoreDoc>) = named(docs.filter { it.data["direction"] == "outbound" }) { it["name"] as? String }

/** A dataset's name: its display name, else its name, else its id. */
fun datasetOptions(docs: List<FirestoreDoc>): List<PickOption> = docs
  .filter { it.data["deletedAt"] == null }
  .map { doc -> PickOption(doc.id, listOf(doc.data["displayName"], doc.data["name"]).firstNotNullOfOrNull { (it as? String)?.trim()?.ifEmpty { null } } ?: doc.id) }
  .sortedWith(compareBy(nameOrder) { it.name })

/** An overlay's name: its own, its bar's text, its popup's headline, else its id. */
fun overlayOptions(docs: List<FirestoreDoc>): List<PickOption> = docs
  .filter { it.data["deletedAt"] == null }
  .map { doc ->
    val data = doc.data
    val text = { value: Any? -> (value as? String)?.trim()?.ifEmpty { null } }
    PickOption(doc.id, text(data["name"]) ?: text(data["bar"].asDoc()?.get("text")) ?: text(data["popup"].asDoc()?.get("headline")) ?: doc.id)
  }
  .sortedWith(compareBy(nameOrder) { it.name })

/** A form's name for the "Form is" condition: not archived, its display name or its id. */
fun formOptions(docs: List<FirestoreDoc>): List<PickOption> = docs
  .filter { it.data["archivedAt"] == null }
  .map { doc -> PickOption(doc.id, (doc.data["displayName"] as? String)?.trim()?.ifEmpty { null } ?: doc.id) }
  .sortedWith(compareBy(nameOrder) { it.name })

/** Whether a record shared as [target] reaches every site [source] names (`scopeCovers`). */
fun scopeCovers(target: List<String>?, source: List<String>): Boolean {
  if (target != null && ORG_SCOPE_TOKEN in target) return true
  if (ORG_SCOPE_TOKEN in source) return false
  val reach = target?.toSet() ?: emptySet()
  return source.all { it in reach }
}

// ── Entitlements and quotas ───────────────────────────────────────────────

/** What a workspace's plan includes, as `/api/orgs/entitlements` answers: a missing or null quota is unlimited. */
data class Entitlements(val features: Map<String, Boolean>, val quotas: Map<String, Long?>) {
  fun has(feature: String) = features[feature] == true
  fun limit(quota: String): Long? = quotas[quota]
}

fun entitlementsOf(body: JsonElement?): Entitlements {
  val root = body as? JsonObject ?: return Entitlements(emptyMap(), emptyMap())
  val features = (root["features"] as? JsonObject)?.mapValues { (_, value) -> (value as? JsonPrimitive)?.booleanOrNull == true } ?: emptyMap()
  val quotas = (root["quotas"] as? JsonObject)?.mapValues { (_, value) ->
    (value as? JsonPrimitive)?.takeIf { it !is JsonNull }?.doubleOrNull?.takeIf { it.isFinite() }?.toLong()
  } ?: emptyMap()
  return Entitlements(features, quotas)
}

/** `312 workflow runs this month · 1,000 included` / `· no monthly limit`. */
fun runQuotaLine(counter: RunCounter, used: Long, limit: Long?): String =
  "${formatEnUs(used.toDouble(), 0)} ${counter.label} this month · " +
    if (limit == null) "no monthly limit" else "${formatEnUs(limit.toDouble(), 0)} included"

/** The standing cap readout: `3/25 workflows on your plan`, or the count alone while the plan loads. */
fun quotaReadout(used: Int, limit: Long?, ready: Boolean, noun: String): String =
  if (ready) "$used/${limit?.toString() ?: "∞"} ${noun}s on your plan" else "$used ${if (used == 1) noun else "${noun}s"} · checking your plan…"

// ── Run history ───────────────────────────────────────────────────────────

val RUN_RESULTS = listOf("succeeded", "failed", "skipped")
val RUN_RESULT_LABELS = linkedMapOf("succeeded" to "Succeeded", "failed" to "Failed", "skipped" to "Skipped")

data class RunRow(
  val id: String,
  val result: String,
  val trigger: String,
  val triggerLabel: String,
  val who: String,
  val summary: String,
  val durationMs: Long?,
  val createdAtMs: Long?,
) {
  /** The `What happened` column with its duration. */
  val summaryLine: String get() = summary + (durationMs?.let { " · ${it}ms" } ?: "")
}

fun runRowOf(doc: FirestoreDoc): RunRow = RunRow(
  id = doc.id,
  result = actionRunResult(doc.data) ?: "succeeded",
  trigger = doc.data["trigger"]?.let(::jsString) ?: "",
  triggerLabel = hostEventLabel(doc.data["trigger"] as? String),
  who = runTriggeredByLabel(doc.data),
  summary = actionRunSummary(doc.data),
  durationMs = (doc.data["durationMs"] as? Number)?.toLong(),
  createdAtMs = doc.data["createdAt"].timestampMs(),
)

/** What the run history is filtered by: a result, a trigger event and the search box's first word. */
data class RunFilters(val result: String? = null, val trigger: String? = null, val search: String = "")

/**
 * The run history's query (`model/run-history.ts`): this automation's
 * entries, runs only (`result in [...]` unless a Result is asked for, whose
 * own equality already names nothing else), newest first, `pageSize * (page
 * + 1) + 1` rows so a later page grows the read.
 */
fun runHistoryQuery(hostId: String, targetId: String?, filters: RunFilters, pageSize: Int, page: Int): FirestoreQuery {
  val clauses = buildList {
    if (!targetId.isNullOrEmpty()) add(FirestoreFilter("target.id", FilterOp.EQ, targetId))
    if (filters.result == null) add(FirestoreFilter("result", FilterOp.IN, RUN_RESULTS))
    filters.trigger?.let { add(FirestoreFilter("trigger", FilterOp.EQ, it)) }
    filters.result?.let { add(FirestoreFilter("result", FilterOp.EQ, it)) }
    val token = com.aglyn.core.listquery.nameSearchToken(filters.search)
    if (token.isNotEmpty()) add(FirestoreFilter("summaryTokens", FilterOp.ARRAY_CONTAINS, token))
  }
  return FirestoreQuery(
    activityPath(hostId),
    filters = clauses,
    orderBy = listOf(FirestoreOrder("createdAt", descending = true)),
    limit = pageSize * (page + 1) + 1,
  )
}

/** The rows one page shows of a grown read, and whether there is another page. */
fun <T> pageOf(rows: List<T>, pageSize: Int, page: Int): Pair<List<T>, Boolean> =
  rows.drop(pageSize * page).take(pageSize) to (rows.size > pageSize * (page + 1))

// ── Route bodies ──────────────────────────────────────────────────────────

/** Plain values as JSON for a route body; a timestamp as epoch milliseconds. */
fun jsonOf(value: Any?): JsonElement = when (value) {
  null -> JsonNull
  is JsonElement -> value
  is String -> JsonPrimitive(value)
  is Boolean -> JsonPrimitive(value)
  is Long -> JsonPrimitive(value)
  is Int -> JsonPrimitive(value)
  is Double -> if (value.isFinite() && kotlin.math.floor(value) == value && kotlin.math.abs(value) < 9.0E15) JsonPrimitive(value.toLong()) else JsonPrimitive(value)
  is Number -> JsonPrimitive(value)
  is FirestoreTimestamp -> JsonPrimitive(value.epochMillis)
  is Map<*, *> -> JsonObject(value.entries.associate { (key, item) -> key.toString() to jsonOf(item) })
  is List<*> -> JsonArray(value.map(::jsonOf))
  else -> JsonPrimitive(value.toString())
}

fun createWorkflowBody(hostId: String, fields: Doc): JsonObject = buildJsonObject {
  put("hostId", hostId)
  put("resource", "workflow")
  put("data", jsonOf(fields))
}

fun duplicateWorkflowBody(hostId: String, sourceId: String, name: String, attemptKey: String): JsonObject = buildJsonObject {
  put("hostId", hostId)
  put("resource", "workflow")
  put("action", "duplicate")
  put("sourceId", sourceId)
  if (name.isNotEmpty()) put("name", name)
  put("attemptKey", attemptKey)
}

/** The action's shell, created by the route that holds the per-site cap; the merge after it writes the whole action. */
fun createActionShellBody(hostId: String, id: String, name: String): JsonObject = buildJsonObject {
  put("hostId", hostId)
  put("resource", "action")
  put("id", id)
  put("data", buildJsonObject { put("name", name) })
}

fun createWebhookBody(hostId: String, id: String, name: String, direction: String, url: String, workflowName: String, secret: String): JsonObject =
  buildJsonObject {
    put("hostId", hostId)
    put("resource", "webhook")
    put("id", id)
    put(
      "data",
      buildJsonObject {
        put("name", name.trim().take(60))
        put("direction", direction)
        if (direction == "outbound") put("url", url.trim()) else put("workflowName", workflowName.trim())
        put("secret", secret)
        put("enabled", true)
      },
    )
  }

fun whereUsedBody(hostId: String, id: String, name: String): JsonObject = buildJsonObject {
  put("hostId", hostId)
  put("kind", "workflow")
  put("id", id)
  put("name", name)
}

fun testRunBody(hostId: String, actionId: String): JsonObject = buildJsonObject {
  put("hostId", hostId)
  put("actionId", actionId)
}

fun pauseBody(hostId: String, automationId: String, paused: Boolean): JsonObject = buildJsonObject {
  put("hostId", hostId)
  put("automationId", automationId)
  put("paused", paused)
}

fun manageBody(orgId: String, action: String, automationId: String? = null, automation: Doc? = null, enabled: Boolean? = null): JsonObject =
  buildJsonObject {
    put("orgId", orgId)
    put("action", action)
    automationId?.let { put("automationId", it) }
    automation?.let { put("automation", jsonOf(it)) }
    enabled?.let { put("enabled", it) }
  }

// ── Where used ────────────────────────────────────────────────────────────

/** What references a workflow, as `/api/hosts/where-used` answers; a failed scan is none. */
data class WhereUsed(val dependentTypes: List<String>, val total: Int)

fun whereUsedOf(body: JsonElement?): WhereUsed {
  val root = body as? JsonObject ?: return WhereUsed(emptyList(), 0)
  val types = (root["dependents"] as? JsonArray)?.mapNotNull { ((it as? JsonObject)?.get("type") as? JsonPrimitive)?.contentOrNull } ?: emptyList()
  val total = (root["total"] as? JsonPrimitive)?.doubleOrNull?.toInt() ?: 0
  return WhereUsed(types, total)
}

/** `2 pages, 1 variable`: a `screen` reads as a page. */
fun summarizeDependents(result: WhereUsed): String {
  val counts = linkedMapOf<String, Int>()
  for (type in result.dependentTypes) {
    val label = if (type == "screen") "page" else type
    counts[label] = (counts[label] ?: 0) + 1
  }
  return counts.entries.joinToString(", ") { (label, count) -> "$count $label${if (count == 1) "" else "s"}" }
}

fun workflowDeleteBody(name: String, scan: WhereUsed): String =
  if (scan.total > 0) "\"$name\" computes ${summarizeDependents(scan)} — those variables will fall back to their stored values."
  else "\"$name\" will no longer be runnable."

fun workflowUsageLine(name: String, scan: WhereUsed): String =
  if (scan.total > 0) "\"$name\" computes ${summarizeDependents(scan)}" else "\"$name\" is not referenced by anything published"

/** The copy's default name: `Copy of …`, never stacked. */
fun duplicateDisplayName(sourceName: String?): String {
  val name = sourceName?.trim()?.ifEmpty { null } ?: "Untitled"
  return (if (name.startsWith(DUPLICATE_NAME_PREFIX)) name else "$DUPLICATE_NAME_PREFIX$name").take(DUPLICATE_NAME_MAX)
}

// ── Test run ──────────────────────────────────────────────────────────────

/** What a test run says: the first alert, or that the server steps ran. */
fun testRunMessage(body: JsonElement?): String {
  val alerts = ((body as? JsonObject)?.get("alerts") as? JsonArray) ?: JsonArray(emptyList())
  val first = ((alerts.firstOrNull() as? JsonObject)?.get("message") as? JsonPrimitive)?.contentOrNull
  return if (alerts.isNotEmpty()) "Test ran — first alert: ${first ?: ""}" else "Test ran — server steps executed (see Runs)"
}

/** The console's words for a test run's refusal, when the route sent none of its own. */
fun testRunRefusal(status: Int): String = when (status) {
  400 -> "Only an action with an in-page trigger can be tested here"
  403 -> "Only a site admin or editor can test an action"
  404 -> "That action no longer exists"
  409 -> "Switch the action on to test it"
  429 -> "Too many test runs — wait a minute and try again"
  else -> if (status >= 500) "The test run could not be completed. Try again." else "Test run failed"
}

// ── Steps ─────────────────────────────────────────────────────────────────

/** Whether a stored step is a client step, edited by its own plain fields. */
fun isClientStep(step: Doc): Boolean = step.str("type") in CLIENT_ACTION_STEP_TYPES

fun isFunctionCall(step: Doc): Boolean = !isWorkflowActionStep(step)
