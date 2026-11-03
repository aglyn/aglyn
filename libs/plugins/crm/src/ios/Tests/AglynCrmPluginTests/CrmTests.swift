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

private func role(_ value: Any) -> CrmContactRole {
  let o = value as! [String: Any]
  return CrmContactRole(contactID: o["contactId"] as! String, role: o["role"] as? String, primary: o["primary"] as? Bool == true)
}

private func roles(_ value: Any) -> [CrmContactRole] { (value as? [Any] ?? []).map(role) }

private func picklistValues(_ value: Any) -> [(label: String, active: Bool)] {
  ((value as? [String: Any])?["values"] as? [[String: Any]] ?? []).map { ($0["label"] as! String, $0["active"] as? Bool == true) }
}

private func picksJSON(_ picks: CrmActivityPicks) -> [String: Any] {
  [
    "contactId": picks.contactID as Any? ?? NSNull(),
    "related": picks.related.map { ["kind": $0.kind.rawValue, "id": $0.id] as Any } ?? NSNull(),
  ]
}

private func picks(_ value: Any) -> CrmActivityPicks {
  let o = value as! [String: Any]
  let related = o["related"] as? [String: Any]
  return CrmActivityPicks(
    contactID: o["contactId"] as? String,
    related: related.map { CrmRelated(kind: CrmRelated.Kind(rawValue: $0["kind"] as! String)!, id: $0["id"] as! String) })
}

private func docs(_ value: Any?) -> [FirestoreDocument] {
  (value as? [[String: Any]] ?? []).map { FirestoreDocument(id: $0["$id"] as! String, data: $0) }
}

/// Name, Related To and the company stamp (AGL-4142), as the console's log dialog opens and writes them.
final class CrmActivityLinkTests: XCTestCase {
  func testTheFieldsOpenAsTheConsolesDo() throws {
    for (index, item) in try functionCases("crmActivityPicksFrom").enumerated() {
      let got = crmActivityPicksFrom(item.args[0] as! [String: Any], primaryContactID: item.args.count > 1 ? item.args[1] as? String : nil)
      XCTAssertEqual(got, picks(item.result), "case \(index)")
    }
  }

  func testThePicksWriteTheConsolesLinks() throws {
    for (index, item) in try functionCases("crmActivityLinkFromPicks").enumerated() {
      let got = crmActivityLinkFromPicks(picks(item.args[0]), leadID: item.args.count > 1 ? item.args[1] as? String : nil)
      XCTAssertEqual(got, item.result as? [String: String], "case \(index)")
    }
  }

  func testRelatedToListsWhatTheConsoleLists() throws {
    for (index, item) in try functionCases("crmRelatedToOptions").enumerated() {
      let input = item.args[0] as! [String: Any]
      let got = crmRelatedToOptions(linkedDeals: docs(input["linkedDeals"]), deals: docs(input["deals"]), companies: docs(input["companies"]))
      let want = (item.result as! [[String: Any]]).map {
        CrmPickOption(key: "\($0["kind"] as! String):\($0["id"] as! String)", label: $0["label"] as! String, group: $0["group"] as! String)
      }
      XCTAssertEqual(got, want, "case \(index)")
    }
  }

  /// A deal's contact roles lead Name; anybody else stays one pick away.
  func testNameLeadsWithTheDealsRoles() {
    let contacts = [FieldOption("c2", "Pat Lee"), FieldOption("c1", "Jordan Lee"), FieldOption("c3", "acme buyer")]
    let pinned = crmNameOptions(pinned: [CrmPickOption(key: "c1", label: "Jordan Lee", group: "")], contacts: contacts)
    XCTAssertEqual(pinned.map(\.key), ["c1", "c3", "c2"])
    XCTAssertEqual(pinned.map(\.group), ["On this deal", "All contacts", "All contacts"])
    XCTAssertEqual(crmNameOptions(pinned: [], contacts: contacts).map(\.group), ["", "", ""])
    XCTAssertEqual(CrmRelated(key: "deal:d1"), CrmRelated(kind: .deal, id: "d1"))
    XCTAssertNil(CrmRelated(key: "lead:l1"))
  }
}

