package com.aglyn.plugins.workflows

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.Doc
import com.aglyn.contracts.WORKFLOW_ACTION_STEP_TYPES
import com.aglyn.contracts.WORKFLOW_MAX_STEPS
import com.aglyn.contracts.hostEventLabel
import com.aglyn.contracts.hostEventPayloadHint
import com.aglyn.contracts.hostEventTypes
import com.aglyn.contracts.hostFunctionOf
import com.aglyn.contracts.hostVariableOf
import com.aglyn.contracts.isWorkflowActionStep
import com.aglyn.contracts.jsString
import com.aglyn.contracts.runWorkflow
import com.aglyn.contracts.stepLabel
import com.aglyn.contracts.stepRunsAfterWait
import com.aglyn.contracts.str
import com.aglyn.contracts.triggerFilterProblem
import com.aglyn.contracts.validateWorkflowSteps
import com.aglyn.contracts.workflowDefinitionOf
import com.aglyn.contracts.workflowFunctionCalls
import com.aglyn.contracts.workflowTestRunLine
import com.aglyn.core.Live
import com.aglyn.core.createResourceUid
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.EmptyState
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/*
 * A site's workflows, as the console's Workflows card keeps them: the list
 * (Usage, Runs, Edit, Duplicate…, Delete), the plan gate and quota on Add,
 * and the editor — function calls and server steps, a trigger with its
 * filter, the return value and a test run of the calls.
 */

private const val FUNCTION_CALL_KIND = "functionCall"

private val WORKFLOW_STEP_KINDS: List<SelectOption> =
  listOf(SelectOption(FUNCTION_CALL_KIND, "Call a function")) + WORKFLOW_ACTION_STEP_TYPES.map { SelectOption(it, stepLabel(it)) }

