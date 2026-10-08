package com.aglyn.plugins.crm

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.FieldOption
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

/** The CRM hub's sections, in the console's rail order. */
enum class CrmSection(val key: String, val label: String, val screen: String, val icon: String) {
  CONTACTS("contacts", "Contacts", "crm.contacts", "person"),
  LEADS("leads", "Leads", "crm.leads", "person_add"),
  COMPANIES("companies", "Companies", "crm.companies", "business"),
  DEALS("deals", "Deals", "crm.deals", "handshake"),
  TASKS("tasks", "Tasks", "crm.tasks", "task"),
  REPORTS("reports", "Reports", "crm.reports", "bar_chart"),
  FIELDS("fields", "Fields", "crm.fields", "tune"),
  SETTINGS("settings", "Settings", "crm.settings", "settings"),
}

/** A scoped collection read, as every CRM listener asks it: `visibleTo array-contains-any` the reader's tokens. */
fun scopedQuery(scope: CrmScope, collection: String, filters: List<FirestoreFilter> = emptyList(), orderBy: List<FirestoreOrder> = emptyList(), limit: Int = 200) =
  FirestoreQuery(
    crmPath(scope.orgId, collection),
    filters = listOf(FirestoreFilter("visibleTo", FilterOp.ARRAY_CONTAINS_ANY, scope.readTokens)) + filters,
    orderBy = orderBy,
    limit = limit,
  )

/** A pipeline and its stages, as `usePipeline` reads them. */
data class Pipeline(val id: String, val name: String, val stages: List<Stage>, val isDefault: Boolean, val archived: Boolean)

data class Stage(val id: String, val name: String, val order: Long, val probability: Long, val kind: String, val forecastCategory: String?)

fun pipelineOf(doc: com.aglyn.core.FirestoreDoc): Pipeline = Pipeline(
  id = doc.id,
  name = doc.string("name") ?: "Pipeline",
  stages = (doc.data["stages"] as? List<*>).orEmpty().mapNotNull { entry ->
    val stage = entry as? Map<*, *> ?: return@mapNotNull null
    Stage(
      id = stage["id"] as? String ?: return@mapNotNull null,
      name = stage["name"] as? String ?: "Stage",
      order = (stage["order"] as? Number)?.toLong() ?: 0,
      probability = (stage["probability"] as? Number)?.toLong() ?: 0,
      kind = stage["kind"] as? String ?: "open",
      forecastCategory = stage["forecastCategory"] as? String,
    )
  }.sortedBy { it.order },
  isDefault = doc.bool("isDefault") == true,
  archived = doc.data["archivedAt"] != null,
)

/** The default pipeline a workspace starts with, until it keeps its own (DEFAULT_DEAL_STAGES). */
fun defaultPipeline(): Pipeline = Pipeline(
  "default", "Sales",
  com.aglyn.contracts.Contracts.defaultDealStages.map {
    Stage(it.id, it.name, it.order.toLong(), it.probability.toLong(), it.kind.raw, it.forecastCategory?.raw)
  },
  isDefault = true, archived = false,
)

/** What every section reads beside its own list: the team, the picklists, the custom fields, the pipelines. */
class CrmReference(
  val members: List<CrmMember>,
  val picklists: Picklists,
  val customFields: List<CustomFieldDefinition>,
  val pipelines: List<Pipeline>,
  val companies: List<FieldOption>,
  val contacts: List<FieldOption>,
) {
  fun fields(kind: CrmKind): List<CrmField> = standardFields(kind, picklists, members, companies, contacts) + customFields(kind, customFields)
  fun memberLabel(uid: String?): String? = uid?.let { id -> members.firstOrNull { it.uid == id }?.label ?: id }
  val activePipelines: List<Pipeline> get() = pipelines.filter { !it.archived }.ifEmpty { listOf(defaultPipeline()) }
  fun pipeline(id: String?): Pipeline = activePipelines.firstOrNull { it.id == id } ?: activePipelines.firstOrNull { it.isDefault } ?: activePipelines.first()
  fun stageName(pipelineId: String?, stageId: String?): String? =
    stageId?.let { sid -> (pipelines + defaultPipeline()).firstOrNull { it.id == pipelineId }?.stages?.firstOrNull { it.id == sid }?.name ?: sid }
}

@Composable
private fun <T> live(key: Any?, flow: () -> Flow<Live<T>>): Live<T> {
  val remembered = remember(key) { flow() }
  return remembered.collectAsState(Live.Loading).value
}

