package com.aglyn.plugins.crm

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.CrmMergeFieldGroup
import com.aglyn.core.FirestoreDoc
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.Live
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.Busy
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.FormSheet
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space

/*
 * THE CRM'S EMAIL TEMPLATES AND SNIPPETS (the Apple `CrmEmailTemplates.swift`; the console's `crm-email-templates.ts`,
 * `use-crm-email-templates.ts`, `email-templates-card.tsx`, `email-template-drawer.tsx` and `crm-email-template-tools.tsx`):
 * the letters a team sends from a record. A template fills Send email's subject and message; a snippet drops a paragraph in.
 * Merge fields such as {{contact.firstName}} are filled by the send route.
 */

const val CRM_EMAIL_TEMPLATES_COLLECTION = "crmEmailTemplates"

data class CrmEmailTemplate(
  val id: String,
  val name: String,
  val subject: String,
  val body: String,
  /** `template` or `snippet`. */
  val kind: String,
  /** `shared` or `personal`. */
  val visibility: String,
  val ownerUid: String? = null,
)

/** `normalizeCrmEmailTemplate`: a stored row read with the console's caps and fallbacks. */
fun crmEmailTemplate(id: String, data: Map<String, Any?>?): CrmEmailTemplate {
  fun text(key: String, max: Int) = (data?.get(key) as? String).orEmpty().take(max)
  val visibility = (data?.get("visibility") as? String)?.takeIf { it == "shared" || it == "personal" } ?: "shared"
  val kind = (data?.get("kind") as? String)?.takeIf { it == "template" || it == "snippet" } ?: "template"
  val owner = text("ownerUid", 128)
  return CrmEmailTemplate(
    id, text("name", Contracts.crmEmailTemplateNameMax.toInt()).trim(), text("subject", Contracts.crmEmailSubjectMax.toInt()),
    text("body", Contracts.crmEmailBodyMax.toInt()), kind, visibility, owner.takeIf { visibility == "personal" && it.isNotEmpty() },
  )
}

/** `crmEmailTemplateIsListed`: a shared template is everyone's; a personal one its owner's alone. */
fun crmEmailTemplateIsListed(visibility: String?, ownerUid: String?, uid: String?): Boolean =
  visibility != "personal" || (!uid.isNullOrEmpty() && ownerUid == uid)

/** The listed templates of a workspace for a reader, named ones only. */
fun crmListedTemplates(docs: List<FirestoreDoc>, uid: String): List<CrmEmailTemplate> =
  docs.map { crmEmailTemplate(it.id, it.data) }.filter { it.name.isNotEmpty() && crmEmailTemplateIsListed(it.visibility, it.ownerUid, uid) }

/** The picker's order: shared (the team's) first, then the reader's own, each by name (`CrmTemplatePicker`). */
fun crmTemplatePickOrder(templates: List<CrmEmailTemplate>): List<CrmEmailTemplate> =
  templates.filter { it.kind == "template" }.sortedWith(compareBy<CrmEmailTemplate> { it.visibility == "personal" }.thenBy { it.name.lowercase() })

/** `{{key}}`. */
fun crmMergeFieldToken(key: String) = "{{$key}}"

/** The merge-field groups a letter to this record may use (the send dialog's `fieldGroups`). */
fun crmMergeGroups(links: Map<String, String>): List<CrmMergeFieldGroup> {
  val contact = "contactId" in links
  val deal = "dealId" in links
  val lead = "leadId" in links
  return buildList {
    if (contact || deal) add(CrmMergeFieldGroup.CONTACT)
    if (lead && !contact) add(CrmMergeFieldGroup.LEAD)
    if (deal) add(CrmMergeFieldGroup.DEAL)
    add(CrmMergeFieldGroup.YOU)
    add(CrmMergeFieldGroup.SITE)
  }
}

/** A snippet or a field put into the message: at its end, within the cap. */
fun crmInsert(text: String, body: String): String = (body + text).take(Contracts.crmEmailBodyMax.toInt())

