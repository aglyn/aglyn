// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// THE SITE-FUNCTIONS LANGUAGE, as libs/aglyn/src/lib/app-utils/functions.ts
// writes it: the no-code function model (parameters, locals, conditional SET
// operations, a return value) and its small, safe expression evaluator — names,
// numbers, quoted text, booleans, `+ - * /`, parentheses and the fixed table of
// built-ins. No loops, a bounded operation count, and the same error words.
// `runWorkflow` (libs/plugins/workflows/src/lib/model/workflows.ts) chains the
// functions into a workflow. The Automation screens run a workflow's test with
// it, and the Logic screens evaluate a function with it.
// function-cases.generated.json holds the console's own answers.

/// One value an expression reads or makes: a number, a text, or a true/false.
public enum SiteValue: Hashable, Sendable, CustomStringConvertible {
  case number(Double)
  case text(String)
  case bool(Bool)

  /// JavaScript's `String(value)`.
  public var description: String {
    switch self {
    case .number(let value): jsNumberString(value)
    case .text(let value): value
    case .bool(let value): value ? "true" : "false"
    }
  }

  /// A plain value (`Double`, `String`, `Bool`) as a Firestore field or JSON holds it.
  public var plain: Any {
    switch self {
    case .number(let value): value
    case .text(let value): value
    case .bool(let value): value
    }
  }

  /// A plain value read as a site value; nil for anything else (a list, a map, null).
  public init?(plain value: Any?) {
    switch value {
    case let text as String: self = .text(text)
    case let number as NSNumber:
      self = looseIsBool(number) ? .bool(number.boolValue) : .number(number.doubleValue)
    default: return nil
    }
  }
}

/// The scope an expression evaluates over, by name.
public typealias SiteScope = [String: SiteValue]

/// Why an expression or a function could not be evaluated, in the console's words.
public struct SiteFunctionError: Error, Equatable, CustomStringConvertible {
  public let message: String
  public init(_ message: String) { self.message = message }
  public var description: String { message }
}

/// How many SETs one run may apply (`FUNCTION_MAX_OPERATIONS`).
public var functionMaxOperations: Int { ContractValues.shared.functionMaxOperations }
/// The longest workflow (`WORKFLOW_MAX_STEPS`).
public var workflowMaxSteps: Int { ContractValues.shared.workflowMaxSteps }
/// Nesting across workflow → function → workflow calls (`CROSS_MAX_DEPTH`).
public var crossMaxDepth: Int { ContractValues.shared.crossMaxDepth }

// MARK: - JavaScript number semantics

/// Whether an `NSNumber` is a boolean (a `CFBoolean`), not a number.
func looseIsBool(_ number: NSNumber) -> Bool { CFGetTypeID(number) == CFBooleanGetTypeID() }

/// JavaScript's `Number(text)`: trimmed, empty is 0, decimal, `0x`/`0o`/`0b`, `Infinity`; anything else NaN.
func jsNumberFromText(_ text: String) -> Double {
  let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
  if trimmed.isEmpty { return 0 }
  let lower = trimmed.lowercased()
  for (prefix, radix) in [("0x", 16), ("0o", 8), ("0b", 2)] where lower.hasPrefix(prefix) {
    return Int(lower.dropFirst(2), radix: radix).map(Double.init) ?? .nan
  }
  switch trimmed {
  case "Infinity", "+Infinity": return .infinity
  case "-Infinity": return -.infinity
  default: break
  }
  // A JS numeric literal: digits, one point, an exponent. Swift's `Double`
  // also reads "nan", "inf" and hex floats, which JavaScript does not.
  guard trimmed.range(of: #"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$"#, options: .regularExpression) != nil else {
    return .nan
  }
  return Double(trimmed) ?? .nan
}