@Composable
fun rememberCrmReference(context: NativePluginContext, scope: CrmScope, api: CrmApi): CrmReference {
  var members by remember(scope.orgId) { mutableStateOf<List<CrmMember>>(emptyList()) }
  LaunchedEffect(scope.orgId) {
    members = try { api.members() } catch (error: Throwable) {
      if (error is CancellationException) throw error
      emptyList()
    }
  }
  val reader = context.firestore
  val picklistDocs = live(scope.orgId) {
    reader.observe(scopedQuery(scope, "crmPicklists", limit = 40))
  }
  val fieldDocs = live(scope.orgId) { reader.observe(scopedQuery(scope, "contactFields", limit = 200)) }
  val pipelineDocs = live(scope.orgId) { reader.observe(scopedQuery(scope, "pipelines", limit = 20)) }
  val companyDocs = live(scope.orgId) { reader.observe(scopedQuery(scope, "companies", orderBy = listOf(FirestoreOrder("nameLower")), limit = 200)) }
  val contactDocs = live(scope.orgId) { reader.observe(scopedQuery(scope, "contacts", orderBy = listOf(FirestoreOrder("updatedAt", true)), limit = 200)) }
  fun <T> ready(value: Live<List<com.aglyn.core.FirestoreDoc>>, map: (List<com.aglyn.core.FirestoreDoc>) -> T, empty: T) = (value as? Live.Ready)?.value?.let(map) ?: empty
  return CrmReference(
    members = members,
    picklists = ready(picklistDocs, Picklists::of, Picklists(emptyMap())),
    customFields = ready(fieldDocs, { docs -> docs.map(::customFieldOf) }, emptyList()),
    pipelines = ready(pipelineDocs, { docs -> docs.map(::pipelineOf) }, emptyList()),
    companies = ready(companyDocs, { docs -> docs.map { FieldOption(it.id, it.string("name") ?: it.id) } }, emptyList()),
    contacts = ready(contactDocs, { docs -> docs.map { FieldOption(it.id, it.string("name")?.takeIf(String::isNotBlank) ?: it.string("email") ?: it.id) } }, emptyList()),
  )
}

/**
 * The CRM's gate: the site's scope, then the plan. A workspace whose plan
 * does not carry the CRM sees the console's own notice, never a list that
 * the rules would refuse to fill.
 */
@Composable
fun CrmGate(context: NativePluginContext, content: @Composable (CrmScope, CrmApi, CrmReference) -> Unit) {
  val orgId = context.orgId
  val hostId = context.hostId
  if (orgId == null || hostId == null) {
    EmptyState("Pick a site", body = "The CRM shows the records a site may see.", icon = AglynIcons.named("public"))
    return
  }
  val flow = remember(orgId, hostId, context.uid, context.firestore) { observeCrmScope(context.firestore, orgId, hostId, context.uid) }
  when (val live = flow.collectAsState(Live.Loading).value) {
    Live.Loading -> SkeletonList(rows = 6)
    is Live.Failed -> EmptyState("Could not open the CRM", body = live.error.message ?: "Check the connection and try again.", icon = AglynIcons.named("error"))
    is Live.Ready -> {
      val scope = live.value
      if (!scope.suite) {
        EmptyState(
          "The CRM is included from Starter",
          body = "Leads, contacts, companies, deals and tasks come with the Starter plan and above. Change the plan under Billing to use them.",
          icon = AglynIcons.named("group"),
          modifier = Modifier.testTag("crm-suite-locked"),
        )
        return
      }
      val api = remember(scope, context.api, context.writer) { CrmApi(context.api, context.writer, scope) }
      val reference = rememberCrmReference(context, scope, api)
      content(scope, api, reference)
    }
  }
}

/**
 * The CRM hub: the console's sections as chips over the picked one. Each
 * section is also its own screen (a link, a quick action), opening here.
 */
@Composable
fun CrmHubScreen(context: NativePluginContext, initial: CrmSection, params: Map<String, String> = emptyMap()) {
  var section by rememberSaveable { mutableStateOf(initial) }
  CrmGate(context) { scope, api, reference ->
    Column(Modifier.fillMaxSize()) {
      ChoiceChipRow(
        CrmSection.entries.map { ChipOption(it.key, it.label, it.icon) },
        section.key,
        { key -> section = CrmSection.entries.first { it.key == key } },
        modifier = Modifier.padding(horizontal = space(2f), vertical = space(1f)).testTag("crm-sections"),
      )
      when (section) {
        CrmSection.CONTACTS -> RecordsSection(context, CrmKind.CONTACT, scope, api, reference, params[CrmKind.CONTACT.param])
        CrmSection.LEADS -> RecordsSection(context, CrmKind.LEAD, scope, api, reference, params[CrmKind.LEAD.param])
        CrmSection.COMPANIES -> RecordsSection(context, CrmKind.COMPANY, scope, api, reference, params[CrmKind.COMPANY.param])
        CrmSection.DEALS -> DealsSection(context, scope, api, reference, params[CrmKind.DEAL.param])
        CrmSection.TASKS -> TasksSection(context, scope, api, reference)
        CrmSection.REPORTS -> ReportsSection(context, scope, reference)
        CrmSection.FIELDS -> FieldsSection(context, scope, api, reference)
        CrmSection.SETTINGS -> SettingsSection(context, scope, reference)
      }
    }
  }
}

@Composable
internal fun NotAllowed(text: String) {
  Text(text)
}

internal fun noFlow(): Flow<Live<List<com.aglyn.core.FirestoreDoc>>> = flowOf(Live.Ready(emptyList()))
