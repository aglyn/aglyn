// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import XCTest

@testable import AglynWorkflowsPlugin

final class AutomationTests: XCTestCase {
  private func doc(_ id: String, _ data: [String: Any], fromCache: Bool = false) -> FirestoreDocument {
    FirestoreDocument(id: id, data: data, fromCache: fromCache)
  }

  private func json(_ value: JSONValue) -> String { String(decoding: try! value.encoded(), as: UTF8.self) }

  // MARK: Rows

  func testWorkflowRowsDropDeletedSortByNameAndCaptionTheirSteps() {
    let rows = visibleWorkflows([
      doc("b", ["name": "beta", "steps": [["functionName": "double"], ["functionName": "quote"]], "trigger": ["event": "lead"]]),
      doc("a", ["name": "Alpha", "steps": [["functionName": "double"]], "trigger": NSNull()]),
      doc("c", ["name": "Gone", "deletedAt": Date()]),
      doc("d", ["name": "Kept", "deletedAt": NSNull(), "steps": []]),
    ])
    XCTAssertEqual(rows.map(\.id), ["a", "b", "d"])
    XCTAssertEqual(rows[0].caption, "1 step · double")
    XCTAssertEqual(rows[1].caption, "2 steps · on New lead · double → quote")
  }

  func testActionsSetElementInteractionsApartAndCountPlaceholders() {
    let (rows, elements) = visibleActions([
      doc("x", ["name": "Menu", "trigger": ["event": "elementClick", "selector": "[data-aglyn=\"leaf:menu\"]"], "steps": [["type": "toggleMenu"]]]),
      doc("y", ["name": "Draft", "enabled": false, "trigger": ["event": "lead"], "steps": [["type": "enrollList", "listId": "", "listName": "[news]"]]]),
      doc("z", ["name": "Alert", "trigger": ["event": "scrollDepth", "threshold": 50], "steps": [["type": "siteAlert", "message": "Hi"]]]),
    ])
    XCTAssertEqual(elements, 1)
    XCTAssertEqual(rows.map(\.id), ["z", "y"])
    XCTAssertTrue(rows[0].testable)
    XCTAssertFalse(rows[1].enabled)
    XCTAssertEqual(rows[1].caption, "on New lead · Enroll in a list")
    XCTAssertEqual(placeholderLine(rows[1].placeholders.count), "1 placeholder to fill in")
    XCTAssertEqual(placeholderLine(3), "3 placeholders to fill in")
    XCTAssertNil(placeholderLine(0))
    XCTAssertEqual(
      elementInteractionLine(1)?.hasPrefix("1 interaction is set up on its own element — open the element"), true)
    XCTAssertEqual(
      placeholderConfirmMessage(name: "Draft", rows[1].placeholders),
      "\"Draft\" still has a placeholder to fill in: Step 1: the list (“news”). Open it with Edit to fill it in first.")
  }

  func testWebhooksCaptionTheirDirection() {
    let rows = visibleWebhooks([
      doc("in", ["name": "Quotes", "direction": "inbound", "workflowName": "Party quote", "secret": "s"]),
      doc("out", ["name": "CRM", "direction": "outbound", "url": "https://hooks.example.com/x"]),
      doc("old", ["name": "Old", "deletedAt": Date()]),
    ])
    XCTAssertEqual(rows.map(\.id), ["out", "in"])
    XCTAssertEqual(rows[0].caption(siteBase: "https://demo.aglyn.app", hostID: "h1"), "outbound · https://hooks.example.com/x")
    XCTAssertEqual(
      rows[1].caption(siteBase: "https://demo.aglyn.app", hostID: "h1"),
      "inbound · https://demo.aglyn.app/api/hooks/h1/in → Party quote")
    XCTAssertEqual(HostStatus.publicOrigin(["subdomain": "demo"]), "https://demo.aglyn.app")
    XCTAssertEqual(HostStatus.publicOrigin(["cname": "www.x.com", "subdomain": "demo"]), "https://www.x.com")
    XCTAssertTrue(isPublicWebhookURL("https://hooks.example.com/aglyn"))
    XCTAssertFalse(isPublicWebhookURL("http://hooks.example.com"))
    XCTAssertFalse(isPublicWebhookURL("https://192.168.1.2/x"))
    XCTAssertFalse(isPublicWebhookURL("https://localhost/x"))
  }

