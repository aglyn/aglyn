package com.aglyn.plugins.marketing

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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import com.aglyn.core.ExperimentGoalEvents
import com.aglyn.core.FilterOp
import com.aglyn.core.FirestoreDelete
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreFilter
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.core.localDateTimeMillis
import com.aglyn.core.localDayAndTime
import com.aglyn.core.nowMillis
import com.aglyn.core.planFeatureCarried
import com.aglyn.core.relativeTime
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.Busy
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.DashboardGrid
import com.aglyn.ui.EmptyState
import com.aglyn.ui.FieldEditor
import com.aglyn.ui.FieldKind
import com.aglyn.ui.FieldOption
import com.aglyn.ui.FieldSpec
import com.aglyn.ui.FormSheet
import com.aglyn.ui.GridSpan
import com.aglyn.ui.LiveListPane
import com.aglyn.ui.LiveQueryList
import com.aglyn.ui.MenuAction
import com.aglyn.ui.MetricCard
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OverflowMenu
import com.aglyn.ui.PropertyRow
import com.aglyn.ui.SearchField
import com.aglyn.ui.SectionCard
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.problemMessage
import com.aglyn.ui.space

fun grouped(value: Long): String = value.toString().reversed().chunked(3).joinToString(",").reversed().replace("-,", "-")

/** The site's role for this member and the workspace document (its plan), which gate what Marketing offers. */
data class MarketingAccess(val canEdit: Boolean, val org: Map<String, Any?>?, val orgReady: Boolean) {
  fun carries(feature: String) = planFeatureCarried(org, feature)
}

@Composable
fun rememberMarketingAccess(context: NativePluginContext): MarketingAccess {
  val hostId = context.hostId
  val orgId = context.orgId
  val host = remember(hostId) { context.firestore.observeDoc("hosts/$hostId") }.collectAsState(Live.Loading).value
  val org = remember(orgId) { context.firestore.observeDoc("orgs/$orgId") }.collectAsState(Live.Loading).value
  @Suppress("UNCHECKED_CAST")
  val role = ((host as? Live.Ready)?.value?.data?.get("memberRoles") as? Map<String, Any?>)?.get(context.uid)
  return MarketingAccess(role in listOf("owner", "admin", "editor"), (org as? Live.Ready)?.value?.data, org is Live.Ready)
}

/** The Marketing hub: the console's sections as chips over the chosen one. */
@Composable
fun MarketingHubScreen(context: NativePluginContext, initialSection: MarketingSection, initial: String? = null) {
  val orgId = context.orgId ?: return
  val hostId = context.hostId ?: return
  var section by rememberSaveable { mutableStateOf(initialSection) }
  val actions = remember(orgId, hostId, context) { MarketingActions(context, orgId, hostId) }
  val access = rememberMarketingAccess(context)
  Column(Modifier.fillMaxSize()) {
    ChoiceChipRow(
      MarketingSection.entries.map { ChipOption(it.name, it.label, it.icon) },
      section.name,
      { section = MarketingSection.valueOf(it) },
      Modifier.padding(horizontal = space(2f), vertical = space(1f)).testTag("marketing-sections"),
    )
    when (section) {
      MarketingSection.OVERVIEW -> OverviewSection(context, actions) { section = it }
      MarketingSection.CAMPAIGNS -> CampaignsSection(context, actions, access, initial)
      MarketingSection.CONVERSIONS -> ConversionsSection(context, actions, null)
      MarketingSection.OVERLAYS -> if (access.orgReady && !access.carries("marketingOverlays")) {
        EmptyState("Overlays come with Starter", body = "Announcement bars and popups are included from the Starter plan. Change the plan under Billing to use them.", icon = AglynIcons.named("web_asset"))
      } else {
        OverlaysSection(context, actions, access)
      }
      MarketingSection.EXPERIMENTS -> if (access.orgReady && !access.carries("abTesting")) {
        EmptyState("A/B testing comes with Business", body = "Testing two versions of a page or an email is included from the Business plan.", icon = AglynIcons.named("science"))
      } else {
        ExperimentsSection(context, actions, access)
      }
    }
  }
}

/*---------- overview ----------*/