/// JavaScript's `String(number)`: the shortest round-trip digits, an exponent only past 1e21 or under 1e-6.
public func jsNumberString(_ value: Double) -> String {
  if value.isNaN { return "NaN" }
  if value.isInfinite { return value < 0 ? "-Infinity" : "Infinity" }
  if value == 0 { return "0" }
  let negative = value < 0
  // Swift's description is the shortest round-trip form too; read its digits and exponent.
  var text = "\(abs(value))"
  var exponent = 0
  if let e = text.firstIndex(where: { $0 == "e" || $0 == "E" }) {
    exponent = Int(text[text.index(after: e)...]) ?? 0
    text = String(text[..<e])
  }
  var integer = text
  var fraction = ""
  if let dot = text.firstIndex(of: ".") {
    integer = String(text[..<dot])
    fraction = String(text[text.index(after: dot)...])
  }
  var digits = integer + fraction
  // The point sits after `pointAt` digits of `digits`.
  var pointAt = integer.count + exponent
  while digits.hasPrefix("0") && digits.count > 1 {
    digits.removeFirst()
    pointAt -= 1
  }
  while digits.hasSuffix("0") && digits.count > 1 { digits.removeLast() }
  let k = digits.count
  let n = pointAt
  var out: String
  if k <= n && n <= 21 {
    out = digits + String(repeating: "0", count: n - k)
  } else if 0 < n && n <= 21 {
    let split = digits.index(digits.startIndex, offsetBy: n)
    out = "\(digits[..<split]).\(digits[split...])"
  } else if -6 < n && n <= 0 {
    out = "0." + String(repeating: "0", count: -n) + digits
  } else {
    let e = n - 1
    let mantissa = k == 1 ? digits : "\(digits.first!).\(digits.dropFirst())"
    out = "\(mantissa)e\(e < 0 ? "-" : "+")\(abs(e))"
  }
  return negative ? "-" + out : out
}

/// `Math.round`: halves toward positive infinity.
func jsMathRound(_ value: Double) -> Double {
  guard value.isFinite else { return value }
  let floor = value.rounded(.down)
  return value - floor >= 0.5 ? floor + 1 : floor
}

/// The evaluator's `toNumber`: JavaScript's `Number()`, refusing anything not finite.
func siteNumber(_ value: SiteValue) throws -> Double {
  let parsed: Double
  switch value {
  case .number(let number): parsed = number
  case .bool(let flag): parsed = flag ? 1 : 0
  case .text(let text): parsed = jsNumberFromText(text)
  }
  guard parsed.isFinite else { throw SiteFunctionError("\"\(value)\" is not a number") }
  return parsed
}

// MARK: - Tokens

private enum SiteToken: Equatable {
  case number(Double)
  case string(String)
  case boolean(Bool)
  case ident(String)
  case op(Character)
  case lparen, rparen, comma
}