/** Where a new template is stamped: under a site its tokens and the site; from the workspace's own CRM the org token and no site. */
fun crmTemplateStamp(scope: CrmScope): Pair<String?, List<String>> =
  if (scope.workspaceWide) null to listOf(ORG_SCOPE_TOKEN) else scope.hostId to scope.createTokens

/** The workspace's templates as this reader may list them, live; null while loading. */
@Composable
internal fun rememberCrmTemplates(context: NativePluginContext, scope: CrmScope): List<CrmEmailTemplate>? {
  val flow = remember(scope.orgId, scope.hostId, context.firestore) {
    context.firestore.observe(scopedQuery(scope, CRM_EMAIL_TEMPLATES_COLLECTION, orderBy = listOf(FirestoreOrder("name")), limit = Contracts.crmEmailTemplatesLimit.toInt()))
  }
  val live by flow.collectAsState(Live.Loading)
  return (live as? Live.Ready)?.value?.let { crmListedTemplates(it, scope.uid) }
}

/** New template / Edit template (`email-template-drawer.tsx`). */
@Composable
internal fun CrmTemplateDialog(editing: CrmEmailTemplate?, busy: Busy, onDismiss: () -> Unit, onSave: (name: String, kind: String, visibility: String, subject: String, body: String) -> Unit) {
  var name by remember { mutableStateOf(editing?.name.orEmpty()) }
  var kind by remember { mutableStateOf(editing?.kind ?: "template") }
  var visibility by remember { mutableStateOf(editing?.visibility ?: "shared") }
  var subject by remember { mutableStateOf(editing?.subject.orEmpty()) }
  var body by remember { mutableStateOf(editing?.body.orEmpty()) }
  FormSheet(
    if (editing == null) "New template" else "Edit template", busy, onDismiss,
    { onSave(name.trim(), kind, visibility, subject.trim(), body.trim()) },
    confirmLabel = if (editing == null) "Create template" else "Save", confirmEnabled = name.isNotBlank() && body.isNotBlank(),
  ) {
    Column(Modifier.padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
      OutlinedTextField(name, { name = it.take(Contracts.crmEmailTemplateNameMax.toInt()) }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("crm-template-name"))
      SelectField(
        "Kind", listOf("template", "snippet").map { SelectOption(it, Contracts.crmEmailTemplateKindLabels[it] ?: it) }, kind, { kind = it ?: "template" },
        Modifier.fillMaxWidth().testTag("crm-template-kind"),
        supporting = if (kind == "template") "Fills in the subject and the message of an email." else "A paragraph inserted where the cursor is.",
      )
      SelectField(
        "Who it is for", listOf("shared", "personal").map { SelectOption(it, Contracts.crmEmailTemplateVisibilityLabels[it] ?: it) }, visibility, { visibility = it ?: "shared" },
        Modifier.fillMaxWidth().testTag("crm-template-visibility"),
        supporting = if (visibility == "shared") "Every CRM editor can use and change it." else "Listed for you alone.",
      )
      if (kind == "template") {
        OutlinedTextField(
          subject, { subject = it.take(Contracts.crmEmailSubjectMax.toInt()) }, label = { Text("Subject") }, singleLine = true,
          supportingText = { Text("Optional. An email keeps its own subject when this is blank.") }, modifier = Modifier.fillMaxWidth().testTag("crm-template-subject"),
        )
      }
      OutlinedTextField(
        body, { body = it.take(Contracts.crmEmailBodyMax.toInt()) }, label = { Text("Message") }, minLines = 5,
        supportingText = { Text("Plain text. A blank line starts a new paragraph. Merge fields such as {{contact.firstName}} are filled in from the record when the email is sent.") },
        modifier = Modifier.fillMaxWidth().testTag("crm-template-body"),
      )
    }
  }
}