/// The Contact roles card's rules (AGL-4142), replayed against the console's answers.
final class CrmContactRoleTests: XCTestCase {
  func testRolesReadAsTheConsoleReadsThem() throws {
    for (index, item) in try functionCases("dealContactRolesOf").enumerated() {
      XCTAssertEqual(dealContactRolesOf(item.args[0] as! [String: Any]), roles(item.result), "case \(index)")
    }
    for (index, item) in try functionCases("companyContactRolesOf").enumerated() {
      XCTAssertEqual(companyContactRolesOf(item.args[0] as! [String: Any]), roles(item.result), "case \(index)")
    }
  }

  func testEachEditMakesTheConsolesList() throws {
    for (index, item) in try functionCases("dealContactRolesWithPrimary").enumerated() {
      XCTAssertEqual(contactRolesWithPrimary(roles(item.args[0]), item.args[1] as? String), roles(item.result), "case \(index)")
    }
    for (index, item) in try functionCases("dealContactRolesWithout").enumerated() {
      XCTAssertEqual(contactRolesWithout(roles(item.args[0]), item.args[1] as! String), roles(item.result), "case \(index)")
    }
    for (index, item) in try functionCases("dealContactRolesWithRole").enumerated() {
      XCTAssertEqual(
        contactRolesWithRole(roles(item.args[0]), item.args[1] as! String, item.args[2] as! String), roles(item.result), "case \(index)")
    }
    for (index, item) in try functionCases("dealContactRolesAdded").enumerated() {
      let added = item.args[1] as! [String: Any]
      XCTAssertEqual(
        contactRolesAdded(roles(item.args[0]), contactID: added["contactId"] as! String, role: added["role"] as? String, primary: added["primary"] as? Bool == true),
        roles(item.result), "case \(index)")
    }
    for (index, item) in try functionCases("dealContactRoleAddProblem").enumerated() {
      XCTAssertEqual(
        contactRoleAddProblem(roles(item.args[0]), item.args[1] as! String, noun: item.args[2] as! String), item.result as? String, "case \(index)")
    }
  }

  func testASaveWritesWhatTheConsoleWrites() throws {
    for (index, item) in try functionCases("dealContactRolesSave").enumerated() {
      let want = item.result as! [String: Any]
      switch dealContactRolesSave(item.args[0] as! [String: Any], roles(item.args[1]), picklistValues(item.args[2])) {
      case .failure(let refusal):
        XCTAssertEqual(refusal.message, want["error"] as? String, "case \(index)")
      case .success(let write):
        XCTAssertEqual(want["ok"] as? Bool, true, "case \(index)")
        XCTAssertEqual(write.contactRoles, roles(want["contactRoles"]!), "case \(index)")
        XCTAssertEqual(write.contactID, want["contactId"] as? String, "case \(index)")
        XCTAssertEqual(write.primaryChanged, want["primaryChanged"] as? Bool, "case \(index)")
      }
    }
    for (index, item) in try functionCases("companyContactRolesSave").enumerated() {
      let want = item.result as! [String: Any]
      switch companyContactRolesSave(item.args[0] as! [String: Any], roles(item.args[1]), picklistValues(item.args[2])) {
      case .failure(let refusal):
        XCTAssertEqual(refusal.message, want["error"] as? String, "case \(index)")
      case .success(let judged):
        XCTAssertEqual(judged, roles(want["contactRoles"]!), "case \(index)")
        let list = contactRoleListFields(judged, visibleTo: nil)
        XCTAssertEqual(list.ids, want["contactRoleContactIds"] as? [String], "case \(index)")
        XCTAssertEqual(list.keys, want["contactRoleKeys"] as? [String], "case \(index)")
      }
    }
  }