private func tokenize(_ text: String) throws -> [SiteToken] {
  let chars = Array(text)
  var tokens: [SiteToken] = []
  var index = 0
  func rest(_ from: Int) -> String { String(chars[from...]) }
  while index < chars.count {
    let char = chars[index]
    if char.isWhitespace {
      index += 1
    } else if "+-*/".contains(char) {
      tokens.append(.op(char))
      index += 1
    } else if char == "(" {
      tokens.append(.lparen)
      index += 1
    } else if char == ")" {
      tokens.append(.rparen)
      index += 1
    } else if char == "," {
      tokens.append(.comma)
      index += 1
    } else if char == "'" || char == "\"" {
      guard let end = chars[(index + 1)...].firstIndex(of: char) else {
        throw SiteFunctionError("Unterminated string")
      }
      tokens.append(.string(String(chars[(index + 1)..<end])))
      index = end + 1
    } else if char.isASCII && (char.isNumber || char == ".") {
      let tail = rest(index)
      guard let match = tail.range(of: #"^[0-9]*\.?[0-9]+"#, options: .regularExpression) else {
        throw SiteFunctionError("Bad number at \"\(tail)\"")
      }
      let literal = String(tail[match])
      tokens.append(.number(Double(literal.hasPrefix(".") ? "0" + literal : literal) ?? .nan))
      index += literal.count
    } else if char.isASCII && (char.isLetter || char == "_") {
      // A dotted path is ONE name: `plan_pro.annual` reads a member of a dictionary.
      let tail = rest(index)
      let match = tail.range(
        of: #"^[a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*"#, options: .regularExpression)!
      let word = String(tail[match])
      if word == "true" || word == "false" {
        tokens.append(.boolean(word == "true"))
      } else {
        tokens.append(.ident(word))
      }
      index += word.count
    } else {
      throw SiteFunctionError("Unexpected character \"\(char)\"")
    }
  }
  return tokens
}

// MARK: - Built-ins

private let maxCallArguments = 16
private let maxDigits = 10

private func digitsOf(_ value: SiteValue?) throws -> Int {
  guard let value else { return 0 }
  let digits = try siteNumber(value).rounded(.towardZero)
  if digits < 0 || digits > Double(maxDigits) {
    throw SiteFunctionError("Decimal places must be between 0 and \(maxDigits)")
  }
  return Int(digits)
}

/// Half away from zero, on the DECIMAL value (the exponent form makes `round(1.005, 2)` 1.01).
func siteRoundTo(_ value: Double, _ digits: Int) -> Double {
  let shifted = jsNumberFromText("\(jsNumberString(abs(value)))e\(digits)")
  let rounded = jsMathRound(shifted)
  let magnitude = jsNumberFromText("\(jsNumberString(rounded))e-\(digits)")
  return value < 0 ? -magnitude : magnitude
}

private func arity(_ name: String, _ args: [SiteValue], _ least: Int, _ most: Int) throws {
  if args.count < least || args.count > most {
    let wanted = least == most ? "\(least)" : "\(least) to \(most)"
    throw SiteFunctionError("\(name)() takes \(wanted) argument(s)")
  }
}

/// `toLocaleString('en-US', {min/maxFractionDigits: digits})`: grouped thousands, fixed decimals.
func siteFormat(_ value: Double, digits: Int) -> String {
  let formatter = NumberFormatter()
  formatter.locale = Locale(identifier: "en_US")
  formatter.numberStyle = .decimal
  formatter.usesGroupingSeparator = true
  formatter.minimumFractionDigits = digits
  formatter.maximumFractionDigits = digits
  formatter.roundingMode = .halfUp
  let text = formatter.string(from: NSNumber(value: value)) ?? jsNumberString(value)
  // `-0` prints as "-0" here and "0" in JavaScript.
  return text.hasPrefix("-") && Double(text.replacingOccurrences(of: ",", with: "")) == 0 ? String(text.dropFirst()) : text
}

private let builtins: [String: ([SiteValue]) throws -> SiteValue] = [
  "min": { args in
    try arity("min", args, 1, maxCallArguments)
    return .number(try args.map(siteNumber).min()!)
  },
  "max": { args in
    try arity("max", args, 1, maxCallArguments)
    return .number(try args.map(siteNumber).max()!)
  },
  "round": { args in
    try arity("round", args, 1, 2)
    return .number(siteRoundTo(try siteNumber(args[0]), try digitsOf(args.count > 1 ? args[1] : nil)))
  },
  "floor": { args in
    try arity("floor", args, 1, 1)
    return .number(try siteNumber(args[0]).rounded(.down))
  },
  "ceil": { args in
    try arity("ceil", args, 1, 1)
    return .number(try siteNumber(args[0]).rounded(.up))
  },
  "abs": { args in
    try arity("abs", args, 1, 1)
    return .number(abs(try siteNumber(args[0])))
  },
  "format": { args in
    try arity("format", args, 1, 2)
    let digits = try digitsOf(args.count > 1 ? args[1] : nil)
    return .text(siteFormat(siteRoundTo(try siteNumber(args[0]), digits), digits: digits))
  },
]

/// The built-in names, for an editor's help text (`FUNCTION_BUILTIN_NAMES`).
public var functionBuiltinNames: [String] { ContractValues.shared.functionBuiltinNames }

private func isBuiltin(_ name: String) -> Bool { builtins[name] != nil }

// MARK: - Dictionary members

private func parseDictionary(_ text: String) -> [String: Any]? {
  guard let data = text.data(using: .utf8),
    let value = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])
  else { return nil }
  return value as? [String: Any]
}