  func testOrgAutomationRowsReadPlacementAndPauses() {
    let sites = [
      WorkspaceSite(id: "h1", orgID: "o", name: "Demo", subdomain: "demo", role: "admin"),
      WorkspaceSite(id: "h2", orgID: "o", name: "", subdomain: "two", role: "admin"),
    ]
    let every = OrgAutomationRow(doc("a", ["name": "A", "visibleTo": ["org"], "pausedHostIds": ["h1"], "trigger": ["event": "lead"], "steps": [["type": "sendEmail"]]]))
    let chosen = OrgAutomationRow(doc("b", ["name": "B", "visibleTo": ["host:h2"], "enabled": false]))
    XCTAssertEqual(placementLine(every, sites: sites), "Runs on every site")
    XCTAssertEqual(placementLine(chosen, sites: sites), "Runs on two")
    XCTAssertEqual(placementLine(OrgAutomationRow(doc("c", ["visibleTo": []])), sites: sites), "Runs on no site")
    XCTAssertEqual(placedSites(every, sites: sites), ["h1", "h2"])
    XCTAssertEqual(every.caption, "on New lead · Send an email")
    XCTAssertEqual(orgAutomationSiteChip(every, hostID: "h1").0, "Paused here")
    XCTAssertEqual(orgAutomationSiteChip(every, hostID: "h2").0, "Runs here")
    XCTAssertEqual(orgAutomationSiteChip(chosen, hostID: "h2").0, "Switched off")
  }

  func testOrgSiteRowsNameTriggerAndStatus() {
    let workflows = orgSiteRows([doc("w", ["name": "W", "trigger": NSNull()]), doc("v", ["name": "", "trigger": ["event": "booking"]])], kind: .workflows)
    XCTAssertEqual(workflows.rows.map(\.trigger), ["Run by other automations", "New booking"])
    XCTAssertEqual(workflows.rows.map(\.name), ["W", "v"])
    XCTAssertEqual(workflows.rows.map(\.status), ["Ready", "Ready"])
    let actions = orgSiteRows(
      [doc("a", ["name": "A", "enabled": false, "trigger": ["event": "lead"]]), doc("leaf", ["trigger": ["selector": "[data-aglyn=\"leaf:x\"]"]])],
      kind: .actions)
    XCTAssertEqual(actions.rows.map(\.status), ["Off"])
    let hooks = orgSiteRows(
      (0..<11).map { doc("h\($0)", ["name": "H", "direction": $0 == 0 ? "inbound" : "outbound"]) }, kind: .webhooks)
    XCTAssertTrue(hooks.truncated)
    XCTAssertEqual(hooks.rows.count, 10)
    XCTAssertEqual(hooks.rows.first?.trigger, "Inbound")
  }

  // MARK: Queries

  func testQueriesUseTheConsoleShapes() {
    let workflows = AutomationQueries.workflows("h1")
    XCTAssertEqual(workflows.path, "hosts/h1/workflows")
    XCTAssertEqual(workflows.order.map(\.field), ["__name__"])
    XCTAssertEqual(workflows.limit, 101)
    XCTAssertTrue(workflows.includeMetadataChanges)
    XCTAssertEqual(AutomationQueries.webhooks("h1").limit, 21)
    let org = AutomationQueries.orgAutomations("o1")
    XCTAssertEqual(org.path, "orgs/o1/automations")
    XCTAssertEqual(org.allFilters.map(\.path), ["deletedAt"])
    XCTAssertTrue(org.allFilters[0].value is NSNull)
    XCTAssertEqual(org.limit, 101)
    let onSite = AutomationQueries.orgAutomationsOnSite("o1", hostID: "h1")
    XCTAssertEqual(onSite.allFilters.map(\.path), ["deletedAt", "visibleTo"])
    XCTAssertEqual(onSite.allFilters[1].op, .arrayContainsAny)
    XCTAssertEqual(onSite.allFilters[1].value as? [String], ["org", "host:h1"])
    XCTAssertEqual(AutomationQueries.datasets("o1", hostID: "h1").path, "orgs/o1/datasets")
    XCTAssertEqual(AutomationQueries.datasets("o1", hostID: nil).allFilters.count, 0)
    XCTAssertEqual(AutomationQueries.campaigns("o1", hostID: "h1").path, "orgs/o1/emailCampaigns")
    XCTAssertEqual(AutomationQueries.orgSiteRows("h2", kind: .actions).path, "hosts/h2/actions")
    XCTAssertEqual(AutomationQueries.orgSiteRows("h2", kind: .actions).limit, 11)
    XCTAssertEqual(AutomationPaths.counter(orgID: "o1", hostID: "h1", "actionRuns"), ["orgs", "o1", "counters", "actionRuns"])
    XCTAssertEqual(AutomationPaths.counter(orgID: nil, hostID: "h1", "actionRuns"), ["hosts", "h1", "counters", "actionRuns"])
  }

