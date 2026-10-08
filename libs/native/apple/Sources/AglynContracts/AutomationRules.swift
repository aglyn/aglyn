// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// THE AUTOMATION RULES, as the console's Automation editors check them before
// they write: an action (a site interaction with server steps), a workflow's
// steps, an org automation, a trigger's filter, the stored shape of an action,
// the transactional-reply switch, placeholders in a drafted automation, and how
// a run row reads. Ported from libs/plugins/workflows/src/lib/model/{host-actions,
// org-automations}.ts, engine/workflow-steps.ts and libs/aglyn/src/lib/app-utils/
// {site-interactions,draft-placeholders,activity-presenter,scope-tokens,crm-kinds}.ts.
// automation-cases.generated.json holds the console's own answers.
//
// Documents are plain dictionaries (`[String: Any]`, as Firestore and JSON give
// them), because an action carries steps this build does not type and an edit
// must write them back unchanged.

public typealias AutomationDocument = [String: Any]

// MARK: - Vocabulary

/// Every step an action may hold, in the editor's "Do" order, with its label.
public let hostActionStepLabels: [(type: String, label: String)] = [
  ("runWorkflow", "Run a workflow"),
  ("siteAlert", "Show a site alert"),
  ("customEvent", "Fire a custom event"),
  ("datasetAppend", "Write to a dataset"),
  ("webhookPost", "Send a webhook (Business)"),
  ("showOverlay", "Show a popup or bar"),
  ("stickyNav", "Make navigation sticky"),
  ("addClass", "Add a CSS class"),
  ("toggleClass", "Toggle a CSS class"),
  ("removeClass", "Remove a CSS class"),
  ("showElement", "Show an element"),
  ("hideElement", "Hide an element"),
  ("toggleElement", "Show/hide an element"),
  ("openDrawer", "Open a drawer"),
  ("closeDrawer", "Close a drawer"),
  ("toggleDrawer", "Open/close a drawer"),
  ("openMenu", "Open a menu"),
  ("closeMenu", "Close a menu"),
  ("toggleMenu", "Open/close a menu"),
  ("setAttribute", "Set an ARIA or data attribute"),
  ("removeAttribute", "Remove an ARIA or data attribute"),
  ("scrollTo", "Scroll to element"),
  ("playVideo", "Play a video"),
  ("showHtml", "Show custom HTML"),
  ("runJs", "Run custom JS (Business)"),
  ("redirect", "Redirect the visitor"),
  ("trackGaEvent", "Track an analytics event"),
  ("sendEmail", "Send an email"),
  ("notifyAdmins", "Notify site admins"),
  ("enrollList", "Enroll in a list"),
  ("updateDataset", "Update a dataset record"),
  ("assignCampaign", "Assign to a campaign"),
  ("wait", "Wait"),
  ("waitForEvent", "Wait for something to happen"),
  ("exitFlow", "End the flow here"),
  ("setContactStage", "Set the contact’s lifecycle stage"),
  ("addContactTag", "Tag the contact"),
  ("assignContactOwner", "Assign the contact an owner"),
  ("createCrmTask", "Create a CRM task"),
  ("logCrmActivity", "Log a CRM activity"),
]

private let stepLabelMap: [String: String] = Dictionary(uniqueKeysWithValues: hostActionStepLabels.map { ($0.type, $0.label) })

/// A step type's label, or nil for a type no vocabulary holds.
public func hostActionStepLabel(_ type: String?) -> String? { type.flatMap { stepLabelMap[$0] } }

/// How a step type reads in a sentence: its label, or its raw type.
public func workflowStepTypeLabel(_ type: String) -> String { stepLabelMap[type] ?? type }

/// The steps the visitor's page runs (`CLIENT_ACTION_STEP_TYPES`).
public let clientActionStepTypes: Set<String> = [
  "showOverlay", "stickyNav", "addClass", "removeClass", "toggleClass", "showElement", "hideElement",
  "toggleElement", "openDrawer", "closeDrawer", "toggleDrawer", "openMenu", "closeMenu", "toggleMenu",
  "setAttribute", "removeAttribute", "scrollTo", "playVideo", "showHtml", "runJs", "redirect", "trackGaEvent",
  "siteAlert",
]

/// The Actions steps a workflow may hold: every server step, and `siteAlert`.
public let workflowActionStepTypes: [String] = hostActionStepLabels.map(\.type).filter {
  $0 == "siteAlert" || !clientActionStepTypes.contains($0)
}

/// Client-side site events the page runtime emits.
public let siteEventTypes = [
  "scrollDepth", "scrollToElement", "elementClick", "elementVisible", "elementHoverEnter", "elementHoverLeave",
  "exitIntent", "timeOnPage", "pageVisit",
]

/// Site events that watch an element and need a selector.
public let elementScopedSiteEvents = [
  "scrollToElement", "elementClick", "elementVisible", "elementHoverEnter", "elementHoverLeave",
]

public func isSiteEventType(_ event: String?) -> Bool { siteEventTypes.contains(event ?? "") }

/// The events an org automation may start on.
public let orgAutomationTriggerEvents = [
  "formSubmission", "lead", "contactCreated", "contactStageChanged", "booking", "memberSignUp", "memberSignIn",
  "dealStageChanged", "dealWon", "dealLost", "taskCompleted",
]

/// The steps an org automation may hold, in its picker's order.
public let orgAutomationStepTypes = [
  "sendEmail", "notifyAdmins", "enrollList", "assignCampaign", "datasetAppend", "updateDataset", "setContactStage",
  "addContactTag", "assignContactOwner", "createCrmTask", "logCrmActivity", "customEvent", "wait", "waitForEvent",
  "exitFlow",
]

/// Why a `sendEmail` step cannot be a transactional reply, as the editor says it.
public let sendEmailReplyIneligibleReasons: [String: String] = [
  "event": "only a reply to the person’s own form submission, booking or sign-up can be transactional",
  "wait": "an email after a wait is a mailing, so it keeps its unsubscribe link",
  "topic": "an email in a topic is a mailing, so it keeps its unsubscribe link",
  "recipient": "only an email to the person who acted can be a transactional reply",
]

