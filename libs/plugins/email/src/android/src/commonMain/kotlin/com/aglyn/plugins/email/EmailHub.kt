package com.aglyn.plugins.email

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.contracts.ListQueryFilter
import com.aglyn.contracts.ListQueryOp
import com.aglyn.contracts.ListQueryRequest
import com.aglyn.core.ApiMethod
import com.aglyn.core.FirestoreDelete
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.firestoreJson
import com.aglyn.core.firestoreNow
import com.aglyn.core.listquery.nameSearchFields
import com.aglyn.core.listquery.newResourceId
import com.aglyn.core.listquery.planListQuery
import com.aglyn.core.listquery.toFirestoreQuery
import com.aglyn.core.nowMillis
import com.aglyn.core.relativeTime
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.Busy
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.FieldEditor
import com.aglyn.ui.FieldKind
import com.aglyn.ui.FieldSpec
import com.aglyn.ui.FormSheet
import com.aglyn.ui.LiveListPane
import com.aglyn.ui.LiveQueryList
import com.aglyn.ui.MenuAction
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OverflowMenu
import com.aglyn.ui.PropertyRow
import com.aglyn.ui.SearchField
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.space
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.longOrNull

/*
 * THE EMAILS HUB (the Apple plugin's `EmailHub.swift`): the console's Emails
 * sections natively. Messages are the site's sends; Templates the site's
 * Besigner email designs; Audiences the workspace's lists and their members;
 * Topics, Sending and Suppressions the rest of the rail. Reads are the
 * console's own list declarations; every write is the console's own: its
 * routes, or the same Firestore write under the same rules.
 */

enum class EmailSection(val key: String, val label: String, val icon: String) {
  MESSAGES("messages", "Messages", "mail"),
  TEMPLATES("templates", "Templates", "brush"),
  AUDIENCES("audiences", "Audiences", "groups"),
  TOPICS("topics", "Topics", "tag"),
  SENDING("sending", "Sending", "send"),
  SUPPRESSIONS("suppressions", "Suppressions", "block");

  val screen: String get() = "email.$key"
}

const val RESOURCES_ROUTE = "/api/hosts/resources"
const val VERSIONS_ROUTE = "/api/hosts/versions"
const val ERASE_ROUTE = "/api/resources/erase"
const val LIST_MEMBERS_PREVIEW_ROUTE = "/api/email/list-members-preview"
const val LIST_MEMBERS_ADD_ROUTE = "/api/email/list-members-add"
const val SUPPRESSION_ADD_ROUTE = "/api/email/suppression-add"
const val SENDING_IDENTITY_ROUTE = "/api/email/sending-identity"
const val SENDING_DOMAINS_ROUTE = "/api/email/sending-domains"

private fun words(text: String): List<String>? = text.trim().ifEmpty { null }?.let { listOf(it) }

fun templatesQuery(hostId: String, search: String, limit: Int): FirestoreQuery = planListQuery(
  Contracts.emailTemplateQuery,
  ListQueryRequest(base = listOf(ListQueryFilter(ListQueryOp.EQUAL, "kind", JsonPrimitive("email"))), clauses = emptyList(), search = words(search)),
).toFirestoreQuery("hosts/$hostId/screens", limit)

fun listsQuery(orgId: String, kind: String, search: String, limit: Int): FirestoreQuery = planListQuery(
  Contracts.emailListQuery,
  ListQueryRequest(clauses = if (kind.isEmpty()) emptyList() else listOf(ListFilterRequest("kind", "equals", kind)), search = words(search)),
).toFirestoreQuery("orgs/$orgId/lists", limit)

fun listMembersQuery(orgId: String, listId: String, search: String, limit: Int): FirestoreQuery =
  planListQuery(Contracts.listMemberQuery, ListQueryRequest(clauses = emptyList(), search = words(search))).toFirestoreQuery("orgs/$orgId/lists/$listId/members", limit)

fun suppressionsQuery(hostId: String, search: String, limit: Int): FirestoreQuery =
  planListQuery(Contracts.suppressionListQuery, ListQueryRequest(clauses = emptyList(), search = words(search))).toFirestoreQuery("hosts/$hostId/suppressions", limit)

/** A new design's first canvas (the console's `emailDesignStarterNodes`, replayed against its answers). */
fun emailDesignStarterNodes(sectionId: String, textId: String): Map<String, Any?> {
  val root = "_@_"
  return mapOf(
    root to mapOf("\$id" to root, "componentId" to "div", "nodes" to listOf(sectionId)),
    sectionId to mapOf("\$id" to sectionId, "componentId" to "emailSection", "pluginId" to "email", "parentId" to root, "nodes" to listOf(textId)),
    textId to mapOf(
      "\$id" to textId, "componentId" to "emailText", "pluginId" to "email", "parentId" to sectionId,
      "props" to mapOf("children" to "Hello {{contact.firstName}},", "variant" to "body"),
    ),
  )
}