/// `plan.annual`: a member of a dictionary held as JSON text; only a number, a text or a true/false comes out.
private func readMember(_ path: String, _ scope: SiteScope) throws -> SiteValue {
  let parts = path.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
  let base = parts[0]
  guard let held = scope[base] else { throw SiteFunctionError("Unknown name \"\(base)\"") }
  var current: Any?
  if case .text(let text) = held { current = parseDictionary(text) }
  guard current != nil else { throw SiteFunctionError("\"\(base)\" is not a dictionary") }
  for member in parts.dropFirst() {
    guard let map = current as? [String: Any], let next = map[member] else {
      throw SiteFunctionError("Unknown name \"\(path)\"")
    }
    current = next
  }
  if let value = SiteValue(plain: current) { return value }
  throw SiteFunctionError("\"\(path)\" is not a number, a text or a true/false")
}

// MARK: - Parsing and evaluation

private struct Parser {
  let tokens: [SiteToken]
  /// Nil when only checking the grammar.
  let scope: SiteScope?
  var position = 0

  init(_ tokens: [SiteToken], scope: SiteScope?) {
    self.tokens = tokens
    self.scope = scope
  }

  func peek() -> SiteToken? { position < tokens.count ? tokens[position] : nil }

  mutating func next() -> SiteToken? {
    defer { position += 1 }
    return peek()
  }

  mutating func factor() throws -> SiteValue {
    guard let token = next() else { throw SiteFunctionError("Unexpected end of expression") }
    switch token {
    case .number(let value): return .number(value)
    case .string(let value): return .text(value)
    case .boolean(let value): return .bool(value)
    case .ident(let name):
      // A CALL only when the parenthesis follows: a scope may still hold a value named `min`.
      if peek() == .lparen {
        guard let builtin = builtins[name] else { throw SiteFunctionError("Unknown function \"\(name)\"") }
        _ = next()
        var args: [SiteValue] = []
        if peek() != .rparen {
          args.append(try expression())
          while peek() == .comma {
            _ = next()
            args.append(try expression())
          }
        }
        guard next() == .rparen else { throw SiteFunctionError("Missing closing parenthesis") }
        guard scope != nil else { return .number(0) }
        return try builtin(args)
      }
      guard let scope else { return .number(0) }
      if name.contains(".") { return try readMember(name, scope) }
      guard let value = scope[name] else { throw SiteFunctionError("Unknown name \"\(name)\"") }
      return value
    case .lparen:
      let value = try expression()
      guard next() == .rparen else { throw SiteFunctionError("Missing closing parenthesis") }
      return value
    case .op("-"):
      let value = try factor()
      guard scope != nil else { return .number(0) }
      return .number(-(try siteNumber(value)))
    default:
      throw SiteFunctionError("Unexpected token")
    }
  }

  mutating func term() throws -> SiteValue {
    var value = try factor()
    while case .op(let op)? = peek(), op == "*" || op == "/" {
      _ = next()
      let right = try factor()
      guard scope != nil else { continue }
      let rightNumber = try siteNumber(right)
      let leftNumber = try siteNumber(value)
      value = .number(op == "*" ? leftNumber * rightNumber : leftNumber / rightNumber)
    }
    return value
  }

  mutating func expression() throws -> SiteValue {
    var value = try term()
    while case .op(let op)? = peek(), op == "+" || op == "-" {
      _ = next()
      let right = try term()
      guard scope != nil else { continue }
      if op == "+" {
        // `+` concatenates when either side is a text, like the templates.
        if case .text = value {
          value = .text("\(value)\(right)")
        } else if case .text = right {
          value = .text("\(value)\(right)")
        } else {
          value = .number(try siteNumber(value) + siteNumber(right))
        }
      } else {
        value = .number(try siteNumber(value) - siteNumber(right))
      }
    }
    return value
  }
}