/** The site's workflows section: what the list shows and what its buttons do. */
@Composable
fun WorkflowsSection(context: NativePluginContext, hostId: String, entitlements: Entitlements?, open: (AutomationTarget) -> Unit, selectedId: String?) {
  val api = remember(context.api, context.writer) { AutomationApi(context.api, context.writer) }
  val scope = rememberCoroutineScope()
  val live = liveQuery(context, remember(hostId) { ceilingQuery(workflowsPath(hostId), WORKFLOW_CEILING) })
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  var deleting by remember { mutableStateOf<Pair<WorkflowRow, WhereUsed>?>(null) }
  var duplicating by remember { mutableStateOf<WorkflowRow?>(null) }
  var scanning by remember { mutableStateOf<String?>(null) }
  var busy by remember { mutableStateOf(false) }

  SectionList(
    testTag = "workflows-section",
    header = {
      RunQuotaLine(context, RunCounter.WORKFLOW_RUNS, context.orgId, hostId, entitlements)
      AutomationNoticeBanner()
      notice?.let { (message, tone) -> NoticeBanner(message, tone, action = { TextButton(onClick = { notice = null }) { Text("Dismiss") } }) }
    },
    live = live,
    rows = { docs -> visibleWorkflows(windowOf(docs, WORKFLOW_CEILING).rows) },
    key = { it.id },
    emptyText = "Chain your functions into multi-step pipelines — each step feeds the next. Site-event triggers are coming next.",
    footer = { docs, rows ->
      val window = windowOf(docs, WORKFLOW_CEILING)
      if (window.truncated) {
        NoticeBanner(
          "Showing $WORKFLOW_CEILING workflows, ordered by id. This site has more — the duplicate-name check below only covers the ones listed here, so a name may already be taken by one that is not.",
          StatusTone.INFO,
        )
      }
      // The head-count the quota gate compares: every stored workflow read, deleted ones too, as the route counts them.
      val count = window.rows.size
      AddButton("Add workflow", "add-workflow") {
        when {
          entitlements != null && !entitlements.has("workflows") ->
            notice = "Workflows require a Starter plan — see Billing to upgrade" to StatusTone.WARNING
          entitlements?.limit("workflowsPerHost")?.let { count >= it } == true ->
            notice = "Workflow limit reached (${entitlements.limit("workflowsPerHost")}) — upgrade in Billing" to StatusTone.WARNING
          else -> open(AutomationTarget.Workflow(null))
        }
      }
      Caption(quotaReadout(count, entitlements?.limit("workflowsPerHost"), entitlements != null, "workflow"), Modifier.testTag("workflow-quota"))
    },
  ) { row ->
    AutomationRow(
      title = row.name,
      caption = row.caption,
      selected = row.id == selectedId,
      onClick = { open(AutomationTarget.Workflow(row.id)) },
      testTag = "workflow-${row.id}",
      actions = listOf(
        com.aglyn.ui.MenuAction(if (scanning == row.id) "Scanning…" else "Usage", "insights", enabled = scanning != row.id) {
          scanning = row.id
          scope.launch {
            val scan = api.whereUsed(hostId, row.id, row.name)
            scanning = null
            notice = workflowUsageLine(row.name, scan) to StatusTone.INFO
          }
        },
        com.aglyn.ui.MenuAction("Runs", "history") { open(AutomationTarget.Runs(row.id, row.name, siteScope = false)) },
        com.aglyn.ui.MenuAction("Edit", "edit") { open(AutomationTarget.Workflow(row.id)) },
        com.aglyn.ui.MenuAction("Duplicate…", "file_copy") { duplicating = row },
        com.aglyn.ui.MenuAction("Delete", "delete", destructive = true) {
          scope.launch { deleting = row to api.whereUsed(hostId, row.id, row.name) }
        },
      ),
    )
  }

  deleting?.let { (row, scan) ->
    ActionDialog(
      title = "Delete this workflow?",
      body = workflowDeleteBody(row.name, scan),
      confirmLabel = "Delete",
      destructive = true,
      icon = "delete",
      busy = busy,
      onDismiss = { deleting = null },
      onConfirm = {
        busy = true
        scope.launch {
          notice = try {
            api.deleteWorkflow(hostId, row.id)
            "Workflow deleted" to StatusTone.SUCCESS
          } catch (error: CancellationException) {
            throw error
          } catch (error: Throwable) {
            failureMessage(error) to StatusTone.ERROR
          }
          busy = false
          deleting = null
        }
      },
    )
  }
  duplicating?.let { row -> DuplicateWorkflowDialog(api, hostId, row, onDone = { message -> duplicating = null; message?.let { notice = it to StatusTone.SUCCESS } }) }
}

/** "Duplicate workflow": the copy's name, what it carries, and the route's answer. */
@Composable
private fun DuplicateWorkflowDialog(api: AutomationApi, hostId: String, row: WorkflowRow, onDone: (String?) -> Unit) {
  val scope = rememberCoroutineScope()
  var name by remember(row.id) { mutableStateOf(duplicateDisplayName(row.name)) }
  val attemptKey = remember(row.id) { createResourceUid() }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  ActionDialog(
    title = "Duplicate workflow",
    confirmLabel = if (busy) "Duplicating…" else "Duplicate",
    confirmEnabled = name.isNotBlank(),
    busy = busy,
    error = error,
    icon = "file_copy",
    dismissLabel = "Cancel",
    onDismiss = { onDone(null) },
    onConfirm = {
      busy = true
      error = null
      scope.launch {
        try {
          val copy = api.duplicateWorkflow(hostId, row.id, name.trim(), attemptKey)
          onDone("Duplicated as “$copy” — arm its trigger to run it")
        } catch (caught: CancellationException) {
          throw caught
        } catch (caught: Throwable) {
          error = caught.message ?: "Duplicate failed"
        } finally {
          busy = false
        }
      }
    },
  ) {
    Field("Name", name, { name = it.take(DUPLICATE_NAME_MAX) }, helper = "A name another workflow already has gets a number.", enabled = !busy)
    Text("What the copy carries", style = MaterialTheme.typography.titleSmall)
    Text("Every step and the return value", style = MaterialTheme.typography.bodyMedium)
    Text("The trigger is cleared, so the copy runs nothing until you arm it", style = MaterialTheme.typography.bodyMedium)
  }
}

