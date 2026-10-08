// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import XCTest

@testable import AglynFormsPlugin

/// The Kotlin `FormsTest` cases, and the writes the screens make.
@MainActor
final class FormsTests: XCTestCase {
  func testRegistersTheDeclaredIDsAndOpensTheConsolePagesNatively() {
    let registry = NativePluginRegistry()
    let result = NativePluginLoader.load(
      [
        NativePluginManifestEntry(
          id: "forms",
          contributes: [
            "screens": ["forms.form", "forms.list"], "quickActions": ["forms.open"],
            "deepLinks": ["forms.page", "forms.record"],
          ], register: registerFormsNative)
      ], into: registry)
    XCTAssertEqual(result.failed, [])
    XCTAssertEqual(registry.screen("forms.list")?.requiresSite, true)
    XCTAssertEqual(registry.quickActions(for: .aglyn).map(\.id), ["forms.open"])
    XCTAssertEqual(
      registry.resolve("https://app.aglyn.com/acme/hosts/shop/forms"),
      .screen("forms.list", ["orgSlug": "acme", "hostSlug": "shop"]))
    XCTAssertEqual(
      registry.resolve("https://app.aglyn.com/acme/hosts/shop/forms/contact"),
      .screen("forms.form", ["orgSlug": "acme", "hostSlug": "shop", "formId": "contact"]))
  }

  private func has(_ plan: ListQueryPlan, _ path: String, _ op: ListQueryOp, _ value: ContractJSON) -> Bool {
    plan.filters.contains { $0.path == path && $0.op == op && $0.value == value }
  }

  func testListsFormsInUseUnlessTheChipAsks() {
    let inUse = formsPlan(.inUse, search: "")
    XCTAssertTrue(has(inUse, "retired", .equal, .bool(false)))
    XCTAssertEqual(inUse.firestoreQuery(formsPath("h")).path, "hosts/h/forms")
    let retired = formsPlan(.retired, search: "quo")
    XCTAssertTrue(has(retired, "retired", .equal, .bool(true)))
    XCTAssertTrue(has(retired, "searchTokens", .arrayContains, .string("quo")))
    XCTAssertTrue(formsPlan(.all, search: "").filters.isEmpty)
    XCTAssertEqual(ContractValues.shared.formInUse.path, "retired")
  }

  func testStampsTheSameSearchKeysTheConsoleWrites() {
    let fields = formListFields(id: "contact", name: "Contact us", slug: "contact-us")
    XCTAssertEqual(fields["nameLower"] as? String, "contact us")
    let tokens = fields["searchTokens"] as? [String] ?? []
    XCTAssertTrue(tokens.contains("us") && tokens.contains("cont") && tokens.contains("contact"))
    XCTAssertEqual(tokens.count, Set(tokens).count)
    XCTAssertEqual(normalizeFormSlug("  Request a Quote! "), "request-a-quote")
    XCTAssertEqual(normalizeFormSlug(String(repeating: "ab ", count: 40)).count <= formSlugMaxLength, true)
    XCTAssertFalse(normalizeFormSlug(String(repeating: "ab ", count: 40)).hasSuffix("-"))
  }

  func testReadsAFormsQuestionsAndRouting() {
    let form = FormRow(
      FirestoreDocument(
        id: "contact",
        data: [
          "displayName": "Contact us",
          "fields": [
            ["fieldName": "email", "label": "Email", "fieldType": "email", "required": true, "role": "email"],
            ["fieldName": "optIn", "label": "", "fieldType": "checkbox"],
          ],
          "routing": ["lead": true, "datasetId": "leads"],
          "stats": ["submissions": NSNumber(value: 4), "leads": NSNumber(value: 3)],
          "archivedAt": NSNull(),
          "retired": false,
        ]))
    XCTAssertTrue(form.routesLeads)
    XCTAssertFalse(form.retired)
    XCTAssertEqual(form.submissions, 4)
    XCTAssertEqual(form.fields.first?.label, "Email")
    XCTAssertEqual(form.fields.first?.summary, "email · used as email · required")
    XCTAssertEqual(form.fields.last?.label, "optIn")
    XCTAssertEqual(form.fields.filter(\.canHoldConsent).map(\.name), ["optIn"])
    XCTAssertEqual(form.summary(), "4 submissions")
    XCTAssertEqual(formBesignerPath(formID: "contact", versionID: "v1"), "/forms/contact/versions/v1/besigner")
    XCTAssertTrue(FormRow(FirestoreDocument(id: "x", data: ["archivedAt": NSNumber(value: 1)])).retired)
  }

  func testCreatesAFormWithTheElementItsBesignerOpensOn() {
    let api = FormsAPI(api: ConsoleAPIClient(origin: "https://x.test", getIDToken: { _ in "t" }), writer: NoFirestoreWrites(), hostID: "h")
    let body = api.createBody(id: "f1", name: "  Get a Quote ")
    XCTAssertEqual(body["resource"], "form")
    XCTAssertEqual(body["data"]?["slug"], "get-a-quote")
    XCTAssertEqual(body["data"]?["displayName"], "Get a Quote")
    XCTAssertEqual(body["data"]?["nodes"]?["formRoot"]?["props"]?["formId"], "f1")
    XCTAssertEqual(body["data"]?["nodes"]?["_@_"]?["nodes"], ["formRoot"])
    XCTAssertEqual(api.createBody(id: "f2", name: "!!!")["data"]?["slug"], "f2")
    XCTAssertEqual(newDocumentID().count, 20)
  }

  func testRetiringKeepsArchivedAtAndRetiredInStep() {
    let api = FormsAPI(api: ConsoleAPIClient(origin: "https://x.test", getIDToken: { _ in "t" }), writer: NoFirestoreWrites(), hostID: "h")
    let retire = api.retireFields(true, now: Date(timeIntervalSince1970: 2))
    XCTAssertEqual(retire["archivedAt"] as? Int64, 2000)
    XCTAssertEqual(retire["retired"] as? Bool, true)
    XCTAssertTrue(api.retireFields(false)["archivedAt"] is NSNull)
  }

  func testReadsAPromoteRefusalsViolations() {
    XCTAssertEqual(promoteViolations(["violations": ["Needs an email question", ["message": "Add a submit button"]]]), [
      "Needs an email question", "Add a submit button",
    ])
    XCTAssertEqual(promoteViolations(["error": "nope"]), [])
  }
}