@Composable
fun OverviewSection(context: NativePluginContext, actions: MarketingActions, open: (MarketingSection) -> Unit) {
  val scope = rememberCoroutineScope()
  val overlays = remember { LiveQueryList(context.firestore, scope, 51, ::overlayRowOf) }
  val sends = remember { LiveQueryList(context.firestore, scope, 200) { it } }
  val experiments = remember { LiveQueryList(context.firestore, scope, 100, ::experimentRowOf) }
  LaunchedEffect(Unit) {
    overlays.show { FirestoreQuery("hosts/${actions.hostId}/overlays", orderBy = listOf(FirestoreOrder("name")), limit = it) }
    sends.show {
      FirestoreQuery("orgs/${actions.orgId}/campaigns", listOf(FirestoreFilter("visibleTo", FilterOp.ARRAY_CONTAINS_ANY, listOf("host:${actions.hostId}"))), listOf(FirestoreOrder("createdAtMs", true)), it)
    }
    experiments.show { FirestoreQuery("hosts/${actions.hostId}/experiments", limit = it) }
  }
  val now = remember { nowMillis() }
  val overlayRows = (overlays.rows as? Live.Ready)?.value
  val sendRows = (sends.rows as? Live.Ready)?.value
  val experimentRows = (experiments.rows as? Live.Ready)?.value
  @Suppress("UNCHECKED_CAST")
  fun sum(key: String) = sendRows.orEmpty().sumOf { ((it.data["stats"] as? Map<String, Any?>)?.get(key) as? Number)?.toLong() ?: 0L }
  val live = overlayRows.orEmpty().count { it.data["deletedAt"] == null && overlayStatus(it.enabled, it.startAtMs, it.endAtMs, now) == "live" }
  val scheduled = sendRows.orEmpty().count { it.string("status") == "scheduled" }
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f))) {
    DashboardGrid(
      columns = 2,
      items = buildList<Pair<GridSpan, @Composable (Modifier) -> Unit>> {
        add(GridSpan.HALF to { m: Modifier ->
          MetricCard("Live overlays", overlayRows?.let { "$live${if (overlays.hasMore) "+" else ""}" }, "${grouped(overlayRows.orEmpty().sumOf { it.impressions })} views · ${grouped(overlayRows.orEmpty().sumOf { it.clicks })} clicks", "web_asset", "Open overlays", m, loading = overlayRows == null) { open(MarketingSection.OVERLAYS) }
        })
        add(GridSpan.HALF to { m: Modifier ->
          MetricCard("Emails sent", sendRows?.let { grouped(sum("sent")) + if (sends.hasMore) "+" else "" }, "${grouped(sum("opens"))} opens · ${grouped(sum("clicks"))} clicks", "send", "Open campaigns", m, loading = sendRows == null) { open(MarketingSection.CAMPAIGNS) }
        })
        if (scheduled > 0) add(GridSpan.HALF to { m: Modifier ->
          MetricCard("Scheduled sends", scheduled.toString(), "waiting to go out", "event", "Open campaigns", m) { open(MarketingSection.CAMPAIGNS) }
        })
        add(GridSpan.HALF to { m: Modifier ->
          MetricCard("Experiments", experimentRows?.let { it.count { e -> e.status == "running" }.toString() }, "running · ${experimentRows.orEmpty().count { it.winnerVariantId != null }} decided", "science", "Open A/B testing", m, loading = experimentRows == null) { open(MarketingSection.EXPERIMENTS) }
        })
      },
    )
  }
}

/*---------- campaigns ----------*/

@Composable
fun CampaignsSection(context: NativePluginContext, actions: MarketingActions, access: MarketingAccess, initial: String?) {
  val scope = rememberCoroutineScope()
  val list = remember { LiveQueryList(context.firestore, scope, 25, ::campaignRowOf) }
  val sends = remember { LiveQueryList(context.firestore, scope, 50) { it } }
  val lists by remember { context.firestore.observe(FirestoreQuery("orgs/${actions.orgId}/lists", limit = 50)) }.collectAsState(Live.Loading)
  var search by rememberSaveable { mutableStateOf("") }
  var asked by rememberSaveable { mutableStateOf("") }
  var creating by remember { mutableStateOf(false) }
  LaunchedEffect(list, asked) { list.show { campaignsQuery(actions.orgId, actions.hostId, asked, it) } }
  val ids = (list.rows as? Live.Ready)?.value.orEmpty().map { it.id }.take(30)
  LaunchedEffect(ids) {
    sends.show { limit ->
      if (ids.isEmpty()) null else FirestoreQuery(
        "orgs/${actions.orgId}/campaigns",
        listOf(FirestoreFilter("hostId", FilterOp.EQ, actions.hostId), FirestoreFilter("emailCampaignId", FilterOp.IN, ids)),
        limit = limit,
      )
    }
  }
  val rollups = campaignRollups((sends.rows as? Live.Ready)?.value.orEmpty())
  val listNames = (lists as? Live.Ready)?.value.orEmpty().associate { it.id to (it.string("name") ?: it.id) }
  AglynListDetail(
    initialSelected = initial,
    list = { selected, onSelect ->
      Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(horizontal = space(2f)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          SearchField(search, { search = it; if (it.isBlank()) asked = "" }, placeholder = "Search campaigns", modifier = Modifier.weight(1f), onSearch = { asked = search })
          if (access.canEdit) Button(onClick = { creating = true }, modifier = Modifier.testTag("campaign-new")) { Text("New campaign") }
        }
        LiveListPane(
          list,
          key = { it.id },
          failed = "Could not load campaigns",
          empty = { EmptyState(if (asked.isEmpty()) "No campaigns yet" else "No campaigns match", body = "A campaign gathers the emails that go to the same lists over a window of time.", icon = AglynIcons.named("campaign")) },
        ) { row ->
          val r = rollups[row.id]
          AglynListItem(
            title = row.name,
            supporting = listOfNotNull(
              row.listIds.joinToString(", ") { listNames[it] ?: it }.ifEmpty { null },
              r?.let { "${it.emails} email${if (it.emails == 1) "" else "s"} · ${grouped(it.sent)} sent · ${grouped(it.opens)} opens" } ?: "No emails yet",
            ).joinToString(" · "),
            icon = AglynIcons.named("campaign"),
            selected = row.id == selected,
            onClick = { onSelect(row.id) },
            trailing = { StatusChip(row.window.label, if (row.window == CampaignWindow.RUNNING) StatusTone.SUCCESS else if (row.window == CampaignWindow.UPCOMING) StatusTone.INFO else StatusTone.NEUTRAL) },
            modifier = Modifier.testTag("campaign-${row.id}"),
          )
        }
      }
    },
    detail = { selected ->
      if (selected == null) EmptyState("Pick a campaign to see its emails", icon = AglynIcons.named("campaign")) else CampaignDetail(context, actions, access, selected, listNames)
    },
  )
  if (creating) CampaignSheet(context, actions, null, listNames, { creating = false }) { name, start, end, picked, topic, _ ->
    actions.createCampaign(name, start, end, picked, topic)
  }
}

