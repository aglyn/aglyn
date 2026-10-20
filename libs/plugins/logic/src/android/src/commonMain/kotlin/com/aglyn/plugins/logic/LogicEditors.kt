package com.aglyn.plugins.logic

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.FunctionValueType
import com.aglyn.contracts.HostFunctionParameterOption
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.ChoiceField
import com.aglyn.ui.InputChoice
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.TextButton
import com.aglyn.ui.WithTooltip
import com.aglyn.ui.space

/*
 * The Logic page's no-code editors as screens (AGL-3757, AGL-3768): the rows
 * a dictionary or list variable edits as, the "Build formula" dialog beside an
 * expression box, and a parameter's choices as rows. What each writes is the
 * text the console would have taken typed (LogicRows.kt).
 */

private val KIND_CHOICES = listOf(
  InputChoice(StructuredKind.TEXT.raw, "Text"),
  InputChoice(StructuredKind.NUMBER.raw, "Number"),
  InputChoice(StructuredKind.BOOLEAN.raw, "True/false"),
)

/**
 * A dictionary as a name / value table and a collection as a list: each row typed Text, Number or
 * True/false, written back as the JSON string the variable has always stored. The rows are this editor's
 * own state, so a row whose name is still being typed is not dropped mid-edit.
 */
@Composable
internal fun StructuredValueEditor(shape: StructuredShape, value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
  val initial = remember { parseStructuredValue(value, shape) }
  var rows by remember { mutableStateOf(initial.rows) }
  val duplicates = if (shape == StructuredShape.DICTIONARY) duplicateStructuredKeys(rows) else emptySet()
  fun commit(next: List<StructuredRow>) {
    rows = next
    onChange(serializeStructuredValue(next, shape))
  }
  fun update(index: Int, next: StructuredRow) = commit(rows.toMutableList().also { it[index] = next })
  val noun = if (shape == StructuredShape.DICTIONARY) "entry" else "item"
  Column(modifier.fillMaxWidth().testTag("variable-value"), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    Text(
      if (shape == StructuredShape.DICTIONARY) "Each entry is a name and its value. A function reads one as variable.name." else "Each item is one value in the list, in order.",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
    if (initial.unreadable) {
      NoticeBanner("The saved value could not be read as a ${if (shape == StructuredShape.DICTIONARY) "set of entries" else "list"}. Add its values below; saving replaces it.", StatusTone.WARNING)
    }
    rows.forEachIndexed { index, row ->
      Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
        Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
          if (shape == StructuredShape.DICTIONARY) {
            val twice = row.key.trim() in duplicates
            OutlinedTextField(
              row.key,
              { update(index, row.copy(key = it)) },
              label = { Text("Entry name") },
              isError = twice,
              supportingText = if (twice) ({ Text("Used twice — the last one wins") }) else null,
              singleLine = true,
              modifier = Modifier.weight(1f).testTag("entry-name-$index"),
            )
          } else {
            Text("${index + 1}", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.widthIn(min = 20.dp))
          }
          WithTooltip("Remove $noun ${index + 1}") { IconButton(onClick = { commit(rows.filterIndexed { at, _ -> at != index }) }) {
            Icon(AglynIcons.named("close"), contentDescription = "Remove $noun ${index + 1}")
          } }
        }
        if (row.kind == StructuredKind.KEPT) {
          Text("A nested list or set of entries — kept as it is", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
          Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
            ChoiceField(
              "Type",
              row.kind.raw,
              KIND_CHOICES,
              { raw ->
                val kind = StructuredKind.entries.first { it.raw == raw }
                update(index, row.copy(kind = kind, value = if (kind == StructuredKind.BOOLEAN) (if (row.value == "true") "true" else "false") else if (row.kind == StructuredKind.BOOLEAN) "" else row.value))
              },
              Modifier.weight(2f),
              allowEmpty = false,
            )
            if (row.kind == StructuredKind.BOOLEAN) {
              SwitchRow("Value", row.value == "true", { update(index, row.copy(value = if (it) "true" else "false")) }, Modifier.weight(3f), supporting = if (row.value == "true") "True" else "False")
            } else {
              OutlinedTextField(
                row.value,
                { typed -> update(index, row.copy(value = if (row.kind == StructuredKind.NUMBER) typed.filter { ch -> ch.isDigit() || ch in ".eE+-" } else typed)) },
                label = { Text("Value") },
                singleLine = true,
                keyboardOptions = if (row.kind == StructuredKind.NUMBER) KeyboardOptions(keyboardType = KeyboardType.Decimal) else KeyboardOptions.Default,
                modifier = Modifier.weight(3f).testTag("entry-value-$index"),
              )
            }
          }
        }
      }
    }
    TextButton(onClick = { commit(rows + StructuredRow("", StructuredKind.TEXT, "")) }, modifier = Modifier.testTag("entry-add")) { Text(if (shape == StructuredShape.DICTIONARY) "Add entry" else "Add item") }
  }
}

