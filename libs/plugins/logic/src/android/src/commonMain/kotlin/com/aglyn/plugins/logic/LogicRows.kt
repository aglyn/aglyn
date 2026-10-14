package com.aglyn.plugins.logic

import com.aglyn.contracts.HostFunction
import com.aglyn.contracts.HostFunctionParameterOption
import com.aglyn.contracts.expressionIdentifiers
import com.aglyn.pluginhost.jsNumber
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/*
 * The Logic page's no-code editors: a dictionary or list variable as rows, a
 * function step's formula built by picking, and a parameter's choices as
 * rows (AGL-3757, AGL-3768). Ports of the console's pure modules
 * (structured-value.ts, formula.ts, formula-names.ts, parameter-choice-rows.ts);
 * LogicCasesTest replays their answers. What they write is the text the
 * console would have taken typed, so a stored value is unchanged.
 */

/* ---- Dictionary and list variables as rows ---- */

enum class StructuredShape { DICTIONARY, COLLECTION }

enum class StructuredKind(val raw: String) { TEXT("text"), NUMBER("number"), BOOLEAN("boolean"), KEPT("kept") }

/** One entry; [kept] is a nested value the rows cannot edit, carried through untouched. */
data class StructuredRow(val key: String, val kind: StructuredKind, val value: String, val kept: JsonElement? = null)

data class ParsedStructuredValue(val rows: List<StructuredRow>, val unreadable: Boolean)

private val ARRAY_INDEX = Regex("^(0|[1-9][0-9]{0,9})$")

/** The order JavaScript walks an object's keys in: array indexes ascending, then the rest as written. */
internal fun jsKeyOrder(keys: Collection<String>): List<String> {
  val indexes = keys.filter { ARRAY_INDEX.matches(it) && it.toLong() < 4294967295L }.sortedBy { it.toLong() }
  return indexes + keys.filter { it !in indexes }
}

private fun rowFor(key: String, value: JsonElement): StructuredRow = when {
  value is JsonNull -> StructuredRow(key, StructuredKind.TEXT, "")
  value is JsonPrimitive && value.isString -> StructuredRow(key, StructuredKind.TEXT, value.content)
  value is JsonPrimitive && value.booleanOrNull != null -> StructuredRow(key, StructuredKind.BOOLEAN, if (value.booleanOrNull == true) "true" else "false")
  value is JsonPrimitive && value.doubleOrNull?.isFinite() == true -> StructuredRow(key, StructuredKind.NUMBER, jsNumber(value.doubleOrNull!!))
  else -> StructuredRow(key, StructuredKind.KEPT, value.toString(), value)
}

/** The rows a stored dictionary or collection value reads as; [ParsedStructuredValue.unreadable] when it is not that shape. */
fun parseStructuredValue(raw: String?, shape: StructuredShape): ParsedStructuredValue {
  val text = (raw ?: "").trim()
  if (text.isEmpty()) return ParsedStructuredValue(emptyList(), false)
  val parsed = try {
    Json.parseToJsonElement(text)
  } catch (_: Exception) {
    return ParsedStructuredValue(emptyList(), true)
  }
  if (shape == StructuredShape.COLLECTION) {
    if (parsed !is JsonArray) return ParsedStructuredValue(emptyList(), true)
    return ParsedStructuredValue(parsed.map { rowFor("", it) }, false)
  }
  if (parsed !is JsonObject) return ParsedStructuredValue(emptyList(), true)
  return ParsedStructuredValue(jsKeyOrder(parsed.keys).map { key -> rowFor(key, parsed.getValue(key)) }, false)
}

/** One row's stored value as JSON text. A number box that does not hold a number stores nothing (null). */
private fun rowJson(row: StructuredRow): String = when (row.kind) {
  StructuredKind.NUMBER -> {
    val text = row.value.trim()
    val number = if (text.isEmpty()) null else jsNumberOf(text)
    if (number != null && number.isFinite()) jsNumber(number) else "null"
  }
  StructuredKind.BOOLEAN -> if (row.value == "true") "true" else "false"
  StructuredKind.KEPT -> (row.kept ?: JsonNull).toString()
  StructuredKind.TEXT -> JsonPrimitive(row.value).toString()
}