@Composable
fun CampaignDetail(context: NativePluginContext, actions: MarketingActions, access: MarketingAccess, campaignId: String, listNames: Map<String, String>) {
  val scope = rememberCoroutineScope()
  val doc by remember(campaignId) { context.firestore.observeDoc("orgs/${actions.orgId}/emailCampaigns/$campaignId") }.collectAsState(Live.Loading)
  val emails = remember(campaignId) { LiveQueryList(context.firestore, scope, 25) { it } }
  var editing by remember { mutableStateOf(false) }
  var deleting by remember { mutableStateOf(false) }
  var gone by remember(campaignId) { mutableStateOf(false) }
  val busy = remember { Busy() }
  LaunchedEffect(emails) { emails.show { campaignEmailsQuery(actions.orgId, actions.hostId, campaignId, it) } }
  val value = doc
  if (gone || (value is Live.Ready && value.value == null)) {
    EmptyState("This campaign is gone", icon = AglynIcons.named("campaign"))
    return
  }
  val row = (value as? Live.Ready)?.value?.let(::campaignRowOf) ?: return
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(2f))) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Text(row.name, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
      StatusChip(row.window.label, if (row.window == CampaignWindow.RUNNING) StatusTone.SUCCESS else StatusTone.NEUTRAL)
      if (access.canEdit) OverflowMenu(listOf(MenuAction("edit", "Edit") { editing = true }, MenuAction("delete", "Delete", destructive = true) { deleting = true }))
    }
    SectionCard(null) {
      PropertyRow("Starts", row.startAtMs?.let { localDayAndTime(it).first })
      PropertyRow("Ends", row.endAtMs?.let { localDayAndTime(it).first })
      PropertyRow("Lists", row.listIds.joinToString(", ") { listNames[it] ?: it })
      PropertyRow("Unsubscribe header", if (row.listUnsubscribe) "On" else "Off")
    }
    SectionCard("Emails") {
      val rows = (emails.rows as? Live.Ready)?.value.orEmpty()
      if (rows.isEmpty()) Text("No emails in this campaign yet.", style = MaterialTheme.typography.bodyMedium)
      for (send in rows) {
        @Suppress("UNCHECKED_CAST") val stats = send.data["stats"] as? Map<String, Any?>
        AglynListItem(
          title = send.string("subject")?.takeIf { it.isNotEmpty() } ?: "(No subject)",
          supporting = "${(send.string("status") ?: "draft").replaceFirstChar { it.uppercase() }} · ${grouped((stats?.get("sent") as? Number)?.toLong() ?: 0)} sent · ${grouped((stats?.get("opens") as? Number)?.toLong() ?: 0)} opens",
          icon = AglynIcons.named("mail"),
          onClick = { context.navigate("email.messages", mapOf("message" to send.id)) },
        )
      }
      TextButton(onClick = { context.navigate("email.messages", mapOf("campaign" to campaignId)) }) { Text("Write an email in this campaign") }
    }
    OutlinedButton(onClick = { context.navigate("marketing.conversions", mapOf("campaign" to campaignId)) }) { Text("See its conversions") }
  }
  if (editing) CampaignSheet(context, actions, row, listNames, { editing = false }) { name, start, end, picked, topic, unsubscribe ->
    actions.updateCampaign(campaignId, name, start, end, picked, topic, unsubscribe)
  }
  if (deleting) ActionDialog(
    title = "Delete ${row.name}?",
    body = "The campaign goes. Its emails stay, with their reports, as single sends.",
    confirmLabel = "Delete",
    destructive = true,
    busy = busy.busy,
    error = busy.error,
    onDismiss = { deleting = false },
    onConfirm = { busy.run(scope, onDone = { deleting = false; gone = true }) { actions.deleteCampaign(campaignId) } },
  )
}

