// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import Foundation
import XCTest

@testable import AglynCrmPlugin

/// The console's own answers, recorded by `generate-native-contracts.mjs`.
private func functionCases(_ name: String) throws -> [(args: [Any], result: Any)] {
  var url = URL(fileURLWithPath: #filePath)
  for _ in 0..<7 { url.deleteLastPathComponent() }
  url.appendPathComponent("native/contracts/function-cases.generated.json")
  let root = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: Any]
  let function = (root?["functions"] as? [String: Any])?[name] as? [String: Any]
  let cases = try XCTUnwrap(function?["cases"] as? [[String: Any]], "no cases for \(name)")
  return cases.map { ($0["args"] as? [Any] ?? [], $0["result"] ?? NSNull()) }
}

private func group(_ value: Any) -> ConsentGroup {
  let o = value as! [String: Any]
  return ConsentGroup(
    hostID: o["hostId"] as! String, groupID: o["groupId"] as! String, name: o["name"] as? String, hostIDs: o["hostIds"] as! [String],
    declared: (o["declared"] as? Bool) == true)
}

final class CrmTests: XCTestCase {
  func testConsentGroupsResolveAsTheConsoleResolvesThem() throws {
    for (index, item) in try functionCases("consentGroupForHost").enumerated() {
      XCTAssertEqual(consentGroupForHost(item.args[0] as? [String: Any], item.args[1] as! String), group(item.result), "case \(index)")
    }
  }

  func testScopeTokensAreTheConsoles() throws {
    for (index, item) in try functionCases("crmScopeTokens").enumerated() {
      XCTAssertEqual(crmScopeTokens(item.args[0] as? [String: Any], group(item.args[1])), item.result as? [String], "case \(index)")
    }
    for (index, item) in try functionCases("crmReadTokens").enumerated() {
      XCTAssertEqual(crmReadTokens(group(item.args[0])), item.result as? [String], "case \(index)")
    }
  }

  func testDefaultScopeIsTheConsoles() throws {
    for (index, item) in try functionCases("crmDefaultScopeOf").enumerated() {
      XCTAssertEqual(crmDefaultScope(item.args[0] as? [String: Any]), item.result as? String, "case \(index)")
    }
  }

  func testActivityTitlesAreTheConsoles() throws {
    for (index, item) in try functionCases("crmActivityKindTitle").enumerated() {
      XCTAssertEqual(
        crmActivityKindTitle(item.args[0] as! String, item.args.count > 1 ? item.args[1] as? String : nil), item.result as? String, "case \(index)")
    }
    XCTAssertEqual(crmActivityKindTitle("whatsapp", "outbound"), "Outbound WhatsApp message")
  }

  /// A record created at the workspace's level belongs to the whole org with no site, and with one it names its source;
  /// a workspace that keeps its sites apart stamps nothing until a site is named.
  func testAWorkspaceLevelCreateNeedsASiteOnlyWhenTheOrgKeepsThemApart() {
    let owner: [String: Any] = ["role": "owner"]
    let shared = CrmScope(orgID: "o1", hostID: "", uid: "u1", org: [:], member: owner, orgLevel: true)
    XCTAssertEqual(shared.createTokens, ["org"])
    XCTAssertNil(shared.createHostID)
    XCTAssertFalse(shared.createNeedsSite)
    XCTAssertEqual(shared.routeScope.keys.sorted(), ["orgId"])
    XCTAssertEqual(shared.taskScope.keys.sorted(), ["orgId"])
    XCTAssertEqual(shared.forSite("h1").createTokens, ["org"])
    XCTAssertEqual(shared.forSite("h1").createHostID, "h1")
    XCTAssertEqual(shared.forSite("h1").routeScope.keys.sorted(), ["hostId", "orgId"])

    let apart = CrmScope(
      orgID: "o1", hostID: "", uid: "u1", org: ["crm": ["defaultRecordScope": "host"]], member: owner, orgLevel: true)
    XCTAssertEqual(apart.createTokens, [])
    XCTAssertTrue(apart.createNeedsSite)
    XCTAssertEqual(apart.forSite("h1").createTokens, ["host:h1"])

    // Under a site nothing is asked: the site is known.
    let site = CrmScope(orgID: "o1", hostID: "h1", uid: "u1", org: [:], member: owner)
    XCTAssertEqual(site.createTokens, ["org"])
    XCTAssertEqual(site.createHostID, "h1")
    XCTAssertEqual(site.taskScope.keys.sorted(), ["hostId"])
  }

