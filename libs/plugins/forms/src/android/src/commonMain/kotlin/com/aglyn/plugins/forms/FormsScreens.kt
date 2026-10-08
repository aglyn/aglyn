package com.aglyn.plugins.forms

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.FirestoreTimestamp
import com.aglyn.core.Live
import com.aglyn.core.nowMillis
import com.aglyn.core.relativeTime
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.ConsoleScope
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.TransferExportDialog
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.DetailRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.ListHeader
import com.aglyn.ui.LoadContent
import com.aglyn.ui.LoadMoreEffect
import com.aglyn.ui.MenuAction
import com.aglyn.ui.StatTile
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OverflowMenu
import com.aglyn.ui.RefreshableBox
import com.aglyn.ui.SearchField
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.space

const val FORMS_LIST_SCREEN = "forms.list"
const val FORMS_FORM_SCREEN = "forms.form"

/** The submissions screens the Inbox plugin contributes; opened by id, never imported. */
private const val INBOX_SUBMISSIONS_SCREEN = "inbox.submissions"

private val CONTENT_ROLES = setOf("admin", "editor", "author")
private val PUBLISH_ROLES = setOf("admin", "editor")

private sealed interface FormDialog {
  data object Create : FormDialog
  data class Rename(val form: FormRow) : FormDialog
  data class Duplicate(val form: FormRow) : FormDialog
  data class Retire(val form: FormRow) : FormDialog
  data class Export(val form: FormRow) : FormDialog
}

/**
 * A site's forms, the picked one beside the list on wide windows: search,
 * in use or retired, create and duplicate, and each form's numbers, details,
 * CRM routing, questions, versions (open in the Besigner, publish), its
 * submissions and their export, and retire or restore.
 */