/** Settings › Email templates (`email-templates-card.tsx`): every listed template and snippet, New, Edit, Delete. */
@Composable
internal fun CrmTemplatesCard(context: NativePluginContext, scope: CrmScope, api: CrmApi) {
  val coroutines = rememberCoroutineScope()
  val templates = rememberCrmTemplates(context, scope)
  var editing by remember { mutableStateOf<CrmEmailTemplate?>(null) }
  var creating by remember { mutableStateOf(false) }
  var deleting by remember { mutableStateOf<CrmEmailTemplate?>(null) }
  var duplicating by remember { mutableStateOf<CrmEmailTemplate?>(null) }
  var notice by remember { mutableStateOf<String?>(null) }
  val busy = remember(editing, creating, deleting, duplicating) { Busy() }
  val limit = Contracts.crmEmailTemplatesLimit.toInt()
  val atCap = (templates?.size ?: 0) >= limit
  SectionCard(
    "Email templates", Modifier.fillMaxWidth().testTag("crm-templates"),
    action = { TextButton(onClick = { creating = true }, enabled = !atCap, modifier = Modifier.testTag("crm-template-new")) { Text("New template") } },
  ) {
    Text(
      "The letters your team sends from a record. A template fills in the subject and the message of Send email; a snippet drops a paragraph in where the cursor is. Merge fields such as {{contact.firstName}} are filled in from the record when the email is sent.",
      style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    notice?.let { NoticeBanner(it, StatusTone.SUCCESS, action = { TextButton(onClick = { notice = null }) { Text("Dismiss") } }) }
    if (templates != null && templates.isEmpty()) {
      Text("No templates yet. Write one here, or save an email you are about to send as a template.", style = MaterialTheme.typography.bodyMedium)
    }
    templates.orEmpty().forEach { template ->
      Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.weight(1f)) {
          AglynListItem(
            title = template.name,
            supporting = listOf(Contracts.crmEmailTemplateKindLabels[template.kind] ?: template.kind, if (template.kind == "template") template.subject.ifEmpty { "—" } else template.body).joinToString(" · "),
            trailing = { StatusChip(Contracts.crmEmailTemplateVisibilityLabels[template.visibility] ?: template.visibility, if (template.visibility == "personal") StatusTone.NEUTRAL else StatusTone.INFO) },
            onClick = { editing = template },
            modifier = Modifier.testTag("crm-template-${template.id}"),
          )
        }
        TextButton(onClick = { duplicating = template }, modifier = Modifier.testTag("crm-template-duplicate-${template.id}")) { Text(CRM_DUPLICATE_MENU_LABEL) }
        TextButton(onClick = { deleting = template }) { Text("Delete", color = MaterialTheme.colorScheme.error) }
      }
    }
    if (atCap) Text("A workspace keeps at most $limit templates and snippets. Delete one to add another.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
  }
  if (creating || editing != null) {
    val opened = editing
    CrmTemplateDialog(opened, busy, onDismiss = { creating = false; editing = null }) { name, kind, visibility, subject, body ->
      busy.run(coroutines, { creating = false; editing = null }) {
        if (opened == null) api.createTemplate(name, kind, visibility, subject, body) else api.updateTemplate(opened.id, name, kind, visibility, subject, body)
      }
    }
  }
  duplicating?.let { template ->
    // Duplicate… (`DuplicateResourceDialog`): the copy's name, filled with "Copy of …", above what the copy carries. One
    // attempt key per open, so a retried tap makes one copy.
    val noun = Contracts.duplicableResourceNouns["emailTemplate"] ?: "email template"
    var name by remember(template.id) { mutableStateOf(crmDuplicateDisplayName(template.name)) }
    val attemptKey = remember(template.id) { newRecordId() }
    ActionDialog(
      "Duplicate $noun", "Duplicate",
      { busy.run(coroutines, { duplicating = null }) { notice = "Duplicated as “${api.duplicateTemplate(template.id, name.trim(), attemptKey)}”" } },
      { duplicating = null }, busy = busy.busy, error = busy.error, confirmEnabled = name.isNotBlank(),
    ) {
      OutlinedTextField(
        name, { name = it.take(Contracts.duplicateNameMax.toInt()) }, label = { Text("Name") }, singleLine = true,
        supportingText = { Text("A name another $noun already has gets a number.") },
        modifier = Modifier.fillMaxWidth().testTag("crm-template-duplicate-name"),
      )
      Text("What the copy carries", style = MaterialTheme.typography.titleSmall)
      Contracts.duplicateCopies["emailTemplate"].orEmpty().forEach { Text(it, style = MaterialTheme.typography.bodyMedium) }
    }
  }
  deleting?.let { template ->
    ActionDialog(
      "Delete \"${template.name}\"?", "Delete", { busy.run(coroutines, { deleting = null }) { api.deleteTemplate(template.id) } }, { deleting = null },
      body = if (template.kind == "snippet") "The snippet is removed for everyone it is listed for. Emails already sent are not changed." else "The template is removed for everyone it is listed for. Emails already sent are not changed.",
      busy = busy.busy, error = busy.error, destructive = true,
    )
  }
}

