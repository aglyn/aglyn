// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

// The editors' drafts: what each dialog holds while a person edits it, read
// from a stored document and turned back into the fields the console saves.
// Pure, so the shapes are unit-tested.

/// One step in an editor: its stored fields, unchanged except where edited, so a
/// step this build does not type round-trips as it was.
struct StepDraft: Identifiable {
  let id = UUID()
  var fields: [String: Any]

  var type: String? { fields["type"] as? String }
  /// A workflow's function call (no Actions `type`).
  var isFunctionCall: Bool { !isWorkflowActionStep(fields) }

  init(_ fields: [String: Any]) { self.fields = fields }

  func string(_ key: String) -> String { fields[key] as? String ?? "" }
}

/// The value the "Do" picker stores for a function call.
let functionCallKind = "__functionCall__"

/// A blank function call, as a new workflow step starts.
func blankFunctionCall() -> [String: Any] { ["functionName": "", "args": [String](), "resultName": ""] }

// MARK: - Conditions

/// The trigger's "Form is…" row: `{field: formId, op: equals}`.
let formIsOp = "formIs"
let formIDField = "formId"

struct ConditionRow: Identifiable, Equatable {
  let id = UUID()
  /// `""` (always), `notEmpty`, `equals`, `contains`, or `formIs`.
  var op: String
  var field: String
  var value: String

  static func empty() -> ConditionRow { ConditionRow(op: "", field: "", value: "") }
  static func == (a: Self, b: Self) -> Bool { a.op == b.op && a.field == b.field && a.value == b.value }
}

/// A trigger's conditions as editor rows; a `formId equals` is a "Form is…" row; none is one "Always" row.
func conditionRowsFromTrigger(_ trigger: [String: Any]?) -> [ConditionRow] {
  let rows = normalizeTriggerConditions(trigger).map { condition -> ConditionRow in
    let field = condition["field"] as? String ?? ""
    let op = condition["op"] as? String ?? ""
    let value = condition["value"] as? String ?? ""
    if field.trimmingCharacters(in: .whitespaces) == formIDField && op == "equals" {
      return ConditionRow(op: formIsOp, field: formIDField, value: value)
    }
    return ConditionRow(op: op, field: field, value: value)
  }
  return rows.isEmpty ? [.empty()] : rows
}

/// The rows as a trigger stores them; nothing when every row is "Always".
func conditionsFromRows(_ rows: [ConditionRow], combinator: String) -> (conditions: [[String: Any]], combinator: String)? {
  let set = rows.filter { !$0.op.isEmpty }
  guard !set.isEmpty else { return nil }
  let conditions = set.map { row -> [String: Any] in
    if row.op == formIsOp {
      return ["field": formIDField, "op": "equals", "value": row.value.trimmingCharacters(in: .whitespacesAndNewlines)]
    }
    var condition: [String: Any] = ["field": row.field.trimmingCharacters(in: .whitespacesAndNewlines), "op": row.op]
    if row.op != "notEmpty" { condition["value"] = row.value.trimmingCharacters(in: .whitespacesAndNewlines) }
    return condition
  }
  return (conditions, combinator)
}

// MARK: - Workflow

struct WorkflowDraft {
  var id: String?
  var name = ""
  var steps: [StepDraft] = [StepDraft(blankFunctionCall())]
  var returnValue = ""
  /// nil is "Manual only".
  var triggerEvent: String?
  var triggerFilter = ""
  /// Fields of the stored trigger this editor does not show, kept as they were.
  var triggerExtra: [String: Any] = [:]

  init() {}

  init(id: String, data: [String: Any]) {
    self.id = id
    name = data["name"] as? String ?? ""
    steps = (data["steps"] as? [Any] ?? []).map { StepDraft($0 as? [String: Any] ?? [:]) }
    returnValue = data["returnValue"] as? String ?? ""
    if let trigger = data["trigger"] as? [String: Any], let event = trigger["event"] as? String {
      triggerEvent = event
      triggerFilter = trigger["filter"] as? String ?? ""
      triggerExtra = trigger.filter { $0.key != "event" && $0.key != "filter" }
    }
  }

  var stepDocuments: [[String: Any]] { steps.map(\.fields) }

