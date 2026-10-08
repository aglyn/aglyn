package com.aglyn.plugins.workflows

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.ACTION_MAX_CONDITIONS
import com.aglyn.contracts.CONTACT_LIFECYCLE_STAGES
import com.aglyn.contracts.CONTACT_LIFECYCLE_STAGE_LABELS
import com.aglyn.contracts.CONTACT_TAG_MAX_LENGTH
import com.aglyn.contracts.CRM_ACTIVITY_DIRECTIONS
import com.aglyn.contracts.CRM_ACTIVITY_DIRECTION_LABELS
import com.aglyn.contracts.CRM_ACTIVITY_KIND_LABELS
import com.aglyn.contracts.CRM_TASK_KIND_LABELS
import com.aglyn.contracts.CRM_TASK_MAX_DUE_DAYS
import com.aglyn.contracts.Doc
import com.aglyn.contracts.SEND_EMAIL_REPLY_INELIGIBLE_REASONS
import com.aglyn.contracts.asDoc
import com.aglyn.contracts.hostEventLabel
import com.aglyn.contracts.hostEventTypes
import com.aglyn.contracts.jsString
import com.aglyn.contracts.sendEmailIsTransactionalReply
import com.aglyn.contracts.sendEmailReplyIneligibility
import com.aglyn.contracts.stepLabel
import com.aglyn.contracts.str
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.space

/*
 * ONE STEP EDITOR FOR EVERY AUTOMATION BUILDER (automation-step-fields and
 * automation-trigger-conditions in the console): a step's number, what it
 * does, the fields that kind takes, its "Only if" guard, and the trigger's
 * condition rows. A field this editor does not show rides along unchanged.
 */

/** Everything on the site a step can be pointed at. */
data class StepPickers(
  val workflows: List<PickOption> = emptyList(),
  val datasets: List<PickOption> = emptyList(),
  val overlays: List<PickOption> = emptyList(),
  val lists: List<PickOption> = emptyList(),
  val campaigns: List<PickOption> = emptyList(),
  val webhooks: List<PickOption> = emptyList(),
)

/** What decides whether an email step can be a transactional reply: the trigger and a wait before it. */
data class ReplyContext(val event: String?, val afterWait: Boolean)

const val SEND_EMAIL_MERGE_HELP =
  "Merge tags: {{firstName|there}}, {{name}}, {{email}}, or {{contact.firstName}}, {{lead.company}}, {{site.name}} — filled from the contact or lead the event is about; the text after | is used when there is no value."

private val TASK_PRIORITY_OPTIONS = listOf("high" to "High", "normal" to "Normal", "low" to "Low")
private const val ELEMENT_SELECTOR_HINT = "[data-aglyn=\"leaf:…\"] or .my-class"