/** The screen and first version a design is stored as (the console's `emailDesignDocuments`). */
fun emailDesignDocuments(screenId: String, versionId: String, displayName: String, nodes: Map<String, Any?>): Pair<Map<String, Any?>, Map<String, Any?>> =
  mapOf("displayName" to displayName, "kind" to "email", "versionId" to versionId) to mapOf("screenId" to screenId, "nodes" to nodes)

/** Addresses typed or pasted: split on commas, semicolons, spaces and lines. */
fun addressesIn(text: String): List<String> = text.split(',', ';', ' ', '\n', '\t').map { it.trim() }.filter { it.isNotEmpty() }

data class MemberPreview(val optedIn: Long, val needAttestation: Long, val refused: Long, val notes: List<Pair<String, String>>)

private fun JsonElement?.obj(): JsonObject? = this as? JsonObject
private fun JsonObject?.str(key: String): String? = (this?.get(key) as? JsonPrimitive)?.contentOrNull
private fun JsonObject?.long(key: String): Long = (this?.get(key) as? JsonPrimitive)?.longOrNull ?: 0L
private fun JsonObject?.bool(key: String): Boolean = (this?.get(key) as? JsonPrimitive)?.booleanOrNull == true
private fun JsonObject?.array(key: String): List<JsonObject> = (this?.get(key) as? JsonArray).orEmpty().mapNotNull { it as? JsonObject }

/** The Emails hub's writes, as the console makes them. */
class EmailActions(val context: NativePluginContext, val orgId: String, val hostId: String) {
  private suspend fun post(route: String, fields: Map<String, Any?>, withHost: Boolean = true): JsonObject? =
    context.api.request(route, ApiMethod.POST, firestoreJson((if (withHost) fields + ("hostId" to hostId) else fields).filterValues { it != null })).obj()

  /** A new design: the screen, then its first version (`createEmailScreen`). Returns (screenId, versionId). */
  suspend fun createDesign(name: String): Pair<String, String> {
    val screenId = newResourceId()
    val versionId = newResourceId()
    val (screen, version) = emailDesignDocuments(screenId, versionId, name, emailDesignStarterNodes(newResourceId(), newResourceId()))
    post(RESOURCES_ROUTE, mapOf("resource" to "screen", "id" to screenId, "data" to screen))
    post(VERSIONS_ROUTE, mapOf("kind" to "screen", "parentId" to screenId, "id" to versionId, "data" to version))
    return screenId to versionId
  }

  suspend fun duplicateDesign(sourceId: String, name: String) {
    post(RESOURCES_ROUTE, mapOf("resource" to "emailDesign", "action" to "duplicate", "sourceId" to sourceId, "name" to name, "attemptKey" to newResourceId(20)))
  }

  /** The console's `emailTemplateSoftDelete`: stamped deleted, its search keys cleared so lists leave it out. */
  suspend fun deleteDesign(id: String) {
    context.writer.merge("hosts/$hostId/screens/$id", mapOf("deletedAt" to firestoreNow(), "nameLower" to FirestoreDelete, "nameTokens" to FirestoreDelete, "nameReversed" to FirestoreDelete))
  }

  suspend fun createList(name: String) {
    context.writer.merge("orgs/$orgId/lists/${newResourceId(20)}", nameSearchFields(name) + mapOf("kind" to "manual", "createdAt" to firestoreNow()))
  }

  suspend fun renameList(id: String, name: String) = context.writer.merge("orgs/$orgId/lists/$id", nameSearchFields(name))

  suspend fun deleteList(id: String) {
    post(ERASE_ROUTE, mapOf("scope" to "orgs", "scopeId" to orgId, "kind" to "lists", "id" to id), withHost = false)
  }

  suspend fun removeMember(listId: String, memberId: String) = context.writer.delete("orgs/$orgId/lists/$listId/members/$memberId")

  suspend fun previewMembers(listId: String, emails: List<String>): MemberPreview {
    val answer = post(LIST_MEMBERS_PREVIEW_ROUTE, mapOf("listId" to listId, "emails" to emails))
    val notes = answer.array("verdicts").mapNotNull { v ->
      val message = v.str("message") ?: v.str("error") ?: return@mapNotNull null
      (v.str("input") ?: "") to message
    }
    return MemberPreview(answer.long("optedIn"), answer.long("needAttestation"), answer.long("refused"), notes)
  }

  suspend fun addMembers(listId: String, emails: List<String>, attest: Boolean): Long =
    post(LIST_MEMBERS_ADD_ROUTE, mapOf("listId" to listId, "emails" to emails, "attestConsent" to attest)).long("added")