  var trigger: Any {
    guard let triggerEvent else { return NSNull() }
    var trigger = triggerExtra
    trigger["event"] = triggerEvent
    trigger["filter"] = triggerFilter
    return trigger
  }

  /// What the console saves: `{name: trim().slice(0, 60), steps, returnValue, trigger}`.
  var fields: [String: Any] {
    [
      "name": jsSliceText(name.trimmingCharacters(in: .whitespacesAndNewlines), 60), "steps": stepDocuments,
      "returnValue": returnValue, "trigger": trigger,
    ]
  }

  /// The save's refusal: an unreadable filter, else a step the editors refuse.
  var problem: String? {
    triggerFilterProblem(triggerEvent == nil ? nil : triggerFilter, remedy: "action")
      ?? validateWorkflowSteps(stepDocuments)
  }

  /// The draft as `workflowFunctionCalls` reads it, for the test run.
  var document: [String: Any] { fields.merging(["name": name]) { _, new in new } }

  func nameTaken(among rows: [WorkflowRow]) -> Bool {
    let wanted = name.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return rows.contains { $0.name.lowercased() == wanted && $0.id != id }
  }
}

/// The site's functions keyed by id and by name, as a workflow resolves them.
func functionMap(_ docs: [FirestoreDocument]) -> [String: HostFunctionDefinition] {
  var map: [String: HostFunctionDefinition] = [:]
  for doc in docs where !isDeleted(doc.data) {
    let definition = HostFunctionDefinition(doc.data)
    map[doc.id] = definition
    if !definition.name.isEmpty { map[definition.name] = definition }
  }
  return map
}

/// The site's variables by name, as the test run reads them.
func variableList(_ docs: [FirestoreDocument]) -> [(key: String, variable: HostVariableValue)] {
  docs.filter { !isDeleted($0.data) && !(($0.data["name"] as? String) ?? "").isEmpty }.map {
    ($0.data["name"] as! String, HostVariableValue($0.data))
  }
}

/// The test run's line: `Result: 22 (d=10, step2=22)` or `Error: …`.
func workflowTestResult(_ draft: WorkflowDraft, functions: [String: HostFunctionDefinition], variables: [(key: String, variable: HostVariableValue)]) -> String {
  let calls = WorkflowDefinition(workflowFunctionCalls(draft.document))
  switch runWorkflow(calls, functions: functions, variables: variables) {
  case .failed(let error, _): return "Error: \(error)"
  case .ok(let value, let results):
    return "Result: \(value) (\(results.map { "\($0.name)=\($0.value)" }.joined(separator: ", ")))"
  }
}

// MARK: - Action

let customEventValue = "__custom__"

enum ActionFrequency: String, CaseIterable, Identifiable {
  case pageview = "", every, session, visitor, cooldown
  var id: String { rawValue }
  var label: String {
    switch self {
    case .pageview: "Every matching pageview"
    case .every: "Every occurrence (repeatable)"
    case .session: "Once per session"
    case .visitor: "Once per visitor"
    case .cooldown: "With a cooldown"
    }
  }
}

struct ActionDraft {
  var id: String?
  var name = ""
  /// A host event, a site event, or `customEventValue`.
  var event = "formSubmission"
  var customEvent = ""
  var filter = ""
  var selector = ""
  var threshold = ""
  var pathPattern = ""
  var frequency: ActionFrequency = .pageview
  var cooldownMinutes = "60"
  var conditionRows: [ConditionRow] = [.empty()]
  var combinator = "and"
  var steps: [StepDraft] = [StepDraft(defaultAutomationStep("siteAlert"))]
  var enabled = true
  /// The recipe stamp: absent (nil) on a document from before stamps, `NSNull` for one
  /// begun blank (every new one), or a recipe id — kept as it was.
  var recipe: Any? = NSNull()

  init() {}

