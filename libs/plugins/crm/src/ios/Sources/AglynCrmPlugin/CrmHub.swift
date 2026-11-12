// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// The CRM hub's sections, in the console's rail order.
enum CrmSection: String, CaseIterable, Identifiable {
  case contacts, leads, companies, deals, tasks, reports, fields, settings
  var id: String { rawValue }
  /// As the console's hub and the shell's rows name it; the record itself stays a deal.
  var label: String { self == .deals ? "Deals / Opportunities" : rawValue.capitalized }
  var screen: String { "crm.\(rawValue)" }

  var symbol: String {
    switch self {
    case .contacts: "person.2"
    case .leads: "person.badge.plus"
    case .companies: "building.2"
    case .deals: "dollarsign.circle"
    case .tasks: "checklist"
    case .reports: "chart.bar"
    case .fields: "slider.horizontal.3"
    case .settings: "gearshape"
    }
  }

  var kind: CrmKind? {
    switch self {
    case .contacts: .contact
    case .leads: .lead
    case .companies: .company
    case .deals: .deal
    default: nil
    }
  }
}

/// What every section reads beside its own list: the team, the picklists, the custom fields, the pipelines.
@MainActor
@Observable
final class CrmReference {
  private(set) var members: [CrmMember] = []
  @ObservationIgnored let picklistDocs = LiveQueryList(pageSize: 40) { $0 }
  @ObservationIgnored let fieldDocs = LiveQueryList(pageSize: 200, map: customField)
  @ObservationIgnored let pipelineDocs = LiveQueryList(pageSize: 20, map: pipelineOf)
  @ObservationIgnored let companyDocs = LiveQueryList(pageSize: 200) { FieldOption($0.id, $0.string("name") ?? $0.id) }
  @ObservationIgnored let contactDocs = LiveQueryList(pageSize: 200) { doc in
    FieldOption(doc.id, crmContactLabel(contactView(doc.data, groupID: crmContactPrimaryHolder(doc.data, org: nil))))
  }
  /// The most recently updated deals, which **Related To** offers below the open deals of the people on an entry.
  @ObservationIgnored let dealDocs = LiveQueryList(pageSize: 200) { $0 }

  func start(_ context: NativePluginContext, _ scope: CrmScope, _ api: CrmAPI) {
    let reader = context.firestore
    picklistDocs.show(reader) { _ in scopedQuery(scope, "crmPicklists", limit: 40) }
    fieldDocs.show(reader) { _ in scopedQuery(scope, "contactFields", limit: 200) }
    pipelineDocs.show(reader) { _ in scopedQuery(scope, "pipelines", limit: 20) }
    companyDocs.show(reader) { _ in scopedQuery(scope, "companies", order: [.init("nameLower")], limit: 200) }
    contactDocs.show(reader) { _ in scopedQuery(scope, "contacts", order: [.init("updatedAt", descending: true)], limit: 200) }
    dealDocs.show(reader) { _ in scopedQuery(scope, "deals", order: [.init("updatedAt", descending: true)], limit: 200) }
    // The roster names every owner; a read that comes back empty (a slow first request on a cold server) is asked again.
    Task {
      for attempt in 0..<3 {
        let answer = await api.members()
        if !answer.isEmpty {
          members = answer
          break
        }
        try? await Task.sleep(nanoseconds: UInt64(2_000_000_000 * (attempt + 1)))
      }
    }
  }

  func stop() {
    for list in [picklistDocs.stop, fieldDocs.stop, pipelineDocs.stop, companyDocs.stop, contactDocs.stop, dealDocs.stop] { list() }
  }

  var picklists: Picklists { Picklists(picklistDocs.rows) }
  var customFields: [CustomFieldDefinition] { fieldDocs.rows }
  var companies: [FieldOption] { companyDocs.rows }
  var contacts: [FieldOption] { contactDocs.rows }
  var deals: [FirestoreDocument] { dealDocs.rows }

  /// A contact's name as the windows hold it; nil for one outside them.
  func contactLabel(_ id: String) -> String? { contacts.first { $0.value == id }?.label }

  func fields(_ kind: CrmKind) -> [CrmField] {
    standardFields(kind, picklists: picklists, members: members, companies: companies, contacts: contacts)
      + customFieldsOf(kind, customFields)
  }

  func memberLabel(_ uid: String?) -> String? {
    guard let uid, !uid.isEmpty else { return nil }
    // One the roster does not hold (yet) reads `Member 4f2a9c`, as the console's `labelFor` does, never a raw uid.
    return members.first { $0.uid == uid }?.label ?? "Member \(uid.suffix(6))"
  }

  var activePipelines: [Pipeline] {
    let live = pipelineDocs.rows.filter { !$0.archived }
    return live.isEmpty ? [.standard] : live
  }

  func pipeline(_ id: String?) -> Pipeline {
    activePipelines.first { $0.id == id } ?? activePipelines.first { $0.isDefault } ?? activePipelines[0]
  }

  /// A stage's name in its pipeline (an archived one too), else in the pipeline a deal without one falls back to; the id
  /// itself when neither has it.
  func stageName(_ pipelineID: String?, _ stageID: String) -> String {
    let named = (pipelineDocs.rows + [.standard]).first { $0.id == pipelineID } ?? pipeline(pipelineID)
    return named.stages.first { $0.id == stageID }?.name ?? stageID
  }
}

/// The CRM's gate: the site's scope, then the plan, then the content with the shared reads.
struct CrmGate<Content: View>: View {
  let context: NativePluginContext
  @ViewBuilder let content: (CrmScope, CrmAPI, CrmReference) -> Content
  @State private var scopeModel = CrmScopeModel()
  @State private var reference = CrmReference()