  func testTheListFieldsAreTheConsoles() throws {
    for (index, item) in try functionCases("crmDealContactRoleListFields").enumerated() {
      let deal = item.args[0] as! [String: Any]
      let want = item.result as! [String: Any]
      let got = contactRoleListFields(dealContactRolesOf(deal), visibleTo: deal["visibleTo"])
      XCTAssertEqual(got.ids, want["contactRoleContactIds"] as? [String], "case \(index)")
      XCTAssertEqual(got.scoped, want["scopedContactRoleContactIds"] as? [String], "case \(index)")
      XCTAssertEqual(got.keys, want["contactRoleKeys"] as? [String], "case \(index)")
    }
  }

  /// The org's stored list judges a pick; with none stored, its standard values do, all of them active.
  func testThePicklistOffersItsValuesWithWhetherTheyAreActive() {
    let stored = Picklists(stored: [crmContactRolePicklist: [("Evaluator", true), ("Champion", false)]])
    XCTAssertEqual(stored.values(crmContactRolePicklist).map(\.label), ["Evaluator", "Champion"])
    XCTAssertEqual(stored.labels(crmContactRolePicklist), ["Evaluator"])
    XCTAssertTrue(Picklists().values(crmContactRolePicklist).allSatisfy(\.active))
    XCTAssertTrue(Picklists().labels(crmContactRolePicklist).contains("Decision Maker"))
  }
}

/// New contact's marketing opt-in (AGL-4142): the console's sentence, its key, and what the create sends.
final class CrmContactConsentTests: XCTestCase {
  func testTheSentenceAndItsKeyAreTheConsoles() throws {
    for (index, item) in try functionCases("consentGroupDisclosure").enumerated() {
      XCTAssertEqual(consentGroupDisclosure(group(item.args[0])), item.result as? String, "case \(index)")
    }
    for (index, item) in try functionCases("consentGroupDisclosureKey").enumerated() {
      XCTAssertEqual(consentGroupDisclosureKey(group(item.args[0])), item.result as? String, "case \(index)")
    }
  }

  func testTheBoxSaysWhyItIsOffAndWhatNoSiteMeans() {
    let declared = ConsentGroup(hostID: "h1", groupID: "brands", name: "North Brands", hostIDs: ["h1", "h2"], declared: true)
    XCTAssertEqual(contactConsentHelp(hasEmail: false, group: declared), "Add an email first: there is nowhere to send marketing without one.")
    XCTAssertEqual(
      contactConsentHelp(hasEmail: true, group: declared),
      "You'll receive marketing email from North Brands, which covers 2 sites. Tick it only if they agreed. Adding a contact is never itself consent.")
    XCTAssertEqual(
      contactConsentHelp(hasEmail: true, group: nil),
      "With no source site, this records it on every site. Tick it only if they agreed. Adding a contact is never itself consent.")
    XCTAssertEqual(contactConsentHelp(hasEmail: true, group: .solo("h1")), "Tick it only if they agreed. Adding a contact is never itself consent.")
  }

  /// The box counts only beside an address, and its key rides only a ticked box for a group with a sentence.
  func testTheCreateSendsTheBoxAndTheSentencesKey() {
    let declared = ConsentGroup(hostID: "h1", groupID: "brands", name: "North Brands", hostIDs: ["h1", "h2"], declared: true)
    let ticked = contactConsentFields(["email": "pat@example.com", contactConsentKey: "true"], group: declared)
    XCTAssertEqual(ticked["marketingConsent"] as? Bool, true)
    XCTAssertEqual(ticked["disclosedConsentGroup"] as? String, consentGroupDisclosureKey(declared))
    let solo = contactConsentFields(["email": "pat@example.com", contactConsentKey: "true"], group: .solo("h1"))
    XCTAssertEqual(solo["marketingConsent"] as? Bool, true)
    XCTAssertNil(solo["disclosedConsentGroup"])
    let unticked = contactConsentFields(["email": "pat@example.com", contactConsentKey: "false"], group: declared)
    XCTAssertEqual(unticked["marketingConsent"] as? Bool, false)
    XCTAssertNil(unticked["disclosedConsentGroup"])
    let noEmail = contactConsentFields(["email": " ", contactConsentKey: "true"], group: declared)
    XCTAssertEqual(noEmail["marketingConsent"] as? Bool, false)
    XCTAssertNil(noEmail["disclosedConsentGroup"])
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