private val SOURCE_CHOICES = listOf(
  InputChoice("name", "A value"),
  InputChoice("number", "A number"),
  InputChoice("text", "Some text"),
  InputChoice("current", "What is there now"),
)

private val SEPARATORS = listOf(" " to "A space", ", " to "A comma", " - " to "A dash", "" to "Nothing")
private val SYMBOLS = listOf("$", "€", "£", "¥", "")

private fun FormulaOperand.source(): String = when (this) {
  is FormulaOperand.Name -> "name"
  is FormulaOperand.Number -> "number"
  is FormulaOperand.Text -> "text"
  FormulaOperand.Current -> "current"
}

/** The ƒx "Build formula" button beside an expression box. [onOpen] runs as the dialog opens, where a caller loads names it reads lazily. */
@Composable
internal fun FormulaBuilderButton(current: String, names: List<FormulaName>, onUse: (String) -> Unit, modifier: Modifier = Modifier, onOpen: () -> Unit = {}) {
  var open by remember { mutableStateOf(false) }
  WithTooltip("Build formula", modifier) {
    IconButton(onClick = { onOpen(); open = true }, modifier = Modifier.semantics { contentDescription = "Build formula" }.testTag("formula-open")) {
      Text("ƒx", fontStyle = FontStyle.Italic, fontWeight = FontWeight.SemiBold)
    }
  }
  if (open) FormulaBuilderDialog(current, names, onUse = { onUse(it); open = false }, onClose = { open = false })
}

/**
 * The "Build formula" dialog: pick what to work out — add, smallest of, format as money — and the values it
 * works on, and the box gets the expression that does it. Nothing is typed but numbers and text.
 */
@Composable
private fun FormulaBuilderDialog(current: String, names: List<FormulaName>, onUse: (String) -> Unit, onClose: () -> Unit) {
  var draft by remember { mutableStateOf(formulaDraftFor(if (current.isNotBlank()) FormulaOperation.ADD else FormulaOperation.VALUE, null, current)) }
  val operation = draft.operation
  val expression = buildFormula(draft, current)
  val nameChoices = names.map { InputChoice(it.value, "${it.label}  ·  ${it.group}") }
  fun setOperand(index: Int, operand: FormulaOperand) { draft = draft.copy(operands = draft.operands.toMutableList().also { it[index] = operand }) }
  ActionDialog(
    title = "Build formula",
    confirmLabel = "Use formula",
    confirmEnabled = expression != null,
    dismissLabel = "Cancel",
    onConfirm = { expression?.let(onUse) },
    onDismiss = onClose,
    modifier = Modifier.testTag("formula-builder"),
  ) {
    Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
      ChoiceField(
        "Work out",
        operation.raw,
        FormulaOperation.entries.map { InputChoice(it.raw, it.label) },
        { raw -> draft = formulaDraftFor(FormulaOperation.entries.first { it.raw == raw }, draft, current) },
        allowEmpty = false,
      )
      draft.operands.forEachIndexed { index, operand ->
        Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
          Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
            ChoiceField(
              formulaOperandLabel(operation, index),
              operand.source(),
              if (current.isBlank()) SOURCE_CHOICES.filter { it.value != "current" } else SOURCE_CHOICES,
              { source ->
                setOperand(
                  index,
                  when (source) {
                    "name" -> FormulaOperand.Name("")
                    "current" -> FormulaOperand.Current
                    "number" -> FormulaOperand.Number("")
                    else -> FormulaOperand.Text("")
                  },
                )
              },
              Modifier.weight(1f),
              allowEmpty = false,
            )
            if (operation.variadic && index >= operation.minOperands) {
              WithTooltip("Remove ${formulaOperandLabel(operation, index)}") { IconButton(onClick = { draft = draft.copy(operands = draft.operands.filterIndexed { at, _ -> at != index }) }) {
                Icon(AglynIcons.named("close"), contentDescription = "Remove ${formulaOperandLabel(operation, index)}")
              } }
            }
          }
          when (operand) {
            is FormulaOperand.Name -> ChoiceField(
              "Which",
              operand.name.takeIf { picked -> names.any { it.value == picked } }.orEmpty(),
              nameChoices,
              { setOperand(index, FormulaOperand.Name(it)) },
              emptyLabel = if (names.isEmpty()) "Nothing to pick yet" else "—",
            )
            is FormulaOperand.Number -> OutlinedTextField(
              operand.value,
              { setOperand(index, FormulaOperand.Number(it.filter { ch -> ch.isDigit() || ch in ".-" })) },
              label = { Text("Number") },
              singleLine = true,
              keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
              modifier = Modifier.fillMaxWidth(),
            )
            is FormulaOperand.Text -> OutlinedTextField(operand.value, { setOperand(index, FormulaOperand.Text(it)) }, label = { Text("Text") }, singleLine = true, modifier = Modifier.fillMaxWidth())
            FormulaOperand.Current -> Text("The formula already in the box", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
          }
        }
      }
      if (operation.variadic) {
        TextButton(onClick = { draft = draft.copy(operands = draft.operands + if (operation == FormulaOperation.JOIN) FormulaOperand.Text("") else FormulaOperand.Name("")) }) { Text("Add another") }
      }
      if (operation == FormulaOperation.CURRENCY) {
        ChoiceField("Sign", draft.symbol ?: "$", SYMBOLS.map { InputChoice(it, it.ifEmpty { "None" }) }, { draft = draft.copy(symbol = it) }, allowEmpty = false)
      }
      if (operation.places) {
        ChoiceField(
          "Decimal places",
          "${draft.places ?: if (operation == FormulaOperation.CURRENCY) 2 else 0}",
          (0..4).map { InputChoice("$it", "$it") },
          { draft = draft.copy(places = it.toInt()) },
          allowEmpty = false,
        )
      }
      if (operation == FormulaOperation.JOIN) {
        ChoiceField("Between each", draft.separator ?: " ", SEPARATORS.map { InputChoice(it.first, it.second) }, { draft = draft.copy(separator = it) }, allowEmpty = false)
      }
      Text(
        if (expression != null) "The box will read: $expression" else "Choose every value to finish the formula.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.testTag("formula-preview"),
      )
    }
  }
}