@Composable
fun CampaignSheet(
  context: NativePluginContext,
  actions: MarketingActions,
  campaign: CampaignRow?,
  listNames: Map<String, String>,
  onDismiss: () -> Unit,
  save: suspend (String, Long?, Long?, List<String>, String, Boolean) -> Unit,
) {
  val scope = rememberCoroutineScope()
  val busy = remember { Busy() }
  val topics by remember { context.firestore.observe(FirestoreQuery("orgs/${actions.orgId}/emailTopics", limit = 50)) }.collectAsState(Live.Loading)
  var name by remember { mutableStateOf(campaign?.name.orEmpty()) }
  var startDay by remember { mutableStateOf(campaign?.startAtMs?.let { localDayAndTime(it).first }.orEmpty()) }
  var endDay by remember { mutableStateOf(campaign?.endAtMs?.let { localDayAndTime(it).first }.orEmpty()) }
  var picked by remember { mutableStateOf(campaign?.listIds?.toSet().orEmpty()) }
  var topic by remember { mutableStateOf(campaign?.topicId.orEmpty()) }
  var unsubscribe by remember { mutableStateOf(campaign?.listUnsubscribe ?: true) }
  val start = startDay.takeIf { it.isNotEmpty() }?.let { localDateTimeMillis(it, "00:00") }
  val end = endDay.takeIf { it.isNotEmpty() }?.let { localDateTimeMillis(it, "23:59") }
  val windowOk = start == null || end == null || end >= start
  FormSheet(
    if (campaign == null) "New campaign" else "Edit campaign", busy, onDismiss,
    confirmLabel = if (campaign == null) "Create" else "Save",
    confirmEnabled = name.isNotBlank() && windowOk,
    onConfirm = { busy.run(scope, onDone = onDismiss) { save(name.trim(), start, end, listNames.keys.filter { it in picked }, topic, unsubscribe) } },
  ) {
    FieldEditor(FieldSpec("name", "Name", required = true), name, { name = it })
    FieldEditor(FieldSpec("start", "Starts", FieldKind.DATE), startDay, { startDay = it })
    FieldEditor(FieldSpec("end", "Ends", FieldKind.DATE), endDay, { endDay = it }, error = if (windowOk) null else "Ends before it starts")
    Text("Lists", style = MaterialTheme.typography.titleSmall)
    if (listNames.isEmpty()) Text("No lists yet. Make one under Emails, Audiences.", style = MaterialTheme.typography.bodySmall)
    for ((id, label) in listNames) SwitchRow(label, id in picked, { on -> picked = if (on) picked + id else picked - id })
    val topicRows = (topics as? Live.Ready)?.value.orEmpty().filter { it.data["archived"] != true || it.id == topic }
    FieldEditor(FieldSpec("topic", "Topic", FieldKind.SELECT, options = topicRows.map { FieldOption(it.id, it.string("name") ?: it.id) }, emptyLabel = "Marketing"), topic, { topic = it })
    if (campaign != null) SwitchRow("One-click unsubscribe header", unsubscribe, { unsubscribe = it })
  }
}

/*---------- conversions ----------*/

data class ConversionRow(val id: String, val record: String, val credited: String, val convertedAtMs: Long?)

fun conversionRowOf(doc: FirestoreDoc): ConversionRow {
  val channel = doc.string("channel").orEmpty()
  val credited = if (channel in listOf("email", "sequence", "page")) doc.string("campaignId") ?: "—"
  else listOfNotNull(doc.string("source"), doc.string("medium"), doc.string("campaign")).filter { it.isNotEmpty() }.joinToString(" / ")
  return ConversionRow(doc.id, doc.string("refId") ?: doc.id, credited.ifEmpty { "—" }, millisOf(doc.data["convertedAtMs"]))
}

@Composable
fun ConversionsSection(context: NativePluginContext, actions: MarketingActions, campaignId: String?) {
  val scope = rememberCoroutineScope()
  val list = remember { LiveQueryList(context.firestore, scope, 25, ::conversionRowOf) }
  var kind by rememberSaveable { mutableStateOf("form") }
  var channel by rememberSaveable { mutableStateOf("email") }
  LaunchedEffect(list, kind, channel, campaignId) {
    list.show {
      FirestoreQuery(
        "hosts/${actions.hostId}/campaignAttributions",
        listOf(FirestoreFilter("kind", FilterOp.EQ, kind), if (campaignId != null) FirestoreFilter("campaignId", FilterOp.EQ, campaignId) else FirestoreFilter("channel", FilterOp.EQ, channel)),
        listOf(FirestoreOrder("__name__")),
        it,
      )
    }
  }
  val now = remember { nowMillis() }
  Column(Modifier.fillMaxSize()) {
    ChoiceChipRow(
      listOf(ChipOption("form", "Form submissions"), ChipOption("lead", "Leads"), ChipOption("contact", "Contacts"), ChipOption("booking", "Bookings")),
      kind, { kind = it }, Modifier.padding(horizontal = space(2f)),
    )
    if (campaignId == null) {
      ChoiceChipRow(listOf(ChipOption("email", "From email"), ChipOption("web", "From the web")), channel, { channel = it }, Modifier.padding(horizontal = space(2f), vertical = space(1f)))
    }
    LiveListPane(
      list,
      key = { it.id },
      failed = "Could not load conversions",
      empty = { EmptyState("No conversions yet", body = "When someone a campaign reached submits a form, books or becomes a lead, it is credited here.", icon = AglynIcons.named("filter_alt")) },
    ) { row ->
      AglynListItem(title = row.record, supporting = listOfNotNull(row.credited, row.convertedAtMs?.let { relativeTime(it, now) }).joinToString(" · "), icon = AglynIcons.named("filter_alt"))
    }
  }
}

/*---------- overlays ----------*/

