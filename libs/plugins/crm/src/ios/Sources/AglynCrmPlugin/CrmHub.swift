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
  /// At the workspace's level: the site new records are filed under (the console's `createHostId`).
  @AppStorage("aglyn.crm.createSite") private var storedCreateHost = ""

  private var createHost: String? {
    guard context.hostID == nil else { return nil }
    if context.sites.contains(where: { $0.id == storedCreateHost }) { return storedCreateHost }
    return context.sites.first?.id
  }

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
    .task(id: "\(context.orgID ?? "")|\(context.hostID ?? "")|\(createHost ?? "")") {
      guard let orgID = context.orgID else { return }
      if let hostID = context.hostID {
        scopeModel.start(context.firestore, orgID: orgID, hostID: hostID, uid: context.uid)
      } else {
        // The workspace's CRM: every site's records, new ones filed under the site picked for them.
        scopeModel.start(context.firestore, orgID: orgID, hostID: createHost ?? "", uid: context.uid, orgLevel: true)
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
      VStack(spacing: 0) {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: AglynSpace.one) {
            ForEach(CrmSection.allCases) { item in
              AglynChoiceChip(item.label, systemImage: item.symbol, selected: section == item) { section = item }
            }
          }
          .aglynContentEdges()
          .padding(.vertical, AglynSpace.one)
        }
        .accessibilityIdentifier("crm-sections")
        if scope.orgLevel { CrmCreateSitePick(context: context, scope: scope) }
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

/// The workspace's CRM: every site's records; a new record is filed under the site picked here (the console's org
/// page asks the same).
struct CrmCreateSitePick: View {
  let context: NativePluginContext
  let scope: CrmScope
  @AppStorage("aglyn.crm.createSite") private var storedCreateHost = ""

  var body: some View {
    if context.sites.count > 1 {
      HStack(spacing: AglynSpace.one) {
        Text("Every site's records. New ones go to").font(AglynFont.subheadline).foregroundStyle(.secondary)
        Menu {
          ForEach(context.sites) { site in Button(site.name) { storedCreateHost = site.id } }
        } label: {
          Label(context.siteName(scope.hostID), systemImage: "globe").font(AglynFont.strongSubheadline)
        }
        .fixedSize()
        .accessibilityIdentifier("crm-create-site")
        Spacer(minLength: 0)
      }
      .aglynContentEdges()
      .padding(.bottom, AglynSpace.one)
    }
  }
}