/** The workflow editor ("Add Workflow" / "Edit Workflow"). [id] null is a new workflow. */
@Composable
fun WorkflowEditor(context: NativePluginContext, hostId: String, id: String?, onDone: (String?) -> Unit) {
  val api = remember(context.api, context.writer) { AutomationApi(context.api, context.writer) }
  val scope = rememberCoroutineScope()
  val list = liveQuery(context, remember(hostId) { ceilingQuery(workflowsPath(hostId), WORKFLOW_CEILING) })
  val stored = liveDoc(context, id?.let { "${workflowsPath(hostId)}/$it" })
  val functionsLive = liveQuery(context, remember(hostId) { ceilingQuery(functionsPath(hostId), EDITOR_OPTION_CEILING) })
  val variablesLive = liveQuery(context, remember(hostId) { ceilingQuery(variablesPath(hostId), EDITOR_OPTION_CEILING) })
  val pickers = rememberSitePickers(context, hostId)

  if (id != null && stored is Live.Loading) return SkeletonList(rows = 4)
  if (id != null && stored is Live.Failed) return EmptyState("Could not load this workflow", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
  val seed = (stored as? Live.Ready)?.value
  if (id != null && seed == null) return EmptyState("This workflow is gone", icon = AglynIcons.named("account_tree"))

  var draft by remember(id, seed != null) { mutableStateOf(seed?.let { workflowDraftOf(it.data, it.id) } ?: WorkflowDraft(id = null)) }
  var testResult by remember { mutableStateOf<String?>(null) }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }

  val rows = visibleWorkflows(windowOf(list.docsOrEmpty(), WORKFLOW_CEILING).rows)
  val nameTaken = draft.name.isNotEmpty() && workflowNameTaken(rows, draft.name, draft.id)
  val functionWindow = windowOf(functionsLive.docsOrEmpty(), EDITOR_OPTION_CEILING)
  val variableWindow = windowOf(variablesLive.docsOrEmpty(), EDITOR_OPTION_CEILING)
  val functionDocs = functionWindow.rows.filter { it.data["deletedAt"] == null }
  val functions = remember(functionDocs) {
    buildMap { for (doc in functionDocs) hostFunctionOf(doc.data).let { put(doc.id, it); if (it.name.isNotEmpty()) put(it.name, it) } }
  }
  val functionChoices = functionOptions(functionWindow.rows)
  val shortLists = listOfNotNull(if (functionWindow.truncated) "functions" else null, if (variableWindow.truncated) "variables" else null) + pickers.truncated

  EditorFrame(
    title = if (draft.id != null) "Edit Workflow" else "Add Workflow",
    saveLabel = "Done",
    saveEnabled = draft.name.isNotBlank() && !nameTaken,
    busy = busy,
    error = error,
    onCancel = { onDone(null) },
    onSave = {
      val problem = triggerFilterProblem(draft.trigger?.get("filter"), "action") ?: validateWorkflowSteps(draft.steps)
      if (problem != null) {
        error = problem
        return@EditorFrame
      }
      val fields = workflowFields(draft)
      val editing = draft.id
      if (editing != null && (stored as? Live.Ready)?.fromCache == true) {
        error = staleSeedMessage("workflow")
        return@EditorFrame
      }
      busy = true
      error = null
      scope.launch {
        try {
          if (editing != null) api.saveWorkflow(hostId, editing, fields) else api.createWorkflow(hostId, fields)
          onDone("Workflow saved")
        } catch (caught: CancellationException) {
          throw caught
        } catch (caught: Throwable) {
          error = failureMessage(caught)
        } finally {
          busy = false
        }
      }
    },
    modifier = Modifier.testTag("workflow-editor"),
  ) {
    Field(
      "Name",
      draft.name,
      { draft = draft.copy(name = it) },
      helper = if (nameTaken) "A workflow with this name already exists" else "Used to identify the workflow",
      error = nameTaken,
      modifier = Modifier.testTag("workflow-name"),
    )
    Overline("Steps")
    if (shortLists.isNotEmpty()) {
      NoticeBanner(
        "Offering the first $EDITOR_OPTION_CEILING ${shortLists.joinToString(", ")} on this site, ordered by id. There are more, so the pickers below are short and a test run may not resolve every expression.",
        StatusTone.INFO,
      )
    }
    draft.steps.forEachIndexed { index, step ->
      val call = !isWorkflowActionStep(step)
      fun replace(next: Doc) { draft = draft.copy(steps = draft.steps.mapIndexed { i, it -> if (i == index) next else it }) }
      StepCard(
        step = step,
        index = index,
        kind = if (call) FUNCTION_CALL_KIND else step.str("type") ?: "",
        kinds = WORKFLOW_STEP_KINDS,
        stepForKind = { kind -> if (kind == FUNCTION_CALL_KIND) emptyCall() else defaultStep(kind) },
        pickers = pickers.pickers,
        onChange = ::replace,
        onRemove = { draft = draft.copy(steps = draft.steps.filterIndexed { i, _ -> i != index }) },
        replyContext = ReplyContext(draft.trigger.str("event"), stepRunsAfterWait(draft.steps, index)),
        functionCall = if (call) {
          { FunctionCallFields(step, index, functions, functionChoices, ::replace) }
        } else {
          null
        },
      )
    }
    OutlinedButton(
      onClick = { draft = draft.copy(steps = draft.steps + emptyCall()) },
      enabled = draft.steps.size < WORKFLOW_MAX_STEPS,
      modifier = Modifier.testTag("add-step"),
    ) {
      Icon(AglynIcons.named("add"), contentDescription = null, Modifier.size(18.dp))
      Text("Add step", Modifier.padding(start = space(0.5f)))
    }
    Overline("Trigger")
    SelectField(
      "Run on event",
      listOf(SelectOption("", "Manual only")) + hostEventTypes.map { SelectOption(it, hostEventLabel(it)) },
      draft.trigger.str("event") ?: "",
      { draft = withWorkflowTrigger(draft, it) },
      Modifier.fillMaxWidth().testTag("workflow-trigger"),
    )
    draft.trigger?.let { trigger ->
      val filter = trigger["filter"]?.let(::jsString) ?: ""
      val problem = triggerFilterProblem(filter, "action")
      Field(
        "Filter (optional)",
        filter,
        { draft = draft.copy(trigger = trigger + ("filter" to it)) },
        placeholder = "subscribe",
        helper = problem ?: listOfNotNull(
          "Runs only when this expression is truthy — a field name, or arithmetic. It cannot compare values.",
          hostEventPayloadHint(trigger.str("event")),
        ).joinToString(" "),
        error = problem != null,
      )
    }
    Field("Return value", draft.returnValue, { draft = draft.copy(returnValue = it) }, helper = "A step result name; defaults to the last step")
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      OutlinedButton(
        onClick = {
          val calls = workflowDefinitionOf(workflowFunctionCalls(workflowFields(draft)))
          val variables = buildMap {
            for (doc in variableWindow.rows) if (doc.data["deletedAt"] == null && doc.data["name"] is String) put(doc.data["name"] as String, hostVariableOf(doc.data))
          }
          testResult = workflowTestRunLine(runWorkflow(calls, functions, variables))
        },
        modifier = Modifier.testTag("workflow-test-run"),
      ) {
        Icon(AglynIcons.named("play_arrow"), contentDescription = null, Modifier.size(18.dp))
        Text("Test run", Modifier.padding(start = space(0.5f)))
      }
      Caption("Uses current variable values")
    }
    testResult?.let { NoticeBanner(it, if (it.startsWith("Error")) StatusTone.WARNING else StatusTone.SUCCESS, Modifier.testTag("workflow-test-result")) }
  }
}