  suspend fun addTopic(name: String, description: String) {
    context.writer.merge("orgs/$orgId/emailTopics/${newResourceId(20)}", mapOf("name" to name, "description" to description, "archived" to false))
  }

  suspend fun setTopicArchived(id: String, archived: Boolean) = context.writer.merge("orgs/$orgId/emailTopics/$id", mapOf("archived" to archived))

  suspend fun addSuppressions(emails: List<String>, note: String) {
    post(SUPPRESSION_ADD_ROUTE, mapOf("emails" to emails, "note" to note))
  }

  suspend fun removeSuppression(id: String) = context.writer.delete("hosts/$hostId/suppressions/$id")

  suspend fun identity(): SendingView = SendingView.of(context.api.request(SENDING_IDENTITY_ROUTE, query = mapOf("hostId" to hostId)).obj())

  suspend fun identityAction(fields: Map<String, Any?>) {
    post(SENDING_IDENTITY_ROUTE, fields)
  }

  suspend fun domainAction(domain: String, action: String) {
    post(SENDING_DOMAINS_ROUTE, mapOf("orgId" to orgId, "domain" to domain, "action" to action), withHost = false)
  }
}

data class SenderRow(val id: String, val localPart: String, val fromName: String?, val replyTo: String?, val isDefault: Boolean, val from: String?)

data class SendingView(
  val selected: String,
  val platformDomain: String,
  val identity: String?,
  val refusal: String?,
  val senders: List<SenderRow>,
  val domains: List<Pair<String, String>>,
  val dedicatedPlan: Boolean,
) {
  companion object {
    fun of(answer: JsonObject?) = SendingView(
      selected = answer.str("selected").orEmpty(),
      platformDomain = answer.str("platformDomain").orEmpty(),
      identity = answer.str("identity"),
      refusal = answer.str("refusal"),
      senders = answer.array("senders").mapNotNull { s ->
        val id = s.str("id") ?: return@mapNotNull null
        SenderRow(id, s.str("localPart").orEmpty(), s.str("fromName"), s.str("replyTo"), s.bool("isDefault"), s.str("from"))
      },
      domains = answer.array("domains").mapNotNull { d -> d.str("domain")?.let { it to (d.str("status") ?: "pending") } },
      dedicatedPlan = answer.bool("dedicatedDomainPlan"),
    )
  }
}

/** The Emails hub: the console's sections as chips over the chosen one. */
@Composable
fun EmailHubScreen(context: NativePluginContext, initialSection: EmailSection, initial: String? = null, composeCampaign: String? = null) {
  val orgId = context.orgId ?: return
  val hostId = context.hostId ?: return
  var section by rememberSaveable { mutableStateOf(initialSection) }
  val actions = remember(orgId, hostId, context) { EmailActions(context, orgId, hostId) }
  Column(Modifier.fillMaxSize()) {
    ChoiceChipRow(
      EmailSection.entries.map { ChipOption(it.name, it.label, it.icon) },
      section.name,
      { section = EmailSection.valueOf(it) },
      Modifier.padding(horizontal = space(2f), vertical = space(1f)).testTag("email-sections"),
    )
    when (section) {
      EmailSection.MESSAGES -> EmailsScreen(context, initial, composeCampaign)
      EmailSection.TEMPLATES -> TemplatesSection(context, actions)
      EmailSection.AUDIENCES -> AudiencesSection(context, actions, initial)
      EmailSection.TOPICS -> TopicsSection(context, actions)
      EmailSection.SENDING -> SendingSection(actions)
      EmailSection.SUPPRESSIONS -> SuppressionsSection(context, actions)
    }
  }
}

/** One name, asked for in a sheet (new, rename, duplicate). */
@Composable
internal fun NameSheet(title: String, initial: String, confirm: String, onDismiss: () -> Unit, save: suspend (String) -> Unit) {
  val coroutines = rememberCoroutineScope()
  val busy = remember { Busy() }
  var name by remember { mutableStateOf(initial) }
  FormSheet(title, busy, onDismiss, confirmLabel = confirm, confirmEnabled = name.isNotBlank(), onConfirm = {
    busy.run(coroutines, onDone = onDismiss) { save(name.trim()) }
  }) {
    FieldEditor(FieldSpec("name", "Name", required = true), name, { name = it })
  }
}

/*---------- Templates ----------*/

data class TemplateRow(val id: String, val name: String, val versionId: String?, val installed: Boolean)

fun templateRowOf(doc: FirestoreDoc) = TemplateRow(
  doc.id, doc.string("displayName")?.takeIf { it.isNotEmpty() } ?: doc.id, doc.string("versionId"),
  doc.data["installedFrom"] != null || doc.data["provenance"] != null,
)

