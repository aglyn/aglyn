package com.aglyn.contracts

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

/*
 * THE SITE-FUNCTIONS LANGUAGE (libs/aglyn app-utils/functions.ts and the
 * workflows plugin's model/workflows.ts), ported once for every native area
 * that evaluates it: a workflow's test run in Automation, and the Logic
 * area's functions. A no-code function is parameters, locals, conditional
 * SETs and a return value; its expressions are arithmetic over declared
 * names, literals, `+ - * / ( )`, a closed table of built-ins and dictionary
 * members. No loops, a bounded operation count.
 *
 * Every value is a Double, a String or a Boolean, and every conversion is
 * JavaScript's (JsValues.kt), so an expression answers on the phone exactly
 * what it answers in the browser and on the server. The error messages are
 * the TypeScript's, word for word: function-cases.generated.json replays them.
 */

/** Why an expression or a function could not be evaluated, in the console's words. */
class SiteFunctionError(message: String) : Exception(message)

/** How many SETs one run may apply (`FUNCTION_MAX_OPERATIONS`). */
const val FUNCTION_MAX_OPERATIONS = 1000

/** The longest workflow (`WORKFLOW_MAX_STEPS`). */
const val WORKFLOW_MAX_STEPS = 25

/** How deep workflow → function → workflow calls may nest (`CROSS_MAX_DEPTH`). */
const val CROSS_MAX_DEPTH = 3

private const val MAX_CALL_ARGUMENTS = 16
private const val MAX_DIGITS = 10

// ── Tokens ────────────────────────────────────────────────────────────────

private sealed interface Token {
  data class Num(val value: Double) : Token
  data class Str(val value: String) : Token
  data class Bool(val value: Boolean) : Token
  data class Ident(val value: String) : Token
  data class Op(val value: Char) : Token
  data object LParen : Token
  data object RParen : Token
  data object Comma : Token
}

private val NUMBER = Regex("^[0-9]*\\.?[0-9]+")
private val IDENT = Regex("^[a-zA-Z_][a-zA-Z0-9_]*(?:\\.[a-zA-Z_][a-zA-Z0-9_]*)*")

private fun isIdentStart(c: Char) = c in 'a'..'z' || c in 'A'..'Z' || c == '_'

private fun tokenize(text: String): List<Token> {
  val tokens = mutableListOf<Token>()
  var index = 0
  while (index < text.length) {
    val char = text[index]
    when {
      char.isWhitespace() || char == '﻿' -> index += 1
      char in "+-*/" -> { tokens += Token.Op(char); index += 1 }
      char == '(' -> { tokens += Token.LParen; index += 1 }
      char == ')' -> { tokens += Token.RParen; index += 1 }
      char == ',' -> { tokens += Token.Comma; index += 1 }
      char == '\'' || char == '"' -> {
        val end = text.indexOf(char, index + 1)
        if (end < 0) throw SiteFunctionError("Unterminated string")
        tokens += Token.Str(text.substring(index + 1, end))
        index = end + 1
      }
      char in '0'..'9' || char == '.' -> {
        val match = NUMBER.find(text.substring(index)) ?: throw SiteFunctionError("Bad number at \"${text.substring(index)}\"")
        tokens += Token.Num(jsStringToNumber(match.value))
        index += match.value.length
      }
      isIdentStart(char) -> {
        val word = IDENT.find(text.substring(index))!!.value
        tokens += if (word == "true" || word == "false") Token.Bool(word == "true") else Token.Ident(word)
        index += word.length
      }
      else -> throw SiteFunctionError("Unexpected character \"$char\"")
    }
  }
  return tokens
}

// ── Values ────────────────────────────────────────────────────────────────

/** `toNumber`: JavaScript's `Number(value)`, refusing what is not a finite number. */
fun siteToNumber(value: Any?): Double {
  val parsed = jsNumber(value)
  if (parsed.isNaN() || parsed.isInfinite()) throw SiteFunctionError("\"${jsString(value)}\" is not a number")
  return parsed
}

private fun digitsOf(value: Any?, present: Boolean): Int {
  if (!present) return 0
  val digits = siteToNumber(value).let { if (it < 0) ceil(it) else floor(it) }
  if (digits < 0 || digits > MAX_DIGITS) throw SiteFunctionError("Decimal places must be between 0 and $MAX_DIGITS")
  return digits.toInt()
}