/** A function call's fields: which function (by id), its result name, an expression per parameter. */
@Composable
private fun FunctionCallFields(
  step: Doc,
  index: Int,
  functions: Map<String, com.aglyn.contracts.HostFunctionDefinition>,
  choices: List<PickOption>,
  onChange: (Doc) -> Unit,
) {
  val functionId = step.str("functionId")
  val definition = functions[functionId ?: ""] ?: functions[step.str("functionName") ?: ""]
  val selected = functionId ?: choices.firstOrNull { it.name == step.str("functionName") }?.id
  Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
    SelectField(
      "Function",
      choices.map { SelectOption(it.id, it.name) },
      selected,
      { picked -> onChange(step + mapOf("functionId" to picked, "functionName" to (choices.firstOrNull { it.id == picked }?.name ?: step.str("functionName") ?: ""))) },
      Modifier.fillMaxWidth().testTag("step-$index-function"),
    )
    Field("Result name", step["resultName"]?.let(::jsString) ?: "", { onChange(step.withField("resultName", resultNameOf(it))) }, placeholder = "step${index + 1}")
    val args = (step["args"] as? List<*>) ?: emptyList<Any?>()
    definition?.parameters?.forEachIndexed { parameterIndex, parameter ->
      Field(
        "${parameter.name} expression",
        args.getOrNull(parameterIndex)?.let(::jsString) ?: "",
        { text ->
          val next = args.toMutableList<Any?>()
          while (next.size <= parameterIndex) next += null
          next[parameterIndex] = text
          onChange(step.withField("args", next))
        },
        placeholder = if (parameterIndex == 0 && index > 0) "step$index" else "a variable, number, or expression",
      )
    }
  }
}