/** JavaScript's `Number(text)` for a trimmed, non-empty text; null where it would be NaN. */
private fun jsNumberOf(text: String): Double? = when {
  text.startsWith("0x") || text.startsWith("0X") -> text.drop(2).toLongOrNull(16)?.toDouble()
  text == "Infinity" || text == "+Infinity" -> Double.POSITIVE_INFINITY
  text == "-Infinity" -> Double.NEGATIVE_INFINITY
  text.any { it.isLetter() && it != 'e' && it != 'E' } -> null
  else -> text.toDoubleOrNull()
}

/**
 * The JSON string rows store as. A dictionary drops rows without a key and keeps the LAST row of a
 * repeated key, as reading the JSON back would.
 */
fun serializeStructuredValue(rows: List<StructuredRow>, shape: StructuredShape): String {
  if (shape == StructuredShape.COLLECTION) return rows.joinToString(",", "[", "]") { rowJson(it) }
  val entries = LinkedHashMap<String, String>()
  for (row in rows) {
    val key = row.key.trim()
    if (key.isNotEmpty()) entries[key] = rowJson(row)
  }
  return jsKeyOrder(entries.keys).joinToString(",", "{", "}") { key -> "${JsonPrimitive(key)}:${entries.getValue(key)}" }
}

/** The dictionary keys used more than once, which the editor flags. */
fun duplicateStructuredKeys(rows: List<StructuredRow>): Set<String> {
  val seen = HashSet<String>()
  val duplicates = LinkedHashSet<String>()
  for (row in rows) {
    val key = row.key.trim()
    if (key.isEmpty()) continue
    if (!seen.add(key)) duplicates += key
  }
  return duplicates
}

/* ---- A formula built by picking ---- */

enum class FormulaOperation(val raw: String, val label: String, val minOperands: Int, val variadic: Boolean, val operandLabels: List<String>, val places: Boolean = false) {
  VALUE("value", "Use a value", 1, false, listOf("Value")),
  ADD("add", "Add", 2, true, listOf("Value", "Plus")),
  SUBTRACT("subtract", "Subtract", 2, false, listOf("Value", "Minus")),
  MULTIPLY("multiply", "Multiply", 2, true, listOf("Value", "Times")),
  DIVIDE("divide", "Divide", 2, false, listOf("Value", "Divided by")),
  MIN("min", "Smallest of", 2, true, listOf("Value", "Or")),
  MAX("max", "Largest of", 2, true, listOf("Value", "Or")),
  ROUND("round", "Round", 1, false, listOf("Value"), places = true),
  ROUND_DOWN("roundDown", "Round down", 1, false, listOf("Value")),
  ROUND_UP("roundUp", "Round up", 1, false, listOf("Value")),
  ABSOLUTE("absolute", "Without its minus sign", 1, false, listOf("Value")),
  CURRENCY("currency", "Format as money", 1, false, listOf("Amount"), places = true),
  NUMBER("number", "Format with thousands separators", 1, false, listOf("Number"), places = true),
  JOIN("join", "Join text", 2, true, listOf("Text", "Then")),
}

/** One value an operation works on. */
sealed interface FormulaOperand {
  /** A parameter, a local variable, a site variable or a dictionary member. */
  data class Name(val name: String) : FormulaOperand
  data class Number(val value: String) : FormulaOperand
  data class Text(val value: String) : FormulaOperand

  /** Whatever the box holds already, so formulas can be layered. */
  data object Current : FormulaOperand
}

data class FormulaDraft(
  val operation: FormulaOperation,
  val operands: List<FormulaOperand>,
  /** Decimal places for round, currency and number. */
  val places: Int? = null,
  /** The sign written before a currency amount. */
  val symbol: String? = null,
  /** What goes between joined texts. */
  val separator: String? = null,
)

/** The label for a value box at [index] of [operation]; the last label repeats. */
fun formulaOperandLabel(operation: FormulaOperation, index: Int): String = operation.operandLabels[minOf(index, operation.operandLabels.size - 1)]

/** A text as the evaluator reads it. Its strings have no escapes, so the quote the text does not contain is used. */
private fun quoteText(value: String): String = when {
  '\'' !in value -> "'$value'"
  '"' !in value -> "\"$value\""
  else -> "'${value.replace("\"", "")}'"
}

private val SIMPLE_EXPRESSION = Regex("^\\s*(?:-?[0-9]*\\.?[0-9]+|[a-zA-Z_][a-zA-Z0-9_.]*)\\s*$")