/** Half away from zero on the DECIMAL value: `round(1.005, 2)` is 1.01. */
private fun roundTo(value: Double, digits: Int): Double {
  val scaled = jsStringToNumber("${jsNumberString(abs(value))}e$digits")
  val magnitude = jsStringToNumber("${jsNumberString(jsRound(scaled))}e-$digits")
  return if (value < 0) -magnitude else magnitude
}

private fun arity(name: String, args: List<Any>, least: Int, most: Int) {
  if (args.size < least || args.size > most) {
    val wanted = if (least == most) "$least" else "$least to $most"
    throw SiteFunctionError("$name() takes $wanted argument(s)")
  }
}

/** The closed table of built-ins, `format` pinned to en-US. */
private val BUILTINS: Map<String, (List<Any>) -> Any> = linkedMapOf(
  "min" to { args: List<Any> -> arity("min", args, 1, MAX_CALL_ARGUMENTS); args.map(::siteToNumber).reduce { a, b -> min(a, b) } },
  "max" to { args: List<Any> -> arity("max", args, 1, MAX_CALL_ARGUMENTS); args.map(::siteToNumber).reduce { a, b -> max(a, b) } },
  "round" to { args: List<Any> -> arity("round", args, 1, 2); roundTo(siteToNumber(args[0]), digitsOf(args.getOrNull(1), args.size > 1)) },
  "floor" to { args: List<Any> -> arity("floor", args, 1, 1); floor(siteToNumber(args[0])) },
  "ceil" to { args: List<Any> -> arity("ceil", args, 1, 1); ceil(siteToNumber(args[0])) },
  "abs" to { args: List<Any> -> arity("abs", args, 1, 1); abs(siteToNumber(args[0])) },
  "format" to { args: List<Any> ->
    arity("format", args, 1, 2)
    val digits = digitsOf(args.getOrNull(1), args.size > 1)
    formatEnUs(roundTo(siteToNumber(args[0]), digits), digits)
  },
)

/** The built-in names, in the table's order. */
val FUNCTION_BUILTIN_NAMES: List<String> = BUILTINS.keys.toList()

private fun isBuiltin(name: String) = name in BUILTINS

private val dictionaryJson = Json { isLenient = false }

private fun parseDictionary(text: String): JsonObject? =
  runCatching { dictionaryJson.parseToJsonElement(text) as? JsonObject }.getOrNull()

/** `plan.annual`: a member of a dictionary held as JSON text. */
private fun readMember(path: String, scope: Map<String, Any>): Any {
  val parts = path.split('.')
  val base = parts[0]
  if (base !in scope) throw SiteFunctionError("Unknown name \"$base\"")
  var current: Any? = (scope[base] as? String)?.let(::parseDictionary)
    ?: throw SiteFunctionError("\"$base\" is not a dictionary")
  for (member in parts.drop(1)) {
    val dictionary = current as? JsonObject
    if (dictionary == null || member !in dictionary) throw SiteFunctionError("Unknown name \"$path\"")
    current = dictionary[member]
  }
  val leaf = current as? JsonPrimitive
  if (leaf != null && leaf !is JsonNull) {
    if (leaf.isString) return leaf.content
    if (leaf.content == "true" || leaf.content == "false") return leaf.content == "true"
    leaf.content.toDoubleOrNull()?.let { return it }
  }
  throw SiteFunctionError("\"$path\" is not a number, a text or a true/false")
}

// ── Grammar ───────────────────────────────────────────────────────────────

private class Cursor(val tokens: List<Token>) {
  var position = 0
  fun peek(): Token? = tokens.getOrNull(position)
  fun next(): Token? = tokens.getOrNull(position++)
  fun peekOp(vararg ops: Char): Boolean = (peek() as? Token.Op)?.value?.let { it in ops } == true
}

/**
 * Why an expression can never be evaluated, or null when it parses: the
 * evaluator's grammar walked without a scope.
 */