@Composable
fun TemplatesSection(context: NativePluginContext, actions: EmailActions) {
  val coroutines = rememberCoroutineScope()
  val list = remember(actions.hostId) { LiveQueryList(context.firestore, coroutines, 25, ::templateRowOf) }
  val canEdit = rememberCanSend(context)
  var search by rememberSaveable { mutableStateOf("") }
  var asked by rememberSaveable { mutableStateOf("") }
  var creating by remember { mutableStateOf(false) }
  var duplicating by remember { mutableStateOf<TemplateRow?>(null) }
  var deleting by remember { mutableStateOf<TemplateRow?>(null) }
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  val busy = remember { Busy() }
  LaunchedEffect(list, asked) { list.show { limit -> templatesQuery(actions.hostId, asked, limit) } }

  fun open(row: TemplateRow) {
    val version = row.versionId ?: return run { notice = "This design has no version to open yet." to StatusTone.WARNING }
    context.openBesigner("/screens/${row.id}/versions/$version/besigner")
  }

  Column(Modifier.fillMaxSize()) {
    Row(Modifier.padding(horizontal = space(2f)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      SearchField(search, { search = it; if (it.isBlank()) asked = "" }, placeholder = "Search templates", modifier = Modifier.weight(1f), onSearch = { asked = search })
      if (canEdit) Button(onClick = { creating = true }, modifier = Modifier.testTag("template-new")) { Text("New design") }
    }
    notice?.let { NoticeBanner(it.first, it.second, Modifier.padding(space(2f))) }
    LiveListPane(
      list,
      key = { it.id },
      failed = "Could not load templates",
      empty = { EmptyState(if (asked.isEmpty()) "No email designs yet" else "No templates match", body = "Design an email once in the Besigner and send it from any campaign.", icon = AglynIcons.named("brush")) },
    ) { row ->
      AglynListItem(
        title = row.name,
        supporting = if (row.installed) "Installed" else "Yours",
        icon = AglynIcons.named("drafts"),
        onClick = { open(row) },
        modifier = Modifier.testTag("template-${row.id}"),
        trailing = {
          OverflowMenu(
            listOf(MenuAction("open-in-the-besigner", "Open in the Besigner") { open(row) }) + if (canEdit) listOf(
              MenuAction("duplicate", "Duplicate") { duplicating = row },
              MenuAction("delete", "Delete", destructive = true) { deleting = row },
            ) else emptyList(),
          )
        },
      )
    }
  }
  if (creating) NameSheet("New email design", "Untitled email", "Create", { creating = false }) { name ->
    val (screenId, versionId) = actions.createDesign(name)
    context.openBesigner("/screens/$screenId/versions/$versionId/besigner")
  }
  duplicating?.let { row ->
    NameSheet("Duplicate ${row.name}", "${row.name} (copy)", "Duplicate", { duplicating = null }) { name ->
      actions.duplicateDesign(row.id, name)
      notice = "Duplicated as $name." to StatusTone.SUCCESS
    }
  }
  deleting?.let { row ->
    ActionDialog(
      title = "Delete this template?",
      body = "Emails already sent with it keep what they sent. Campaigns that name it can no longer send it.",
      confirmLabel = "Delete",
      destructive = true,
      busy = busy.busy,
      error = busy.error,
      onDismiss = { deleting = null },
      onConfirm = { busy.run(coroutines, onDone = { deleting = null }) { actions.deleteDesign(row.id) } },
    )
  }
}

/*---------- Audiences ----------*/

data class EmailListRow(val id: String, val name: String, val dynamic: Boolean)

fun emailListRowOf(doc: FirestoreDoc) = EmailListRow(doc.id, doc.string("name")?.takeIf { it.isNotEmpty() } ?: doc.id, doc.string("kind") == "dynamic")

data class ListMemberRow(val id: String, val email: String, val name: String?, val via: String?, val joinedAtMs: Long?)

fun listMemberRowOf(doc: FirestoreDoc) = ListMemberRow(doc.id, doc.string("email") ?: doc.id, doc.string("name"), doc.string("via"), millisOf(doc.data["createdAt"] ?: doc.data["addedAt"]))

@Composable
fun AudiencesSection(context: NativePluginContext, actions: EmailActions, initial: String?) {
  val coroutines = rememberCoroutineScope()
  val list = remember(actions.orgId) { LiveQueryList(context.firestore, coroutines, 25, ::emailListRowOf) }
  var kind by rememberSaveable { mutableStateOf("") }
  var search by rememberSaveable { mutableStateOf("") }
  var asked by rememberSaveable { mutableStateOf("") }
  var creating by remember { mutableStateOf(false) }
  LaunchedEffect(list, kind, asked) { list.show { limit -> listsQuery(actions.orgId, kind, asked, limit) } }
  AglynListDetail(
    initialSelected = initial,
    list = { selected, onSelect ->
      Column(Modifier.fillMaxSize()) {
        Column(Modifier.padding(horizontal = space(2f), vertical = space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
          Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
            SearchField(search, { search = it; if (it.isBlank()) asked = "" }, placeholder = "Search lists", modifier = Modifier.weight(1f), onSearch = { asked = search })
            Button(onClick = { creating = true }, modifier = Modifier.testTag("list-new")) { Text("New list") }
          }
          ChoiceChipRow(listOf(ChipOption("", "All"), ChipOption("manual", "Manual"), ChipOption("dynamic", "Rule")), kind, { kind = it })
        }
        LiveListPane(
          list,
          key = { it.id },
          failed = "Could not load lists",
          empty = { EmptyState("No lists yet", body = "A list is who an email goes to: people you add, or everyone a rule matches.", icon = AglynIcons.named("groups")) },
        ) { row ->
          AglynListItem(
            title = row.name,
            supporting = if (row.dynamic) "Rule" else "Manual",
            icon = AglynIcons.named(if (row.dynamic) "auto_awesome" else "groups"),
            selected = row.id == selected,
            onClick = { onSelect(row.id) },
            modifier = Modifier.testTag("list-${row.id}"),
          )
        }
      }
    },
    detail = { selected ->
      if (selected == null) EmptyState("Pick a list to see who is on it", icon = AglynIcons.named("groups")) else ListDetail(context, actions, selected)
    },
  )
  if (creating) NameSheet("New list", "", "Create", { creating = false }) { actions.createList(it) }
}

/** One list: its members (search, remove), Add people, rename and delete. */
@Composable
fun ListDetail(context: NativePluginContext, actions: EmailActions, listId: String) {
  val coroutines = rememberCoroutineScope()
  val doc by remember(listId) { context.firestore.observeDoc("orgs/${actions.orgId}/lists/$listId") }.collectAsState(Live.Loading)
  val members = remember(listId) { LiveQueryList(context.firestore, coroutines, 25, ::listMemberRowOf) }
  var search by rememberSaveable(listId) { mutableStateOf("") }
  var asked by rememberSaveable(listId) { mutableStateOf("") }
  var adding by remember { mutableStateOf(false) }
  var renaming by remember { mutableStateOf(false) }
  var deleting by remember { mutableStateOf(false) }
  var removing by remember { mutableStateOf<ListMemberRow?>(null) }
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  var gone by remember(listId) { mutableStateOf(false) }
  val busy = remember { Busy() }
  LaunchedEffect(members, asked) { members.show { limit -> listMembersQuery(actions.orgId, listId, asked, limit) } }
  val row = (doc as? Live.Ready)?.value?.let(::emailListRowOf)
  if (gone) {
    EmptyState("This list was deleted", icon = AglynIcons.named("groups"))
    return
  }
  Column(Modifier.fillMaxSize()) {
    Row(Modifier.padding(horizontal = space(2f), vertical = space(1f)), verticalAlignment = Alignment.CenterVertically) {
      Text(row?.name ?: "List", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
      OutlinedButton(onClick = { adding = true }, modifier = Modifier.testTag("list-add-people")) { Text("Add people") }
      OverflowMenu(listOf(MenuAction("rename", "Rename") { renaming = true }, MenuAction("delete-list", "Delete list", destructive = true) { deleting = true }))
    }
    notice?.let { NoticeBanner(it.first, it.second, Modifier.padding(horizontal = space(2f))) }
    if (row?.dynamic == true) {
      NoticeBanner("Everyone the list's rule matches is on it. The rule is edited on the website for now; its members are listed here.", StatusTone.INFO, Modifier.padding(horizontal = space(2f)))
    }
    SearchField(search, { search = it; if (it.isBlank()) asked = "" }, placeholder = "Search members", modifier = Modifier.padding(horizontal = space(2f), vertical = space(1f)), onSearch = { asked = search })
    val now = remember { nowMillis() }
    LiveListPane(
      members,
      key = { it.id },
      failed = "Could not load members",
      empty = { EmptyState(if (asked.isEmpty()) "Nobody on this list yet" else "No members match", body = "Add people by address; each is checked against consent and suppressions first.", icon = AglynIcons.named("person")) },
    ) { member ->
      AglynListItem(
        title = member.name?.takeIf { it.isNotEmpty() } ?: member.email,
        supporting = listOfNotNull(if (member.name.isNullOrEmpty()) null else member.email, if (member.via == "rule") "Rule" else "Added", member.joinedAtMs?.let { relativeTime(it, now) }).joinToString(" · "),
        icon = AglynIcons.named("person"),
        trailing = { OverflowMenu(listOf(MenuAction("remove-from-this-list", "Remove from this list", destructive = true) { removing = member })) },
      )
    }
  }
  if (adding) AddPeopleSheet(actions, listId, { adding = false }) { notice = "Added $it to the list." to StatusTone.SUCCESS }
  if (renaming) NameSheet("Rename list", row?.name.orEmpty(), "Save", { renaming = false }) { actions.renameList(listId, it) }
  if (deleting) ActionDialog(
    title = "Delete list?",
    body = "The list and its memberships go. The people stay in your contacts, and emails already sent keep their reports.",
    confirmLabel = "Delete",
    destructive = true,
    busy = busy.busy,
    error = busy.error,
    onDismiss = { deleting = false },
    onConfirm = { busy.run(coroutines, onDone = { deleting = false; gone = true }) { actions.deleteList(listId) } },
  )
  removing?.let { member ->
    ActionDialog(
      title = "Remove from this list?",
      body = "${member.email} will no longer get emails sent to this list.",
      confirmLabel = "Remove",
      destructive = true,
      busy = busy.busy,
      error = busy.error,
      onDismiss = { removing = null },
      onConfirm = { busy.run(coroutines, onDone = { removing = null }) { actions.removeMember(listId, member.id) } },
    )
  }
}

/** Add people by address: checked first (the route's preview), then added with one attestation. */
@Composable
fun AddPeopleSheet(actions: EmailActions, listId: String, onDismiss: () -> Unit, onAdded: (Long) -> Unit) {
  val coroutines = rememberCoroutineScope()
  val busy = remember { Busy() }
  var text by remember { mutableStateOf("") }
  var preview by remember { mutableStateOf<MemberPreview?>(null) }
  var attest by remember { mutableStateOf(false) }
  val checked = preview
  FormSheet(
    title = "Add people",
    busy = busy,
    onDismiss = onDismiss,
    confirmLabel = if (checked == null) "Check" else "Add",
    confirmEnabled = if (checked == null) addressesIn(text).isNotEmpty() else checked.optedIn + (if (attest) checked.needAttestation else 0) > 0,
    modifier = Modifier.testTag("add-people"),
    onConfirm = {
      if (checked == null) {
        busy.run(coroutines) { preview = actions.previewMembers(listId, addressesIn(text)) }
      } else {
        busy.run(coroutines, onDone = onDismiss) { onAdded(actions.addMembers(listId, addressesIn(text), attest)) }
      }
    },
  ) {
    FieldEditor(FieldSpec("addresses", "Addresses", FieldKind.MULTILINE, help = "One per line, or separated by commas."), text, { text = it; preview = null })
    if (checked != null) {
      PropertyRow("Opted in already", checked.optedIn.toString())
      PropertyRow("Need your word they agreed", checked.needAttestation.toString())
      PropertyRow("Cannot be added", checked.refused.toString())
      for ((input, message) in checked.notes) PropertyRow(input, message)
      if (checked.needAttestation > 0) SwitchRow("These people agreed to hear from us", attest, { attest = it })
    }
  }
}

/*---------- Topics ----------*/

data class TopicRow(val id: String, val name: String, val description: String?, val archived: Boolean)

@Composable
fun TopicsSection(context: NativePluginContext, actions: EmailActions) {
  val coroutines = rememberCoroutineScope()
  val list = remember(actions.orgId) {
    LiveQueryList(context.firestore, coroutines, 100) { TopicRow(it.id, it.string("name") ?: it.id, it.string("description"), it.data["archived"] == true) }
  }
  var adding by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  LaunchedEffect(list) { list.show { FirestoreQuery("orgs/${actions.orgId}/emailTopics", limit = 100) } }
  Column(Modifier.fillMaxSize()) {
    Row(Modifier.padding(horizontal = space(2f)), verticalAlignment = Alignment.CenterVertically) {
      Text("A topic is a stream people can leave on its own, without leaving everything.", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
      Button(onClick = { adding = true }) { Text("Add topic") }
    }
    error?.let { NoticeBanner(it, StatusTone.ERROR, Modifier.padding(space(2f))) }
    val rows = (list.rows as? Live.Ready)?.value.orEmpty().sortedWith(compareBy({ it.archived }, { it.name.lowercase() }))
    when (list.rows) {
      Live.Loading -> SkeletonList(rows = 4)
      is Live.Failed -> EmptyState("Could not load topics", icon = AglynIcons.named("error"))
      is Live.Ready -> if (rows.isEmpty()) {
        EmptyState("No topics yet", body = "Like a newsletter or product news.", icon = AglynIcons.named("tag"))
      } else {
        Column(Modifier.verticalScroll(rememberScrollState())) {
          for (topic in rows) {
            AglynListItem(
              title = topic.name,
              supporting = listOfNotNull(topic.description, if (topic.archived) "Retired" else null).joinToString(" · "),
              icon = AglynIcons.named("tag"),
              trailing = {
                OutlinedButton(onClick = {
                  Busy().run(coroutines) {
                    runCatching { actions.setTopicArchived(topic.id, !topic.archived) }.onFailure { error = it.message }
                  }
                }, modifier = Modifier.testTag("topic-archive-${topic.id}")) { Text(if (topic.archived) "Restore" else "Retire") }
              },
            )
          }
        }
      }
    }
  }
  if (adding) {
    val busy = remember { Busy() }
    var name by remember { mutableStateOf("") }
    var detail by remember { mutableStateOf("") }
    FormSheet("Add topic", busy, { adding = false }, confirmLabel = "Add", confirmEnabled = name.isNotBlank(), onConfirm = {
      busy.run(coroutines, onDone = { adding = false }) { actions.addTopic(name.trim(), detail.trim()) }
    }) {
      FieldEditor(FieldSpec("name", "Name", required = true), name, { name = it })
      FieldEditor(FieldSpec("description", "What it is about", FieldKind.MULTILINE), detail, { detail = it })
    }
  }
}

/*---------- Suppressions ----------*/

data class SuppressionRow(val id: String, val email: String, val reason: String?, val sinceMs: Long?)

@Composable
fun SuppressionsSection(context: NativePluginContext, actions: EmailActions) {
  val coroutines = rememberCoroutineScope()
  val list = remember(actions.hostId) {
    LiveQueryList(context.firestore, coroutines, 25) { SuppressionRow(it.id, it.string("email") ?: it.id, it.string("reason"), millisOf(it.data["createdAt"])) }
  }
  var search by rememberSaveable { mutableStateOf("") }
  var asked by rememberSaveable { mutableStateOf("") }
  var adding by remember { mutableStateOf(false) }
  var removing by remember { mutableStateOf<SuppressionRow?>(null) }
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  val busy = remember { Busy() }
  LaunchedEffect(list, asked) { list.show { limit -> suppressionsQuery(actions.hostId, asked, limit) } }
  val now = remember { nowMillis() }
  Column(Modifier.fillMaxSize()) {
    Row(Modifier.padding(horizontal = space(2f)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      SearchField(search, { search = it; if (it.isBlank()) asked = "" }, placeholder = "Search addresses", modifier = Modifier.weight(1f), onSearch = { asked = search })
      Button(onClick = { adding = true }, modifier = Modifier.testTag("suppression-add")) { Text("Suppress") }
    }
    notice?.let { NoticeBanner(it.first, it.second, Modifier.padding(space(2f))) }
    LiveListPane(
      list,
      key = { it.id },
      failed = "Could not load suppressions",
      empty = { EmptyState(if (asked.isEmpty()) "Nobody is suppressed" else "No address matches", body = "Addresses that bounced, complained or unsubscribed are skipped by every send, and listed here.", icon = AglynIcons.named("block")) },
    ) { row ->
      AglynListItem(
        title = row.email,
        supporting = listOfNotNull(row.reason?.replaceFirstChar { it.uppercase() }, row.sinceMs?.let { relativeTime(it, now) }).joinToString(" · "),
        icon = AglynIcons.named("block"),
        trailing = { OverflowMenu(listOf(MenuAction("put-back-on-your-list", "Put back on your list") { removing = row })) },
      )
    }
  }
  if (adding) {
    val sheetBusy = remember { Busy() }
    var addresses by remember { mutableStateOf("") }
    var note by remember { mutableStateOf("") }
    FormSheet("Suppress addresses", sheetBusy, { adding = false }, confirmLabel = "Suppress", confirmEnabled = addressesIn(addresses).isNotEmpty(), onConfirm = {
      sheetBusy.run(coroutines, onDone = { adding = false; notice = "Suppressed. No email from this site will go to them." to StatusTone.SUCCESS }) {
        actions.addSuppressions(addressesIn(addresses), note.trim())
      }
    }) {
      FieldEditor(FieldSpec("addresses", "Addresses", FieldKind.MULTILINE, required = true, help = "Every send from this site skips a suppressed address."), addresses, { addresses = it })
      FieldEditor(FieldSpec("note", "Note (why)"), note, { note = it })
    }
  }
  removing?.let { row ->
    ActionDialog(
      title = "Put this address back on your list?",
      body = "${row.email} can be sent to again. Only do this if they asked to hear from you again.",
      confirmLabel = "Put back",
      busy = busy.busy,
      error = busy.error,
      onDismiss = { removing = null },
      onConfirm = { busy.run(coroutines, onDone = { removing = null }) { actions.removeSuppression(row.id) } },
    )
  }
}

/*---------- Sending ----------*/

@Composable
fun SendingSection(actions: EmailActions) {
  val coroutines = rememberCoroutineScope()
  var view by remember { mutableStateOf<SendingView?>(null) }
  var loadError by remember { mutableStateOf<String?>(null) }
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  var editing by remember { mutableStateOf<SenderRow?>(null) }
  var creating by remember { mutableStateOf(false) }
  var reload by remember { mutableStateOf(0) }
  LaunchedEffect(reload) {
    try {
      view = actions.identity()
      loadError = null
    } catch (error: Exception) {
      if (error is kotlinx.coroutines.CancellationException) throw error
      loadError = problemText(error)
    }
  }
  fun act(fields: Map<String, Any?>, done: String) = Busy().run(coroutines) {
    try {
      actions.identityAction(fields)
      notice = done to StatusTone.SUCCESS
      reload++
    } catch (error: Exception) {
      if (error is kotlinx.coroutines.CancellationException) throw error
      notice = problemText(error) to StatusTone.ERROR
    }
  }
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(2f))) {
    notice?.let { NoticeBanner(it.first, it.second) }
    val current = view
    when {
      current == null && loadError != null -> EmptyState("Could not load sending", body = loadError, icon = AglynIcons.named("error"), action = { OutlinedButton(onClick = { reload++ }) { Text("Try again") } })
      current == null -> SkeletonList(rows = 5)
      else -> {
        SectionCard("Sending as") {
          PropertyRow("Address", current.identity ?: current.selected)
          current.refusal?.let { NoticeBanner(it, StatusTone.ERROR) }
        }
        SectionCard("Senders", action = { OutlinedButton(onClick = { creating = true }) { Text("Add sender") } }) {
          for (sender in current.senders) {
            AglynListItem(
              title = sender.fromName ?: sender.localPart,
              supporting = listOfNotNull(sender.from ?: "${sender.localPart}@…", if (sender.isDefault) "Default" else null).joinToString(" · "),
              icon = AglynIcons.named(if (sender.isDefault) "star" else "person"),
              trailing = {
                OverflowMenu(
                  listOf(MenuAction("edit", "Edit") { editing = sender }) + if (!sender.isDefault) listOf(
                    MenuAction("make-default", "Make default") { act(mapOf("action" to "makeDefaultSender", "senderId" to sender.id), "Default sender changed.") },
                    MenuAction("delete", "Delete", destructive = true) { act(mapOf("action" to "deleteSender", "senderId" to sender.id), "Sender deleted.") },
                  ) else emptyList(),
                )
              },
            )
          }
        }
        SectionCard("Domains") {
          if (current.domains.isEmpty()) Text("No domains of your own yet. Add one on the website's Sending page.", style = MaterialTheme.typography.bodyMedium)
          for ((domain, status) in current.domains) {
            AglynListItem(
              title = domain,
              supporting = status.replaceFirstChar { it.uppercase() },
              icon = AglynIcons.named(if (status == "verified") "verified" else "hourglass"),
              trailing = {
                OverflowMenu(
                  buildList {
                    if (status == "verified" && current.selected != domain) add(MenuAction("send-from-this-domain", "Send from this domain") { act(mapOf("domain" to domain), "This site now sends from $domain.") })
                    if (status != "verified") add(MenuAction("check-again", "Check again") {
                      Busy().run(coroutines) {
                        try {
                          actions.domainAction(domain, "verify")
                          reload++
                        } catch (error: Exception) {
                          if (error is kotlinx.coroutines.CancellationException) throw error
                          notice = problemText(error) to StatusTone.ERROR
                        }
                      }
                    })
                  },
                )
              },
            )
          }
        }
        if (current.dedicatedPlan && current.platformDomain.isEmpty()) {
          OutlinedButton(onClick = { act(mapOf("action" to "request-dedicated"), "Asked for. It is set up within a few minutes.") }) {
            Text("Ask for a sending domain of this site's own")
          }
        }
      }
    }
  }
  if (creating || editing != null) {
    val sender = editing
    val busy = remember(sender) { Busy() }
    var localPart by remember(sender) { mutableStateOf(sender?.localPart.orEmpty()) }
    var fromName by remember(sender) { mutableStateOf(sender?.fromName.orEmpty()) }
    var replyTo by remember(sender) { mutableStateOf(sender?.replyTo.orEmpty()) }
    val close = { creating = false; editing = null }
    FormSheet(if (sender == null) "Add sender" else "Edit sender", busy, close, confirmEnabled = localPart.isNotBlank(), onConfirm = {
      busy.run(coroutines, onDone = { close(); reload++ }) {
        actions.identityAction(
          mapOf(
            "action" to if (sender == null) "createSender" else "updateSender",
            "senderId" to sender?.id,
            "localPart" to localPart.trim(),
            "fromName" to fromName.trim(),
            "replyTo" to replyTo.trim(),
          ),
        )
      }
    }) {
      FieldEditor(FieldSpec("localPart", "Mailbox (before the @)", required = true), localPart, { localPart = it })
      FieldEditor(FieldSpec("fromName", "From name"), fromName, { fromName = it })
      FieldEditor(FieldSpec("replyTo", "Reply to", FieldKind.EMAIL), replyTo, { replyTo = it })
    }
  }
}