/// Evaluates an expression against the scope; throws the console's words on any invalid input.
public func evaluateExpression(_ text: String, _ scope: SiteScope) throws -> SiteValue {
  var parser = Parser(try tokenize(text), scope: scope)
  let result = try parser.expression()
  if parser.position < parser.tokens.count { throw SiteFunctionError("Unexpected trailing input") }
  return result
}

/// Why an expression can never be evaluated, or nil when it parses — only what the TEXT decides.
public func expressionSyntaxError(_ text: String?) -> String? {
  do {
    var parser = Parser(try tokenize(text ?? ""), scope: nil)
    _ = try parser.expression()
    if parser.position < parser.tokens.count { throw SiteFunctionError("Unexpected trailing input") }
    return nil
  } catch let error as SiteFunctionError {
    return error.message
  } catch {
    return "Unreadable expression"
  }
}

/// The names an expression READS, in order: every identifier not a built-in being called; a dotted path names its base.
public func expressionIdentifiers(_ text: String?) -> [String] {
  guard let tokens = try? tokenize(text ?? "") else { return [] }
  var names: [String] = []
  for (index, token) in tokens.enumerated() {
    guard case .ident(let name) = token else { continue }
    if index + 1 < tokens.count, tokens[index + 1] == .lparen, isBuiltin(name) { continue }
    names.append(String(name.split(separator: ".").first ?? Substring(name)))
  }
  return names
}

// MARK: - Functions

public enum SiteValueType: String, Sendable, CaseIterable {
  case number, text, boolean
}

/// `hosts/{hostId}/functions/{id}` as the evaluator reads it.
public struct HostFunctionDefinition: Sendable, Equatable {
  public struct Parameter: Sendable, Equatable {
    public var name: String
    public var type: SiteValueType
    public var required: Bool
    public var defaultValue: String?
    public init(name: String, type: SiteValueType, required: Bool = false, defaultValue: String? = nil) {
      self.name = name
      self.type = type
      self.required = required
      self.defaultValue = defaultValue
    }
  }

  public struct SetOperation: Sendable, Equatable {
    public var set: String
    public var expression: String
    public var workflow: String?
  }

  public struct Operation: Sendable, Equatable {
    public var left: String
    public var comparator: String
    public var right: String
    public var then: [SetOperation]
    public var otherwise: [SetOperation]
  }

  public var name: String
  public var parameters: [Parameter]
  public var variables: [(name: String, type: SiteValueType)]
  public var operations: [Operation]
  public var returnValue: String?

  public static func == (a: Self, b: Self) -> Bool {
    a.name == b.name && a.parameters == b.parameters && a.operations == b.operations && a.returnValue == b.returnValue
      && a.variables.map(\.name) == b.variables.map(\.name)
  }

  /// A stored definition, read loosely as the TypeScript does (absent lists are empty).
  public init(_ data: [String: Any]) {
    func type(_ value: Any?) -> SiteValueType { SiteValueType(rawValue: value as? String ?? "") ?? .text }
    func sets(_ value: Any?) -> [SetOperation] {
      (value as? [Any] ?? []).compactMap { $0 as? [String: Any] }.map {
        SetOperation(
          set: $0["set"] as? String ?? "", expression: looseString($0["expression"]),
          workflow: ($0["workflow"] as? String).flatMap { $0.isEmpty ? nil : $0 })
      }
    }
    name = data["name"] as? String ?? ""
    parameters = (data["parameters"] as? [Any] ?? []).compactMap { $0 as? [String: Any] }.map {
      Parameter(
        name: $0["name"] as? String ?? "", type: type($0["type"]), required: $0["required"] as? Bool == true,
        defaultValue: $0["defaultValue"] as? String)
    }
    variables = (data["variables"] as? [Any] ?? []).compactMap { $0 as? [String: Any] }.map {
      ($0["name"] as? String ?? "", type($0["type"]))
    }
    operations = (data["operations"] as? [Any] ?? []).compactMap { $0 as? [String: Any] }.map { raw in
      let condition = raw["if"] as? [String: Any] ?? [:]
      return Operation(
        left: looseString(condition["left"]), comparator: condition["comparator"] as? String ?? "",
        right: looseString(condition["right"]), then: sets(raw["then"]), otherwise: sets(raw["otherwise"]))
    }
    returnValue = data["returnValue"] as? String
  }
}