public let triggerConditionOps = ["equals", "contains", "notEmpty"]
public let triggerCombinators = ["and", "or"]
public let actionMaxConditions = 5
public let actionMaxSteps = 10
public let actionsMaxPerHost = 500
public let webhookMaxPerHost = 5
public let orgAutomationsMax = 100
public let orgAutomationNameMax = 60
public let maxScopeHosts = 30
public let flowWaitMinMinutes = 1
public let flowWaitMaxMinutes = 90 * 24 * 60
public let contactTagMaxLength = 60
public let crmTaskMaxDueDays = 365
public let contactLifecycleStages = [
  "subscriber", "lead", "marketing-qualified", "sales-qualified", "opportunity", "customer", "evangelist", "other",
]
public let crmTaskKinds = ["call", "email", "meeting", "todo"]
public let crmTaskPriorities = ["low", "normal", "high"]
public let crmActivityKinds = ["call", "email", "meeting", "note", "other"]
/// The directions a logged call or email takes; no other kind takes one.
public let crmActivityDirections: [String: [String]] = [
  "call": ["outbound", "inbound", "internal"], "email": ["outbound", "inbound"],
]

/// The interaction recipes the first-party plugins declare.
public let declaredInteractionRecipes: Set<String> = ["welcomeNewLead", "followUpWonDeal", "reengageStaleLead", "tagByForm"]