/** One step: its number, the "Do" picker, its fields, its guard. [functionCall] replaces the fields for a workflow's call. */
@Composable
fun StepCard(
  step: Doc,
  index: Int,
  kind: String,
  kinds: List<SelectOption>,
  stepForKind: (String) -> Doc,
  pickers: StepPickers,
  onChange: (Doc) -> Unit,
  onRemove: () -> Unit,
  replyContext: ReplyContext?,
  functionCall: (@Composable () -> Unit)? = null,
) {
  Surface(
    shape = MaterialTheme.shapes.large,
    color = MaterialTheme.colorScheme.surfaceContainerLow,
    modifier = Modifier.fillMaxWidth().testTag("step-$index"),
  ) {
    Column(Modifier.padding(space(1.5f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        Surface(shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.size(28.dp)) {
          Box(contentAlignment = Alignment.Center) {
            Text("${index + 1}", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onPrimaryContainer, fontWeight = FontWeight.SemiBold)
          }
        }
        val known = kinds.any { it.value == kind }
        SelectField(
          label = "Do",
          options = if (known) kinds else kinds + SelectOption(kind, stepLabel(kind), enabled = false),
          selected = kind,
          onSelect = { onChange(stepForKind(it)) },
          modifier = Modifier.weight(1f).testTag("step-$index-kind"),
        )
        RemoveButton("Remove step ${index + 1}", onRemove, Modifier.testTag("step-$index-remove"))
      }
      if (functionCall != null) {
        functionCall()
      } else {
        StepFields(step, pickers, onChange)
        if (step.str("type") == "sendEmail" && replyContext != null) SendEmailReplySwitch(step, replyContext, onChange)
        HorizontalDivider()
        StepGuard(step, onChange)
      }
    }
  }
}

@Composable
private fun SendEmailReplySwitch(step: Doc, context: ReplyContext, onChange: (Doc) -> Unit) {
  val ineligible = sendEmailReplyIneligibility(step, context.event, context.afterWait)
  val on = sendEmailIsTransactionalReply(step, context.event, context.afterWait)
  SwitchRow(
    title = "Transactional reply (no unsubscribe)",
    checked = on,
    onCheckedChange = { onChange(step.withField("transactional", it)) },
    enabled = ineligible == null,
    supporting = when {
      ineligible != null -> "Sent as a mailing with an unsubscribe link: ${SEND_EMAIL_REPLY_INELIGIBLE_REASONS[ineligible]}."
      on -> "Answers what this person just did, so it goes without an unsubscribe link or header. Bounced, complaining and unsubscribed addresses are still skipped."
      else -> "Sent as a mailing, with an unsubscribe link and header."
    },
    modifier = Modifier.testTag("step-transactional"),
  )
}

private fun Doc.text(key: String): String = this[key]?.let(::jsString) ?: ""

@Composable
private fun StepFields(step: Doc, pickers: StepPickers, onChange: (Doc) -> Unit) {
  fun set(key: String, value: Any?, dropEmpty: Boolean = false) = onChange(step.withField(key, value, dropEmpty))
  val placeholderOne = "Fill in the placeholder"
  val placeholderMany = "Fill in the placeholders"
  when (val type = step.str("type")) {
    "runWorkflow" -> RecordPicker(
      "Workflow",
      pickers.workflows,
      step.str("workflowId") ?: pickers.workflows.firstOrNull { it.name == step.str("workflowName") }?.id,
      { option -> onChange(step + mapOf("workflowId" to option.id, "workflowName" to option.name)) },
      placeholderName = step["workflowName"].takeIf { step.str("workflowId").isNullOrEmpty() },
    )
    "siteAlert" -> {
      Field("Message", step.text("message"), { set("message", it) }, helper = placeholderHelp(step["message"], placeholderOne), error = placeholderHelp(step["message"], placeholderOne) != null)
      SelectField("Style", listOf("info", "success", "warning", "error").map { SelectOption(it, it) }, step.str("severity") ?: "info", { set("severity", it) }, Modifier.fillMaxWidth())
    }
    "customEvent" -> Field("Event name", step.text("eventName"), { set("eventName", it) })
    "webhookPost" -> RecordPicker(
      "Webhook",
      pickers.webhooks,
      step.str("webhookId") ?: pickers.webhooks.firstOrNull { it.name == step.str("webhookName") }?.id,
      { option -> onChange(step + mapOf("webhookId" to option.id, "webhookName" to option.name)) },
      placeholderName = step["webhookName"].takeIf { step.str("webhookId").isNullOrEmpty() },
    )
    "datasetAppend", "updateDataset" -> RecordPicker(
      "Dataset",
      pickers.datasets,
      step.str("datasetId")?.ifEmpty { null } ?: pickers.datasets.firstOrNull { it.name == step.str("datasetName") }?.id,
      { option -> onChange(step + mapOf("datasetId" to option.id, "datasetName" to option.name)) },
      placeholderName = step["datasetName"].takeIf { step.str("datasetId").isNullOrEmpty() },
    )
    "showOverlay" -> RecordPicker("Overlay", pickers.overlays, step.str("overlayId"), { option -> onChange(step + mapOf("overlayId" to option.id, "overlayName" to option.name)) })
    "stickyNav" -> Field("Selector (default: header/nav)", step.text("selector"), { set("selector", it) })
    "addClass", "removeClass", "toggleClass" -> {
      Field("CSS selector", step.text("selector"), { set("selector", it) })
      Field("Class name", step.text("className"), { set("className", it) })
    }
    "showElement", "hideElement", "toggleElement", "playVideo" ->
      Field("CSS selector", step.text("selector"), { set("selector", it) }, placeholder = ELEMENT_SELECTOR_HINT)
    "scrollTo" -> {
      Field("CSS selector", step.text("selector"), { set("selector", it) }, placeholder = ELEMENT_SELECTOR_HINT)
      SelectField(
        "Scroll",
        listOf(SelectOption("smooth", "Smoothly"), SelectOption("instant", "Instantly")),
        if (step["behavior"] == "instant") "instant" else "smooth",
        { set("behavior", if (it == "instant") "instant" else null) },
        Modifier.fillMaxWidth(),
      )
      Field("Offset (px)", step["offsetPx"]?.let(::jsString) ?: "", { text -> set("offsetPx", if (text.isBlank()) null else text.filter(Char::isDigit).toLongOrNull()) }, number = true)
    }
    "setAttribute", "removeAttribute" -> {
      Field("CSS selector", step.text("selector"), { set("selector", it) }, placeholder = ELEMENT_SELECTOR_HINT)
      val name = step.text("name")
      val refused = name.isNotEmpty() && !isInteractionAttributeAllowed(name)
      Field("Attribute", name, { set("name", it) }, placeholder = "aria-expanded", helper = if (refused) "Must start with aria- or data-" else null, error = refused)
      if (type == "setAttribute") Field("Value", step.text("value"), { set("value", it) }, placeholder = "true")
    }
    "openDrawer", "closeDrawer", "toggleDrawer" ->
      Field("Drawer node id (optional)", step.text("drawerNodeId"), { set("drawerNodeId", it, dropEmpty = true) }, placeholder = "Empty = the page's first drawer")
    "openMenu", "closeMenu", "toggleMenu" ->
      Field("Menu node id (optional)", step.text("menuNodeId"), { set("menuNodeId", it, dropEmpty = true) }, placeholder = "Empty = the page's first menu")
    "showHtml" -> Field("HTML", step.text("html"), { set("html", it) }, multiline = true)
    "runJs" -> Field("JavaScript", step.text("code"), { set("code", it) }, multiline = true)
    "redirect" -> Field("Destination URL", step.text("url"), { set("url", it) })
    "trackGaEvent" -> Field("Analytics event name", step.text("eventName"), { set("eventName", it) })
    "sendEmail" -> {
      val subjectHelp = placeholderHelp(step["subject"], placeholderOne)
      Field("Subject", step.text("subject"), { set("subject", it) }, helper = subjectHelp, error = subjectHelp != null)
      val bodyHelp = placeholderHelp(step["body"], placeholderMany)
      Field("Body", step.text("body"), { set("body", it) }, multiline = true, helper = bodyHelp ?: SEND_EMAIL_MERGE_HELP, error = bodyHelp != null)
    }
    "notifyAdmins" -> {
      val help = placeholderHelp(step["title"], placeholderOne)
      Field("Notification title", step.text("title"), { set("title", it) }, helper = help, error = help != null)
    }
    "enrollList" -> RecordPicker(
      "List",
      pickers.lists,
      step.str("listId")?.ifEmpty { null },
      { option -> onChange(step + mapOf("listId" to option.id, "listName" to option.name)) },
      placeholderName = step["listName"],
      emptyLabel = "No lists yet — create one under Campaigns",
    )
    "assignCampaign" -> RecordPicker(
      "Campaign",
      pickers.campaigns,
      step.str("campaignId")?.ifEmpty { null },
      { option -> onChange(step + mapOf("campaignId" to option.id, "campaignName" to option.name)) },
      placeholderName = step["campaignName"],
      emptyLabel = "No campaigns yet",
    )
    "setContactStage" -> SelectField(
      "Stage",
      CONTACT_LIFECYCLE_STAGES.map { SelectOption(it, CONTACT_LIFECYCLE_STAGE_LABELS.getValue(it)) },
      step.str("lifecycleStage"),
      { set("lifecycleStage", it) },
      Modifier.fillMaxWidth(),
    )
    "addContactTag" -> {
      val help = placeholderHelp(step["tag"], placeholderOne)
      Field("Tag", step.text("tag"), { set("tag", it.take(CONTACT_TAG_MAX_LENGTH)) }, helper = help, error = help != null)
    }
    "assignContactOwner" -> {
      val roundRobin = step["roundRobin"] == true
      SelectField(
        "Assign to",
        listOf(SelectOption("member", "A team member"), SelectOption("roundRobin", "Round robin — the next member of the CRM’s pool")),
        if (roundRobin) "roundRobin" else "member",
        { mode -> onChange(if (mode == "roundRobin") linkedMapOf("type" to "assignContactOwner", "roundRobin" to true) else linkedMapOf("type" to "assignContactOwner", "ownerEmail" to "")) },
        Modifier.fillMaxWidth(),
      )
      if (roundRobin) {
        Caption("The pool is set under CRM → Settings; an empty pool is a failed step.")
      } else {
        Field("Owner (email address or member id)", step.str("ownerEmail")?.ifEmpty { null } ?: step.text("ownerUid"), { onChange(step.withMemberRef("owner", it)) })
        Caption("Somebody on your team, matched against the roster when the automation runs.")
      }
    }
    "createCrmTask" -> {
      val help = placeholderHelp(step["title"], placeholderOne)
      Field("Title", step.text("title"), { set("title", it) }, helper = help, error = help != null)
      SelectField("Type", CRM_TASK_KIND_LABELS.map { (key, label) -> SelectOption(key, label) }, step.str("kind"), { set("kind", it) }, Modifier.fillMaxWidth())
      SelectField("Priority", TASK_PRIORITY_OPTIONS.map { SelectOption(it.first, it.second) }, step.str("priority") ?: "normal", { set("priority", it) }, Modifier.fillMaxWidth())
      Field(
        "Due in (days)",
        step["dueInDays"]?.let(::jsString) ?: "",
        { text -> set("dueInDays", (text.filter(Char::isDigit).toLongOrNull() ?: 0L).coerceIn(0L, CRM_TASK_MAX_DUE_DAYS.toLong())) },
        number = true,
      )
      Field(
        "Assignee (email address or member id, optional)",
        step.str("assigneeEmail")?.ifEmpty { null } ?: step.text("assigneeUid"),
        { onChange(step.withMemberRef("assignee", it)) },
        helper = "Blank gives it to the contact’s owner.",
      )
    }
    "logCrmActivity" -> {
      val kind = step.str("kind")
      SelectField("Kind", CRM_ACTIVITY_KIND_LABELS.map { (key, label) -> SelectOption(key, label) }, kind, { onChange(step.withActivityKind(it)) }, Modifier.fillMaxWidth())
      val directions = CRM_ACTIVITY_DIRECTIONS[kind].orEmpty()
      if (directions.isNotEmpty()) {
        SelectField(
          "Direction",
          listOf(SelectOption("", "Not said")) + directions.map { SelectOption(it, CRM_ACTIVITY_DIRECTION_LABELS.getValue(it)) },
          step.str("direction") ?: "",
          { set("direction", it, dropEmpty = true) },
          Modifier.fillMaxWidth(),
        )
      }
      val help = placeholderHelp(step["body"], placeholderMany)
      Field("What happened", step.text("body"), { set("body", it) }, multiline = true, helper = help, error = help != null)
    }
    "wait", "waitForEvent" -> {
      val waitsForEvent = type == "waitForEvent"
      if (waitsForEvent) {
        SelectField("Until", hostEventTypes.map { SelectOption(it, hostEventLabel(it)) }, step.str("eventName"), { set("eventName", it) }, Modifier.fillMaxWidth())
      }
      val key = if (waitsForEvent) "timeoutMinutes" else "delayMinutes"
      val current = (step[key] as? Number)?.toLong()
      val presets = FLOW_WAIT_PRESETS.map { SelectOption(it.first.toString(), it.second) }
      SelectField(
        if (waitsForEvent) "Give up after" else "Wait for",
        if (current != null && FLOW_WAIT_PRESETS.none { it.first == current }) presets + SelectOption(current.toString(), "$current minutes", enabled = false) else presets,
        current?.toString(),
        { set(key, it.toLong()) },
        Modifier.fillMaxWidth(),
      )
      Caption(if (waitsForEvent) "Continues as soon as this happens, or when the time is up." else "The rest of this automation runs later, on its own.")
    }
    "exitFlow" -> Caption("Nothing after this step runs. Add a condition to make it a branch.")
    else -> Caption("${stepLabel(type)} — its settings are kept as they are.")
  }
}

/** The step's "Only if": one clause that decides whether this step runs. */
@Composable
private fun StepGuard(step: Doc, onChange: (Doc) -> Unit) {
  val first = (step["when"].asDoc()?.get("conditions") as? List<*>)?.firstOrNull().asDoc()
  val op = first?.get("op") as? String ?: ""
  Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
    SelectField(
      "Only if",
      listOf(SelectOption("", "Always run"), SelectOption("notEmpty", "Field is not empty"), SelectOption("equals", "Field equals"), SelectOption("contains", "Field contains")),
      op,
      { onChange(step.withGuardOp(it)) },
      Modifier.fillMaxWidth().testTag("step-guard"),
    )
    if (op.isNotEmpty()) {
      Field("Field", first?.get("field")?.let(::jsString) ?: "", { onChange(step.withGuardField("field", it)) }, placeholder = "orderId")
    }
    if (op == "equals" || op == "contains") {
      val value = first?.get("value")
      val help = placeholderHelp(value, "Replace the placeholder with the value to match")
      Field("Value", value?.let(::jsString) ?: "", { onChange(step.withGuardField("value", it)) }, helper = help, error = help != null)
    }
  }
}