  /// Nothing is picked silently: only an earlier pick the workspace still has, or its one site.
  func testTheSiteACreateStartsFrom() {
    XCTAssertNil(crmCreateHost(picked: nil, sites: ["h1", "h2"]))
    XCTAssertEqual(crmCreateHost(picked: "h2", sites: ["h1", "h2"]), "h2")
    XCTAssertNil(crmCreateHost(picked: "gone", sites: ["h1", "h2"]))
    XCTAssertEqual(crmCreateHost(picked: nil, sites: ["h1"]), "h1")
    XCTAssertNil(crmCreateHost(picked: nil, sites: []))
  }

  func testTheSiteFieldAsksOnlyWhatTheOrgNeeds() {
    let owner: [String: Any] = ["role": "owner"]
    let sites = [NativeSiteRef(id: "h1", name: "One", subdomain: "one", role: "admin"), NativeSiteRef(id: "h2", name: "Two", subdomain: "two", role: "admin")]
    let shared = CrmScope(orgID: "o1", hostID: "", uid: "u1", org: [:], member: owner, orgLevel: true)
    let apart = CrmScope(
      orgID: "o1", hostID: "", uid: "u1", org: ["crm": ["defaultRecordScope": "host"]], member: owner, orgLevel: true)
    XCTAssertEqual(crmSiteField(.deal, shared, sites: sites)?.spec.label, "Source site")
    XCTAssertEqual(crmSiteField(.deal, shared, sites: sites)?.spec.required, false)
    XCTAssertEqual(crmSiteField(.deal, shared, sites: sites)?.spec.emptyLabel, "None")
    XCTAssertEqual(crmSiteField(.deal, apart, sites: sites)?.spec.label, "Site")
    XCTAssertEqual(crmSiteField(.deal, apart, sites: sites)?.spec.required, true)
    XCTAssertNil(crmSiteField(.deal, apart, sites: sites)?.spec.emptyLabel)
    // A lead is private to one site, whatever the org keeps.
    XCTAssertEqual(crmSiteField(.lead, shared, sites: sites)?.spec.required, true)
    XCTAssertNil(crmSiteField(.deal, shared, sites: [sites[0]]))
    XCTAssertNil(crmSiteField(.deal, CrmScope(orgID: "o1", hostID: "h1", uid: "u1", org: [:], member: owner), sites: sites))
    // The field picks; it is never a field of the record.
    XCTAssertTrue(createdFields([crmSiteField(.deal, shared, sites: sites)!], [crmSiteFieldKey: "h1"]).isEmpty)
  }

  /// From the workspace's CRM a record's page works in the site it came from, else stamps what it is visible to.
  func testARecordsOwnPageWorksInTheSiteItCameFrom() {
    let shared = CrmScope(orgID: "o1", hostID: "", uid: "u1", org: [:], member: ["role": "owner"], orgLevel: true)
    XCTAssertEqual(recordScope(shared, ["hostId": "h1"]).createHostID, "h1")
    XCTAssertEqual(recordScope(shared, ["capturedByHostIds": ["h2", "h3"]]).createHostID, "h2")
    let noSite = recordScope(shared, ["hostId": NSNull(), "visibleTo": ["org"]])
    XCTAssertNil(noSite.createHostID)
    XCTAssertEqual(noSite.createTokens, ["org"])
    XCTAssertEqual(recordScope(shared, ["visibleTo": ["host:h9"]]).createTokens, ["host:h9"])
    let site = CrmScope(orgID: "o1", hostID: "h1", uid: "u1", org: [:], member: ["role": "owner"])
    XCTAssertEqual(recordScope(site, ["hostId": "h2"]).hostID, "h1")
  }

  func testATaskStartsFiledWhereTheOrgFilesIt() {
    let owner: [String: Any] = ["role": "owner"]
    let sites = [NativeSiteRef(id: "h1", name: "One", subdomain: "one", role: "admin"), NativeSiteRef(id: "h2", name: "Two", subdomain: "two", role: "admin")]
    let shared = CrmScope(orgID: "o1", hostID: "", uid: "u1", org: [:], member: owner, orgLevel: true)
    let apart = CrmScope(
      orgID: "o1", hostID: "", uid: "u1", org: ["crm": ["defaultRecordScope": "host"]], member: owner, orgLevel: true)
    XCTAssertEqual(TaskSiteChoice(shared, sites: sites, picked: nil).start, crmOrganizationChoice)
    XCTAssertEqual(TaskSiteChoice(shared, sites: sites, picked: "h2").start, "h2")
    XCTAssertEqual(TaskSiteChoice(apart, sites: sites, picked: nil).start, "")
  }