@Composable
fun FormsScreen(context: NativePluginContext, initialFormId: String? = null) {
  val hostId = context.hostId ?: return
  val scope = rememberCoroutineScope()
  val model = remember(hostId, context.firestore) { FormsModel(hostId, context.firestore, scope) }
  LaunchedEffect(model) { model.reload() }
  val api = remember(hostId, context.api, context.writer) { FormsApi(context.api, context.writer, hostId) }
  val runner = remember(hostId) { ActionRunner(scope) }
  var dialog by remember { mutableStateOf<FormDialog?>(null) }
  val canEdit = context.siteRole in CONTENT_ROLES

  AglynListDetail(
    initialSelected = initialFormId,
    list = { selected, onSelect ->
      val listState = rememberLazyListState()
      LoadMoreEffect(listState, model.hasMore, onLoadMore = model::loadMore)
      Column(Modifier.fillMaxSize()) {
        ListHeader("Forms") {
          Button(onClick = { dialog = FormDialog.Create }, enabled = canEdit, modifier = Modifier.testTag("add-form")) {
            Icon(AglynIcons.named("add"), contentDescription = null)
            Text("New form", Modifier.padding(start = space(1f)))
          }
        }
        Column(Modifier.padding(horizontal = space(2f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
          if (dialog == null) {
            runner.notice?.let { NoticeBanner(it, StatusTone.SUCCESS, action = { TextButton(onClick = runner::clear) { Text("Dismiss") } }) }
            runner.error?.let { NoticeBanner(it, StatusTone.ERROR) }
          }
          SearchField(model.search, model::type, placeholder = "Search forms")
          ChoiceChipRow(FormStatusFilter.entries.map { ChipOption(it.name, it.label) }, model.status.name, { model.pick(FormStatusFilter.valueOf(it)) })
        }
        RefreshableBox(model.refreshing, model::refresh) {
          LoadContent(model.rows, onRetry = { model.reload() }, failedTitle = "Could not load forms") { rows ->
            if (rows.isEmpty()) {
              EmptyState(
                if (model.search.isBlank() && model.status == FormStatusFilter.IN_USE) "No forms yet" else "No forms match",
                body = if (model.search.isBlank()) "Add a form, then place it on a page in the Besigner." else "Try another search.",
                icon = AglynIcons.named("dynamic_form"),
              )
            } else {
              val now = remember(rows) { nowMillis() }
              LazyColumn(Modifier.fillMaxSize().testTag("forms-list"), state = listState) {
                items(rows, key = { it.id }) { row ->
                  AglynListItem(
                    title = row.name,
                    supporting = listOfNotNull(
                      row.submissions?.let { if (it == 1L) "1 submission" else "$it submissions" } ?: "No submissions",
                      row.lastSubmissionAtMs?.let { "last " + relativeTime(it, now) },
                    ).joinToString(" · "),
                    icon = AglynIcons.named("dynamic_form"),
                    selected = row.id == selected,
                    trailing = {
                      Row(horizontalArrangement = Arrangement.spacedBy(space(0.5f))) {
                        if (row.routesLeads) StatusChip("Leads", StatusTone.INFO)
                        if (row.retired) StatusChip("Retired", StatusTone.NEUTRAL)
                      }
                    },
                    onClick = { onSelect(row.id) },
                    modifier = Modifier.testTag("form-${row.id}"),
                  )
                }
                if (model.hasMore) item { SkeletonList(rows = 2) }
              }
            }
          }
        }
      }
    },
    detail = { selected ->
      if (selected == null) {
        EmptyState("Pick a form to see it here", icon = AglynIcons.named("dynamic_form"))
      } else {
        FormDetail(context, hostId, selected, api, runner, canEdit, context.siteRole in PUBLISH_ROLES) { dialog = it }
      }
    },
  )

  FormDialogs(context, hostId, dialog, api, runner, onChanged = { model.refresh() }) { dialog = null }
}

@Composable
private fun FormDetail(
  context: NativePluginContext,
  hostId: String,
  formId: String,
  api: FormsApi,
  runner: ActionRunner,
  canEdit: Boolean,
  canPublish: Boolean,
  open: (FormDialog) -> Unit,
) {
  val live by remember(hostId, formId, context.firestore) { context.firestore.observeDoc("${formsPath(hostId)}/$formId") }.collectAsState(Live.Loading)
  when (val value = live) {
    Live.Loading -> SkeletonList(rows = 6, modifier = Modifier.padding(space(2f)))
    is Live.Failed -> EmptyState("Could not load this form", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
    is Live.Ready -> {
      val doc = value.value ?: return EmptyState("This form is gone", icon = AglynIcons.named("dynamic_form"))
      val form = FormRow.from(doc)
      val now = remember(form.updatedAt) { nowMillis() }
      Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("form-detail"),
        verticalArrangement = Arrangement.spacedBy(space(2f)),
      ) {
        SectionCard(null) {
          Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
              Text(form.name, Modifier.semantics { heading() }, style = MaterialTheme.typography.headlineSmall)
              form.slug?.let { Text(it, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall) }
            }
            OverflowMenu(
              listOf(
                MenuAction("rename", "Rename", "edit", enabled = canEdit) { open(FormDialog.Rename(form)) },
                MenuAction("duplicate", "Duplicate", "content_copy", enabled = canEdit) { open(FormDialog.Duplicate(form)) },
                MenuAction("export", "Export submissions", "download") { open(FormDialog.Export(form)) },
                MenuAction("retire", if (form.retired) "Bring back" else "Retire", if (form.retired) "unarchive" else "archive", enabled = canEdit) { open(FormDialog.Retire(form)) },
              ),
            )
          }
          FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
            StatusChip(if (form.retired) "Retired" else "In use", if (form.retired) StatusTone.NEUTRAL else StatusTone.SUCCESS)
            if (form.routesLeads) StatusChip("Sends leads to the CRM", StatusTone.INFO)
            if (form.campaignCount > 0) StatusChip(if (form.campaignCount == 1) "In 1 campaign" else "In ${form.campaignCount} campaigns")
          }
          FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
            Button(
              onClick = { context.navigate(INBOX_SUBMISSIONS_SCREEN, mapOf("formId" to form.id, "formName" to form.name)) },
              modifier = Modifier.testTag("form-submissions"),
            ) {
              Icon(AglynIcons.named("inbox"), contentDescription = null)
              Text("Submissions", Modifier.padding(start = space(1f)))
            }
            OutlinedButton(
              onClick = { runner.run { context.openBesigner(formBesignerPath(form.id, api.versionToOpen(form, null)), ConsoleScope.SITE) } },
              enabled = canEdit && !runner.busy,
              modifier = Modifier.testTag("form-edit-besigner"),
            ) {
              Icon(AglynIcons.named("design_services"), contentDescription = null)
              Text("Design in the Besigner", Modifier.padding(start = space(1f)))
            }
          }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          StatTile("Submissions", (form.submissions ?: 0).toString(), Modifier.weight(1f), form.lastSubmissionAtMs?.let { "Last " + relativeTime(it, now) } ?: "None yet")
          StatTile("Leads", form.leads?.toString() ?: "—", Modifier.weight(1f), if (form.routesLeads) "Sent to the CRM" else "Not sent to the CRM")
          StatTile("Views", (form.views ?: 0).toString(), Modifier.weight(1f), "Times it was shown")
        }
        RoutingCard(form, api, runner, canEdit)
        SectionCard("Questions") {
          if (form.fields.isEmpty()) Text("This form declares no questions yet. Add them in the Besigner.", color = MaterialTheme.colorScheme.onSurfaceVariant)
          form.fields.forEachIndexed { index, field ->
            if (index > 0) HorizontalDivider()
            AglynListItem(
              title = field.label,
              supporting = listOfNotNull(field.type, field.role?.let { "used as $it" }, if (field.required) "required" else null, field.options.takeIf { it.isNotEmpty() }?.joinToString(", ")).joinToString(" · "),
              icon = AglynIcons.named("title"),
            )
          }
        }
        FormVersions(context, hostId, form, api, runner, canPublish)
        SectionCard("Details") {
          DetailRow("Form id", form.id)
          DetailRow("Updated", form.updatedAt?.let { relativeTime(it.epochMillis, now) })
        }
      }
    }
  }
}