  var body: some View {
    Group {
      if let scope = scopeModel.scope {
        if !scope.suite {
          // The console's notice for a plugin the plan leaves out, with View plans (Figma Notice/Upgrade).
          AglynUpgradeNotice(upgradeNoticeMessage(title: "CRM", feature: "crm"), kind: .plan) {
            context.navigate("core.billing.plans")
          }
          .asScreen()
          .accessibilityIdentifier("crm-suite-locked")
        } else if scope.orgLevel && !scope.opensWorkspaceCrm {
          // Only a member who reaches every site and holds "Manage data" reads every record; anyone else reads them a site at a time.
          AglynEmptyState(
            "Pick a site to see its records", systemImage: "globe",
            message: "The whole workspace's CRM needs the Manage data permission on every site. Your records are on the sites you belong to.")
            .accessibilityIdentifier("crm-workspace-reach")
        } else {
          let api = CrmAPI(api: context.api, reader: context.firestore, scope: scope)
          content(scope, api, reference)
            .task(id: scope.readTokens) { reference.start(context, scope, api) }
        }
      } else if scopeModel.failed {
        AglynEmptyState("Could not open the CRM", systemImage: "exclamationmark.triangle")
      } else {
        List { SkeletonRows(count: 6) }.aglynListBackground()
      }
    }
    .task(id: "\(context.orgID ?? "")|\(context.hostID ?? "")") {
      guard let orgID = context.orgID else { return }
      if let hostID = context.hostID {
        scopeModel.start(context.firestore, orgID: orgID, hostID: hostID, uid: context.uid)
      } else {
        // The workspace's CRM: every site's records, a new one naming its site in its own form.
        scopeModel.start(context.firestore, orgID: orgID, hostID: "", uid: context.uid, orgLevel: true)
      }
    }
    .onDisappear {
      scopeModel.stop()
      reference.stop()
    }
  }
}

/// The CRM hub: the console's sections as a picker over the chosen one.
struct CrmHubScreen: View {
  let context: NativePluginContext
  @State var section: CrmSection
  var initialRecord: String?
  /// The Contacts list asked to open the one person with this address (`?email=`, `contactByEmail`).
  var openEmail: String?
  /// Opened from Create new (`new=1`): the section's list opens its new-record sheet.
  var startNew = false

  var body: some View { hub(context) }

  private func hub(_ context: NativePluginContext) -> some View {
    CrmGate(context: context) { scope, api, reference in
      // The sections across the top, or under the CRM's title in the list column beside a record (Figma 13:483).
      AglynSectionHub(
        CrmSection.allCases, selection: $section, label: \.label, systemImage: \.symbol, identifier: "crm-sections"
      ) {
        sectionView(context, scope, api, reference).frame(maxWidth: .infinity, maxHeight: .infinity)
      }
      .background(AglynGround())
    }
    .navigationTitle(section == .contacts ? "CRM" : section.label)
    .aglynScreenTitle(section == .contacts ? "CRM" : section.label)
  }

  @ViewBuilder
  private func sectionView(
    _ context: NativePluginContext, _ scope: CrmScope, _ api: CrmAPI, _ reference: CrmReference
  ) -> some View {
    switch section {
    case .contacts, .leads, .companies:
      RecordsSection(
        context: context, kind: section.kind!, scope: scope, api: api, reference: reference, initial: initialRecord,
        openEmail: section == .contacts ? openEmail : nil, startNew: startNew)
        .id(section)
    case .deals: DealsSection(context: context, scope: scope, api: api, reference: reference, initial: initialRecord)
    case .tasks: TasksSection(context: context, scope: scope, api: api, reference: reference)
    case .reports: ReportsSection(context: context, scope: scope, reference: reference)
    case .fields: FieldsSection(context: context, scope: scope, reference: reference)
    case .settings: SettingsSection(context: context, scope: scope, reference: reference)
    }
  }
}

/// The site a create came from last, per workspace, for this run of the app (the console keeps it for the session): a
/// site remembered across weeks would stamp a record onto a site the reader had forgotten choosing.
@MainActor
enum CrmCreateSiteMemory {
  private static var picks: [String: String] = [:]

  static func pick(_ orgID: String) -> String? { picks[orgID] }
  static func remember(_ site: String?, _ orgID: String) { picks[orgID] = site }
}

/// The field a create at the workspace's level asks with (the console's `CrmSitePicker`): the record's optional source
/// where every site sees it, or the site it belongs to where the workspace keeps them apart. Nil under a site, and with
/// one site, which is then the answer (`crmCreateHost`).
func crmSiteField(_ kind: CrmKind, _ scope: CrmScope, sites: [NativeSiteRef]) -> CrmField? {
  guard scope.orgLevel, sites.count != 1 else { return nil }
  // A lead is the one record a site always files: it is private to that site.
  let required = scope.createNeedsSite || kind == .lead
  let options = sites.map { FieldOption($0.id, $0.name) }
  let help: String
  if !required {
    help =
      kind == .contact
      ? "Where they came from, if anywhere. Every site in the organization can see them either way."
      : "Where it came from, if anywhere. Every site in the organization can see it either way."
  } else if sites.isEmpty {
    help = "This organization has no sites yet, so nothing can be filed."
  } else {
    help =
      switch kind {
      case .contact: "The site that captures this person — it decides which sites may see them."
      case .lead: "The site this lead is filed under — a lead is private to one site."
      case .company: "The site this company belongs to — it decides which of your sites may see it."
      case .deal: "The site this deal belongs to — it decides which of your sites may see it."
      }
  }
  return CrmField(
    FieldSpec(
      crmSiteFieldKey, required ? "Site" : "Source site", kind: .select, required: required, options: options, help: help,
      emptyLabel: required ? nil : "None"),
    editable: false)
}

let crmSiteFieldKey = "crmSourceSite"