/// Custom event names: short, no collision with built-ins.
public func matchesCustomEventPattern(_ text: String) -> Bool {
  text.range(of: #"^[a-zA-Z][a-zA-Z0-9_-]{1,39}$"#, options: .regularExpression) != nil
}

/// A custom (non-built-in) event name an action may fire.
public func isCustomEventName(_ event: String) -> Bool { !isHostEventType(event) && matchesCustomEventPattern(event) }

// MARK: - Loose JavaScript reads

/// `typeof value === 'string'` and its value.
func looseText(_ value: Any?) -> String? { value as? String }

/// `value?.trim()` over a value that should be a text; anything else is empty.
func trimmed(_ value: Any?) -> String { (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "" }

/// JavaScript truthiness.
func looseTruthy(_ value: Any?) -> Bool {
  switch value {
  case nil, is NSNull: return false
  case let text as String: return !text.isEmpty
  case let number as NSNumber:
    return looseIsBool(number) ? number.boolValue : !(number.doubleValue == 0 || number.doubleValue.isNaN)
  default: return true
  }
}

/// JavaScript's `Number(value)`: undefined is NaN, null is 0.
func looseNumber(_ value: Any?) -> Double {
  switch value {
  case nil: return .nan
  case is NSNull: return 0
  case let text as String: return jsNumberFromText(text)
  case let number as NSNumber: return looseIsBool(number) ? (number.boolValue ? 1 : 0) : number.doubleValue
  default: return .nan
  }
}

/// `Number.isInteger(value)`: a number, whole.
func looseInteger(_ value: Any?) -> Int? {
  guard let number = value as? NSNumber, !looseIsBool(number) else { return nil }
  let double = number.doubleValue
  return double.isFinite && double == double.rounded() ? Int(double) : nil
}

/// `value === true`.
func looseIsTrue(_ value: Any?) -> Bool { (value as? NSNumber).map { looseIsBool($0) && $0.boolValue } ?? false }
/// `value === false`.
func looseIsFalse(_ value: Any?) -> Bool { (value as? NSNumber).map { looseIsBool($0) && !$0.boolValue } ?? false }

/// `text.slice(0, n)` in UTF-16 units.
func jsSlice(_ text: String, _ count: Int) -> String {
  let units = Array(text.utf16.prefix(count))
  return String(decoding: units, as: UTF16.self)
}

/// JavaScript's `text.length`.
func jsLength(_ text: String) -> Int { text.utf16.count }

// MARK: - Trigger conditions

/// A trigger's condition clauses as a list: `conditions` when it is one, else a legacy `condition`.
public func normalizeTriggerConditions(_ trigger: AutomationDocument?) -> [AutomationDocument] {
  if let conditions = trigger?["conditions"] as? [Any] {
    return conditions.compactMap { looseTruthy($0) ? $0 as? AutomationDocument ?? [:] : nil }
  }
  if let condition = trigger?["condition"] as? AutomationDocument { return [condition] }
  return []
}

private let filterComparison = #"[=!<>]|&&|\|\|"#

/// Why a trigger's free-text filter can never run, or nil. `remedy` is `action`
/// for a workflow's trigger (which has no conditions beside it).
public func triggerFilterProblem(_ filter: String?, remedy: String? = nil) -> String? {
  let text = (filter ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
  if text.isEmpty { return nil }
  let fix =
    remedy == "action"
    ? "start the workflow from an action with a condition (for example: source equals form) instead"
    : "use a condition instead (for example: source equals form)"
  let withoutStrings = text.replacingOccurrences(of: #""[^"]*"|'[^']*'"#, with: "\"\"", options: .regularExpression)
  if withoutStrings.range(of: filterComparison, options: .regularExpression) != nil {
    return "A filter can’t compare values (no ==, !=, <, >, && or ||) — \(fix), and clear the filter"
  }
  if let syntax = expressionSyntaxError(text) {
    return "The filter can’t be read (\(syntax)) — \(fix), and clear the filter"
  }
  return nil
}

// MARK: - Validation

/// A step type the first-party plugins declare as PICKING a record, and what a step with no pick is told.
private let declaredPicks: [String: (idField: String, nameField: String, missing: String)] = [
  "showOverlay": ("overlayId", "overlayName", "pick an overlay"),
  "runWorkflow": ("workflowId", "workflowName", "pick a workflow"),
]

private func isFlowWaitMinutes(_ value: Any?) -> Bool {
  guard let minutes = looseInteger(value) else { return false }
  return minutes >= flowWaitMinMinutes && minutes <= flowWaitMaxMinutes
}

/// A server step's own complaint, or nil.
func hostActionStepProblem(_ step: AutomationDocument, _ label: String) -> String? {
  let type = step["type"] as? String ?? ""
  switch type {
  case "wait":
    if !isFlowWaitMinutes(step["delayMinutes"]) {
      return "\(label): wait between \(flowWaitMinMinutes) minute and \(flowWaitMaxMinutes) minutes"
    }
  case "waitForEvent":
    let waited = trimmed(step["eventName"])
    if waited.isEmpty || (!isHostEventType(waited) && !isCustomEventName(waited)) {
      return "\(label): pick the event to wait for"
    }
    if !isFlowWaitMinutes(step["timeoutMinutes"]) {
      return "\(label): give up after \(flowWaitMinMinutes)–\(flowWaitMaxMinutes) minutes"
    }
  case "customEvent":
    if !isCustomEventName(trimmed(step["eventName"])) {
      return "\(label): custom event names are 2–40 letters, digits, dashes"
    }
  case "datasetAppend", "updateDataset":
    if trimmed(step["datasetId"]).isEmpty && trimmed(step["datasetName"]).isEmpty { return "\(label): pick a dataset" }
  case "webhookPost":
    if trimmed(step["webhookId"]).isEmpty && trimmed(step["webhookName"]).isEmpty { return "\(label): pick a webhook" }
  case "sendEmail":
    if trimmed(step["subject"]).isEmpty { return "\(label): enter the subject" }
    if trimmed(step["body"]).isEmpty { return "\(label): enter the email body" }
  case "notifyAdmins":
    if trimmed(step["title"]).isEmpty { return "\(label): enter the notification title" }
  case "enrollList":
    if trimmed(step["listId"]).isEmpty && trimmed(step["listName"]).isEmpty { return "\(label): pick a list" }
  case "assignCampaign":
    if trimmed(step["campaignId"]).isEmpty && trimmed(step["campaignName"]).isEmpty {
      return "\(label): pick a campaign"
    }
  case "setContactStage":
    if !contactLifecycleStages.contains(step["lifecycleStage"] as? String ?? "\u{0}") {
      return "\(label): pick a lifecycle stage"
    }
  case "addContactTag":
    let tag = trimmed(step["tag"])
    if tag.isEmpty { return "\(label): enter the tag" }
    if jsLength(tag) > contactTagMaxLength { return "\(label): tags are at most \(contactTagMaxLength) characters" }
  case "assignContactOwner":
    let named = !trimmed(step["ownerUid"]).isEmpty || !trimmed(step["ownerEmail"]).isEmpty
    if looseIsTrue(step["roundRobin"]) && named { return "\(label): pick round robin or a member, not both" }
    if !looseIsTrue(step["roundRobin"]) && trimmed(step["ownerUid"]).isEmpty
      && !trimmed(step["ownerEmail"]).contains("@")
    {
      return "\(label): enter the owner’s email address"
    }
  case "createCrmTask":
    if trimmed(step["title"]).isEmpty { return "\(label): give the task a title" }
    if !crmTaskKinds.contains(step["kind"] as? String ?? "\u{0}") { return "\(label): pick the type of task" }
    if step.keys.contains("priority") && !crmTaskPriorities.contains(step["priority"] as? String ?? "\u{0}") {
      return "\(label): pick the task’s priority"
    }
    if let due = looseInteger(step["dueInDays"]), due >= 0, due <= crmTaskMaxDueDays {
    } else {
      return "\(label): due in 0–\(crmTaskMaxDueDays) days"
    }
    let assignee = trimmed(step["assigneeEmail"])
    if !assignee.isEmpty && !assignee.contains("@") { return "\(label): enter the assignee’s email address" }
  case "logCrmActivity":
    let kind = step["kind"] as? String ?? "\u{0}"
    if !crmActivityKinds.contains(kind) { return "\(label): pick the kind of activity" }
    if step.keys.contains("direction") {
      let directions = crmActivityDirections[kind] ?? []
      if !directions.contains(step["direction"] as? String ?? "\u{0}") {
        return directions.isEmpty
          ? "\(label): only a call or an email takes a direction"
          : "\(label): pick which way the \(kind) went"
      }
    }
    if trimmed(step["body"]).isEmpty { return "\(label): write what happened" }
  default: break
  }
  return nil
}

// GA4's own reserved event names and prefixes, which it drops on arrival.
private let ga4ReservedEventNames: Set<String> = [
  "ad_activeview", "ad_click", "ad_exposure", "ad_impression", "ad_query", "ad_reward", "adunit_exposure",
  "app_background", "app_clear_data", "app_exception", "app_install", "app_remove", "app_store_refund",
  "app_store_subscription_cancel", "app_store_subscription_convert", "app_store_subscription_renew", "app_update",
  "app_upgrade", "dynamic_link_app_open", "dynamic_link_app_update", "dynamic_link_first_open", "error",
  "first_open", "first_visit", "in_app_purchase", "notification_dismiss", "notification_foreground",
  "notification_open", "notification_receive", "os_update", "screen_view", "session_start", "user_engagement",
]
private let ga4ReservedPrefixes = ["firebase_", "google_", "ga_"]
private let deniedParamKeys: Set<String> = [
  "email", "email_address", "user_email", "name", "full_name", "first_name", "last_name", "user_name", "username",
  "customer_name", "org_name", "organization_name", "company", "company_name", "phone", "phone_number", "address",
  "street", "postal_code", "zip", "ip", "ip_address",
]

/// An author's analytics event name as GA4 takes it, or why it cannot be one.
func resolveAuthoredEventName(_ raw: String?) -> (name: String?, reserved: Bool) {
  var normalized = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
  normalized = normalized.replacingOccurrences(of: "[^a-z0-9_]+", with: "_", options: .regularExpression)
  normalized = normalized.replacingOccurrences(of: "^[^a-z]+", with: "", options: .regularExpression)
  normalized = normalized.replacingOccurrences(of: "_{2,}", with: "_", options: .regularExpression)
  normalized = String(normalized.prefix(40))
  normalized = normalized.replacingOccurrences(of: "_+$", with: "", options: .regularExpression)
  if normalized.isEmpty { return (nil, false) }
  if ga4ReservedEventNames.contains(normalized) || ga4ReservedPrefixes.contains(where: normalized.hasPrefix) {
    return (nil, true)
  }
  return (normalized, false)
}

/// Whether an analytics parameter value survives the runtime's scrub (no address in it).
private func paramValueKept(_ value: Any?) -> Bool {
  switch value {
  case nil, is NSNull: return false
  case let text as String:
    var candidate = text
    if candidate.range(of: "^https?://", options: [.regularExpression, .caseInsensitive]) != nil {
      guard let url = URLComponents(string: candidate), let scheme = url.scheme, let host = url.host else { return false }
      candidate = "\(scheme)://\(host)\(url.port.map { ":\($0)" } ?? "")\(url.path)"
    }
    if candidate.range(of: #"[^\s@]+@[^\s@]+\.[^\s@]+"#, options: .regularExpression) != nil { return false }
    return !candidate.isEmpty
  default: return true
  }
}

/// A client step's own complaint, or nil. The step's guard is checked by the caller.
private func clientStepProblem(_ step: AutomationDocument, _ label: String) -> String? {
  let type = step["type"] as? String ?? ""
  switch type {
  case "siteAlert":
    if trimmed(step["message"]).isEmpty { return "\(label): enter the alert message" }
  case "addClass", "removeClass", "toggleClass":
    if trimmed(step["selector"]).isEmpty { return "\(label): enter a CSS selector" }
    if trimmed(step["className"]).isEmpty { return "\(label): enter the class name" }
  case "showElement", "hideElement", "toggleElement":
    if trimmed(step["selector"]).isEmpty { return "\(label): pick the element to show or hide" }
    if let delay = step["delayMs"], !(delay is NSNull) {
      if let ms = looseInteger(delay), ms >= 0, ms <= 5000 {} else { return "\(label): delay must be 0–5000ms" }
    }
    if let dismiss = step["dismissOn"], !(dismiss is NSNull) {
      let options = dismiss as? [Any]
      if options == nil || !options!.allSatisfy({ ["escape", "outsideClick"].contains($0 as? String ?? "") }) {
        return "\(label): dismiss options are escape and outsideClick"
      }
    }
  case "scrollTo":
    if trimmed(step["selector"]).isEmpty { return "\(label): pick the element to scroll to" }
    if let behavior = step["behavior"], !(behavior is NSNull), !["smooth", "instant"].contains(behavior as? String ?? "") {
      return "\(label): scroll smoothly or instantly"
    }
    if let offset = step["offsetPx"], !(offset is NSNull) {
      if let px = looseInteger(offset), px >= 0, px <= 1000 {} else { return "\(label): the offset must be 0–1000px" }
    }
  case "playVideo":
    if trimmed(step["selector"]).isEmpty { return "\(label): pick the video to play" }
  case "showHtml":
    if trimmed(step["html"]).isEmpty { return "\(label): enter the HTML" }
  case "runJs":
    if trimmed(step["code"]).isEmpty { return "\(label): enter the JavaScript" }
  case "redirect":
    if trimmed(step["url"]).isEmpty && !looseTruthy(step["screenId"]) {
      return "\(label): pick a page or enter the destination URL"
    }
  case "trackGaEvent":
    let eventName = trimmed(step["eventName"])
    if eventName.isEmpty { return "\(label): name the analytics event" }
    let resolved = resolveAuthoredEventName(step["eventName"] as? String)
    if resolved.reserved { return "\(label): \"\(eventName)\" is a reserved analytics event name — pick another" }
    if resolved.name == nil { return "\(label): the analytics event name must start with a letter" }
    let params = (step["params"] as? AutomationDocument ?? [:]).sorted { $0.key < $1.key }
    if params.count > 10 { return "\(label): analytics parameters are capped at 10" }
    for (key, value) in params {
      let name = key.trimmingCharacters(in: .whitespacesAndNewlines)
      if name.isEmpty { return "\(label): name every analytics parameter" }
      if jsLength(name) > 40 {
        return "\(label): the \"\(jsSlice(name, 16))…\" parameter name is over 40 characters, which GA4 drops"
      }
      if looseString(value).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
        return "\(label): enter a value for the \"\(name)\" parameter"
      }
    }
    if let stripped = params.first(where: { deniedParamKeys.contains($0.key.lowercased()) || !paramValueKept($0.value) }) {
      return "\(label): the \"\(stripped.key)\" parameter is never sent — an analytics parameter must not carry a visitor's own details"
    }
  default: break
  }
  return nil
}

private func conditionProblem(_ condition: AutomationDocument) -> String? {
  if !triggerConditionOps.contains(condition["op"] as? String ?? "\u{0}") { return "Pick a condition operator" }
  if trimmed(condition["field"]).isEmpty { return "Name the field the condition checks" }
  if condition["op"] as? String != "notEmpty" && trimmed(condition["value"]).isEmpty {
    return "Enter the value the condition compares against"
  }
  return nil
}

/// Validates an action (a site interaction with server steps); the console's
/// words, or nil. `knownRecipes` are the recipe stamps a document may carry.
public func validateHostAction(_ action: AutomationDocument, knownRecipes: Set<String> = declaredInteractionRecipes) -> String? {
  if trimmed(action["name"]).isEmpty { return "Name the action" }
  if let recipe = action["recipe"], !(recipe is NSNull) {
    if !((recipe as? String).map { !$0.isEmpty && knownRecipes.contains($0) } ?? false) { return "Unknown recipe" }
  }
  let trigger = action["trigger"] as? AutomationDocument
  let event = trimmed(trigger?["event"])
  if event.isEmpty { return "Pick a trigger event" }
  if !isSiteEventType(event) && !matchesCustomEventPattern(event) {
    return "Custom event names are 2–40 letters, digits, dashes"
  }
  if elementScopedSiteEvents.contains(event) && trimmed(trigger?["selector"]).isEmpty {
    return "This trigger needs a CSS selector"
  }
  if ["scrollDepth", "timeOnPage"].contains(event) && !(looseNumber(trigger?["threshold"]) > 0) {
    return event == "scrollDepth" ? "Set the scroll percentage (1–100)" : "Set the seconds on page"
  }
  if let cooldown = trigger?["cooldownMinutes"], !(cooldown is NSNull), !(looseNumber(cooldown) >= 1) {
    return "Cooldown must be at least 1 minute"
  }
  if let problem = triggerFilterProblem(trigger?["filter"] as? String) { return problem }
  if let combinator = trigger?["combinator"], !(combinator is NSNull),
    !triggerCombinators.contains(combinator as? String ?? "")
  {
    return "Combine conditions with AND or OR"
  }
  let conditions = normalizeTriggerConditions(trigger)
  if conditions.count > actionMaxConditions { return "Conditions are capped at \(actionMaxConditions)" }
  for (index, condition) in conditions.enumerated() {
    if let problem = conditionProblem(condition) {
      return conditions.count > 1 ? "\(problem) (condition \(index + 1))" : problem
    }
  }
  let steps = (action["steps"] as? [Any] ?? []).map { $0 as? AutomationDocument ?? [:] }
  if steps.isEmpty { return "Add at least one step" }
  if steps.count > actionMaxSteps { return "Actions are capped at \(actionMaxSteps) steps" }
  for (index, step) in steps.enumerated() {
    let label = "Step \(index + 1)"
    let when = step["when"] as? AutomationDocument
    let clauses = (when?["conditions"] as? [Any] ?? []).compactMap { looseTruthy($0) ? $0 as? AutomationDocument ?? [:] : nil }
    if clauses.count > actionMaxConditions { return "\(label): conditions are capped at \(actionMaxConditions)" }
    if let combinator = when?["combinator"], !(combinator is NSNull), !triggerCombinators.contains(combinator as? String ?? "") {
      return "\(label): combine conditions with AND or OR"
    }
    for clause in clauses {
      if let problem = conditionProblem(clause) {
        return "\(label): \(problem.prefix(1).lowercased())\(problem.dropFirst())"
      }
    }
    if let owned = hostActionStepProblem(step, label) { return owned }
    if let picks = declaredPicks[step["type"] as? String ?? ""], trimmed(step[picks.idField]).isEmpty,
      trimmed(step[picks.nameField]).isEmpty
    {
      return "\(label): \(picks.missing)"
    }
    if clientActionStepTypes.contains(step["type"] as? String ?? "") {
      if let problem = clientStepProblem(step, label) { return problem }
    }
  }
  for (index, step) in steps.enumerated() where step["type"] as? String == "sendEmail" && looseIsTrue(step["transactional"]) {
    if let why = sendEmailReplyIneligibility(step, event: trigger?["event"] as? String, afterWait: stepRunsAfterWait(steps, index)) {
      return "Step \(index + 1): \(sendEmailReplyIneligibleReasons[why] ?? why)"
    }
  }
  return nil
}

// MARK: - Transactional replies and waits

/// Whether a step type suspends the run that reaches it.
public func isFlowSuspendingStep(_ step: AutomationDocument) -> Bool {
  ["wait", "waitForEvent"].contains(step["type"] as? String ?? "")
}

/// Whether the step at `index` runs after a wait earlier in the list.
public func stepRunsAfterWait(_ steps: [AutomationDocument], _ index: Int) -> Bool {
  steps.prefix(max(0, index)).contains(where: isFlowSuspendingStep)
}

/// Why a `sendEmail` step cannot be a transactional reply (`event`, `wait`, `topic`, `recipient`), or nil.
public func sendEmailReplyIneligibility(_ step: AutomationDocument, event: String?, afterWait: Bool) -> String? {
  if !hostEventRecipientActed(event) { return "event" }
  if afterWait { return "wait" }
  if !looseString(step["topicId"]).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "topic" }
  let toField = looseString(step["toField"]).trimmingCharacters(in: .whitespacesAndNewlines)
  if !toField.isEmpty && toField != "email" { return "recipient" }
  return nil
}

/// Whether a `sendEmail` step goes out as a transactional reply: it qualifies, and was not switched off.
public func sendEmailIsTransactionalReply(_ step: AutomationDocument, event: String?, afterWait: Bool) -> Bool {
  !looseIsFalse(step["transactional"]) && sendEmailReplyIneligibility(step, event: event, afterWait: afterWait) == nil
}

// MARK: - Workflow steps

/// Whether a stored workflow step is an Actions step (its `type` is in the vocabulary).
public func isWorkflowActionStep(_ step: Any?) -> Bool {
  guard let type = (step as? AutomationDocument)?["type"] as? String else { return false }
  return stepLabelMap[type] != nil
}

/// Whether a stored workflow step is a function call.
public func isWorkflowFunctionStep(_ step: Any?) -> Bool { step is AutomationDocument && !isWorkflowActionStep(step) }

/// Why a workflow cannot hold this Actions step, or nil.
public func workflowActionStepRefusal(_ step: AutomationDocument) -> String? {
  let type = step["type"] as? String ?? ""
  if workflowActionStepTypes.contains(type) { return nil }
  if let label = stepLabelMap[type] {
    return "“\(label)” runs in the visitor’s browser, so a workflow cannot run it — build it as an interaction in Actions"
  }
  return "“\(type)” is not a step a workflow can run"
}

/// A workflow's steps checked as the editors check them; nil, or the first problem.
public func validateWorkflowSteps(_ steps: Any?) -> String? {
  let list = steps as? [Any] ?? []
  if list.count > workflowMaxSteps { return "Workflows are capped at \(workflowMaxSteps) steps" }
  for (index, step) in list.enumerated() {
    let label = "Step \(index + 1)"
    guard isWorkflowActionStep(step), let step = step as? AutomationDocument else { continue }
    if let refusal = workflowActionStepRefusal(step) { return "\(label): \(refusal)" }
    if let problem = validateHostAction([
      "name": "workflow step", "trigger": ["event": "formSubmission"] as AutomationDocument, "steps": [step],
    ]) {
      return problem.replacingOccurrences(of: #"^Step 1\b"#, with: label, options: .regularExpression)
    }
  }
  return nil
}

/// A workflow's function calls as a workflow of their own; each keeps the result name its place gives it.
public func workflowFunctionCalls(_ workflow: AutomationDocument) -> AutomationDocument {
  var calls: [AutomationDocument] = []
  for (index, step) in (workflow["steps"] as? [Any] ?? []).enumerated() {
    guard isWorkflowFunctionStep(step), var call = step as? AutomationDocument else { continue }
    let named = trimmed(call["resultName"])
    call["resultName"] = named.isEmpty ? "step\(index + 1)" : named
    calls.append(call)
  }
  var copy = workflow
  copy["steps"] = calls
  return copy
}

// MARK: - Stored shape

/// An action as `hosts/{hostId}/actions/{id}` holds it: every optional trigger key written out.
public func siteInteractionDocument(_ interaction: AutomationDocument) -> AutomationDocument {
  var document = interaction
  document.removeValue(forKey: "recipe")
  var trigger = interaction["trigger"] as? AutomationDocument ?? [:]
  trigger["oncePerVisitor"] = looseIsTrue(trigger["oncePerVisitor"])
  trigger["oncePerSession"] = looseIsTrue(trigger["oncePerSession"])
  let cooldown = looseNumber(trigger["cooldownMinutes"])
  if cooldown >= 1 {
    trigger["cooldownMinutes"] = cooldown == cooldown.rounded() && cooldown < 1e15 ? Int(cooldown) as Any : cooldown as Any
  } else {
    trigger["cooldownMinutes"] = NSNull()
  }
  trigger["everyTime"] = looseIsTrue(trigger["everyTime"])
  trigger["condition"] = NSNull()
  trigger["conditions"] = trigger["conditions"] ?? NSNull()
  trigger["combinator"] = trigger["combinator"] ?? NSNull()
  document["trigger"] = trigger
  document["enabled"] = !looseIsFalse(interaction["enabled"])
  if let recipe = interaction["recipe"] { document["recipe"] = recipe }
  return document
}

// MARK: - Org automations

private let orgStepFields: [String: [(String, String)]] = [
  "sendEmail": [("subject", "200"), ("body", "5000"), ("toField", "64"), ("topicId", "128"), ("transactional", "boolean")],
  "notifyAdmins": [("title", "200"), ("body", "500")],
  "enrollList": [("listId", "128"), ("listName", "200")],
  "assignCampaign": [("campaignId", "128"), ("campaignName", "200")],
  "datasetAppend": [("datasetId", "128"), ("datasetName", "200")],
  "updateDataset": [("datasetId", "128"), ("datasetName", "200")],
  "setContactStage": [("lifecycleStage", "64")],
  "addContactTag": [("tag", "200")],
  "assignContactOwner": [("ownerUid", "128"), ("ownerEmail", "320"), ("roundRobin", "boolean")],
  "createCrmTask": [
    ("title", "200"), ("kind", "64"), ("priority", "16"), ("dueInDays", "number"), ("assigneeUid", "128"),
    ("assigneeEmail", "320"),
  ],
  "logCrmActivity": [("kind", "64"), ("body", "2000"), ("direction", "16")],
  "customEvent": [("eventName", "64")],
  "wait": [("delayMinutes", "number")],
  "waitForEvent": [("eventName", "64"), ("timeoutMinutes", "number")],
  "exitFlow": [],
]

private func readOrgCondition(_ raw: Any) -> AutomationDocument? {
  guard let row = raw as? AutomationDocument else { return nil }
  let field = jsSlice(looseString(row["field"]).trimmingCharacters(in: .whitespacesAndNewlines), 64)
  guard let op = row["op"] as? String, triggerConditionOps.contains(op) else {
    var kept: AutomationDocument = ["field": field]
    if let op = row["op"], !(op is NSNull) { kept["op"] = op }
    return kept
  }
  var condition: AutomationDocument = ["field": field, "op": op]
  if op != "notEmpty" { condition["value"] = jsSlice(looseString(row["value"]).trimmingCharacters(in: .whitespacesAndNewlines), 200) }
  return condition
}

private func readOrgConditions(_ raw: Any?) -> [AutomationDocument] {
  (raw as? [Any] ?? []).prefix(actionMaxConditions + 1).compactMap(readOrgCondition)
}

private func readCombinator(_ raw: Any?) -> String? {
  (raw as? String).flatMap { triggerCombinators.contains($0) ? $0 : nil }
}

private func readOrgStep(_ raw: Any) -> AutomationDocument {
  let source = raw as? AutomationDocument ?? [:]
  guard let type = source["type"] as? String, let fields = orgStepFields[type] else {
    return source["type"].map { ["type": $0] } ?? [:]
  }
  var step: AutomationDocument = ["type": type]
  for (key, kind) in fields {
    guard let value = source[key], !(value is NSNull) else { continue }
    switch kind {
    case "boolean": if let number = value as? NSNumber, looseIsBool(number) { step[key] = number.boolValue }
    case "number":
      if let number = value as? NSNumber, !looseIsBool(number), number.doubleValue.isFinite { step[key] = number }
    default: if let text = value as? String { step[key] = jsSlice(text, Int(kind) ?? 0) }
    }
  }
  if let when = source["when"] as? AutomationDocument {
    let conditions = readOrgConditions(when["conditions"])
    if !conditions.isEmpty { step["when"] = ["conditions": conditions, "combinator": readCombinator(when["combinator"]) ?? "and"] }
  }
  return step
}

/// Why an org automation cannot hold this step, or nil.
public func orgAutomationStepRefusal(_ step: AutomationDocument) -> String? {
  if let type = step["type"] as? String, orgAutomationStepTypes.contains(type) { return nil }
  guard let label = hostActionStepLabel(step["type"] as? String) else { return "“\(looseString(step["type"]))” is not a step" }
  return "“\(label)” belongs to one site, so an org automation cannot run it — build it as an action on that site"
}

/// A scope list as a save stores it: `['org']`, or up to thirty `host:` tokens; nil when it cannot be stored.
public func normalizeVisibleTo(_ input: [String]) -> [String]? {
  let tokens = input.filter { $0 == "org" || ($0.hasPrefix("host:") && $0.count > 5) }
  if tokens.isEmpty { return nil }
  if tokens.contains("org") { return ["org"] }
  var unique: [String] = []
  for token in tokens where !unique.contains(token) { unique.append(token) }
  return unique.count > maxScopeHosts ? nil : unique
}

/// What `readOrgAutomation` answers: the fields as stored, or the first reason they cannot be saved.
public enum OrgAutomationRead {
  case ok(AutomationDocument)
  case problem(String)
}

/// Reads an org automation as the save route stores it, or the first reason it cannot be saved.
public func readOrgAutomation(_ input: Any?) -> OrgAutomationRead {
  let body = input as? AutomationDocument ?? [:]
  let name = jsSlice(looseString(body["name"]).trimmingCharacters(in: .whitespacesAndNewlines), orgAutomationNameMax)
  if name.isEmpty { return .problem("Name the automation") }
  let trigger = body["trigger"] as? AutomationDocument ?? [:]
  let event = looseString(trigger["event"]).trimmingCharacters(in: .whitespacesAndNewlines)
  if !orgAutomationTriggerEvents.contains(event) {
    return .problem("Pick a trigger an org automation can start on — a form, a lead, a booking, a member or a CRM event")
  }
  let filter = jsSlice(looseString(trigger["filter"]).trimmingCharacters(in: .whitespacesAndNewlines), 500)
  let conditions = readOrgConditions(trigger["conditions"])
  let combinator = readCombinator(trigger["combinator"])
  let rawSteps = body["steps"] as? [Any] ?? []
  if rawSteps.count > actionMaxSteps { return .problem("Org automations are capped at \(actionMaxSteps) steps") }
  let steps = rawSteps.map(readOrgStep)
  for (index, step) in steps.enumerated() {
    if let refusal = orgAutomationStepRefusal(step) { return .problem("Step \(index + 1): \(refusal)") }
  }
  var checked: AutomationDocument = ["event": event]
  if !filter.isEmpty { checked["filter"] = filter }
  if !conditions.isEmpty { checked["conditions"] = conditions }
  if let combinator { checked["combinator"] = combinator }
  if let problem = validateHostAction(["name": name, "trigger": checked, "steps": steps]) { return .problem(problem) }
  guard let visibleTo = normalizeVisibleTo((body["visibleTo"] as? [Any] ?? []).compactMap { $0 as? String }) else {
    return .problem("Choose every site, or up to 30 sites, for it to run on")
  }
  var stored: AutomationDocument = ["event": event]
  if !filter.isEmpty { stored["filter"] = filter }
  if conditions.isEmpty {
    stored["conditions"] = NSNull()
    stored["combinator"] = NSNull()
  } else {
    stored["conditions"] = conditions
    stored["combinator"] = combinator ?? "and"
  }
  return .ok([
    "name": name, "trigger": stored, "steps": steps, "enabled": !looseIsFalse(body["enabled"]), "visibleTo": visibleTo,
  ])
}

/// A stored scope list covers this site.
public func visibleToHost(_ visibleTo: Any?, _ hostID: String) -> Bool {
  guard let tokens = visibleTo as? [Any] else { return false }
  let strings = tokens.compactMap { $0 as? String }
  return strings.contains("org") || strings.contains("host:\(hostID)")
}

/// A stored document's pause list.
public func orgAutomationPausedHostIDs(_ automation: AutomationDocument?) -> [String] {
  (automation?["pausedHostIds"] as? [Any] ?? []).compactMap { $0 as? String }
}

/// Why a stored org automation will not run on this site, or nil when it will.
public func orgAutomationStopReason(_ automation: AutomationDocument?, hostID: String) -> String? {
  guard let automation, !looseTruthy(automation["deletedAt"]) else { return "the org automation was deleted" }
  if looseIsFalse(automation["enabled"]) { return "the org automation was switched off" }
  if !visibleToHost(automation["visibleTo"], hostID) { return "the org automation no longer runs on this site" }
  if orgAutomationPausedHostIDs(automation).contains(hostID) { return "the org automation is paused on this site" }
  return nil
}

/// Whether a stored org automation runs on this site.
public func orgAutomationRunsOnHost(_ automation: AutomationDocument?, hostID: String) -> Bool {
  orgAutomationStopReason(automation, hostID: hostID) == nil
}

// MARK: - Placeholders

/// One placeholder an automation holds: the 1-based step (nil for the trigger), the field, what it is called, its words.
public struct InteractionPlaceholder: Equatable, Sendable {
  public let step: Int?
  public let field: String
  public let names: String
  public let text: String

  public init(step: Int?, field: String, names: String, text: String) {
    self.step = step
    self.field = field
    self.names = names
    self.text = text
  }
}

/// The fields of each step type a person types words into, and what a sentence calls each.
public let interactionStepTypedFields: [String: [(key: String, names: String)]] = [
  "showOverlay": [("overlayName", "the popup or bar")],
  "siteAlert": [("message", "the message")],
  "addContactTag": [("tag", "the tag")],
  "createCrmTask": [("title", "the title")],
  "logCrmActivity": [("body", "the text")],
  "datasetAppend": [("datasetName", "the dataset")],
  "updateDataset": [("datasetName", "the dataset")],
  "runWorkflow": [("workflowName", "the workflow")],
  "webhookPost": [("webhookName", "the webhook")],
  "sendEmail": [("subject", "the subject"), ("body", "the text")],
  "notifyAdmins": [("title", "the title"), ("body", "the text")],
  "enrollList": [("listName", "the list")],
  "assignCampaign": [("campaignName", "the campaign")],
]

private let placeholderPattern = try! NSRegularExpression(pattern: #"\[([^\[\]\n]{1,120})\](?!\()"#)

/// The words inside the first placeholder in a value, or nil.
public func draftPlaceholderIn(_ value: Any?) -> String? {
  guard let text = value as? String else { return nil }
  let range = NSRange(text.startIndex..., in: text)
  guard let match = placeholderPattern.firstMatch(in: text, range: range),
    let words = Range(match.range(at: 1), in: text)
  else { return nil }
  let trimmedWords = text[words].trimmingCharacters(in: .whitespacesAndNewlines)
  return trimmedWords.isEmpty ? nil : trimmedWords
}

/// The placeholders one step holds: its guard's values, then its typed fields.
public func interactionStepPlaceholders(_ step: AutomationDocument, index: Int) -> [InteractionPlaceholder] {
  var found: [InteractionPlaceholder] = []
  let when = step["when"] as? AutomationDocument
  for clause in when?["conditions"] as? [Any] ?? [] {
    if let text = draftPlaceholderIn((clause as? AutomationDocument)?["value"]) {
      found.append(InteractionPlaceholder(step: index + 1, field: "condition", names: "a condition value", text: text))
    }
  }
  for (key, names) in interactionStepTypedFields[step["type"] as? String ?? ""] ?? [] {
    if let text = draftPlaceholderIn(step[key]) {
      found.append(InteractionPlaceholder(step: index + 1, field: key, names: names, text: text))
    }
  }
  return found
}

/// Every placeholder an automation holds: its trigger's conditions first, then each step's.
public func interactionPlaceholders(_ interaction: AutomationDocument?) -> [InteractionPlaceholder] {
  guard let interaction else { return [] }
  var found: [InteractionPlaceholder] = []
  for condition in normalizeTriggerConditions(interaction["trigger"] as? AutomationDocument) {
    if let text = draftPlaceholderIn(condition["value"]) {
      found.append(InteractionPlaceholder(step: nil, field: "condition", names: "a condition value", text: text))
    }
  }
  for (index, step) in (interaction["steps"] as? [Any] ?? []).enumerated() {
    if let step = step as? AutomationDocument { found += interactionStepPlaceholders(step, index: index) }
  }
  return found
}

/// One placeholder as a person reads it: where it is, and what it stands in for.
public func describeInteractionPlaceholder(step: Int?, names: String, text: String) -> String {
  "\(step.map { "Step \($0)" } ?? "The trigger"): \(names) (“\(text)”)"
}

public func describeInteractionPlaceholder(_ placeholder: InteractionPlaceholder) -> String {
  describeInteractionPlaceholder(step: placeholder.step, names: placeholder.names, text: placeholder.text)
}

// MARK: - Run rows

/// The run history's Who: whoever set the run off.
public func runTriggeredByLabel(_ entry: AutomationDocument, brand: String = "Aglyn") -> String {
  let by = entry["triggeredBy"] as? AutomationDocument
  func value(_ key: String) -> String? { (by?[key] as? String).flatMap { $0.isEmpty ? nil : $0 } }
  switch by?["kind"] as? String {
  case "member": return value("email") ?? value("uid").map { "Account \($0)" } ?? "A member"
  case "apiKey": return value("apiKeyName").map { "API key \($0)" } ?? "API key"
  case "visitor": return value("email").map { "Site visitor (\($0))" } ?? "Site visitor"
  case "webhook": return value("name").map { "Inbound webhook \($0)" } ?? "Inbound webhook"
  case "platform": return brand
  default: return "Not recorded"
  }
}

/// The run's outcome (`succeeded`, `failed`, `skipped`), tolerating rows written before it was recorded.
public func actionRunResult(_ entry: AutomationDocument) -> String? {
  let stored = looseString(entry["result"]).trimmingCharacters(in: .whitespacesAndNewlines)
  if ["succeeded", "failed", "skipped"].contains(stored) { return stored }
  let action = looseString(entry["action"])
  guard action.hasPrefix("Action ran on") else { return nil }
  return action.contains("with errors:") ? "failed" : "succeeded"
}

/// The run's `What happened`: its summary, or the legacy prose minus its `Action ran on` prefix.
public func actionRunSummary(_ entry: AutomationDocument) -> String {
  let summary = looseString(entry["summary"]).trimmingCharacters(in: .whitespacesAndNewlines)
  if !summary.isEmpty { return summary }
  let action = looseString(entry["action"]).trimmingCharacters(in: .whitespacesAndNewlines)
  if let range = action.range(of: #"with errors:\s*(.+)$"#, options: .regularExpression) {
    return String(action[range]).replacingOccurrences(of: #"^with errors:\s*"#, with: "", options: .regularExpression)
  }
  if action.hasPrefix("Action ran on") { return "Ran" }
  return action
}

// MARK: - Editor defaults

/// The step a kind the author just picked becomes, as the console's editor starts it.
public func defaultAutomationStep(_ type: String) -> AutomationDocument {
  switch type {
  case "runWorkflow": return ["type": type, "workflowName": ""]
  case "siteAlert": return ["type": type, "message": "", "severity": "info"]
  case "customEvent": return ["type": type, "eventName": ""]
  case "webhookPost": return ["type": type, "webhookName": ""]
  case "showOverlay": return ["type": type, "overlayId": ""]
  case "stickyNav": return ["type": type, "selector": ""]
  case "addClass", "removeClass", "toggleClass": return ["type": type, "selector": "", "className": ""]
  case "showElement", "hideElement", "toggleElement", "scrollTo", "playVideo": return ["type": type, "selector": ""]
  case "setAttribute": return ["type": type, "selector": "", "name": "", "value": ""]
  case "removeAttribute": return ["type": type, "selector": "", "name": ""]
  case "openDrawer", "closeDrawer", "toggleDrawer", "openMenu", "closeMenu", "toggleMenu", "exitFlow":
    return ["type": type]
  case "showHtml": return ["type": type, "html": ""]
  case "runJs": return ["type": type, "code": ""]
  case "redirect": return ["type": type, "url": ""]
  case "trackGaEvent": return ["type": type, "eventName": ""]
  case "sendEmail": return ["type": type, "subject": "", "body": ""]
  case "notifyAdmins": return ["type": type, "title": ""]
  case "enrollList": return ["type": type, "listId": ""]
  case "updateDataset": return ["type": type, "datasetId": ""]
  case "assignCampaign": return ["type": type, "campaignId": ""]
  case "setContactStage": return ["type": type, "lifecycleStage": "lead"]
  case "addContactTag": return ["type": type, "tag": ""]
  case "assignContactOwner": return ["type": type, "ownerEmail": ""]
  case "createCrmTask": return ["type": type, "title": "", "kind": "call", "dueInDays": 1]
  case "logCrmActivity": return ["type": type, "kind": "note", "body": ""]
  case "wait": return ["type": type, "delayMinutes": 60 * 24]
  case "waitForEvent": return ["type": type, "eventName": "", "timeoutMinutes": 60 * 24 * 3]
  default: return ["type": "datasetAppend", "datasetName": ""]
  }
}

/// The element-interaction selector an action on its own element carries.
public func isElementInteraction(_ action: AutomationDocument) -> Bool {
  let selector = (action["trigger"] as? AutomationDocument)?["selector"] as? String ?? ""
  return selector.range(of: #"^\[data-aglyn="leaf:.+"\]$"#, options: .regularExpression) != nil
}