/** The trigger's condition rows, "Add condition", and the AND/OR choice once there are two. */
@Composable
fun ConditionRowsEditor(
  rows: List<ConditionRow>,
  combinator: String,
  onRows: (List<ConditionRow>) -> Unit,
  onCombinator: (String) -> Unit,
  /** The site's forms for a "Form is" row, where the event carries the form's id; null offers it only to show a stored one. */
  formOptions: List<PickOption>? = null,
) {
  val offerForms = formOptions != null || rows.any { it.op == FORM_IS_OP }
  Column(verticalArrangement = Arrangement.spacedBy(space(1f)), modifier = Modifier.testTag("condition-rows")) {
    rows.forEachIndexed { index, row ->
      fun update(next: ConditionRow) = onRows(rows.mapIndexed { i, it -> if (i == index) next else it })
      if (index > 0) Caption(if (combinator == "or") "or" else "and")
      Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(space(1f))) {
          val ops = buildList {
            if (rows.size == 1) add(SelectOption("", "Always (no condition)"))
            add(SelectOption("notEmpty", "A field is not empty"))
            add(SelectOption("equals", "A field equals…"))
            add(SelectOption("contains", "A field contains…"))
            if (offerForms) add(SelectOption(FORM_IS_OP, "Form is…"))
          }
          SelectField(if (index == 0) "Only run when" else "Condition", ops, row.op, { update(withOp(row, it)) }, Modifier.fillMaxWidth().testTag("condition-$index-op"))
          when {
            row.op == FORM_IS_OP && formOptions != null -> {
              val gone = row.value.isNotEmpty() && formOptions.none { it.id == row.value }
              SelectField(
                "Form",
                (if (gone) listOf(SelectOption(row.value, "A form that is gone (${row.value})")) else emptyList()) + formOptions.map { SelectOption(it.id, it.name) },
                row.value.ifEmpty { null },
                { update(row.copy(value = it)) },
                Modifier.fillMaxWidth(),
                supportingText = if (row.value.isEmpty()) "Pick the form" else null,
                isError = row.value.isEmpty(),
              )
            }
            row.op == FORM_IS_OP -> Field("Form id", row.value, { update(row.copy(value = it)) })
            row.op.isNotEmpty() -> Field("Field", row.field, { update(row.copy(field = it)) }, placeholder = "subscribe")
          }
          if (row.op == "equals" || row.op == "contains") {
            val help = placeholderHelp(row.value, "Replace the placeholder with the value to match")
            Field("Value", row.value, { update(row.copy(value = it)) }, placeholder = "Yes", helper = help, error = help != null)
          }
        }
        if (rows.size > 1) {
          RemoveButton("Remove condition ${index + 1}", { onRows(if (rows.size > 1) rows.filterIndexed { i, _ -> i != index } else listOf(EMPTY_CONDITION_ROW)) })
        }
      }
    }
    if (rows.all { it.op.isNotEmpty() }) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        OutlinedButton(
          onClick = { onRows(rows + ConditionRow("notEmpty", "", "")) },
          enabled = rows.size < ACTION_MAX_CONDITIONS,
          modifier = Modifier.testTag("add-condition"),
        ) {
          Icon(AglynIcons.named("add"), contentDescription = null, Modifier.size(18.dp))
          Text("Add condition", Modifier.padding(start = space(0.5f)))
        }
        if (rows.size >= 2) {
          SelectField(
            "Match",
            listOf(SelectOption("and", "All conditions match (AND)"), SelectOption("or", "Any condition matches (OR)")),
            combinator,
            onCombinator,
            Modifier.weight(1f),
          )
        }
      }
    }
  }
}