  init(id: String, data: [String: Any]) {
    self.id = id
    name = data["name"] as? String ?? ""
    let trigger = data["trigger"] as? [String: Any] ?? [:]
    let stored = trigger["event"] as? String ?? ""
    let builtIn = isHostEventType(stored) || isSiteEventType(stored)
    event = builtIn ? stored : customEventValue
    customEvent = builtIn ? "" : stored
    filter = trigger["filter"] as? String ?? ""
    selector = trigger["selector"] as? String ?? ""
    if let threshold = trigger["threshold"] as? NSNumber { self.threshold = jsNumberString(threshold.doubleValue) }
    pathPattern = trigger["pathPattern"] as? String ?? ""
    let cooldown = (trigger["cooldownMinutes"] as? NSNumber)?.doubleValue ?? 0
    if looseIsTrueValue(trigger["oncePerVisitor"]) {
      frequency = .visitor
    } else if looseIsTrueValue(trigger["oncePerSession"]) {
      frequency = .session
    } else if cooldown >= 1 {
      frequency = .cooldown
    } else if looseIsTrueValue(trigger["everyTime"]) {
      frequency = .every
    }
    if cooldown >= 1 { cooldownMinutes = jsNumberString(cooldown) }
    conditionRows = conditionRowsFromTrigger(trigger)
    combinator = trigger["combinator"] as? String == "or" ? "or" : "and"
    steps = (data["steps"] as? [Any] ?? []).map { StepDraft($0 as? [String: Any] ?? [:]) }
    enabled = !looseIsFalseValue(data["enabled"])
    recipe = data["recipe"]
  }

  var triggerEvent: String { event == customEventValue ? customEvent.trimmingCharacters(in: .whitespacesAndNewlines) : event }

  /// What the console validates and saves: trigger keys only when set.
  var candidate: [String: Any] {
    var trigger: [String: Any] = ["event": triggerEvent]
    let clean = { (text: String) in text.trimmingCharacters(in: .whitespacesAndNewlines) }
    if !clean(filter).isEmpty { trigger["filter"] = clean(filter) }
    if !clean(selector).isEmpty { trigger["selector"] = clean(selector) }
    if let value = Double(clean(threshold)), value > 0 { trigger["threshold"] = jsWhole(value) }
    if !clean(pathPattern).isEmpty { trigger["pathPattern"] = clean(pathPattern) }
    if frequency == .visitor { trigger["oncePerVisitor"] = true }
    if frequency == .session { trigger["oncePerSession"] = true }
    if frequency == .cooldown, let minutes = Double(clean(cooldownMinutes)), minutes >= 1 {
      trigger["cooldownMinutes"] = jsWhole(minutes)
    }
    if frequency == .every { trigger["everyTime"] = true }
    if case let (conditions, combinator)? = conditionsFromRows(conditionRows, combinator: combinator) {
      trigger["conditions"] = conditions
      trigger["combinator"] = combinator
    }
    var action: [String: Any] = [
      "name": jsSliceText(clean(name), 60), "trigger": trigger, "steps": steps.map(\.fields), "enabled": enabled,
    ]
    if let recipe { action["recipe"] = recipe }
    return action
  }

  /// A recipe a stored stamp names that this build does not declare is still the document's own.
  var knownRecipes: Set<String> {
    var known = declaredInteractionRecipes
    if let stamp = recipe as? String { known.insert(stamp) }
    return known
  }
}

/// A number as JavaScript keeps it: whole numbers as integers.
func jsWhole(_ value: Double) -> Any {
  value == value.rounded() && abs(value) < 1e15 ? Int(value) as Any : value as Any
}

func looseIsTrueValue(_ value: Any?) -> Bool {
  guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return false }
  return number.boolValue
}

// MARK: - Org automation

struct OrgAutomationDraft {
  var id: String?
  var name = ""
  var event = "formSubmission"
  var filter = ""
  var conditionRows: [ConditionRow] = [.empty()]
  var combinator = "and"
  var steps: [StepDraft] = [StepDraft(defaultAutomationStep("sendEmail"))]
  var enabled = true
  var everySite = true
  var siteIDs: [String] = []

  init() {}

  init(id: String, data: [String: Any]) {
    self.id = id
    name = data["name"] as? String ?? ""
    let trigger = data["trigger"] as? [String: Any] ?? [:]
    let stored = trigger["event"] as? String ?? ""
    event = orgAutomationTriggerEvents.contains(stored) ? stored : "formSubmission"
    filter = trigger["filter"] as? String ?? ""
    conditionRows = conditionRowsFromTrigger(trigger)
    combinator = trigger["combinator"] as? String == "or" ? "or" : "and"
    steps = (data["steps"] as? [Any] ?? []).map { StepDraft($0 as? [String: Any] ?? [:]) }
    enabled = !looseIsFalseValue(data["enabled"])
    let visibleTo = (data["visibleTo"] as? [Any] ?? []).compactMap { $0 as? String }
    everySite = visibleTo.contains("org")
    siteIDs = visibleTo.compactMap { $0.hasPrefix("host:") ? String($0.dropFirst(5)) : nil }
  }