/** One operand as expression text, or null while it is still blank. [bare] is a built-in's argument. */
private fun operandText(operand: FormulaOperand, current: String, bare: Boolean): String? = when (operand) {
  is FormulaOperand.Name -> operand.name.ifEmpty { null }
  is FormulaOperand.Number -> {
    val text = operand.value.trim()
    val parsed = if (text.isEmpty()) null else jsNumberOf(text)
    if (parsed != null && parsed.isFinite()) jsNumber(parsed) else null
  }
  is FormulaOperand.Text -> quoteText(operand.value)
  FormulaOperand.Current -> {
    val text = current.trim()
    if (text.isEmpty()) null else if (bare || SIMPLE_EXPRESSION.matches(text)) text else "($text)"
  }
}

private fun placesOf(draft: FormulaDraft, fallback: Int): Int = draft.places?.takeIf { it in 0..6 } ?: fallback

/** The expression a draft writes, or null while a value it needs is blank. [current] is what the box held when the builder opened. */
fun buildFormula(draft: FormulaDraft, current: String = ""): String? {
  val spec = draft.operation
  val operands = draft.operands.take(if (spec.variadic) draft.operands.size else spec.minOperands)
  if (operands.size < spec.minOperands) return null
  val arithmetic = draft.operation in setOf(FormulaOperation.ADD, FormulaOperation.SUBTRACT, FormulaOperation.MULTIPLY, FormulaOperation.DIVIDE, FormulaOperation.JOIN)
  val values = operands.map { operandText(it, current, !arithmetic && draft.operation != FormulaOperation.VALUE) ?: return null }
  val first = values[0]
  return when (draft.operation) {
    FormulaOperation.VALUE -> first
    FormulaOperation.ADD -> values.joinToString(" + ")
    FormulaOperation.SUBTRACT -> values.joinToString(" - ")
    FormulaOperation.MULTIPLY -> values.joinToString(" * ")
    FormulaOperation.DIVIDE -> values.joinToString(" / ")
    FormulaOperation.MIN -> "min(${values.joinToString(", ")})"
    FormulaOperation.MAX -> "max(${values.joinToString(", ")})"
    FormulaOperation.ROUND -> "round($first, ${placesOf(draft, 0)})"
    FormulaOperation.ROUND_DOWN -> "floor($first)"
    FormulaOperation.ROUND_UP -> "ceil($first)"
    FormulaOperation.ABSOLUTE -> "abs($first)"
    FormulaOperation.CURRENCY -> "${quoteText(draft.symbol ?: "$")} + format($first, ${placesOf(draft, 2)})"
    FormulaOperation.NUMBER -> "format($first, ${placesOf(draft, 0)})"
    // A leading '' keeps two numbers joined as text rather than added.
    FormulaOperation.JOIN -> {
      val separator = draft.separator ?: " "
      if (separator.isNotEmpty()) values.joinToString(" + ${quoteText(separator)} + ") else (listOf("''") + values).joinToString(" + ")
    }
  }
}

/** A fresh draft for [operation], carrying over the values already chosen. */
fun formulaDraftFor(operation: FormulaOperation, previous: FormulaDraft? = null, current: String = ""): FormulaDraft {
  fun blank(index: Int): FormulaOperand = when {
    index == 0 && current.trim().isNotEmpty() -> FormulaOperand.Current
    operation == FormulaOperation.JOIN -> FormulaOperand.Text("")
    else -> FormulaOperand.Name("")
  }
  return FormulaDraft(
    operation,
    List(operation.minOperands) { index -> previous?.operands?.getOrNull(index) ?: blank(index) },
    previous?.places,
    previous?.symbol,
    previous?.separator,
  )
}

/* ---- The names a formula can read ---- */

/** A name a formula can read, grouped the way the picker lists it. */
data class FormulaName(val value: String, val label: String, val group: String)

private val VALID_NAME = Regex("^[a-zA-Z_][a-zA-Z0-9_]{0,39}$")

/** A site variable as the picker reads one. */
data class SiteVariableName(val name: String?, val type: String?, val value: String?)

/** `localeCompare` for identifiers: punctuation before digits before letters, letters ignoring case (lower first on a tie). */
private fun identifierOrder(a: String, b: String): Int {
  fun rank(c: Char) = when {
    c == '_' -> 0
    c.isDigit() -> 1
    else -> 2
  }
  for (i in 0 until minOf(a.length, b.length)) {
    val x = a[i]
    val y = b[i]
    if (x == y) continue
    val byClass = rank(x) - rank(y)
    if (byClass != 0) return byClass
    val byLetter = x.lowercaseChar().compareTo(y.lowercaseChar())
    if (byLetter != 0) return byLetter
  }
  if (a.length != b.length) return a.length - b.length
  for (i in a.indices) if (a[i] != b[i]) return if (a[i].isLowerCase()) -1 else 1
  return 0
}