/**
 * A parameter's choices as rows (AGL-3768): what the function receives and what a visitor reads, one choice per
 * row. The rows are this editor's own state, so a choice whose value is still blank is not dropped mid-edit.
 */
@Composable
internal fun ParameterChoicesEditor(parameterName: String, type: FunctionValueType, options: List<HostFunctionParameterOption>?, onChange: (List<HostFunctionParameterOption>) -> Unit, modifier: Modifier = Modifier) {
  var rows by remember { mutableStateOf(choiceRowsFromOptions(options)) }
  fun commit(next: List<ParameterChoiceRow>) {
    rows = next
    onChange(optionsFromChoiceRows(next))
  }
  fun update(index: Int, next: ParameterChoiceRow) = commit(rows.toMutableList().also { it[index] = next })
  fun duplicate(index: Int): Boolean {
    val value = rows[index].value.trim()
    return value.isNotEmpty() && rows.indexOfFirst { it.value.trim() == value } < index
  }
  Column(modifier.fillMaxWidth().padding(top = space(0.5f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    rows.forEachIndexed { index, row ->
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.Top) {
        OutlinedTextField(
          row.value,
          { typed -> update(index, row.copy(value = if (type == FunctionValueType.NUMBER) typed.filter { ch -> ch.isDigit() || ch in ".-" } else typed.take(120))) },
          label = { Text("Function gets") },
          isError = duplicate(index),
          supportingText = if (duplicate(index)) ({ Text("Already a choice") }) else null,
          singleLine = true,
          keyboardOptions = if (type == FunctionValueType.NUMBER) KeyboardOptions(keyboardType = KeyboardType.Decimal) else KeyboardOptions.Default,
          modifier = Modifier.weight(1f),
        )
        OutlinedTextField(
          row.label,
          { update(index, row.copy(label = it.take(80))) },
          label = { Text("Visitors see") },
          placeholder = { Text(row.value) },
          singleLine = true,
          modifier = Modifier.weight(2f),
        )
        WithTooltip("Remove choice ${index + 1} of ${parameterName.ifEmpty { "parameter" }}") { IconButton(onClick = { commit(rows.filterIndexed { at, _ -> at != index }) }) {
          Icon(AglynIcons.named("close"), contentDescription = "Remove choice ${index + 1} of ${parameterName.ifEmpty { "parameter" }}")
        } }
      }
    }
    Row(verticalAlignment = Alignment.CenterVertically) {
      TextButton(onClick = { commit(rows + ParameterChoiceRow("", "")) }, modifier = Modifier.testTag("choice-add")) { Text("Add choice") }
      if (rows.isEmpty()) Text("Give it choices to ask it as a list.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}