  func testRunHistoryQueryScopesToRunsAndGrowsByThePage() {
    let base = runHistoryQuery(hostID: "h1", targetID: "a1", filters: RunFilters(), pageSize: 25, page: 0)
    XCTAssertEqual(base.path, "hosts/h1/activity")
    XCTAssertEqual(base.allFilters.map(\.path), ["target.id", "result"])
    XCTAssertEqual(base.allFilters[1].op, .in)
    XCTAssertEqual(base.allFilters[1].value as? [String], ["succeeded", "failed", "skipped"])
    XCTAssertEqual(base.order.first?.field, "createdAt")
    XCTAssertEqual(base.order.first?.descending, true)
    XCTAssertEqual(base.limit, 26)
    let filtered = runHistoryQuery(
      hostID: "h1", targetID: "a1", filters: RunFilters(result: .failed, trigger: "lead", search: "Email Bounced"),
      pageSize: 25, page: 2)
    XCTAssertEqual(filtered.allFilters.map(\.path), ["target.id", "result", "trigger", "summaryTokens"])
    XCTAssertEqual(filtered.allFilters[1].op, .equal)
    XCTAssertEqual(filtered.allFilters[3].op, .arrayContains)
    XCTAssertEqual(filtered.allFilters[3].value as? String, "email")
    XCTAssertEqual(filtered.limit, 76)
  }

  func testRunRowsReadTheirVerdictWhoAndDuration() {
    let row = RunRow(
      doc("r", [
        "result": "skipped", "trigger": "formSubmission", "summary": "Skipped: subscribe is empty",
        "triggeredBy": ["kind": "visitor", "email": "a@b.co"], "durationMs": 20, "createdAt": Date(timeIntervalSince1970: 0),
      ]), brand: "Aglyn")
    XCTAssertEqual(row.result, .skipped)
    XCTAssertEqual(row.triggerLabel, "Form submitted")
    XCTAssertEqual(row.who, "Site visitor (a@b.co)")
    XCTAssertEqual(row.detail, "Skipped: subscribe is empty · 20ms")
    let legacy = RunRow(doc("l", ["action": "Action ran on lead with errors: webhook 500"]))
    XCTAssertEqual(legacy.result, .failed)
    XCTAssertEqual(legacy.summary, "webhook 500")
  }

  // MARK: Quota and entitlements

  func testRunQuotaLineWaitsForBothReads() {
    let now = Date(timeIntervalSince1970: 1_791_000_000)
    let key = monthKey(now)
    XCTAssertNil(runQuotaLine(counter: .actionRuns, counterDoc: nil, counterRead: false, limit: .capped(500), now: now))
    XCTAssertNil(runQuotaLine(counter: .actionRuns, counterDoc: [key: 3], counterRead: true, limit: nil, now: now))
    XCTAssertEqual(
      runQuotaLine(counter: .actionRuns, counterDoc: [key: 1284], counterRead: true, limit: .capped(500_000), now: now),
      "1,284 action runs this month · 500,000 included")
    XCTAssertEqual(
      runQuotaLine(counter: .workflowRuns, counterDoc: nil, counterRead: true, limit: .unlimited, now: now),
      "0 workflow runs this month · no monthly limit")
  }

  func testEntitlementsReadFeaturesAndQuotas() {
    let value = AutomationEntitlements(
      [
        "orgId": "o1", "features": ["workflows": true, "actions": false],
        "quotas": ["workflowsPerHost": 3, "actionRunsPerMonth": .null],
      ] as JSONValue)
    XCTAssertTrue(value.has("workflows"))
    XCTAssertFalse(value.has("actions"))
    XCTAssertFalse(value.has("webhooks"))
    XCTAssertEqual(value.quota("actionRunsPerMonth"), .unlimited)
    XCTAssertTrue(value.allows("workflowsPerHost", used: 2))
    XCTAssertFalse(value.allows("workflowsPerHost", used: 3))
    XCTAssertTrue(value.allows("actionRunsPerMonth", used: 99_999))
  }