fun expressionSyntaxError(text: String?): String? {
  val tokens = try {
    tokenize(text ?: "")
  } catch (error: SiteFunctionError) {
    return error.message
  }
  val cursor = Cursor(tokens)
  lateinit var expression: () -> Unit
  fun factor() {
    val token = cursor.next() ?: throw SiteFunctionError("Unexpected end of expression")
    when (token) {
      is Token.Num, is Token.Str, is Token.Bool -> return
      is Token.Ident -> {
        if (cursor.peek() != Token.LParen) return
        if (!isBuiltin(token.value)) throw SiteFunctionError("Unknown function \"${token.value}\"")
        cursor.next()
        if (cursor.peek() != Token.RParen) {
          expression()
          while (cursor.peek() == Token.Comma) {
            cursor.next()
            expression()
          }
        }
        if (cursor.next() != Token.RParen) throw SiteFunctionError("Missing closing parenthesis")
      }
      Token.LParen -> {
        expression()
        if (cursor.next() != Token.RParen) throw SiteFunctionError("Missing closing parenthesis")
      }
      is Token.Op -> if (token.value == '-') factor() else throw SiteFunctionError("Unexpected token")
      else -> throw SiteFunctionError("Unexpected token")
    }
  }
  fun term() {
    factor()
    while (cursor.peekOp('*', '/')) {
      cursor.next()
      factor()
    }
  }
  expression = {
    term()
    while (cursor.peekOp('+', '-')) {
      cursor.next()
      term()
    }
  }
  return try {
    expression()
    if (cursor.position < tokens.size) throw SiteFunctionError("Unexpected trailing input")
    null
  } catch (error: SiteFunctionError) {
    error.message
  }
}

/** The names an expression reads, in order, without evaluating it; malformed text names nothing. */
fun expressionIdentifiers(text: String?): List<String> {
  val tokens = try {
    tokenize(text ?: "")
  } catch (error: SiteFunctionError) {
    return emptyList()
  }
  return tokens.mapIndexedNotNull { index, token ->
    if (token !is Token.Ident) return@mapIndexedNotNull null
    if (tokens.getOrNull(index + 1) == Token.LParen && isBuiltin(token.value)) return@mapIndexedNotNull null
    token.value.substringBefore('.')
  }
}

/**
 * Evaluates an expression against [scope] (Double, String or Boolean
 * values). Throws [SiteFunctionError] on any invalid input.
 */
fun evaluateExpression(text: String, scope: Map<String, Any>): Any {
  val cursor = Cursor(tokenize(text))
  lateinit var expression: () -> Any
  fun factor(): Any {
    val token = cursor.next() ?: throw SiteFunctionError("Unexpected end of expression")
    return when (token) {
      is Token.Num -> token.value
      is Token.Str -> token.value
      is Token.Bool -> token.value
      is Token.Ident -> {
        if (cursor.peek() == Token.LParen) {
          val builtin = BUILTINS[token.value] ?: throw SiteFunctionError("Unknown function \"${token.value}\"")
          cursor.next()
          val args = mutableListOf<Any>()
          if (cursor.peek() != Token.RParen) {
            args += expression()
            while (cursor.peek() == Token.Comma) {
              cursor.next()
              args += expression()
            }
          }
          if (cursor.next() != Token.RParen) throw SiteFunctionError("Missing closing parenthesis")
          builtin(args)
        } else if ('.' in token.value) {
          readMember(token.value, scope)
        } else {
          scope[token.value] ?: throw SiteFunctionError("Unknown name \"${token.value}\"")
        }
      }
      Token.LParen -> {
        val value = expression()
        if (cursor.next() != Token.RParen) throw SiteFunctionError("Missing closing parenthesis")
        value
      }
      is Token.Op -> if (token.value == '-') -siteToNumber(factor()) else throw SiteFunctionError("Unexpected token")
      else -> throw SiteFunctionError("Unexpected token")
    }
  }
  fun term(): Any {
    var value = factor()
    while (cursor.peekOp('*', '/')) {
      val operator = (cursor.next() as Token.Op).value
      val right = siteToNumber(factor())
      value = if (operator == '*') siteToNumber(value) * right else siteToNumber(value) / right
    }
    return value
  }
  expression = {
    var value = term()
    while (cursor.peekOp('+', '-')) {
      val operator = (cursor.next() as Token.Op).value
      val right = term()
      value = if (operator == '+') {
        if (value is String || right is String) jsString(value) + jsString(right) else siteToNumber(value) + siteToNumber(right)
      } else {
        siteToNumber(value) - siteToNumber(right)
      }
    }
    value
  }
  val result = expression()
  if (cursor.position < cursor.tokens.size) throw SiteFunctionError("Unexpected trailing input")
  return result
}

// ── Functions ─────────────────────────────────────────────────────────────

data class HostFunctionParameter(
  val name: String,
  val type: String,
  val required: Boolean = false,
  val label: String? = null,
  val defaultValue: Any? = null,
)