/// What a function run answers: its value and final scope, or the error that stopped it.
public enum FunctionRunResult: Equatable, Sendable {
  case ok(value: SiteValue, scope: SiteScope)
  case failed(String)
}

private func compare(_ left: SiteValue, _ comparator: String, _ right: SiteValue) throws -> Bool {
  switch comparator {
  case "==": return left == right
  case "!=": return left != right
  case "<": return try siteNumber(left) < siteNumber(right)
  case "<=": return try siteNumber(left) <= siteNumber(right)
  case ">": return try siteNumber(left) > siteNumber(right)
  case ">=": return try siteNumber(left) >= siteNumber(right)
  default: throw SiteFunctionError("Unknown comparator \"\(comparator)\"")
  }
}

private func typeDefault(_ type: SiteValueType) -> SiteValue {
  switch type {
  case .number: .number(0)
  case .boolean: .bool(false)
  case .text: .text("")
  }
}

private func coerce(_ type: SiteValueType, _ value: SiteValue) throws -> SiteValue {
  switch type {
  case .number: return .number(try siteNumber(value))
  case .boolean: return .bool(value == .bool(true) || value == .text("true"))
  case .text: return .text(value.description)
  }
}

/// Runs a function definition against arguments. `globals` are the site's
/// variables by name — readable, never settable, shadowed by the function's
/// own names. `invokeWorkflow` serves a `set.workflow` operation.
public func evaluateHostFunction(
  _ definition: HostFunctionDefinition, _ args: [String: SiteValue], globals: SiteScope = [:],
  invokeWorkflow: ((String, SiteScope) throws -> SiteValue)? = nil
) -> FunctionRunResult {
  do {
    var scope = globals
    var writable = Set<String>()
    for parameter in definition.parameters {
      let provided = args[parameter.name]
      if provided == nil || provided == .text("") {
        if let fallback = parameter.defaultValue, !fallback.isEmpty {
          scope[parameter.name] = try coerce(parameter.type, .text(fallback))
        } else if parameter.required {
          throw SiteFunctionError("Parameter \"\(parameter.name)\" is required")
        } else {
          scope[parameter.name] = typeDefault(parameter.type)
        }
      } else if let provided {
        scope[parameter.name] = try coerce(parameter.type, provided)
      }
      writable.insert(parameter.name)
    }
    for variable in definition.variables {
      scope[variable.name] = typeDefault(variable.type)
      writable.insert(variable.name)
    }
    var applied = 0
    for operation in definition.operations {
      let passed = try compare(
        evaluateExpression(operation.left, scope), operation.comparator, evaluateExpression(operation.right, scope))
      for set in passed ? operation.then : operation.otherwise {
        applied += 1
        if applied > functionMaxOperations { throw SiteFunctionError("Operation limit exceeded") }
        guard writable.contains(set.set) else {
          throw SiteFunctionError(
            scope[set.set] != nil
              ? "\"\(set.set)\" is a site variable: a function can read it, not set it"
              : "Unknown variable \"\(set.set)\"")
        }
        if let workflow = set.workflow {
          guard let invokeWorkflow else { throw SiteFunctionError("Workflow calls are not available here") }
          scope[set.set] = try invokeWorkflow(workflow, scope)
        } else {
          scope[set.set] = try evaluateExpression(set.expression, scope)
        }
      }
    }
    let value = definition.returnValue.flatMap { $0.isEmpty ? nil : scope[$0] } ?? .text("")
    return .ok(value: value, scope: scope)
  } catch let error as SiteFunctionError {
    return .failed(error.message)
  } catch {
    return .failed(error.localizedDescription)
  }
}

// MARK: - Workflows