  /// The timeline's line: the chip names the channel and the way it went, the heading what was said.
  func testAnActivityReadsAsTheConsoleReadsIt() {
    let message = crmActivityLine(["kind": "whatsapp", "direction": "outbound", "body": "Sent the proposal\nThey asked about hosting"])
    XCTAssertEqual(message.chip, "Outbound WhatsApp message")
    XCTAssertEqual(message.heading, "Sent the proposal")
    XCTAssertEqual(message.detail, "They asked about hosting")
    XCTAssertNil(message.state)

    let inbound = crmActivityLine(["kind": "messenger", "direction": "inbound", "body": "Thanks"])
    XCTAssertEqual(inbound.chip, "Inbound Messenger message")
    XCTAssertNil(inbound.detail)

    XCTAssertEqual(crmActivityLine(["kind": "instagram", "body": "Liked it"]).chip, "Instagram")
    XCTAssertEqual(crmActivityLine(["kind": "linkedin", "direction": "outbound", "subject": "Intro", "body": "Hello"]).heading, "Intro")
    XCTAssertEqual(crmActivityLine(["kind": "linkedin", "direction": "outbound", "subject": "Intro", "body": "Hello"]).detail, "Hello")
    // A stored kind outside the list reads as Other, as the console draws it.
    XCTAssertEqual(crmActivityLine(["kind": "telegram", "body": "x"]).chip, "Other")

    // A message the platform carried names the kind alone, and says it was sent or received.
    let sent = crmActivityLine(["kind": "email", "direction": "outbound", "messageId": "m1", "subject": "Hi", "body": "Hello"])
    XCTAssertEqual(sent.chip, "Email")
    XCTAssertEqual(sent.state, "Sent")
    XCTAssertEqual(crmActivityLine(["kind": "email", "direction": "inbound", "messageId": "m2", "body": "Hello"]).state, "Received")
  }

  /// Every kind draws its own mark: the brands from the console's glyphs, which parse; the rest from SF Symbols.
  func testEveryActivityKindHasItsOwnIcon() {
    let paths = ContractValues.shared.nativeCrmActivityIconPaths
    XCTAssertEqual(paths.keys.sorted(), ["instagram", "linkedin", "messenger", "whatsapp"])
    for path in paths.values { XCTAssertNotNil(svgPath(path)) }
    XCTAssertEqual(crmActivitySymbol("text"), "message")
    XCTAssertEqual(crmActivitySymbol("other"), "ellipsis.circle")
  }

  func testTheActivityCompanyIsTheConsoles() throws {
    for (index, item) in try functionCases("crmActivityCompanyId").enumerated() {
      let link = item.args[0] as? [String: Any]
      let sources = item.args[1] as? [String: Any]
      XCTAssertEqual(
        crmActivityCompanyID(
          named: link?["companyId"] as? String, deal: sources?["deal"] as? [String: Any], contact: sources?["contact"] as? [String: Any],
          groupID: sources?["groupId"] as? String, org: sources?["org"] as? [String: Any]),
        item.result as? String, "case \(index)")
    }
  }

  /// A contact needs no email: it reads as its name, then its number, and offers nothing to write to.
  func testAContactWithNoEmailReadsAsItsNameThenItsNumber() {
    XCTAssertEqual(crmContactLabel(["name": "Ada", "email": "a@example.com"]), "Ada")
    XCTAssertEqual(crmContactLabel(["email": "a@example.com"]), "a@example.com")
    XCTAssertEqual(crmContactLabel(["name": " ", "email": "", "phone": "+1 555 0100"]), "+1 555 0100")
    XCTAssertEqual(crmContactLabel(["mobilePhone": "+1 555 0101"]), "+1 555 0101")
    XCTAssertEqual(crmContactLabel([:]), "Unnamed contact")
    XCTAssertFalse(crmHasEmail(["email": ""]))
    XCTAssertFalse(crmHasEmail([:]))
    XCTAssertTrue(crmHasEmail(["email": "a@example.com"]))
    XCTAssertTrue(crmContactIdentified(["phone": "+1 555 0100"]))
    XCTAssertFalse(crmContactIdentified(["email": " ", "ownerUid": "u1"]))
    let scope = CrmScope(orgID: "o1", hostID: "", uid: "u1", org: [:], member: ["role": "owner"], orgLevel: true)
    let doc = FirestoreDocument(id: "c1", data: ["email": "", "facets": ["org": ["phone": "+1 555 0100"]]])
    XCTAssertEqual(crmRow(.contact, doc, scope).title, "+1 555 0100")
    let email = standardFields(.contact, picklists: Picklists(), members: [], companies: [], contacts: []).first { $0.spec.key == "email" }
    XCTAssertEqual(email?.spec.required, false)
    XCTAssertEqual(email?.editable, true)
    XCTAssertEqual(standardFields(.lead, picklists: Picklists(), members: [], companies: [], contacts: []).first { $0.spec.key == "email" }?.spec.required, true)
    XCTAssertEqual(withContactEmailHelp([email!], hasEmail: false).first?.spec.help, "Add it whenever you have it.")
  }