@Composable
private fun RoutingCard(form: FormRow, api: FormsApi, runner: ActionRunner, canEdit: Boolean) {
  var lead by remember(form.id, form.routesLeads) { mutableStateOf(form.routesLeads) }
  var consent by remember(form.id, form.consentFieldName) { mutableStateOf(form.consentFieldName) }
  var picking by remember { mutableStateOf(false) }
  SectionCard("CRM routing") {
    SwitchRow(
      "Send submissions to the CRM as leads",
      lead,
      { lead = it },
      supporting = "Each submission with an email address becomes a lead.",
      enabled = canEdit,
      modifier = Modifier.testTag("form-route-leads"),
    )
    Column {
      Text("Marketing consent question", style = MaterialTheme.typography.labelLarge)
      androidx.compose.foundation.layout.Box {
        OutlinedButton(onClick = { picking = true }, enabled = canEdit, modifier = Modifier.testTag("form-consent")) {
          Text(consent?.let { name -> form.fields.firstOrNull { it.name == name }?.label ?: name } ?: "None")
        }
        DropdownMenu(expanded = picking, onDismissRequest = { picking = false }) {
          DropdownMenuItem(text = { Text("None") }, onClick = { consent = null; picking = false })
          for (field in form.fields.filter { it.type == "checkbox" || it.type == "radio" || it.type == "select" }) {
            DropdownMenuItem(text = { Text(field.label) }, onClick = { consent = field.name; picking = false })
          }
        }
      }
    }
    if (lead && consent == null) NoticeBanner("A form that sends leads should ask for marketing consent.", StatusTone.WARNING)
    Button(
      onClick = { runner.run("CRM routing saved.") { api.saveRouting(form, lead, consent) } },
      enabled = canEdit && !runner.busy && (lead != form.routesLeads || consent != form.consentFieldName),
      modifier = Modifier.testTag("form-routing-save"),
    ) { Text("Save routing") }
  }
}