/// One function call of a workflow: `{functionId?, functionName, args, resultName?}`.
public struct WorkflowFunctionCall: Sendable, Equatable {
  public var functionId: String?
  public var functionName: String
  public var args: [String]
  public var resultName: String?

  public init(functionId: String? = nil, functionName: String, args: [String], resultName: String? = nil) {
    self.functionId = functionId
    self.functionName = functionName
    self.args = args
    self.resultName = resultName
  }

  public init(_ data: [String: Any]) {
    functionId = data["functionId"] as? String
    functionName = data["functionName"] as? String ?? ""
    args = (data["args"] as? [Any] ?? []).map { looseString($0) }
    resultName = data["resultName"] as? String
  }
}

/// A workflow as the evaluator runs it: its function calls and its return name.
public struct WorkflowDefinition: Sendable, Equatable {
  public var name: String
  public var steps: [WorkflowFunctionCall]
  public var returnValue: String?

  public init(name: String, steps: [WorkflowFunctionCall], returnValue: String? = nil) {
    self.name = name
    self.steps = steps
    self.returnValue = returnValue
  }

  public init(_ data: [String: Any]) {
    name = data["name"] as? String ?? ""
    steps = (data["steps"] as? [Any] ?? []).compactMap { $0 as? [String: Any] }.map(WorkflowFunctionCall.init)
    returnValue = data["returnValue"] as? String
  }
}

/// A site variable as a workflow reads it: `hosts/{hostId}/variables/{id}`.
public struct HostVariableValue: Sendable, Equatable {
  public var name: String?
  public var type: String
  public var value: String?

  public init(name: String?, type: String, value: String?) {
    self.name = name
    self.type = type
    self.value = value
  }

  public init(_ data: [String: Any]) {
    name = data["name"] as? String
    type = data["type"] as? String ?? "text"
    value = (data["value"]).map { looseString($0) }
  }
}

/// What a workflow run answers: its value and each step's result, or the error and the step it stopped at.
public enum WorkflowRunResult: Equatable, Sendable {
  case ok(value: SiteValue, results: [(name: String, value: SiteValue)])
  case failed(error: String, step: Int?)

  public static func == (a: Self, b: Self) -> Bool {
    switch (a, b) {
    case (.ok(let va, let ra), .ok(let vb, let rb)):
      va == vb && ra.map(\.name) == rb.map(\.name) && ra.map(\.value) == rb.map(\.value)
    case (.failed(let ea, let sa), .failed(let eb, let sb)): ea == eb && sa == sb
    default: false
    }
  }
}

/// Variable values as a typed expression scope, under each key and under each name.
private func variableScope(_ variables: [(key: String, variable: HostVariableValue)]) -> SiteScope {
  var scope: SiteScope = [:]
  for (key, variable) in variables {
    let value: SiteValue =
      variable.type == "number"
      ? .number(jsNumberFromText(variable.value ?? "0"))
      : variable.type == "boolean" ? .bool(variable.value == "true") : .text(variable.value ?? "")
    scope[key] = value
    if let name = variable.name, !name.isEmpty, scope[name] == nil { scope[name] = value }
  }
  return scope
}

