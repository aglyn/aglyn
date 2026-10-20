package com.aglyn.plugins.logic

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
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
import com.aglyn.ui.EmptyTone
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.TextButton
import com.aglyn.ui.WithTooltip
import kotlinx.coroutines.launch
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.FunctionComparator
import com.aglyn.contracts.FunctionConditionalOperation
import com.aglyn.contracts.FunctionConditionalOperationIf
import com.aglyn.contracts.FunctionSetOperation
import com.aglyn.contracts.FunctionValueType
import com.aglyn.contracts.FunctionRunResult
import com.aglyn.contracts.HostFunction
import com.aglyn.contracts.HostFunctionParameter
import com.aglyn.contracts.HostFunctionVariable
import com.aglyn.contracts.evaluateHostFunction
import com.aglyn.contracts.hostFunctionOf
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.pluginhost.jsString
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.ChoiceField
import com.aglyn.ui.EmptyState
import com.aglyn.ui.InputChoice
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.space

private val VALUE_TYPES = listOf(FunctionValueType.NUMBER, FunctionValueType.TEXT, FunctionValueType.BOOLEAN)
private fun typeChoices() = VALUE_TYPES.map { InputChoice(it.raw, it.raw) }
private fun typeOf(raw: String) = FunctionValueType.entries.firstOrNull { it.raw == raw } ?: FunctionValueType.NUMBER
private val COMPARATORS = FunctionComparator.entries.filter { it != FunctionComparator.UNKNOWN }

/** The console's input filter for a parameter's or variable's name. */
private fun nameInput(text: String) = text.filter { (it.isLetterOrDigit() && it.code < 128) || it == '_' }

/**
 * One no-code function, as the Functions card's editor builds it: its name,
 * parameters (type, required, and what a visitor sees: label, starting value
 * and choices), working variables, the if/then/otherwise operations of SET
 * rows, and the value it returns. A new one is created through the
 * quota-enforcing route; an edit is the card's merge, then the site's cache
 * drop.
 */
@Composable
fun FunctionEditorScreen(context: NativePluginContext, functionId: String?) {
  val hostId = context.hostId ?: return
  if (functionId == null) return FunctionEditor(context, hostId, null, emptyFunction())
  val live by remember(hostId, functionId, context.firestore) { context.firestore.observeDoc("${functionsPath(hostId)}/$functionId") }.collectAsState(Live.Loading)
  when (val value = live) {
    Live.Loading -> SkeletonList(rows = 6, modifier = Modifier.padding(space(2f)))
    is Live.Failed -> EmptyState("Could not load this function", body = "Check the connection and try again.", icon = AglynIcons.named("error"), tone = EmptyTone.ERROR)
    is Live.Ready -> {
      val doc = value.value?.takeIf { it.data["deletedAt"] == null } ?: return EmptyState("This function is gone", icon = AglynIcons.named("functions"))
      // Seeded once from the stored function; Save writes the whole definition, as the card does.
      val start = remember(doc.id) { FunctionRow.from(doc).definition }
      FunctionEditor(context, hostId, doc.id, start)
    }
  }
}

