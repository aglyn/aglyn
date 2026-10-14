package com.aglyn.pluginhost

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AssistChip
import androidx.compose.material3.AssistChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.InputChip
import androidx.compose.material3.InputChipDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.foundation.text.KeyboardOptions
import com.aglyn.contracts.ListFilterField
import com.aglyn.contracts.ListFilterKind
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.core.listquery.listFilterOperators
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.ChoiceField
import com.aglyn.ui.InputChoice
import com.aglyn.ui.MultiChoiceField
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space

/*
 * A list's filter clauses as the console's Filters panel holds them
 * (`{field, op, value}` over a list declaration's fields): one chip per
 * clause, "Add filter" to make one, and what the query did not apply, said
 * as the planner said it. The clauses go on the list's ONE Firestore query;
 * nothing here matches rows already loaded.
 */

/** How an operator reads on a chip (`listFilterOperatorLabel`, list-filter-sentence.ts). */
fun listFilterOperatorLabel(op: String): String = when (op) {
  "contains" -> "contains"
  "doesNotContain" -> "does not contain"
  "equals", "is", "=" -> "is"
  "doesNotEqual", "!=" -> "is not"
  "startsWith" -> "starts with"
  "endsWith" -> "ends with"
  "isAnyOf" -> "is any of"
  "isEmpty" -> "is empty"
  "isNotEmpty" -> "is set"
  "after" -> "after"
  "onOrAfter" -> "on or after"
  "before" -> "before"
  "onOrBefore" -> "on or before"
  ">" -> "over"
  ">=" -> "at least"
  "<" -> "under"
  "<=" -> "at most"
  else -> op
}

private val VALUELESS = setOf("isEmpty", "isNotEmpty")

/** A clause in words: "Category is any of Bread, Cake". */
fun clauseLabel(clause: ListFilterRequest, headers: Map<String, String>, choices: Map<String, List<InputChoice>>): String {
  val header = headers[clause.field] ?: clause.field
  if (clause.op in VALUELESS) return "$header ${listFilterOperatorLabel(clause.op)}"
  val named = clause.value.split(',').map { it.trim() }.filter { it.isNotEmpty() }
    .joinToString(", ") { value -> choices[clause.field]?.firstOrNull { it.value == value }?.label ?: value }
  return "$header ${listFilterOperatorLabel(clause.op)} $named"
}

/** One refusal the planner gave: the clause as typed (null for the search) and its reason. */
data class FilterRefusal(val clause: ListFilterRequest?, val reason: String)

/**
 * The clause chips, "Add filter", and the planner's refusals and notices.
 * [fields] are the declaration's filterable fields; [choices] the values a
 * select field offers.
 */
@Composable
fun ClauseFilterBar(
  fields: List<ListFilterField>,
  headers: Map<String, String>,
  choices: Map<String, List<InputChoice>>,
  clauses: List<ListFilterRequest>,
  onChange: (List<ListFilterRequest>) -> Unit,
  modifier: Modifier = Modifier,
  refused: List<FilterRefusal> = emptyList(),
  notices: List<String> = emptyList(),
) {
  var adding by remember { mutableStateOf(false) }
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    if (fields.isNotEmpty() || clauses.isNotEmpty()) {
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        clauses.forEachIndexed { index, clause ->
          val label = clauseLabel(clause, headers, choices)
          InputChip(
            selected = true,
            onClick = { onChange(clauses.filterIndexed { at, _ -> at != index }) },
            label = { Text(label) },
            trailingIcon = { Icon(AglynIcons.named("close"), contentDescription = "Remove filter $label", Modifier.size(InputChipDefaults.IconSize)) },
            modifier = Modifier.testTag("filter-chip-$index"),
          )
        }
        if (fields.isNotEmpty()) {
          AssistChip(
            onClick = { adding = true },
            label = { Text("Add filter") },
            leadingIcon = { Icon(AglynIcons.named("filter_list"), contentDescription = null, Modifier.size(AssistChipDefaults.IconSize)) },
            modifier = Modifier.testTag("add-filter"),
          )
        }
      }
    }
    for (refusal in refused) {
      val what = refusal.clause?.let { "“${clauseLabel(it, headers, choices)}”" } ?: "The search"
      NoticeBanner("$what was not applied: ${refusal.reason}.", StatusTone.WARNING)
    }
    for (notice in notices) NoticeBanner(notice, StatusTone.INFO)
  }
  if (adding) {
    AddClauseDialog(fields, headers, choices, onAdd = { onChange(clauses + it); adding = false }, onDismiss = { adding = false })
  }
}

@Composable
private fun AddClauseDialog(
  fields: List<ListFilterField>,
  headers: Map<String, String>,
  choices: Map<String, List<InputChoice>>,
  onAdd: (ListFilterRequest) -> Unit,
  onDismiss: () -> Unit,
) {
  var column by remember { mutableStateOf(fields.first().column) }
  val field = fields.firstOrNull { it.column == column } ?: fields.first()
  val operators = listFilterOperators(field)
  var op by remember(column) { mutableStateOf(operators.firstOrNull() ?: "equals") }
  var value by remember(column) { mutableStateOf("") }
  val offered = choices[column].orEmpty()
  val valueless = op in VALUELESS
  ActionDialog(
    title = "Add filter",
    confirmLabel = "Apply",
    confirmEnabled = valueless || value.isNotBlank(),
    icon = "filter_list",
    onDismiss = onDismiss,
    onConfirm = { onAdd(ListFilterRequest(field = column, op = op, value = if (valueless) "" else value.trim())) },
    modifier = Modifier.testTag("add-filter-dialog"),
  ) {
    ChoiceField(
      label = "Field",
      value = column,
      choices = fields.map { InputChoice(it.column, headers[it.column] ?: it.column) },
      onChange = { if (it.isNotEmpty()) column = it },
      allowEmpty = false,
    )
    ChoiceChipRow(operators.map { ChipOption(it, listFilterOperatorLabel(it)) }, op, { op = it }, wrap = true)
    when {
      valueless -> Unit
      offered.isNotEmpty() && op == "isAnyOf" -> MultiChoiceField(
        label = "Values",
        values = value.split(',').map { it.trim() }.filter { it.isNotEmpty() },
        choices = offered,
        onChange = { value = it.joinToString(",") },
      )
      offered.isNotEmpty() -> ChoiceField(label = "Value", value = value, choices = offered, onChange = { value = it }, allowEmpty = false)
      else -> OutlinedTextField(
        value,
        { value = it },
        label = { Text(if (op == "isAnyOf") "Values, separated by commas" else "Value") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = if (field.kind == ListFilterKind.NUMBER) KeyboardType.Decimal else KeyboardType.Text),
        modifier = Modifier.fillMaxWidth().testTag("filter-value"),
      )
    }
  }
}