@Composable
fun OverlaysSection(context: NativePluginContext, actions: MarketingActions, access: MarketingAccess) {
  val scope = rememberCoroutineScope()
  val list = remember { LiveQueryList(context.firestore, scope, 51, ::overlayRowOf) }
  var editing by remember { mutableStateOf<OverlayRow?>(null) }
  var creatingKind by remember { mutableStateOf<String?>(null) }
  var deleting by remember { mutableStateOf<OverlayRow?>(null) }
  var error by remember { mutableStateOf<String?>(null) }
  val busy = remember { Busy() }
  LaunchedEffect(list) { list.show { FirestoreQuery("hosts/${actions.hostId}/overlays", orderBy = listOf(FirestoreOrder("name")), limit = it) } }
  val rows = (list.rows as? Live.Ready)?.value.orEmpty().filter { it.data["deletedAt"] == null }.sortedWith(compareBy({ it.order }, { it.title.lowercase() }))
  fun run(block: suspend () -> Unit) = Busy().run(scope) {
    try {
      block()
    } catch (failure: Exception) {
      if (failure is kotlinx.coroutines.CancellationException) throw failure
      error = problemMessage(failure)
    }
  }
  val now = remember { nowMillis() }
  Column(Modifier.fillMaxSize()) {
    if (access.canEdit) {
      Row(Modifier.padding(horizontal = space(2f)), horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        Button(onClick = { creatingKind = "bar" }, modifier = Modifier.testTag("overlay-new-bar")) { Text("New bar") }
        OutlinedButton(onClick = { creatingKind = "popup" }) { Text("New popup") }
      }
    }
    error?.let { NoticeBanner(it, StatusTone.ERROR, Modifier.padding(space(2f))) }
    when (val state = list.rows) {
      Live.Loading -> com.aglyn.ui.SkeletonList(rows = 4)
      is Live.Failed -> EmptyState("Could not load overlays", body = state.error.message, icon = AglynIcons.named("error"), action = { OutlinedButton(onClick = list::retry) { Text("Try again") } })
      is Live.Ready -> if (rows.isEmpty()) EmptyState("No overlays yet", body = "An announcement bar across the top, or a popup, shown on the pages you pick.", icon = AglynIcons.named("web_asset"))
    }
    if (rows.isNotEmpty()) {
      Column(Modifier.verticalScroll(rememberScrollState())) {
        rows.forEachIndexed { index, row ->
          val status = overlayStatus(row.enabled, row.startAtMs, row.endAtMs, now)
          AglynListItem(
            title = row.title,
            supporting = "${if (row.kind == "bar") "Announcement bar" else "Popup"} · ${grouped(row.impressions)} views · ${grouped(row.clicks)} clicks",
            icon = AglynIcons.named("web_asset"),
            trailing = {
              Row(verticalAlignment = Alignment.CenterVertically) {
                StatusChip(status.replaceFirstChar { it.uppercase() }, if (status == "live") StatusTone.SUCCESS else if (status == "scheduled") StatusTone.INFO else StatusTone.NEUTRAL)
                if (access.canEdit) OverflowMenu(buildList {
                  add(MenuAction("turn-off", if (row.enabled) "Turn off" else "Turn on") { run { actions.toggleOverlay(row) } })
                  add(MenuAction("edit", "Edit") { editing = row })
                  if (index > 0) add(MenuAction("move-up", "Move up") { run { actions.swapOverlays(row, rows[index - 1]) } })
                  if (index < rows.size - 1) add(MenuAction("move-down", "Move down") { run { actions.swapOverlays(row, rows[index + 1]) } })
                  add(MenuAction("delete", "Delete", destructive = true) { deleting = row })
                })
              }
            },
            modifier = Modifier.testTag("overlay-${row.id}"),
          )
        }
      }
    }
  }
  editing?.let { row -> OverlaySheet(actions, row.kind, row, rows.size.toLong()) { editing = null } }
  creatingKind?.let { kind -> OverlaySheet(actions, kind, null, (rows.maxOfOrNull { it.order } ?: -1) + 1) { creatingKind = null } }
  deleting?.let { row ->
    ActionDialog(
      title = "Delete overlay?",
      body = "It comes off every page at once.",
      confirmLabel = "Delete",
      destructive = true,
      busy = busy.busy,
      error = busy.error,
      onDismiss = { deleting = null },
      onConfirm = { busy.run(scope, onDone = { deleting = null }) { actions.deleteOverlay(row.id) } },
    )
  }
}