data class HostFunctionVariable(val name: String, val type: String)

data class FunctionSetOperation(val set: String, val expression: String?, val workflow: String? = null)

data class FunctionConditionalOperation(
  val left: String,
  val comparator: String,
  val right: String,
  val then: List<FunctionSetOperation>,
  val otherwise: List<FunctionSetOperation>,
)

/** `hosts/{hostId}/functions/{id}`. */
data class HostFunctionDefinition(
  val name: String,
  val parameters: List<HostFunctionParameter> = emptyList(),
  val variables: List<HostFunctionVariable> = emptyList(),
  val operations: List<FunctionConditionalOperation> = emptyList(),
  val returnValue: String? = null,
)

private fun Map<*, *>.text(key: String): String? = this[key] as? String
private fun Any?.maps(): List<Map<*, *>> = (this as? List<*>)?.filterIsInstance<Map<*, *>>() ?: emptyList()

private fun setOperationOf(data: Map<*, *>) = FunctionSetOperation(
  set = data.text("set") ?: "",
  expression = data["expression"]?.let(::jsString),
  workflow = data.text("workflow"),
)

/** A stored function document (plain Firestore values) as a definition. */
fun hostFunctionOf(data: Map<*, *>): HostFunctionDefinition = HostFunctionDefinition(
  name = data.text("name") ?: "",
  parameters = data["parameters"].maps().map {
    HostFunctionParameter(
      name = it.text("name") ?: "",
      type = it.text("type") ?: "text",
      required = it["required"] == true,
      label = it.text("label"),
      defaultValue = it["defaultValue"],
    )
  },
  variables = data["variables"].maps().map { HostFunctionVariable(it.text("name") ?: "", it.text("type") ?: "text") },
  operations = data["operations"].maps().map { operation ->
    val condition = operation["if"] as? Map<*, *> ?: emptyMap<String, Any?>()
    FunctionConditionalOperation(
      left = condition["left"]?.let(::jsString) ?: "",
      comparator = condition.text("comparator") ?: "",
      right = condition["right"]?.let(::jsString) ?: "",
      then = operation["then"].maps().map(::setOperationOf),
      otherwise = operation["otherwise"].maps().map(::setOperationOf),
    )
  },
  returnValue = data.text("returnValue"),
)

sealed interface FunctionRunResult {
  data class Ok(val value: Any, val scope: Map<String, Any>) : FunctionRunResult
  data class Failed(val error: String) : FunctionRunResult
}

private fun compare(left: Any, comparator: String, right: Any): Boolean = when (comparator) {
  "==" -> jsStrictEquals(left, right)
  "!=" -> !jsStrictEquals(left, right)
  "<" -> siteToNumber(left) < siteToNumber(right)
  "<=" -> siteToNumber(left) <= siteToNumber(right)
  ">" -> siteToNumber(left) > siteToNumber(right)
  ">=" -> siteToNumber(left) >= siteToNumber(right)
  else -> throw SiteFunctionError("Unknown comparator \"$comparator\"")
}

private fun defaultValue(type: String): Any = when (type) {
  "number" -> 0.0
  "boolean" -> false
  else -> ""
}

private fun coerce(type: String, value: Any?): Any = when (type) {
  "number" -> siteToNumber(value)
  "boolean" -> value == true || value == "true"
  else -> if (value == null) "" else jsString(value)
}

/**
 * Runs a function against [args]: parameters coerce into scope, locals start
 * at their type's default, each conditional applies its SET list, and the
 * return value's final value comes back. [globals] are the site variables a
 * function may read but never set; [invokeWorkflow] serves a `set.workflow`.
 */