/**
 * Send email (`crm-send-email-dialog.tsx`): To, a template to start from, the subject, Insert (a snippet or a merge field) and
 * Save as template, then the message.
 */
@Composable
internal fun CrmEmailDialog(context: NativePluginContext, scope: CrmScope, api: CrmApi, row: CrmRow, links: Map<String, String>, busy: Busy, onDismiss: () -> Unit, onSend: (String, String) -> Unit) {
  val coroutines = rememberCoroutineScope()
  val templates = rememberCrmTemplates(context, scope).orEmpty()
  val pickable = crmTemplatePickOrder(templates)
  val snippets = templates.filter { it.kind == "snippet" }
  var subject by remember { mutableStateOf("") }
  var message by remember { mutableStateOf("") }
  var applied by remember { mutableStateOf<CrmEmailTemplate?>(null) }
  var replacing by remember { mutableStateOf<CrmEmailTemplate?>(null) }
  var inserting by remember { mutableStateOf(false) }
  var savingTemplate by remember { mutableStateOf(false) }
  val saveBusy = remember(savingTemplate) { Busy() }
  // What `crm/email-check` says about the address before the send (`useCrmEmailCheck`).
  val address = row.data["email"] as? String
  val check by androidx.compose.runtime.produceState<CrmEmailCheck?>(null, address) { this.value = api.emailCheck(address) }
  // The draft as it will be sent (the dialog's `preview`): the records are read the first time it names a merge field.
  val hasFields = crmHasMergeFields("$subject\n$message")
  var merge by remember { mutableStateOf<CrmMergeContext?>(null) }
  androidx.compose.runtime.LaunchedEffect(hasFields) {
    if (hasFields && merge == null) merge = crmMergeContextFor(context.firestore, scope, row.kind, row.data)
  }
  val preview = if (hasFields) merge?.let { crmResolveMergeFields(subject, it) to crmResolveMergeFields(message, it) } else null
  val unresolved = preview?.let { (it.first.unresolved + it.second.unresolved).distinct() }.orEmpty()
  fun apply(template: CrmEmailTemplate) {
    if (template.subject.isNotEmpty()) subject = template.subject
    message = template.body
    applied = template
  }
  ActionDialog(
    title = "Email ${row.title}",
    body = (row.data["email"] as? String)?.let { "To $it. The email is logged on the record." },
    icon = "mail",
    confirmLabel = "Send",
    confirmEnabled = subject.isNotBlank() && message.isNotBlank(),
    busy = busy.busy,
    error = busy.error,
    onDismiss = onDismiss,
    onConfirm = { onSend(subject, message) },
  ) {
    crmEmailCheckWarning(check)?.let { NoticeBanner(it, com.aglyn.ui.StatusTone.WARNING, Modifier.fillMaxWidth().testTag("crm-email-check-warning")) }
    if (pickable.isNotEmpty()) {
      SelectField(
        "Template",
        pickable.map { SelectOption(it.id, it.name, supporting = if (it.visibility == "personal") "Mine" else "Shared") },
        applied?.id,
        { id ->
          val template = pickable.firstOrNull { it.id == id }
          when {
            template == null -> applied = null
            message.isNotBlank() && message != applied?.body -> replacing = template
            else -> apply(template)
          }
        },
        Modifier.fillMaxWidth().testTag("crm-email-template"),
        noneLabel = "None",
        supporting = "Fills in the subject and the message. Merge fields such as {{contact.firstName}} are filled from this record when the email is sent.",
      )
    }
    OutlinedTextField(subject, { subject = it.take(Contracts.crmEmailSubjectMax.toInt()) }, label = { Text("Subject") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("crm-email-subject"))
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
      Box {
        TextButton(onClick = { inserting = true }, modifier = Modifier.testTag("crm-email-insert")) { Text("Insert") }
        DropdownMenu(inserting, onDismissRequest = { inserting = false }) {
          if (snippets.isNotEmpty()) {
            Text("Snippets", Modifier.padding(horizontal = space(2f), vertical = space(0.5f)), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            snippets.forEach { snippet -> DropdownMenuItem(text = { Text(snippet.name) }, onClick = { inserting = false; message = crmInsert(snippet.body, message) }) }
          }
          crmMergeGroups(links).forEach { group ->
            HorizontalDivider()
            Text("${group.raw} fields", Modifier.padding(horizontal = space(2f), vertical = space(0.5f)), style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Contracts.crmMergeFields.filter { it.group == group }.forEach { field ->
              DropdownMenuItem(text = { Text(field.label) }, onClick = { inserting = false; message = crmInsert(crmMergeFieldToken(field.key), message) })
            }
          }
        }
      }
      TextButton(onClick = { savingTemplate = true }, enabled = subject.isNotBlank() || message.isNotBlank(), modifier = Modifier.testTag("crm-email-save-template")) { Text("Save as template…") }
    }
    OutlinedTextField(
      message, { message = it.take(Contracts.crmEmailBodyMax.toInt()) }, label = { Text("Message") }, minLines = 5,
      supportingText = {
        if (unresolved.isNotEmpty()) {
          Text(crmMergeUnresolvedMessage(unresolved), color = com.aglyn.ui.LocalAglynPalette.current.warning.text, modifier = Modifier.testTag("crm-email-unresolved"))
        } else {
          Text(if (hasFields) "Plain text. Merge fields are filled in from this record when the email is sent." else "Plain text. A blank line starts a new paragraph.")
        }
      },
      modifier = Modifier.fillMaxWidth().testTag("crm-email-body"),
    )
    preview?.let { (previewSubject, previewBody) ->
      Column(Modifier.fillMaxWidth().testTag("crm-email-preview"), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
        Text("Preview — as it will be sent", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(previewSubject.text, style = MaterialTheme.typography.titleSmall)
        Text(previewBody.text, style = MaterialTheme.typography.bodyMedium)
      }
    }
  }
  replacing?.let { template ->
    ActionDialog(
      "Replace the message?", "Replace", { replacing = null; apply(template) }, { replacing = null },
      body = "\"${template.name}\" replaces what you have written in the subject and the message.",
    )
  }
  if (savingTemplate) {
    var name by remember { mutableStateOf("") }
    var visibility by remember { mutableStateOf("personal") }
    ActionDialog(
      "Save as template", "Save template",
      { saveBusy.run(coroutines, { savingTemplate = false }) { api.createTemplate(name.trim(), "template", visibility, subject.trim(), message.trim()) } },
      { savingTemplate = false }, busy = saveBusy.busy, error = saveBusy.error, confirmEnabled = name.isNotBlank(),
    ) {
      OutlinedTextField(name, { name = it.take(Contracts.crmEmailTemplateNameMax.toInt()) }, label = { Text("Template name") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("crm-save-template-name"))
      ChoiceChipRow(
        listOf(ChipOption("personal", "Personal — listed for you alone"), ChipOption("shared", "Shared — every CRM editor can use and edit it")),
        visibility, { visibility = it },
      )
    }
  }
}

/** The row menus' label for the act (`DUPLICATE_MENU_LABEL`). */
internal const val CRM_DUPLICATE_MENU_LABEL = "Duplicate…"