  /// A person the organization added holds their fields in its own facet, read wherever no site's facet answers.
  func testAnOrgHeldContactReadsItsOwnFacet() {
    let data: [String: Any] = ["name": "Base", "facets": ["org": ["phone": "+1 555 0100"], "g1": ["phone": "+1 555 0199"]]]
    XCTAssertEqual(contactView(data, groupID: "")["phone"] as? String, "+1 555 0100")
    XCTAssertEqual(contactView(data, groupID: "g2")["phone"] as? String, "+1 555 0100")
    XCTAssertEqual(contactView(data, groupID: "g1")["phone"] as? String, "+1 555 0199")
  }

  /// A currency field (AGL-3971) shows and stores its own currency's minor units: USD cents, whole yen, BHD fils. A
  /// JPY value stored as 1500 reads ¥1,500, never ¥15.
  func testCurrencyFieldsUseTheirOwnCurrencysMinorUnit() {
    func field(_ code: String?) -> CrmField {
      customFieldsOf(.contact, [
        CustomFieldDefinition(
          id: "f", key: "budget", label: "Budget", type: "currency", options: [], required: false, order: 0, retired: false,
          object: "contact", currency: code)
      ])[0]
    }
    let usd = field("usd")
    let jpy = field("jpy")
    let bhd = field("bhd")
    XCTAssertEqual(usd.stored, .minor)
    XCTAssertEqual(jpy.spec.currency, FieldCurrency(code: "JPY", digits: 0))
    XCTAssertEqual(bhd.spec.currency, FieldCurrency(code: "BHD", digits: 3))
    XCTAssertEqual(field(nil).spec.currency?.code, "USD")

    XCTAssertEqual(displayValue(usd, NSNumber(value: 125050)), "1250.50")
    XCTAssertEqual(displayValue(jpy, NSNumber(value: 1500)), "1500")
    XCTAssertEqual(displayValue(bhd, NSNumber(value: 1250)), "1.250")

    XCTAssertEqual(AglynCrmPlugin.storedValue(usd, "$1,250.50") as? Int64, 125050)
    XCTAssertEqual(AglynCrmPlugin.storedValue(jpy, "¥1,500") as? Int64, 1500)
    XCTAssertEqual(AglynCrmPlugin.storedValue(bhd, "1.25") as? Int64, 1250)
    XCTAssertNil(AglynCrmPlugin.storedValue(usd, "abc"))

    let us = Locale(identifier: "en_US")
    XCTAssertEqual(formatCurrencyFieldValue(1500, "jpy", locale: us), "¥1,500")
    XCTAssertEqual(fieldDisplay(jpy.spec, "1500"), 1500.0.formatted(.currency(code: "JPY").precision(.fractionLength(0))))
    XCTAssertEqual(fieldDisplay(usd.spec, "1250.50"), 1250.5.formatted(.currency(code: "USD").precision(.fractionLength(2))))
    XCTAssertTrue(fieldProblems([jpy.spec], [jpy.spec.key: "¥1,500"]).isEmpty)
    XCTAssertEqual(fieldProblems([jpy.spec], [jpy.spec.key: "lots"])[jpy.spec.key], "Enter an amount")

    // The create sheet sends the value nested under `custom`, in minor units, in the ONE contacts-create call.
    let created = createdFields([jpy], [jpy.spec.key: "¥1,500"])
    XCTAssertEqual((created["custom"] as? [String: Any])?["budget"] as? Int64, 1500)
  }

  /// The field drawer's types and currencies are the console's (`CONTACT_FIELD_TYPES`, the deal currencies).
  func testTheFieldEditorOffersTheConsolesTypesAndCurrencies() {
    let values = ContractValues.shared
    XCTAssertEqual(values.nativeCrmFieldTypes.last, "currency")
    XCTAssertEqual(values.nativeCrmFieldTypeLabels["currency"], "Currency")
    XCTAssertTrue(values.nativeCrmFieldCurrencies.contains("jpy"))
    XCTAssertEqual(values.nativeCrmFieldDefaultCurrency, "usd")
    let def = CustomFieldDefinition(
      id: "f", key: "budget", label: "Budget", type: "currency", options: [], required: true, order: 0, retired: false,
      object: "contact", currency: "jpy")
    XCTAssertEqual(fieldSubtitle(def), "budget · Currency · JPY · Required")
  }