@Composable
private fun FormVersions(context: NativePluginContext, hostId: String, form: FormRow, api: FormsApi, runner: ActionRunner, canPublish: Boolean) {
  val versions by remember(hostId, form.id, context.firestore) {
    context.firestore.observe(FirestoreQuery("${formsPath(hostId)}/${form.id}/versions", orderBy = listOf(FirestoreOrder("createdAt", descending = true)), limit = 20))
  }.collectAsState(Live.Loading)
  var refused by remember(form.id) { mutableStateOf<List<String>>(emptyList()) }
  SectionCard("Versions") {
    when (val live = versions) {
      Live.Loading -> SkeletonList(rows = 2)
      is Live.Failed -> Text("Versions could not be loaded.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      is Live.Ready -> {
        if (live.value.isEmpty()) Text("No versions yet. Open the Besigner to design the form.", color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (refused.isNotEmpty()) NoticeBanner("Fix these in the Besigner first: " + refused.joinToString("; "), StatusTone.WARNING)
        val now = remember(live.value.size) { nowMillis() }
        live.value.forEachIndexed { index, doc ->
          if (index > 0) HorizontalDivider()
          val current = doc.id == form.versionId
          AglynListItem(
            title = doc.string("displayName")?.ifBlank { null } ?: "Version ${live.value.size - index}",
            supporting = (doc.data["createdAt"] as? FirestoreTimestamp)?.let { "Saved " + relativeTime(it.epochMillis, now) },
            icon = AglynIcons.named("history"),
            trailing = {
              Row(verticalAlignment = Alignment.CenterVertically) {
                if (current) StatusChip("Published", StatusTone.SUCCESS)
                TextButton(onClick = { context.openBesigner(formBesignerPath(form.id, doc.id), ConsoleScope.SITE) }) { Text("Open") }
                if (!current) {
                  TextButton(
                    onClick = {
                      refused = emptyList()
                      runner.run("This version is now the published form.") {
                        try {
                          api.promote(form.id, doc.id)
                        } catch (refusal: FormPromoteRefused) {
                          refused = refusal.violations
                          throw refusal
                        }
                      }
                    },
                    enabled = canPublish && !runner.busy,
                  ) { Text("Publish") }
                }
              }
            },
            modifier = Modifier.testTag("form-version-${doc.id}"),
          )
        }
      }
    }
  }
}

@Composable
private fun FormDialogs(context: NativePluginContext, hostId: String, dialog: FormDialog?, api: FormsApi, runner: ActionRunner, onChanged: () -> Unit, close: () -> Unit) {
  when (dialog) {
    null -> Unit
    FormDialog.Create -> {
      var name by remember { mutableStateOf("") }
      ActionDialog(
        title = "New form",
        body = "Then design its questions in the Besigner and place it on a page.",
        icon = "dynamic_form",
        confirmLabel = "Create form",
        confirmEnabled = name.isNotBlank(),
        busy = runner.busy,
        error = runner.error,
        onDismiss = close,
        onConfirm = {
          runner.run("${name.trim()} was added.", onDone = { close(); onChanged() }) {
            val id = api.create(name)
            context.navigate(FORMS_FORM_SCREEN, mapOf("form" to id))
          }
        },
      ) {
        OutlinedTextField(name, { name = it.take(80) }, label = { Text("Form name") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("form-name"))
      }
    }
    is FormDialog.Rename -> {
      var name by remember(dialog) { mutableStateOf(dialog.form.name) }
      ActionDialog(
        title = "Rename form",
        icon = "edit",
        confirmLabel = "Save",
        confirmEnabled = name.isNotBlank() && name.trim() != dialog.form.name,
        busy = runner.busy,
        error = runner.error,
        onDismiss = close,
        onConfirm = { runner.run("Saved.", onDone = { close(); onChanged() }) { api.rename(dialog.form, name) } },
      ) {
        OutlinedTextField(name, { name = it.take(80) }, label = { Text("Form name") }, singleLine = true, modifier = Modifier.fillMaxWidth())
      }
    }
    is FormDialog.Duplicate -> {
      var name by remember(dialog) { mutableStateOf("${dialog.form.name} copy") }
      ActionDialog(
        title = "Duplicate ${dialog.form.name}",
        body = "The copy starts with no submissions.",
        icon = "content_copy",
        confirmLabel = "Duplicate",
        confirmEnabled = name.isNotBlank(),
        busy = runner.busy,
        error = runner.error,
        onDismiss = close,
        onConfirm = {
          runner.run("Copy added.", onDone = { close(); onChanged() }) {
            api.duplicate(dialog.form.id, name)?.let { context.navigate(FORMS_FORM_SCREEN, mapOf("form" to it)) }
          }
        },
      ) {
        OutlinedTextField(name, { name = it.take(80) }, label = { Text("Name of the copy") }, singleLine = true, modifier = Modifier.fillMaxWidth())
      }
    }
    is FormDialog.Retire -> ActionDialog(
      title = if (dialog.form.retired) "Bring ${dialog.form.name} back?" else "Retire ${dialog.form.name}?",
      body = if (dialog.form.retired) "It joins the forms in use again." else "It leaves the forms in use. Its submissions are kept, and you can bring it back.",
      icon = if (dialog.form.retired) "unarchive" else "archive",
      confirmLabel = if (dialog.form.retired) "Bring back" else "Retire",
      busy = runner.busy,
      error = runner.error,
      onDismiss = close,
      onConfirm = { runner.run(if (dialog.form.retired) "Form brought back." else "Form retired.", onDone = { close(); onChanged() }) { api.setRetired(dialog.form.id, !dialog.form.retired) } },
    )
    is FormDialog.Export -> TransferExportDialog(
      context,
      resource = "forms.submissions",
      title = "Export ${dialog.form.name} submissions",
      hostId = hostId,
      scope = mapOf("kind" to "filter", "filter" to mapOf("formId" to dialog.form.id)),
      fileStem = "${dialog.form.slug ?: dialog.form.id}-submissions",
      filter = mapOf("formId" to dialog.form.id),
    ) { message ->
      close()
      if (message != null) runner.notice = message
    }
  }
}