fun evaluateHostFunction(
  definition: HostFunctionDefinition,
  args: Map<String, Any?>,
  globals: Map<String, Any> = emptyMap(),
  invokeWorkflow: ((name: String, scope: Map<String, Any>) -> Any)? = null,
): FunctionRunResult = try {
  val scope = LinkedHashMap<String, Any>(globals)
  val writable = mutableSetOf<String>()
  for (parameter in definition.parameters) {
    val provided = args[parameter.name]
    val fallback = parameter.defaultValue
    if (provided == null || provided == "") {
      when {
        fallback != null && fallback != "" -> scope[parameter.name] = coerce(parameter.type, fallback)
        parameter.required -> throw SiteFunctionError("Parameter \"${parameter.name}\" is required")
        else -> scope[parameter.name] = defaultValue(parameter.type)
      }
    } else {
      scope[parameter.name] = coerce(parameter.type, provided)
    }
    writable += parameter.name
  }
  for (variable in definition.variables) {
    scope[variable.name] = defaultValue(variable.type)
    writable += variable.name
  }
  var applied = 0
  for (operation in definition.operations) {
    val passed = compare(evaluateExpression(operation.left, scope), operation.comparator, evaluateExpression(operation.right, scope))
    for (set in if (passed) operation.then else operation.otherwise) {
      applied += 1
      if (applied > FUNCTION_MAX_OPERATIONS) throw SiteFunctionError("Operation limit exceeded")
      if (set.set !in writable) {
        throw SiteFunctionError(
          if (set.set in scope) "\"${set.set}\" is a site variable: a function can read it, not set it"
          else "Unknown variable \"${set.set}\"",
        )
      }
      scope[set.set] = if (!set.workflow.isNullOrEmpty()) {
        val invoke = invokeWorkflow ?: throw SiteFunctionError("Workflow calls are not available here")
        invoke(set.workflow, scope.toMap())
      } else {
        evaluateExpression(set.expression ?: "", scope)
      }
    }
  }
  val returnName = definition.returnValue
  val value = if (!returnName.isNullOrEmpty() && returnName in scope) scope.getValue(returnName) else ""
  FunctionRunResult.Ok(value, scope)
} catch (error: SiteFunctionError) {
  FunctionRunResult.Failed(error.message ?: "")
}

// ── Workflows ─────────────────────────────────────────────────────────────

/** A site variable (`hosts/{hostId}/variables/{id}`), as an expression scope reads it. */
data class HostVariableValue(val name: String?, val type: String?, val value: Any?)

fun hostVariableOf(data: Map<*, *>): HostVariableValue =
  HostVariableValue(data.text("name"), data.text("type"), data["value"])

/** One function call of a workflow. */
data class WorkflowCall(
  val functionId: String? = null,
  val functionName: String? = null,
  val args: List<Any?> = emptyList(),
  val resultName: String? = null,
)

/** A workflow as the evaluator runs it: its function calls only. */
data class WorkflowDefinition(val name: String, val steps: List<WorkflowCall>, val returnValue: String? = null)

fun workflowCallOf(data: Map<*, *>): WorkflowCall = WorkflowCall(
  functionId = data.text("functionId"),
  functionName = data.text("functionName"),
  args = (data["args"] as? List<*>) ?: emptyList(),
  resultName = data.text("resultName"),
)

fun workflowDefinitionOf(data: Map<*, *>): WorkflowDefinition = WorkflowDefinition(
  name = data.text("name") ?: "",
  steps = data["steps"].maps().map(::workflowCallOf),
  returnValue = data.text("returnValue"),
)

sealed interface WorkflowRunResult {
  /** [results] in the order JavaScript walks them. */
  data class Ok(val value: Any, val results: List<Pair<String, Any>>) : WorkflowRunResult
  data class Failed(val error: String, val step: Int? = null) : WorkflowRunResult
}

/** Variable values as a typed scope, under their key and their name. */
private fun variableScope(variables: Map<String, HostVariableValue>): LinkedHashMap<String, Any> {
  val scope = LinkedHashMap<String, Any>()
  for ((key, variable) in variables) {
    val value: Any = when (variable.type) {
      "number" -> jsNumber(variable.value ?: 0.0)
      "boolean" -> variable.value == "true"
      else -> when (val raw = variable.value) {
        null -> ""
        is Number -> raw.toDouble()
        is String, is Boolean -> raw
        else -> jsString(raw)
      }
    }
    scope[key] = value
    val name = variable.name
    if (!name.isNullOrEmpty() && name !in scope) scope[name] = value
  }
  return scope
}

/**
 * Runs a workflow's function calls (`runWorkflow`). [functions] and
 * [workflows] are keyed by id and by name; [extraScope] (an event's payload)
 * wins over the variables.
 */