/**
 * Everything a function's formula can read, in the order the evaluator resolves a clash: its parameters, its
 * own variables, then the site's variables, each dictionary's members listed under it as `name.member`.
 */
fun formulaNames(parameters: List<String>, locals: List<String>, siteVariables: List<SiteVariableName>): List<FormulaName> {
  val names = mutableListOf<FormulaName>()
  val seen = HashSet<String>()
  fun push(value: String, label: String, group: String) {
    if (seen.add(value)) names += FormulaName(value, label, group)
  }
  for (name in parameters) if (VALID_NAME.matches(name)) push(name, name, "Parameters")
  for (name in locals) if (VALID_NAME.matches(name)) push(name, name, "This function’s variables")
  for (variable in siteVariables.sortedWith { a, b -> identifierOrder(a.name.orEmpty(), b.name.orEmpty()) }) {
    val name = variable.name.orEmpty()
    if (!VALID_NAME.matches(name)) continue
    if (variable.type == "collection") continue
    if (variable.type != "dictionary") {
      push(name, name, "Site variables")
      continue
    }
    val entries = (runCatching { Json.parseToJsonElement(variable.value.orEmpty()) }.getOrNull() as? JsonObject) ?: continue
    for (member in jsKeyOrder(entries.keys)) {
      if (!VALID_NAME.matches(member)) continue
      val value = entries.getValue(member)
      if (value !is JsonPrimitive || value is JsonNull) continue
      push("$name.$member", "$name → $member", "Site variables")
    }
  }
  return names
}

/* ---- A parameter's choices as rows ---- */

/** One row of the choices editor, blanks and all, as the author sees it. */
data class ParameterChoiceRow(val value: String, val label: String)

fun choiceRowsFromOptions(options: List<HostFunctionParameterOption>?): List<ParameterChoiceRow> =
  options.orEmpty().map { ParameterChoiceRow(it.value, it.label.orEmpty()) }

/**
 * The choice list rows store as (AGL-3768). A row with no value is not a choice yet; the second row of a
 * value is dropped; a label equal to its value is not stored.
 */
fun optionsFromChoiceRows(rows: List<ParameterChoiceRow>): List<HostFunctionParameterOption> {
  val options = mutableListOf<HostFunctionParameterOption>()
  val seen = HashSet<String>()
  for (row in rows) {
    val value = row.value.trim()
    if (value.isEmpty() || !seen.add(value)) continue
    val label = row.label.trim()
    options += if (label.isNotEmpty() && label != value) HostFunctionParameterOption(label = label, value = value) else HostFunctionParameterOption(value = value)
  }
  return options
}

/* ---- A test run's view of the site ---- */

/** The OUTSIDE names a function reads: every identifier in its conditions and expressions that is not its own parameter or local. */
fun functionReferencedNames(definition: HostFunction): List<String> {
  val own = (definition.parameters.orEmpty().mapNotNull { it.name } + definition.variables.orEmpty().mapNotNull { it.name }).toSet()
  val names = LinkedHashSet<String>()
  fun read(text: String?) {
    for (name in expressionIdentifiers(text.orEmpty())) if (name !in own) names += name
  }
  for (operation in definition.operations.orEmpty()) {
    read(operation.`if`?.left)
    read(operation.`if`?.right)
    for (set in operation.then.orEmpty() + operation.otherwise.orEmpty()) read(set.expression)
  }
  return names.toList()
}

/**
 * The site variables ONE function reads, by name, typed as the evaluator reads them: a number as a number, a
 * true/false as a boolean, anything else as its text (a dictionary stays its JSON, read by `name.member`).
 */
fun functionGlobals(definition: HostFunction, variables: List<SiteVariableName>): Map<String, Any> {
  val scope = LinkedHashMap<String, Any>()
  for (variable in variables) {
    val name = variable.name?.ifEmpty { null } ?: continue
    scope[name] = when (variable.type) {
      "number" -> variable.value?.let { it.trim().let { text -> if (text.isEmpty()) 0.0 else jsNumberOf(text) ?: Double.NaN } } ?: 0.0
      "boolean" -> variable.value == "true"
      else -> variable.value.orEmpty()
    }
  }
  val globals = LinkedHashMap<String, Any>()
  for (name in functionReferencedNames(definition)) if (name in scope) globals[name] = scope.getValue(name)
  return globals
}