@Composable
private fun FunctionEditor(context: NativePluginContext, hostId: String, functionId: String?, start: HostFunction) {
  val scope = rememberCoroutineScope()
  val api = remember(hostId, context.api, context.writer) { LogicApi(context.api, context.writer, hostId) }
  val runner = remember(hostId, functionId) { ActionRunner(scope) }
  val canEdit = context.siteRole in LOGIC_WRITE_ROLES
  var draft by remember(functionId) { mutableStateOf(start) }
  val others by remember(hostId, context.firestore) { context.firestore.observe(ceilingQuery(functionsPath(hostId))) }.collectAsState(Live.Loading)
  val taken = ((others as? Live.Ready)?.value).orEmpty().filter { it.id != functionId && it.data["deletedAt"] == null }.mapNotNull { it.string("name")?.lowercase() }
  val nameTaken = draft.name.orEmpty().trim().lowercase() in taken
  val names = draft.assignableNames().map { InputChoice(it, it) }
  // The site's variables, for the formula builder's value picker: read the first time a builder opens, so
  // an author who never builds a formula costs nothing.
  var siteVariables by remember { mutableStateOf<List<SiteVariableName>?>(null) }
  fun loadSiteVariables() {
    if (siteVariables != null) return
    siteVariables = emptyList()
    scope.launch {
      runCatching { context.firestore.page(FirestoreQuery(variablesPath(hostId), orderBy = listOf(FirestoreOrder("__name__")), limit = LOGIC_CEILING)) }
        .onSuccess { page -> siteVariables = page.docs.filter { it.data["deletedAt"] == null && !it.string("name").isNullOrEmpty() }.map { SiteVariableName(it.string("name"), it.string("type"), it.string("value")) } }
    }
  }
  val parameters = draft.parameters.orEmpty()
  val variables = draft.variables.orEmpty()
  val operations = draft.operations.orEmpty()
  var testArgs by remember { mutableStateOf<Map<String, String>>(emptyMap()) }
  var testResult by remember { mutableStateOf<String?>(null) }
  // A test run sees what a published page sees: the site variables the draft names, read on the click and
  // only when the draft names something outside itself.
  fun runTest() {
    scope.launch {
      var globals: Map<String, Any> = emptyMap()
      if (functionReferencedNames(draft).isNotEmpty()) {
        runCatching { context.firestore.page(FirestoreQuery(variablesPath(hostId), orderBy = listOf(FirestoreOrder("__name__")), limit = LOGIC_CEILING)) }.onSuccess { page ->
          val rows = page.docs.filter { it.data["deletedAt"] == null && !it.string("name").isNullOrEmpty() }.map { SiteVariableName(it.string("name"), it.string("type"), it.string("value")) }
          globals = functionGlobals(draft, rows)
        }
      }
      val args = parameters.associate { it.name.orEmpty() to (testArgs[it.name.orEmpty()] ?: "") }
      testResult = when (val run = evaluateHostFunction(hostFunctionOf(functionSaveFields(draft)), args, globals)) {
        is FunctionRunResult.Failed -> "Error: ${run.error}"
        is FunctionRunResult.Ok -> "Result: ${jsString(run.value)}"
      }
    }
  }
  val formulaNameOptions = formulaNames(parameters.mapNotNull { it.name }, variables.mapNotNull { it.name }, siteVariables.orEmpty())

  Column(
    Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)).widthIn(max = 960.dp).testTag("function-editor"),
    verticalArrangement = Arrangement.spacedBy(space(2f)),
  ) {
    Text(if (functionId == null) "New function" else "Edit function", style = MaterialTheme.typography.headlineSmall)
    runner.error?.let { NoticeBanner(it, StatusTone.ERROR) }
    if (!canEdit) NoticeBanner("Changing a function needs the editor or admin role on this site.", StatusTone.WARNING)
    OutlinedTextField(
      draft.name.orEmpty(),
      { draft = draft.copy(name = it) },
      label = { Text("Name") },
      isError = nameTaken,
      supportingText = { Text(if (nameTaken) "A function with this name already exists" else "Used to identify the function") },
      singleLine = true,
      modifier = Modifier.fillMaxWidth().testTag("function-name"),
    )

    SectionCard("Parameters", action = {
      TextButton(onClick = {
        draft = draft.copy(parameters = parameters + HostFunctionParameter(name = "P${parameters.size + variables.size + 1}", type = FunctionValueType.NUMBER, required = false))
      }) { Text("Add parameter") }
    }) {
      if (parameters.isEmpty()) Text("No parameters: the function takes nothing in.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      parameters.forEachIndexed { index, parameter ->
        if (index > 0) HorizontalDivider()
        fun put(next: HostFunctionParameter) { draft = draft.copy(parameters = parameters.toMutableList().also { it[index] = next }) }
        Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
          OutlinedTextField(parameter.name.orEmpty(), { put(parameter.copy(name = nameInput(it))) }, label = { Text("Name") }, singleLine = true, modifier = Modifier.weight(1f))
          ChoiceField("Type", (parameter.type ?: FunctionValueType.NUMBER).raw, typeChoices(), { put(parameter.copy(type = typeOf(it))) }, Modifier.weight(1f), allowEmpty = false)
          WithTooltip("Remove parameter ${parameter.name}") { IconButton(onClick = { draft = draft.copy(parameters = parameters.filterIndexed { at, _ -> at != index }) }) {
            Icon(AglynIcons.named("delete"), contentDescription = "Remove parameter ${parameter.name}")
          } }
        }
        SwitchRow("Required", parameter.required == true, { put(parameter.copy(required = it)) })
        // What a visitor sees for this parameter: empty fields are left off the definition.
        ParameterAudience(parameter) { put(it) }
      }
    }

    SectionCard("Variables", action = {
      TextButton(onClick = { draft = draft.copy(variables = variables + HostFunctionVariable(name = "V${variables.size + 1}", type = FunctionValueType.NUMBER)) }) { Text("Add variable") }
    }) {
      if (variables.isEmpty()) Text("No working variables.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      variables.forEachIndexed { index, variable ->
        fun put(next: HostFunctionVariable) { draft = draft.copy(variables = variables.toMutableList().also { it[index] = next }) }
        Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
          OutlinedTextField(variable.name.orEmpty(), { put(variable.copy(name = nameInput(it))) }, label = { Text("Name") }, singleLine = true, modifier = Modifier.weight(1f))
          ChoiceField("Type", (variable.type ?: FunctionValueType.NUMBER).raw, typeChoices(), { put(variable.copy(type = typeOf(it))) }, Modifier.weight(1f), allowEmpty = false)
          WithTooltip("Remove variable ${variable.name}") { IconButton(onClick = { draft = draft.copy(variables = variables.filterIndexed { at, _ -> at != index }) }) {
            Icon(AglynIcons.named("delete"), contentDescription = "Remove variable ${variable.name}")
          } }
        }
      }
    }

    SectionCard("Operations", action = { TextButton(onClick = { draft = draft.copy(operations = operations + newOperation()) }) { Text("Add operation") } }) {
      operations.forEachIndexed { index, operation ->
        if (index > 0) HorizontalDivider()
        OperationEditor(index, operation, names, formulaNameOptions, ::loadSiteVariables, onRemove = { draft = draft.copy(operations = operations.filterIndexed { at, _ -> at != index }) }) { next ->
          draft = draft.copy(operations = operations.toMutableList().also { it[index] = next })
        }
      }
    }

    ChoiceField("Return value", draft.returnValue.orEmpty(), names, { draft = draft.copy(returnValue = it) }, supporting = "The parameter or variable whose final value the function returns", emptyLabel = "Nothing")

    SectionCard("Test run") {
      if (parameters.isEmpty()) Text("This function takes nothing in.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      parameters.forEach { parameter ->
        val name = parameter.name.orEmpty()
        OutlinedTextField(testArgs[name].orEmpty(), { testArgs = testArgs + (name to it) }, label = { Text(name) }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("test-arg-$name"))
      }
      OutlinedButton(onClick = ::runTest, modifier = Modifier.testTag("test-run")) { Text("Run") }
      testResult?.let { NoticeBanner(it, if (it.startsWith("Error")) StatusTone.WARNING else StatusTone.SUCCESS, Modifier.testTag("test-result")) }
    }

    Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      OutlinedButton(onClick = { context.back() }) { Text("Cancel") }
      Button(
        onClick = {
          runner.run(if (functionId == null) "Function added." else "Function saved.", onDone = { context.back() }) { api.saveFunction(functionId, draft) }
        },
        enabled = canEdit && !runner.busy && draft.name.orEmpty().isNotBlank() && !nameTaken,
        modifier = Modifier.testTag("function-save"),
      ) { Text("Done") }
    }
  }
}