  var placement: [String] { everySite ? ["org"] : siteIDs.map { "host:\($0)" } }

  /// The body the manage route takes.
  var body: [String: Any] {
    var trigger: [String: Any] = ["event": event]
    let cleanFilter = filter.trimmingCharacters(in: .whitespacesAndNewlines)
    if !cleanFilter.isEmpty { trigger["filter"] = cleanFilter }
    if case let (conditions, combinator)? = conditionsFromRows(conditionRows, combinator: combinator) {
      trigger["conditions"] = conditions
      trigger["combinator"] = combinator
    }
    return [
      "name": name.trimmingCharacters(in: .whitespacesAndNewlines), "trigger": trigger, "steps": steps.map(\.fields),
      "enabled": enabled, "visibleTo": placement,
    ]
  }

  var tooManySites: Bool { !everySite && siteIDs.count > maxScopeHosts }
}

// MARK: - Step vocabulary for pickers

struct StepKind: Identifiable, Hashable {
  let value: String
  let label: String
  var id: String { value }
}

/// Every Actions step, as the actions builder's "Do" picker offers it.
let actionStepKinds: [StepKind] = hostActionStepLabels.map { StepKind(value: $0.type, label: $0.label) }
/// A workflow's: a function call, then every step a server event can run.
let workflowStepKinds: [StepKind] =
  [StepKind(value: functionCallKind, label: "Call a function")]
  + workflowActionStepTypes.map { StepKind(value: $0, label: workflowStepTypeLabel($0)) }
/// An org automation's.
let orgStepKinds: [StepKind] = orgAutomationStepTypes.map { StepKind(value: $0, label: workflowStepTypeLabel($0)) }

/// The durations a wait may be set to.
let flowWaitPresets: [(minutes: Int, label: String)] = [
  (5, "5 minutes"), (30, "30 minutes"), (60, "1 hour"), (240, "4 hours"), (1440, "1 day"), (2880, "2 days"),
  (4320, "3 days"), (10080, "1 week"), (20160, "2 weeks"), (43200, "30 days"), (86400, "60 days"), (129600, "90 days"),
]

/// A stored duration off the preset list, in words: `90 minutes`, `5 days`.
func durationLabel(_ minutes: Int) -> String {
  if minutes % 1440 == 0 { return "\(minutes / 1440) day\(minutes == 1440 ? "" : "s")" }
  if minutes % 60 == 0 { return "\(minutes / 60) hour\(minutes == 60 ? "" : "s")" }
  return "\(minutes) minute\(minutes == 1 ? "" : "s")"
}

let lifecycleStageLabels: [String: String] = [
  "subscriber": "Subscriber", "lead": "Lead", "marketing-qualified": "Marketing qualified",
  "sales-qualified": "Sales qualified", "opportunity": "Opportunity", "customer": "Customer",
  "evangelist": "Evangelist", "other": "Other",
]
let taskKindLabels: [String: String] = ["call": "Call", "email": "Email", "meeting": "Meeting", "todo": "To-do"]
let taskPriorityOptions: [(value: String, label: String)] = [("high", "High"), ("normal", "Normal"), ("low", "Low")]
let activityKindLabels: [String: String] = [
  "call": "Call", "email": "Email", "meeting": "Meeting", "note": "Note", "other": "Other",
]
let activityDirectionLabels: [String: String] = ["outbound": "Outbound", "inbound": "Inbound", "internal": "Internal"]

let sendEmailMergeHelp =
  "Merge tags: {{firstName|there}}, {{name}}, {{email}}, or {{contact.firstName}}, {{lead.company}}, {{site.name}} — filled from the contact or lead the event is about; the text after | is used when there is no value."