/** The step pickers' records, read when an editor opens, and which lists the ceiling cut. */
data class SitePickers(val pickers: StepPickers, val truncated: List<String>)

@Composable
fun rememberSitePickers(context: NativePluginContext, hostId: String): SitePickers {
  val orgId = context.orgId
  val workflows = windowOf(liveQuery(context, remember(hostId) { ceilingQuery(workflowsPath(hostId), EDITOR_OPTION_CEILING) }).docsOrEmpty(), EDITOR_OPTION_CEILING)
  val webhooks = windowOf(liveQuery(context, remember(hostId) { ceilingQuery(webhooksPath(hostId), EDITOR_OPTION_CEILING) }).docsOrEmpty(), EDITOR_OPTION_CEILING)
  val overlays = windowOf(liveQuery(context, remember(hostId) { ceilingQuery(overlaysPath(hostId), EDITOR_OPTION_CEILING) }).docsOrEmpty(), EDITOR_OPTION_CEILING)
  val datasets = windowOf(liveQuery(context, remember(orgId, hostId) { orgId?.let { siteDatasetsQuery(it, hostId) } }).docsOrEmpty(), EDITOR_OPTION_CEILING)
  val lists = windowOf(liveQuery(context, remember(orgId) { orgId?.let { ceilingQuery(listsPath(it), EDITOR_OPTION_CEILING) } }).docsOrEmpty(), EDITOR_OPTION_CEILING)
  val campaigns = windowOf(liveQuery(context, remember(orgId, hostId) { orgId?.let { siteCampaignsQuery(it, hostId) } }).docsOrEmpty(), EDITOR_OPTION_CEILING)
  return SitePickers(
    StepPickers(
      workflows = workflowOptions(workflows.rows),
      datasets = datasetOptions(datasets.rows),
      overlays = overlayOptions(overlays.rows),
      lists = listOptions(lists.rows),
      campaigns = campaignOptions(campaigns.rows),
      webhooks = webhookOptions(webhooks.rows),
    ),
    listOfNotNull(
      if (workflows.truncated) "workflows" else null,
      if (webhooks.truncated) "webhooks" else null,
      if (datasets.truncated) "datasets" else null,
      if (overlays.truncated) "overlays" else null,
      if (lists.truncated) "audiences" else null,
      if (campaigns.truncated) "campaigns" else null,
    ),
  )
}