@Suppress("UNCHECKED_CAST")
@Composable
fun OverlaySheet(actions: MarketingActions, kind: String, existing: OverlayRow?, nextOrder: Long, onDismiss: () -> Unit) {
  val scope = rememberCoroutineScope()
  val busy = remember { Busy() }
  val data = existing?.data.orEmpty()
  val bar = data["bar"] as? Map<String, Any?> ?: emptyMap()
  val popup = data["popup"] as? Map<String, Any?> ?: emptyMap()
  var values by remember {
    mutableStateOf(
      mapOf(
        "name" to (existing?.name ?: ""),
        "enabled" to (existing?.enabled ?: true).toString(),
        "startDay" to (existing?.startAtMs?.let { localDayAndTime(it).first } ?: ""),
        "startTime" to (existing?.startAtMs?.let { localDayAndTime(it).second } ?: "00:00"),
        "endDay" to (existing?.endAtMs?.let { localDayAndTime(it).first } ?: ""),
        "endTime" to (existing?.endAtMs?.let { localDayAndTime(it).second } ?: "23:59"),
        "paths" to ((data["pathPatterns"] as? List<String>).orEmpty().joinToString(", ")),
        "excluded" to ((data["excludePathPatterns"] as? List<String>).orEmpty().joinToString(", ")),
        "text" to (bar["text"] as? String ?: ""),
        "href" to (bar["href"] as? String ?: ""),
        "backgroundColor" to (bar["backgroundColor"] as? String ?: ""),
        "textColor" to (bar["textColor"] as? String ?: ""),
        "dismissible" to ((bar["dismissible"] as? Boolean) ?: true).toString(),
        "headline" to (popup["headline"] as? String ?: ""),
        "body" to (popup["body"] as? String ?: ""),
        "ctaLabel" to (popup["ctaLabel"] as? String ?: ""),
        "ctaHref" to (popup["ctaHref"] as? String ?: ""),
        "collectEmail" to ((popup["collectEmail"] as? Boolean) ?: false).toString(),
        "trigger" to (popup["trigger"] as? String ?: "delay"),
        "triggerValue" to ((popup["triggerValue"] as? Number)?.toLong() ?: 3L).toString(),
        "frequencyDays" to ((popup["frequencyDays"] as? Number)?.toLong() ?: 7L).toString(),
        "oncePerSession" to ((popup["oncePerSession"] as? Boolean) ?: false).toString(),
      ),
    )
  }
  fun v(key: String) = values[key].orEmpty()
  fun set(key: String, value: String) { values = values + (key to value) }
  fun list(text: String) = text.split(',').map { it.trim() }.filter { it.isNotEmpty() }
  val canSave = if (kind == "bar") v("text").isNotBlank() else v("headline").isNotBlank()
  FormSheet(
    if (existing == null) (if (kind == "bar") "New announcement bar" else "New popup") else "Edit overlay", busy, onDismiss,
    confirmEnabled = canSave,
    onConfirm = {
      val fields = buildMap<String, Any?> {
        put("kind", kind)
        put("name", v("name").trim().ifEmpty { null })
        put("enabled", v("enabled") == "true")
        put("order", existing?.order ?: nextOrder)
        localDateTimeMillis(v("startDay"), v("startTime"))?.let { put("startAtMs", it) }
        localDateTimeMillis(v("endDay"), v("endTime"))?.let { put("endAtMs", it) }
        list(v("paths")).takeIf { it.isNotEmpty() }?.let { put("pathPatterns", it) }
        list(v("excluded")).takeIf { it.isNotEmpty() }?.let { put("excludePathPatterns", it) }
        if (kind == "bar") {
          put("bar", buildMap<String, Any?> {
            put("text", v("text").trim())
            put("dismissible", v("dismissible") == "true")
            v("href").ifEmpty { null }?.let { put("href", it) }
            v("backgroundColor").ifEmpty { null }?.let { put("backgroundColor", it) }
            v("textColor").ifEmpty { null }?.let { put("textColor", it) }
          })
        } else {
          put("popup", buildMap<String, Any?> {
            put("headline", v("headline").trim())
            put("collectEmail", v("collectEmail") == "true")
            put("trigger", v("trigger"))
            put("triggerValue", v("triggerValue").toLongOrNull() ?: 0L)
            put("frequencyDays", (v("frequencyDays").toLongOrNull() ?: 1L).coerceAtLeast(1L))
            put("oncePerSession", v("oncePerSession") == "true")
            v("body").ifEmpty { null }?.let { put("body", it) }
            v("ctaLabel").ifEmpty { null }?.let { put("ctaLabel", it) }
            v("ctaHref").ifEmpty { null }?.let { put("ctaHref", it) }
            for (key in listOf("imageUrl", "imageAlt")) popup[key]?.let { put(key, it) }
          })
        }
        data["stats"]?.let { put("stats", it) }
        data["createdAt"]?.let { put("createdAt", it) }
      }
      busy.run(scope, onDone = onDismiss) { actions.saveOverlay(existing, fields) }
    },
  ) {
    FieldEditor(FieldSpec("name", "Name (only you see it)"), v("name"), { set("name", it) })
    SwitchRow("On", v("enabled") == "true", { set("enabled", it.toString()) })
    if (kind == "bar") {
      FieldEditor(FieldSpec("text", "Text", FieldKind.MULTILINE, required = true), v("text"), { set("text", it) })
      FieldEditor(FieldSpec("href", "Link", FieldKind.URL), v("href"), { set("href", it) })
      FieldEditor(FieldSpec("backgroundColor", "Background color"), v("backgroundColor"), { set("backgroundColor", it) })
      FieldEditor(FieldSpec("textColor", "Text color"), v("textColor"), { set("textColor", it) })
      SwitchRow("Visitors can close it", v("dismissible") == "true", { set("dismissible", it.toString()) })
    } else {
      FieldEditor(FieldSpec("headline", "Headline", required = true), v("headline"), { set("headline", it) })
      FieldEditor(FieldSpec("body", "Body", FieldKind.MULTILINE), v("body"), { set("body", it) })
      FieldEditor(FieldSpec("ctaLabel", "Button label"), v("ctaLabel"), { set("ctaLabel", it) })
      FieldEditor(FieldSpec("ctaHref", "Button link", FieldKind.URL), v("ctaHref"), { set("ctaHref", it) })
      SwitchRow("Ask for an email address", v("collectEmail") == "true", { set("collectEmail", it.toString()) })
      FieldEditor(
        FieldSpec("trigger", "Opens", FieldKind.SELECT, options = listOf(FieldOption("delay", "After a delay"), FieldOption("scroll", "After scrolling"), FieldOption("exit", "When leaving")), emptyLabel = null),
        v("trigger"), { set("trigger", it) },
      )
      if (v("trigger") != "exit") FieldEditor(FieldSpec("triggerValue", if (v("trigger") == "delay") "Seconds" else "Percent scrolled", FieldKind.NUMBER), v("triggerValue"), { set("triggerValue", it) })
      FieldEditor(FieldSpec("frequencyDays", "At most every (days)", FieldKind.NUMBER), v("frequencyDays"), { set("frequencyDays", it) })
      SwitchRow("Once per visit", v("oncePerSession") == "true", { set("oncePerSession", it.toString()) })
    }
    Text("Where and when", style = MaterialTheme.typography.titleSmall)
    FieldEditor(FieldSpec("startDay", "From", FieldKind.DATE), v("startDay"), { set("startDay", it) })
    if (v("startDay").isNotEmpty()) FieldEditor(FieldSpec("startTime", "At", FieldKind.TIME), v("startTime"), { set("startTime", it) })
    FieldEditor(FieldSpec("endDay", "Until", FieldKind.DATE), v("endDay"), { set("endDay", it) })
    if (v("endDay").isNotEmpty()) FieldEditor(FieldSpec("endTime", "At", FieldKind.TIME), v("endTime"), { set("endTime", it) })
    FieldEditor(FieldSpec("paths", "Only on pages (comma separated, * for any)"), v("paths"), { set("paths", it) })
    FieldEditor(FieldSpec("excluded", "Never on pages"), v("excluded"), { set("excluded", it) })
  }
}