  func testWhereUsedSummarizesDependents() {
    let result = WhereUsedResult(
      [
        "dependents": [["type": "screen", "id": "s1", "name": "Home"], ["type": "screen", "id": "s2", "name": "Pricing"], ["type": "variable", "id": "v", "name": "x"]],
        "total": 3,
      ] as JSONValue)
    XCTAssertEqual(result.summary, "2 pages, 1 variable")
    XCTAssertEqual(result.usageMessage("W"), "\"W\" computes 2 pages, 1 variable")
    XCTAssertEqual(WhereUsedResult(nil).usageMessage("W"), "\"W\" is not referenced by anything published")
    XCTAssertEqual(WhereUsedResult(nil).deleteMessage("W"), "\"W\" will no longer be runnable.")
  }

  // MARK: Bodies

  func testBodiesAreTheConsoleRoutes() {
    XCTAssertEqual(
      json(AutomationBodies.createWorkflow(hostID: "h1", fields: ["name": "W", "steps": [], "trigger": NSNull()])),
      #"{"data":{"name":"W","steps":[],"trigger":null},"hostId":"h1","resource":"workflow"}"#)
    XCTAssertEqual(
      json(AutomationBodies.duplicateWorkflow(hostID: "h1", sourceID: "w1", name: "Copy of W", attemptKey: "k")),
      #"{"action":"duplicate","attemptKey":"k","hostId":"h1","name":"Copy of W","resource":"workflow","sourceId":"w1"}"#)
    XCTAssertEqual(
      json(AutomationBodies.createAction(hostID: "h1", id: "a1", name: "A")),
      #"{"data":{"name":"A"},"hostId":"h1","id":"a1","resource":"action"}"#)
    XCTAssertEqual(
      json(AutomationBodies.createWebhook(hostID: "h1", id: "w", name: " Hook ", inbound: true, target: "Quote", secret: "s")),
      #"{"data":{"direction":"inbound","enabled":true,"name":"Hook","secret":"s","workflowName":"Quote"},"hostId":"h1","id":"w","resource":"webhook"}"#)
    XCTAssertEqual(
      json(AutomationBodies.pause(hostID: "h1", automationID: "a", paused: true)),
      #"{"automationId":"a","hostId":"h1","paused":true}"#)
    XCTAssertEqual(
      json(AutomationBodies.manageSave(orgID: "o", automationID: nil, automation: ["name": "A"])),
      #"{"action":"create","automation":{"name":"A"},"orgId":"o"}"#)
    XCTAssertEqual(
      json(AutomationBodies.manageSave(orgID: "o", automationID: "x", automation: ["name": "A"])),
      #"{"action":"update","automation":{"name":"A"},"automationId":"x","orgId":"o"}"#)
    XCTAssertEqual(
      json(AutomationBodies.manageEnabled(orgID: "o", automationID: "x", enabled: false)),
      #"{"action":"setEnabled","automationId":"x","enabled":false,"orgId":"o"}"#)
    XCTAssertEqual(
      json(AutomationBodies.manageDelete(orgID: "o", automationID: "x")), #"{"action":"delete","automationId":"x","orgId":"o"}"#)
    XCTAssertEqual(json(AutomationBodies.testRun(hostID: "h1", actionID: "a")), #"{"actionId":"a","hostId":"h1"}"#)
    XCTAssertEqual(
      json(AutomationBodies.whereUsed(hostID: "h1", id: "w", name: "W")), #"{"hostId":"h1","id":"w","kind":"workflow","name":"W"}"#)
  }

  func testTestRunAnswersReadAsTheConsoleShowsThem() {
    XCTAssertEqual(testRunMessage(["ok": true, "alerts": [["message": "Hi", "severity": "info"]]]), "Test ran — first alert: Hi")
    XCTAssertEqual(testRunMessage(["ok": true, "alerts": []]), "Test ran — server steps executed (see Runs)")
    XCTAssertEqual(testRunRefusal(ConsoleAPIError(status: 409, message: "x", body: ["error": "Switch it on"])), "Switch it on")
    XCTAssertEqual(testRunRefusal(ConsoleAPIError(status: 429, message: "x")), "Too many test runs — wait a minute and try again")
    XCTAssertEqual(testRunRefusal(ConsoleAPIError(status: 404, message: "x")), "That action no longer exists")
  }

  // MARK: Drafts

  func testAWorkflowDraftRoundTripsAndValidates() {
    var draft = WorkflowDraft(
      id: "w1",
      data: [
        "name": "Score", "returnValue": "s",
        "steps": [["functionId": "f1", "functionName": "double", "args": ["1"], "resultName": "s"], ["type": "notifyAdmins", "title": "Hi", "extra": 1]],
        "trigger": ["event": "lead", "filter": "email", "kept": true],
      ])
    XCTAssertEqual(draft.triggerEvent, "lead")
    let fields = draft.fields
    XCTAssertEqual((fields["steps"] as? [[String: Any]])?[1]["extra"] as? Int, 1)
    XCTAssertEqual((fields["trigger"] as? [String: Any])?["kept"] as? Bool, true)
    XCTAssertNil(draft.problem)
    draft.triggerFilter = "a == b"
    XCTAssertEqual(draft.problem?.hasPrefix("A filter can’t compare values"), true)
    draft.triggerEvent = nil
    XCTAssertTrue(draft.fields["trigger"] is NSNull)
    XCTAssertTrue(draft.nameTaken(among: [WorkflowRow(doc("w2", ["name": "score"]))]))
    XCTAssertFalse(draft.nameTaken(among: [WorkflowRow(doc("w1", ["name": "score"]))]))
    draft.name = String(repeating: "x", count: 70)
    XCTAssertEqual((draft.fields["name"] as? String)?.count, 60)
  }

  func testAWorkflowTestRunUsesTheFunctionCallsAndVariables() {
    var draft = WorkflowDraft()
    draft.steps = [
      StepDraft(["functionId": "fn-double", "functionName": "double", "args": ["base"], "resultName": "d"]),
      StepDraft(["type": "notifyAdmins", "title": "x"]),
      StepDraft(["functionName": "double", "args": ["d + 1"]]),
    ]
    let functions = functionMap([
      doc("fn-double", [
        "name": "double", "parameters": [["name": "x", "type": "number", "required": true]],
        "variables": [["name": "out", "type": "number"]],
        "operations": [["if": ["left": "1", "comparator": "==", "right": "1"], "then": [["set": "out", "expression": "x * 2"]], "otherwise": []]],
        "returnValue": "out",
      ])
    ])
    let variables = variableList([doc("v", ["name": "base", "type": "number", "value": "5"])])
    XCTAssertEqual(workflowTestResult(draft, functions: functions, variables: variables), "Result: 22 (d=10, step3=22)")
    draft.steps = [StepDraft(["functionName": "missing", "args": []])]
    XCTAssertEqual(workflowTestResult(draft, functions: functions, variables: variables), "Error: Unknown function \"missing\"")
  }

  func testAnActionDraftWritesOnlyTheTriggerKeysThatAreSet() {
    var draft = ActionDraft()
    draft.name = "  Nudge  "
    draft.event = "scrollDepth"
    draft.threshold = "60"
    draft.pathPattern = "/pricing"
    draft.frequency = .cooldown
    draft.cooldownMinutes = "30"
    draft.conditionRows = [ConditionRow(op: "equals", field: " plan ", value: " pro "), ConditionRow(op: formIsOp, field: formIDField, value: "f1")]
    draft.combinator = "or"
    draft.steps[0].fields["message"] = "Hi"
    let candidate = draft.candidate
    let trigger = candidate["trigger"] as! [String: Any]
    XCTAssertEqual(candidate["name"] as? String, "Nudge")
    XCTAssertEqual(trigger["threshold"] as? Int, 60)
    XCTAssertEqual(trigger["cooldownMinutes"] as? Int, 30)
    XCTAssertNil(trigger["filter"])
    XCTAssertNil(trigger["oncePerVisitor"])
    XCTAssertEqual(trigger["combinator"] as? String, "or")
    let conditions = trigger["conditions"] as! [[String: Any]]
    XCTAssertEqual(conditions[0]["field"] as? String, "plan")
    XCTAssertEqual(conditions[0]["value"] as? String, "pro")
    XCTAssertEqual(conditions[1]["field"] as? String, "formId")
    XCTAssertEqual(conditions[1]["op"] as? String, "equals")
    XCTAssertTrue(candidate["recipe"] is NSNull)
    XCTAssertNil(validateHostAction(candidate))
    let document = siteInteractionDocument(candidate)
    XCTAssertEqual((document["trigger"] as? [String: Any])?["everyTime"] as? Bool, false)
  }

  func testAStoredActionComesBackIntoTheEditorAsItWas() {
    let draft = ActionDraft(
      id: "a1",
      data: [
        "name": "Lead", "enabled": false, "recipe": NSNull(),
        "trigger": ["event": "lead-scored", "conditions": [["field": "formId", "op": "equals", "value": "f1"]], "combinator": "and", "oncePerSession": true],
        "steps": [["type": "teleport", "where": "moon"]],
      ])
    XCTAssertEqual(draft.event, customEventValue)
    XCTAssertEqual(draft.customEvent, "lead-scored")
    XCTAssertEqual(draft.frequency, .session)
    XCTAssertEqual(draft.conditionRows.first?.op, formIsOp)
    XCTAssertFalse(draft.enabled)
    let candidate = draft.candidate
    XCTAssertTrue(candidate["recipe"] is NSNull)
    XCTAssertEqual(((candidate["steps"] as? [[String: Any]])?.first)?["where"] as? String, "moon")
    XCTAssertEqual((candidate["trigger"] as? [String: Any])?["event"] as? String, "lead-scored")
  }

  func testConditionRowsClearToNothingWhenAlways() {
    XCTAssertNil(conditionsFromRows([.empty()], combinator: "and"))
    XCTAssertEqual(conditionRowsFromTrigger(nil).count, 1)
    XCTAssertEqual(conditionRowsFromTrigger(["condition": ["field": "a", "op": "notEmpty"]]).first?.field, "a")
    let (conditions, _) = conditionsFromRows([ConditionRow(op: "notEmpty", field: "a", value: "ignored")], combinator: "and")!
    XCTAssertNil(conditions[0]["value"])
  }

  func testAnOrgDraftBuildsTheManageBody() {
    var draft = OrgAutomationDraft()
    draft.name = " Welcome "
    draft.everySite = false
    draft.siteIDs = ["h1", "h2"]
    draft.steps = [StepDraft(["type": "sendEmail", "subject": "Hi", "body": "B"])]
    let body = draft.body
    XCTAssertEqual(body["visibleTo"] as? [String], ["host:h1", "host:h2"])
    guard case .ok(let read) = readOrgAutomation(body) else { return XCTFail("refused") }
    XCTAssertEqual(read["name"] as? String, "Welcome")
    draft.siteIDs = (0..<31).map { "h\($0)" }
    XCTAssertTrue(draft.tooManySites)
    let stored = OrgAutomationDraft(id: "x", data: ["name": "A", "visibleTo": ["org"], "trigger": ["event": "pageView"]])
    XCTAssertTrue(stored.everySite)
    XCTAssertEqual(stored.event, "formSubmission")
  }

  func testAStaleSeedIsRefused() {
    XCTAssertNil(seedWriteRefusal(subject: "workflow", unreadable: false, fromCache: false))
    XCTAssertEqual(
      seedWriteRefusal(subject: "workflow", unreadable: false, fromCache: true)?.hasPrefix(
        "We could not confirm your workflow with the server"), true)
    XCTAssertEqual(
      seedWriteRefusal(subject: "action", unreadable: true, fromCache: false)?.hasPrefix("Your action could not be loaded"), true)
  }

  func testMemberReferencesSplitByTheAtSign() {
    var step: [String: Any] = ["type": "assignContactOwner", "ownerEmail": "old@x.co"]
    memberReference(&step, role: "owner", "u123")
    XCTAssertEqual(step["ownerUid"] as? String, "u123")
    XCTAssertNil(step["ownerEmail"])
    memberReference(&step, role: "owner", "a@b.co")
    XCTAssertEqual(step["ownerEmail"] as? String, "a@b.co")
    XCTAssertNil(step["ownerUid"])
    memberReference(&step, role: "owner", " ")
    XCTAssertNil(step["ownerEmail"])
    XCTAssertEqual(placeholderReferenceHelp(name: "[news]", id: "", noun: "list"), "Pick the list — the draft asked for “news”")
    XCTAssertNil(placeholderReferenceHelp(name: "[news]", id: "l1", noun: "list"))
  }

  func testScopeCoversAsTheConsoleDoes() {
    XCTAssertTrue(scopeCovers(["org"], ["host:h1"]))
    XCTAssertFalse(scopeCovers(["host:h1"], ["org"]))
    XCTAssertTrue(scopeCovers(["host:h1", "host:h2"], ["host:h1"]))
    XCTAssertFalse(scopeCovers(["host:h1"], ["host:h1", "host:h2"]))
  }

  func testGeneratedIDsAndSecretsHaveTheConsoleShape() {
    XCTAssertEqual(createResourceUID().count, 10)
    XCTAssertTrue(createResourceUID().allSatisfy { $0.isLetter || $0.isNumber })
    let secret = randomHexSecret()
    XCTAssertEqual(secret.count, 48)
    XCTAssertTrue(secret.allSatisfy(\.isHexDigit))
  }
}