/// A teammate typed as one field: an address is `{role}Email`, anything else `{role}Uid`, blank clears both.
func memberReference(_ step: inout [String: Any], role: String, _ value: String) {
  let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
  step.removeValue(forKey: "\(role)Email")
  step.removeValue(forKey: "\(role)Uid")
  guard !text.isEmpty else { return }
  if text.contains("@") { step["\(role)Email"] = value } else { step["\(role)Uid"] = text }
}

/// A picker whose stored reference is a placeholder name and no id.
func placeholderReferenceHelp(name: Any?, id: Any?, noun: String) -> String? {
  guard ((id as? String) ?? "").trimmingCharacters(in: .whitespaces).isEmpty, let words = draftPlaceholderIn(name) else {
    return nil
  }
  return "Pick the \(noun) — the draft asked for “\(words)”"
}

/// The plain text fields of each client step the native editor shows, with their console labels.
struct PlainField {
  let key: String
  let label: String
  var placeholder: String? = nil
  var multiline = false
  var optional = false
}

let elementSelectorPlaceholder = "[data-aglyn=\"leaf:…\"] or .my-class"

let clientStepFields: [String: [PlainField]] = [
  "stickyNav": [PlainField(key: "selector", label: "Selector (default: header/nav)")],
  "addClass": [PlainField(key: "selector", label: "CSS selector"), PlainField(key: "className", label: "Class name")],
  "removeClass": [PlainField(key: "selector", label: "CSS selector"), PlainField(key: "className", label: "Class name")],
  "toggleClass": [PlainField(key: "selector", label: "CSS selector"), PlainField(key: "className", label: "Class name")],
  "showElement": [PlainField(key: "selector", label: "CSS selector", placeholder: elementSelectorPlaceholder)],
  "hideElement": [PlainField(key: "selector", label: "CSS selector", placeholder: elementSelectorPlaceholder)],
  "toggleElement": [PlainField(key: "selector", label: "CSS selector", placeholder: elementSelectorPlaceholder)],
  "playVideo": [PlainField(key: "selector", label: "CSS selector", placeholder: elementSelectorPlaceholder)],
  "scrollTo": [PlainField(key: "selector", label: "CSS selector", placeholder: elementSelectorPlaceholder)],
  "setAttribute": [
    PlainField(key: "selector", label: "CSS selector", placeholder: elementSelectorPlaceholder),
    PlainField(key: "name", label: "Attribute", placeholder: "aria-expanded"),
    PlainField(key: "value", label: "Value", placeholder: "true"),
  ],
  "removeAttribute": [
    PlainField(key: "selector", label: "CSS selector", placeholder: elementSelectorPlaceholder),
    PlainField(key: "name", label: "Attribute", placeholder: "aria-expanded"),
  ],
  "openDrawer": [PlainField(key: "drawerNodeId", label: "Drawer node id (optional)", placeholder: "Empty = the page's first drawer", optional: true)],
  "closeDrawer": [PlainField(key: "drawerNodeId", label: "Drawer node id (optional)", placeholder: "Empty = the page's first drawer", optional: true)],
  "toggleDrawer": [PlainField(key: "drawerNodeId", label: "Drawer node id (optional)", placeholder: "Empty = the page's first drawer", optional: true)],
  "openMenu": [PlainField(key: "menuNodeId", label: "Menu node id (optional)", placeholder: "Empty = the page's first menu", optional: true)],
  "closeMenu": [PlainField(key: "menuNodeId", label: "Menu node id (optional)", placeholder: "Empty = the page's first menu", optional: true)],
  "toggleMenu": [PlainField(key: "menuNodeId", label: "Menu node id (optional)", placeholder: "Empty = the page's first menu", optional: true)],
  "showHtml": [PlainField(key: "html", label: "HTML", multiline: true)],
  "runJs": [PlainField(key: "code", label: "JavaScript", multiline: true)],
  "redirect": [PlainField(key: "url", label: "Destination URL")],
  "trackGaEvent": [PlainField(key: "eventName", label: "Analytics event name")],
]

/// Whether an attribute name is one an interaction may write (`aria-*` or `data-*`).
func isInteractionAttributeAllowed(_ name: String) -> Bool {
  name.trimmingCharacters(in: .whitespaces).lowercased().range(of: #"^(?:aria|data)-[a-z][a-z0-9-]*$"#, options: .regularExpression) != nil
}