/*---------- experiments ----------*/

@Composable
fun ExperimentsSection(context: NativePluginContext, actions: MarketingActions, access: MarketingAccess) {
  val scope = rememberCoroutineScope()
  val list = remember { LiveQueryList(context.firestore, scope, 25, ::experimentRowOf) }
  var search by rememberSaveable { mutableStateOf("") }
  var asked by rememberSaveable { mutableStateOf("") }
  var creating by remember { mutableStateOf(false) }
  LaunchedEffect(list, asked) { list.show { experimentsQuery(actions.hostId, asked, it) } }
  AglynListDetail(
    list = { selected, onSelect ->
      Column(Modifier.fillMaxSize()) {
        Row(Modifier.padding(horizontal = space(2f)), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          SearchField(search, { search = it; if (it.isBlank()) asked = "" }, placeholder = "Search experiments", modifier = Modifier.weight(1f), onSearch = { asked = search })
          if (access.canEdit) Button(onClick = { creating = true }, modifier = Modifier.testTag("experiment-new")) { Text("New experiment") }
        }
        LiveListPane(
          list,
          key = { it.id },
          failed = "Could not load experiments",
          empty = { EmptyState(if (asked.isEmpty()) "No experiments yet" else "No experiments match", body = "Show two versions of a page or an email and keep the one that converts better.", icon = AglynIcons.named("science")) },
        ) { row ->
          AglynListItem(
            title = row.name,
            supporting = "${row.variants.size} versions · ${if (row.target == "email") "Email" else "Page"}",
            icon = AglynIcons.named("science"),
            selected = row.id == selected,
            onClick = { onSelect(row.id) },
            trailing = { StatusChip(experimentStatusLabel(row.status), if (row.status == "running") StatusTone.SUCCESS else if (row.status == "done") StatusTone.INFO else StatusTone.NEUTRAL) },
            modifier = Modifier.testTag("experiment-${row.id}"),
          )
        }
      }
    },
    detail = { selected ->
      if (selected == null) EmptyState("Pick an experiment to see how its versions do", icon = AglynIcons.named("science")) else ExperimentDetail(context, actions, access, selected)
    },
  )
  if (creating) ExperimentSheet(context, actions) { creating = false }
}