fun runWorkflow(
  workflow: WorkflowDefinition,
  functions: Map<String, HostFunctionDefinition>,
  variables: Map<String, HostVariableValue> = emptyMap(),
  extraScope: Map<String, Any> = emptyMap(),
  workflows: Map<String, WorkflowDefinition>? = null,
  depth: Int = 0,
): WorkflowRunResult {
  val steps = workflow.steps
  if (steps.size > WORKFLOW_MAX_STEPS) return WorkflowRunResult.Failed("Workflows are capped at $WORKFLOW_MAX_STEPS steps")
  if (depth > CROSS_MAX_DEPTH) return WorkflowRunResult.Failed("Workflow nesting is too deep")
  val invoke: ((String, Map<String, Any>) -> Any)? = workflows?.let { all ->
    { name: String, callScope: Map<String, Any> ->
      val nested = all[name.trim()] ?: throw SiteFunctionError("Unknown workflow \"$name\"")
      when (val run = runWorkflow(nested, functions, variables, callScope, all, depth + 1)) {
        is WorkflowRunResult.Failed -> throw SiteFunctionError(run.error)
        is WorkflowRunResult.Ok -> run.value
      }
    }
  }
  val siteVariables = variableScope(variables)
  val scope = LinkedHashMap<String, Any>(siteVariables).apply { putAll(extraScope) }
  val results = LinkedHashMap<String, Any>()
  for ((index, step) in steps.withIndex()) {
    val number = index + 1
    val definition = functions[step.functionId?.trim() ?: ""] ?: functions[step.functionName?.trim() ?: ""]
      ?: return WorkflowRunResult.Failed(
        "Unknown function \"${step.functionName?.ifEmpty { null } ?: step.functionId ?: "undefined"}\"",
        number,
      )
    val args = mutableMapOf<String, Any?>()
    try {
      definition.parameters.forEachIndexed { parameterIndex, parameter ->
        val expression = step.args.getOrNull(parameterIndex)
        if (expression != null && jsString(expression).trim().isNotEmpty()) {
          args[parameter.name] = evaluateExpression(jsString(expression), scope)
        }
      }
    } catch (error: SiteFunctionError) {
      return WorkflowRunResult.Failed("Step $number: ${error.message}", number)
    }
    when (val run = evaluateHostFunction(definition, args, siteVariables, invoke)) {
      is FunctionRunResult.Failed -> return WorkflowRunResult.Failed("Step $number (${definition.name}): ${run.error}", number)
      is FunctionRunResult.Ok -> {
        val resultName = step.resultName?.trim()?.ifEmpty { null } ?: "step$number"
        scope[resultName] = run.value
        results[resultName] = run.value
      }
    }
  }
  val returnName = workflow.returnValue?.trim()
  val ordered = jsObjectOrder(results)
  val value = if (!returnName.isNullOrEmpty() && returnName in scope) scope.getValue(returnName) else ordered.lastOrNull()?.second ?: ""
  return WorkflowRunResult.Ok(value, ordered)
}

/** The console's test-run line: `Result: 22 (d=10, step2=22)` or `Error: …`. */
fun workflowTestRunLine(run: WorkflowRunResult): String = when (run) {
  is WorkflowRunResult.Failed -> "Error: ${run.error}"
  is WorkflowRunResult.Ok -> "Result: ${jsString(run.value)} (${run.results.joinToString(", ") { (key, value) -> "$key=${jsString(value)}" }})"
}

// ── Host events ───────────────────────────────────────────────────────────

/** Every host event, in picker order. */
val hostEventsInOrder: List<HostEventDeclaration> by lazy { Contracts.hostEvents.sortedBy { it.order } }

/** Every host event's type, in picker order (`HOST_EVENT_TYPES`). */
val hostEventTypes: List<String> by lazy { hostEventsInOrder.map { it.type } }

/** `formSubmission` → `Form submitted`; a custom event keeps its own name; nothing reads `Event`. */
fun hostEventLabel(event: String?): String {
  val key = (event ?: "").trim()
  if (key.isEmpty()) return "Event"
  return hostEventsInOrder.firstOrNull { it.type == key }?.label ?: key
}

/** What a trigger's filter and conditions can read for [event], or null where it is not documented. */
fun hostEventPayloadHint(event: String?): String? {
  val keys = hostEventsInOrder.firstOrNull { it.type == (event ?: "") }?.payloadKeys
  if (keys.isNullOrEmpty()) return null
  return "In scope: ${keys.joinToString(", ")}."
}

/** Whether [event] is the recipient's own action (a form, a booking, a sign-up). */
fun hostEventRecipientActed(event: String?): Boolean {
  val key = (event ?: "").trim()
  return hostEventsInOrder.any { it.type == key && it.recipientActed == true }
}