  func testFieldListFieldsAreTheConsoles() throws {
    for (index, item) in try functionCases("crmFieldListFields").enumerated() {
      let def = item.args[0] as! [String: Any]
      let got = fieldListFields(
        key: def["key"] as! String, label: def["label"] as! String, required: def["required"] as? Bool == true,
        object: def["object"] as? String ?? "contact")
      let want = item.result as! [String: Any]
      XCTAssertEqual(got["searchTokens"] as? [String], want["searchTokens"] as? [String], "case \(index)")
      XCTAssertEqual(got["object"] as? String, want["object"] as? String, "case \(index)")
    }
  }

  func testPipelineTotalsAreTheConsoles() throws {
    for (index, item) in try functionCases("pipelineTotals").enumerated() {
      let stages = ((item.args[1] as! [String: Any])["stages"] as! [[String: Any]]).map {
        Stage(
          id: $0["id"] as! String, name: $0["name"] as! String, order: ($0["order"] as! NSNumber).intValue,
          probability: ($0["probability"] as! NSNumber).intValue, kind: $0["kind"] as! String, forecastCategory: nil)
      }
      let got = pipelineTotals(item.args[0] as! [[String: Any]], Pipeline(id: "p", name: "P", stages: stages, isDefault: false, archived: false))
      let want = item.result as! [String: Any]
      XCTAssertEqual(got.count, (want["count"] as! NSNumber).intValue, "case \(index)")
      XCTAssertEqual(got.amountCents, (want["amountCents"] as! NSNumber).int64Value, "case \(index)")
      XCTAssertEqual(got.weightedCents, (want["weightedCents"] as! NSNumber).int64Value, "case \(index)")
      XCTAssertEqual(got.stages.map(\.count), (want["stages"] as! [[String: Any]]).map { ($0["count"] as! NSNumber).intValue })
    }
  }

  func testTheLeadFunnelIsTheConsoles() throws {
    for (index, item) in try functionCases("leadFunnel").enumerated() {
      let got = leadFunnel(item.args[0] as! [[String: Any]])
      let want = item.result as! [String: Any]
      XCTAssertEqual(got.total, (want["total"] as! NSNumber).intValue, "case \(index)")
      XCTAssertEqual(got.open, (want["open"] as! NSNumber).intValue, "case \(index)")
      XCTAssertEqual(got.reasons.map(\.label), (want["reasons"] as! [[String: Any]]).map { $0["label"] as! String }, "case \(index)")
    }
  }

  func testAnEditWritesOnlyWhatChanged() {
    let fields = [
      CrmField(.init("name", "Name")), CrmField(.init("amount", "Amount", kind: .money), path: "amountCents", stored: .cents),
      CrmField(.init("custom.size", "Size"), path: "custom.size"), CrmField(.init("phone", "Phone")),
    ]
    let before = formValues(fields, ["name": "A", "amountCents": 1250, "custom": ["size": "M"], "phone": "1"])
    XCTAssertEqual(before["amount"], "12.5")
    let changes = changedFields(fields, before: before, after: before.merging(["amount": "20", "custom.size": "L", "phone": ""]) { $1 })
    XCTAssertEqual(changes["amountCents"] as? Int64, 2000)
    XCTAssertEqual((changes["custom"] as? [String: Any])?["size"] as? String, "L")
    XCTAssertTrue(changes["phone"] is FirestoreSentinel)
    XCTAssertNil(changes["name"])
  }

  func testTheSuiteFollowsTheRules() {
    XCTAssertTrue(crmSuiteCarried(["plan": "pro"]))
    XCTAssertFalse(crmSuiteCarried(["plan": "pro", "billingStatus": "canceled"]))
    XCTAssertFalse(crmSuiteCarried(["plan": "free"]))
    XCTAssertTrue(crmSuiteCarried(["entitlements": ["features": ["crm": true]]]))
  }
}

/// The Contacts list asked to open one person by address (`contactsListSeed`, `?email=`).
final class CrmContactByEmailTests: XCTestCase {
  func testTheAddressNarrowsTheListToThatOnePerson() {
    let filter = contactEmailFilter("  Jane@Example.com ")
    XCTAssertEqual(filter?.id, contactEmailFilterID)
    XCTAssertEqual(filter?.clauses, [ListFilterRequest(field: "email", op: "equals", value: "jane@example.com")])
    XCTAssertNil(contactEmailFilter(nil))
    XCTAssertNil(contactEmailFilter("not an address"))
  }
}