/// Runs a workflow's function calls in order over the site's variables (and
/// `extraScope`, an event's payload, which wins over them). `functions` is
/// keyed by id and by name; `workflows` (by name) enables function → workflow calls.
public func runWorkflow(
  _ workflow: WorkflowDefinition, functions: [String: HostFunctionDefinition],
  variables: [(key: String, variable: HostVariableValue)] = [], extraScope: SiteScope = [:],
  workflows: [String: WorkflowDefinition]? = nil, depth: Int = 0
) -> WorkflowRunResult {
  if workflow.steps.count > workflowMaxSteps {
    return .failed(error: "Workflows are capped at \(workflowMaxSteps) steps", step: nil)
  }
  if depth > crossMaxDepth { return .failed(error: "Workflow nesting is too deep", step: nil) }
  var invoke: ((String, SiteScope) throws -> SiteValue)?
  if let known = workflows {
    invoke = { (name: String, callScope: SiteScope) throws -> SiteValue in
      guard let nested = known[name.trimmingCharacters(in: .whitespacesAndNewlines)] else {
        throw SiteFunctionError("Unknown workflow \"\(name)\"")
      }
      switch runWorkflow(
        nested, functions: functions, variables: variables, extraScope: callScope, workflows: known, depth: depth + 1)
      {
      case .ok(let value, _): return value
      case .failed(let error, _): throw SiteFunctionError(error)
      }
    }
  }
  let siteVariables = variableScope(variables)
  var scope = siteVariables.merging(extraScope) { _, extra in extra }
  var results: [(name: String, value: SiteValue)] = []
  for (index, step) in workflow.steps.enumerated() {
    let byID = step.functionId.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) } ?? ""
    guard let definition = functions[byID] ?? functions[step.functionName.trimmingCharacters(in: .whitespacesAndNewlines)]
    else {
      let named = step.functionName.isEmpty ? (step.functionId ?? "") : step.functionName
      return .failed(error: "Unknown function \"\(named)\"", step: index + 1)
    }
    var args: [String: SiteValue] = [:]
    do {
      for (position, parameter) in definition.parameters.enumerated() where position < step.args.count {
        let expression = step.args[position]
        if !expression.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
          args[parameter.name] = try evaluateExpression(expression, scope)
        }
      }
    } catch {
      return .failed(error: "Step \(index + 1): \((error as? SiteFunctionError)?.message ?? "\(error)")", step: index + 1)
    }
    switch evaluateHostFunction(definition, args, globals: siteVariables, invokeWorkflow: invoke) {
    case .failed(let error):
      return .failed(error: "Step \(index + 1) (\(definition.name)): \(error)", step: index + 1)
    case .ok(let value, _):
      let named = step.resultName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      let resultName = named.isEmpty ? "step\(index + 1)" : named
      scope[resultName] = value
      // A record keeps a re-bound key where it first went, as a JavaScript object does.
      if let at = results.firstIndex(where: { $0.name == resultName }) {
        results[at].value = value
      } else {
        results.append((resultName, value))
      }
    }
  }
  let returnName = workflow.returnValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
  let value = !returnName.isEmpty && scope[returnName] != nil ? scope[returnName]! : results.last?.value ?? .text("")
  return .ok(value: value, results: results)
}

// MARK: - Host events

/// Every host event in picker order.
public var hostEvents: [HostEventDeclaration] {
  ContractValues.shared.hostEvents.sorted { $0.order < $1.order }
}

/// `formSubmission` → `Form submitted`; a custom event keeps its own name.
public func hostEventLabel(_ event: String?) -> String {
  let key = (event ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  if key.isEmpty { return "Event" }
  return ContractValues.shared.hostEvents.first { $0.type == key }?.label ?? key
}

/// One sentence naming what a trigger's filter and conditions can read, or nil.
public func hostEventPayloadHint(_ event: String?) -> String? {
  guard let keys = ContractValues.shared.hostEvents.first(where: { $0.type == (event ?? "") })?.payloadKeys,
    !keys.isEmpty
  else { return nil }
  return "In scope: \(keys.joined(separator: ", "))."
}

/// Whether the event is the recipient's own action (a form submitted, a booking, a sign-up).
public func hostEventRecipientActed(_ event: String?) -> Bool {
  let key = (event ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  return ContractValues.shared.hostEvents.contains { $0.type == key && $0.recipientActed == true }
}

/// Whether the event is one the platform or a plugin declares.
public func isHostEventType(_ event: String?) -> Bool {
  ContractValues.shared.hostEvents.contains { $0.type == (event ?? "") }
}

// MARK: - Loose values

/// JavaScript's `String(value ?? '')` over a plain value.
func looseString(_ value: Any?) -> String {
  switch value {
  case nil, is NSNull: return ""
  case let text as String: return text
  case let number as NSNumber: return looseIsBool(number) ? (number.boolValue ? "true" : "false") : jsNumberString(number.doubleValue)
  default: return "\(value!)"
  }
}
