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
  var label: String { rawValue.capitalized }
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
    FieldOption(doc.id, doc.string("name").flatMap { $0.isEmpty ? nil : $0 } ?? doc.string("email") ?? doc.id)
  }

  func start(_ context: NativePluginContext, _ scope: CrmScope, _ api: CrmAPI) {
    let reader = context.firestore
    picklistDocs.show(reader) { _ in scopedQuery(scope, "crmPicklists", limit: 40) }
    fieldDocs.show(reader) { _ in scopedQuery(scope, "contactFields", limit: 200) }
    pipelineDocs.show(reader) { _ in scopedQuery(scope, "pipelines", limit: 20) }
    companyDocs.show(reader) { _ in scopedQuery(scope, "companies", order: [.init("nameLower")], limit: 200) }
    contactDocs.show(reader) { _ in scopedQuery(scope, "contacts", order: [.init("updatedAt", descending: true)], limit: 200) }
    Task { members = await api.members() }
  }

  func stop() {
    for list in [picklistDocs.stop, fieldDocs.stop, pipelineDocs.stop, companyDocs.stop, contactDocs.stop] { list() }
  }

  var picklists: Picklists { Picklists(picklistDocs.rows) }
  var customFields: [CustomFieldDefinition] { fieldDocs.rows }
  var companies: [FieldOption] { companyDocs.rows }
  var contacts: [FieldOption] { contactDocs.rows }

  func fields(_ kind: CrmKind) -> [CrmField] {
    standardFields(kind, picklists: picklists, members: members, companies: companies, contacts: contacts)
      + customFieldsOf(kind, customFields)
  }

  func memberLabel(_ uid: String?) -> String? {
    guard let uid, !uid.isEmpty else { return nil }
    return members.first { $0.uid == uid }?.label ?? uid
  }

  var activePipelines: [Pipeline] {
    let live = pipelineDocs.rows.filter { !$0.archived }
    return live.isEmpty ? [.standard] : live
  }

  func pipeline(_ id: String?) -> Pipeline {
    activePipelines.first { $0.id == id } ?? activePipelines.first { $0.isDefault } ?? activePipelines[0]
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
          AglynEmptyState(
            "The CRM is included from Starter", systemImage: "person.2",
            message: "Leads, contacts, companies, deals and tasks come with the Starter plan and above. Change the plan under Billing to use them."
          )
          .accessibilityIdentifier("crm-suite-locked")
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
      guard let orgID = context.orgID, let hostID = context.hostID else { return }
      scopeModel.start(context.firestore, orgID: orgID, hostID: hostID, uid: context.uid)
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

  var body: some View {
    CrmGate(context: context) { scope, api, reference in
      VStack(spacing: 0) {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: AglynSpace.one) {
            ForEach(CrmSection.allCases) { item in
              AglynChoiceChip(item.label, systemImage: item.symbol, selected: section == item) { section = item }
            }
          }
          .padding(.horizontal, AglynSpace.two)
          .padding(.vertical, AglynSpace.one)
        }
        .accessibilityIdentifier("crm-sections")
        sectionView(scope, api, reference).frame(maxWidth: .infinity, maxHeight: .infinity)
      }
      .background(AglynColor.page)
    }
    .navigationTitle(section == .contacts ? "CRM" : section.label)
  }

  @ViewBuilder
  private func sectionView(_ scope: CrmScope, _ api: CrmAPI, _ reference: CrmReference) -> some View {
    switch section {
    case .contacts, .leads, .companies:
      RecordsSection(context: context, kind: section.kind!, scope: scope, api: api, reference: reference, initial: initialRecord)
        .id(section)
    case .deals: DealsSection(context: context, scope: scope, api: api, reference: reference, initial: initialRecord)
    case .tasks: TasksSection(context: context, scope: scope, api: api, reference: reference)
    case .reports: ReportsSection(context: context, scope: scope, reference: reference)
    case .fields: FieldsSection(context: context, scope: scope, reference: reference)
    case .settings: SettingsSection(context: context, scope: scope, reference: reference)
    }
  }
}