@Composable
fun ExperimentDetail(context: NativePluginContext, actions: MarketingActions, access: MarketingAccess, experimentId: String) {
  val scope = rememberCoroutineScope()
  val doc by remember(experimentId) { context.firestore.observeDoc("hosts/${actions.hostId}/experiments/$experimentId") }.collectAsState(Live.Loading)
  val stats by remember(experimentId) { context.firestore.observe(FirestoreQuery("hosts/${actions.hostId}/experiments/$experimentId/stats", limit = 10)) }.collectAsState(Live.Loading)
  var error by remember { mutableStateOf<String?>(null) }
  var deleting by remember { mutableStateOf(false) }
  var gone by remember(experimentId) { mutableStateOf(false) }
  val busy = remember { Busy() }
  val value = doc
  if (gone || (value is Live.Ready && value.value == null)) {
    EmptyState("This experiment is gone", icon = AglynIcons.named("science"))
    return
  }
  val row = (value as? Live.Ready)?.value?.let(::experimentRowOf) ?: return
  val byVariant = (stats as? Live.Ready)?.value.orEmpty().associate { it.id to it.data }
  val results = experimentResultRows(row.variants, row.winnerVariantId, byVariant)
  fun run(block: suspend () -> Unit) = Busy().run(scope) {
    try {
      block()
    } catch (failure: Exception) {
      if (failure is kotlinx.coroutines.CancellationException) throw failure
      error = problemMessage(failure)
    }
  }
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(2f))) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Text(row.name, Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
      StatusChip(experimentStatusLabel(row.status), if (row.status == "running") StatusTone.SUCCESS else StatusTone.NEUTRAL)
      if (access.canEdit) OverflowMenu(listOf(MenuAction("delete", "Delete", destructive = true) { deleting = true }))
    }
    error?.let { NoticeBanner(it, StatusTone.ERROR) }
    SectionCard(null) {
      PropertyRow("Tests", if (row.target == "email") "An email" else if (row.target == "section") "A section of a page" else "A page")
      PropertyRow("Goal", row.goalEvent)
      if (access.canEdit && row.status != "done") {
        Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          if (row.status != "running") Button(onClick = { run { actions.setExperimentStatus(row, "running") } }) { Text("Start") }
          if (row.status == "running") OutlinedButton(onClick = { run { actions.setExperimentStatus(row, "paused") } }) { Text("Pause") }
        }
      }
    }
    SectionCard("Results") {
      for (result in results) {
        AglynListItem(
          title = (result.variant.name ?: result.variant.id) + if (result.winner) " · Winner" else if (result.leader) " · Leading" else "",
          supporting = "${grouped(result.summary.exposures.toLong())} saw it · ${grouped(result.summary.conversions.toLong())} converted · ${jsFixed0(result.summary.rate * 1000).toLong() / 10.0}% · ${describeVariantComparison(result.comparison)}",
          icon = AglynIcons.named("science"),
          trailing = if (access.canEdit && row.status != "done") ({
            TextButton(onClick = { run { actions.setExperimentStatus(row, "done", result.variant.id) } }) { Text("Pick as winner") }
          }) else null,
        )
      }
    }
  }
  if (deleting) ActionDialog(
    title = "Delete experiment?",
    body = "Its results go with it, and every visitor sees the page as it is.",
    confirmLabel = "Delete",
    destructive = true,
    busy = busy.busy,
    error = busy.error,
    onDismiss = { deleting = false },
    onConfirm = { busy.run(scope, onDone = { deleting = false; gone = true }) { actions.deleteExperiment(experimentId) } },
  )
}

@Composable
fun ExperimentSheet(context: NativePluginContext, actions: MarketingActions, onDismiss: () -> Unit) {
  val scope = rememberCoroutineScope()
  val busy = remember { Busy() }
  val screens by remember { context.firestore.observe(FirestoreQuery("hosts/${actions.hostId}/screens", limit = 200)) }.collectAsState(Live.Loading)
  var name by remember { mutableStateOf("") }
  var target by remember { mutableStateOf("screen") }
  var screenId by remember { mutableStateOf("") }
  var goal by remember { mutableStateOf("formSubmission") }
  var variants by remember { mutableStateOf(listOf("A (control)", "B")) }
  fun variantId(index: Int) = ('a' + index).toString()
  val problem = validateExperiment(name, target, screenId, null, variants.indices.map(::variantId))
  FormSheet("New experiment", busy, onDismiss, confirmLabel = "Create", confirmEnabled = problem == null, onConfirm = {
    busy.run(scope, onDone = onDismiss) {
      actions.saveExperiment(
        null,
        mapOf(
          "name" to name.trim(), "status" to "draft", "target" to target,
          "screenId" to (if (target == "email") FirestoreDelete else screenId),
          "variants" to variants.mapIndexed { i, label -> mapOf("id" to variantId(i), "name" to label, "weight" to 1L) },
          "goal" to mapOf("event" to goal), "endAtMs" to null, "autoWinner" to null,
        ),
      )
    }
  }) {
    FieldEditor(FieldSpec("name", "Name", required = true), name, { name = it })
    FieldEditor(FieldSpec("target", "Tests", FieldKind.SELECT, options = listOf(FieldOption("screen", "A page"), FieldOption("email", "An email")), emptyLabel = null), target, { target = it })
    if (target == "screen") {
      val pages = (screens as? Live.Ready)?.value.orEmpty().filter { it.string("kind") != "email" && it.data["deletedAt"] == null }
      FieldEditor(FieldSpec("screen", "Page", FieldKind.SELECT, options = pages.map { FieldOption(it.id, it.string("displayName") ?: it.id) }, emptyLabel = "Choose a page"), screenId, { screenId = it })
    }
    FieldEditor(FieldSpec("goal", "Conversion goal", FieldKind.SELECT, options = ExperimentGoalEvents.all.map { FieldOption(it, it) }, emptyLabel = null), goal, { goal = it })
    Text("Versions", style = MaterialTheme.typography.titleSmall)
    variants.forEachIndexed { i, label ->
      FieldEditor(FieldSpec("variant-$i", "Version ${variantId(i).uppercase()}"), label, { value -> variants = variants.toMutableList().also { it[i] = value } })
    }
    Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      if (variants.size < 4) OutlinedButton(onClick = { variants = variants + variantId(variants.size).uppercase() }) { Text("Add a version") }
      if (variants.size > 2) TextButton(onClick = { variants = variants.dropLast(1) }) { Text("Remove the last") }
    }
    Text(problem ?: "Each version's page or email is set up on the website; it starts as a draft.", style = MaterialTheme.typography.bodySmall)
  }
}