/**
 * What a VISITOR meets for one parameter: the label above the input, what it starts with, and, for a question
 * with fixed answers, the choices, one row each (AGL-3768). Empty fields are dropped from the definition
 * rather than stored as empty strings. "Starts as" is picked wherever there is a list to pick from: the
 * choices when there are any, On or Off for a true/false.
 */
@Composable
private fun ParameterAudience(parameter: HostFunctionParameter, onChange: (HostFunctionParameter) -> Unit) {
  val options = parameter.options.orEmpty()
  val startsAs: List<InputChoice>? = when {
    parameter.type == FunctionValueType.BOOLEAN -> listOf(InputChoice("true", "On"), InputChoice("false", "Off"))
    options.isNotEmpty() -> options.map { InputChoice(it.value, it.label ?: it.value) }
    else -> null
  }
  Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
    OutlinedTextField(parameter.label.orEmpty(), { onChange(parameter.copy(label = it.take(80).ifEmpty { null })) }, label = { Text("Label") }, placeholder = { Text(parameter.name.orEmpty()) }, singleLine = true, modifier = Modifier.weight(2f))
    if (startsAs != null) {
      ChoiceField(
        "Starts as",
        parameter.defaultValue?.takeIf { start -> startsAs.any { it.value == start } }.orEmpty(),
        startsAs,
        { onChange(parameter.copy(defaultValue = it.ifEmpty { null })) },
        Modifier.weight(1f),
        emptyLabel = "Nothing chosen",
      )
    } else {
      OutlinedTextField(
        parameter.defaultValue.orEmpty(),
        { typed -> onChange(parameter.copy(defaultValue = (if (parameter.type == FunctionValueType.NUMBER) typed.filter { ch -> ch.isDigit() || ch in ".-" } else typed.take(120)).ifEmpty { null })) },
        label = { Text("Starts as") },
        singleLine = true,
        keyboardOptions = if (parameter.type == FunctionValueType.NUMBER) KeyboardOptions(keyboardType = KeyboardType.Decimal) else KeyboardOptions.Default,
        modifier = Modifier.weight(1f),
      )
    }
  }
  if (parameter.type != FunctionValueType.BOOLEAN) {
    ParameterChoicesEditor(parameter.name.orEmpty(), parameter.type ?: FunctionValueType.NUMBER, parameter.options, onChange = { next ->
      var updated = parameter.copy(options = next.ifEmpty { null })
      // A start that is no longer a choice would preselect nothing.
      if (next.isNotEmpty() && updated.defaultValue != null && next.none { it.value == updated.defaultValue }) updated = updated.copy(defaultValue = null)
      onChange(updated)
    })
  }
}

@Composable
private fun OperationEditor(
  index: Int,
  operation: FunctionConditionalOperation,
  names: List<InputChoice>,
  formulaNames: List<FormulaName>,
  loadSiteVariables: () -> Unit,
  onRemove: () -> Unit,
  onChange: (FunctionConditionalOperation) -> Unit,
) {
  val condition = operation.`if` ?: FunctionConditionalOperationIf(comparator = FunctionComparator.LESS_THAN_OR_EQUAL, left = "", right = "")
  Column(verticalArrangement = Arrangement.spacedBy(space(1f)), modifier = Modifier.testTag("operation-$index")) {
    Row(verticalAlignment = Alignment.CenterVertically) {
      Text("If", style = MaterialTheme.typography.labelLarge, modifier = Modifier.weight(1f))
      WithTooltip("Remove operation ${index + 1}") { IconButton(onClick = onRemove) { Icon(AglynIcons.named("delete"), contentDescription = "Remove operation ${index + 1}") } }
    }
    Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
      OutlinedTextField(condition.left, { onChange(operation.copy(`if` = condition.copy(left = it))) }, placeholder = { Text("P1") }, singleLine = true, modifier = Modifier.weight(2f))
      FormulaBuilderButton(condition.left, formulaNames, { onChange(operation.copy(`if` = condition.copy(left = it))) }, onOpen = loadSiteVariables)
      ChoiceField(
        "Is",
        condition.comparator.raw,
        COMPARATORS.map { InputChoice(it.raw, it.raw) },
        { raw -> COMPARATORS.firstOrNull { it.raw == raw }?.let { onChange(operation.copy(`if` = condition.copy(comparator = it))) } },
        Modifier.weight(1f),
        allowEmpty = false,
      )
      OutlinedTextField(condition.right, { onChange(operation.copy(`if` = condition.copy(right = it))) }, placeholder = { Text("P2") }, singleLine = true, modifier = Modifier.weight(2f))
      FormulaBuilderButton(condition.right, formulaNames, { onChange(operation.copy(`if` = condition.copy(right = it))) }, onOpen = loadSiteVariables)
    }
    SetRows("Then do this", operation.then.orEmpty(), names, formulaNames, loadSiteVariables) { onChange(operation.copy(then = it)) }
    SetRows("Otherwise do this", operation.otherwise.orEmpty(), names, formulaNames, loadSiteVariables) { onChange(operation.copy(otherwise = it)) }
  }
}

/** A branch's SET rows: SET [name] equal to [expression]. */
@Composable
private fun SetRows(title: String, rows: List<FunctionSetOperation>, names: List<InputChoice>, formulaNames: List<FormulaName>, loadSiteVariables: () -> Unit, onChange: (List<FunctionSetOperation>) -> Unit) {
  Text(title, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
  rows.forEachIndexed { index, row ->
    fun put(next: FunctionSetOperation) = onChange(rows.toMutableList().also { it[index] = next })
    Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
      Text("SET", style = MaterialTheme.typography.labelSmall)
      ChoiceField("Name", row.set.orEmpty(), names, { put(row.copy(set = it)) }, Modifier.weight(1f))
      Text("=", style = MaterialTheme.typography.labelLarge)
      OutlinedTextField(row.expression.orEmpty(), { put(row.copy(expression = it)) }, placeholder = { Text("P1 + P2") }, singleLine = true, modifier = Modifier.weight(2f))
      FormulaBuilderButton(row.expression.orEmpty(), formulaNames, { put(row.copy(expression = it)) }, onOpen = loadSiteVariables)
      WithTooltip("Remove this row") { IconButton(onClick = { onChange(rows.filterIndexed { at, _ -> at != index }) }) { Icon(AglynIcons.named("close"), contentDescription = "Remove this row") } }
    }
  }
  TextButton(onClick = { onChange(rows + FunctionSetOperation(set = "", expression = "")) }) { Text("Add set") }
}
