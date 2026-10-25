// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// Registers the ids `plugins.config.json` declares under the plugin's
/// `mobile.contributes`: every section of the console's CRM hub as a
/// screen, each record kind's screen, the glance and tasks-due Home cards,
/// quick actions, and the console's CRM links.
@MainActor
public func registerCrmNative(_ r: NativePluginRegistrar) {
  for section in CrmSection.allCases {
    r.screen(
      section.screen, title: section == .contacts ? "CRM" : section.label, requiresSite: true, workspaceView: true,
      icon: section.symbol
    ) { ctx, params in
      CrmHubScreen(
        context: ctx, section: section, initialRecord: section.kind.flatMap { params[$0.param] },
        openEmail: section == .contacts ? params[contactsListEmailParam] : nil, startNew: params["new"] == "1")
    }
  }
  for kind in CrmKind.allCases {
    r.screen(kind.detailScreen, title: kind.singular, requiresSite: true, workspaceView: true, icon: kind.symbol) { ctx, params in
      if let id = params[kind.param] ?? params["\(kind.param)Id"] ?? params["id"] {
        CrmGate(context: ctx) { scope, api, reference in
          RecordDetail(context: ctx, kind: kind, id: id, scope: scope, api: api, reference: reference)
        }
      } else {
        CrmHubScreen(context: ctx, section: CrmSection.allCases.first { $0.kind == kind } ?? .contacts)
      }
    }
  }
  r.widget("crm.glance", title: "CRM at a glance", icon: "person.badge.plus", order: 70, size: .full, requiresSite: true) {
    CrmAtAGlanceCard(context: $0, orgLevel: false)
  }
  r.widget("crm.tasks-due", title: "Tasks due", icon: "checklist", order: 72, size: .half, requiresSite: true) {
    CrmTasksDueCard(context: $0, orgLevel: false)
  }
  // The same two cards on the workspace's Home, totaling every site (the console's `orgDashboard` row).
  r.widget("crm.org-glance", title: "CRM at a glance", icon: "person.badge.plus", order: 70, size: .full, slot: crmOrgDashboardSlot) {
    CrmAtAGlanceCard(context: $0, orgLevel: true)
  }
  r.widget("crm.org-tasks-due", title: "Tasks due", icon: "checklist", order: 72, size: .half, slot: crmOrgDashboardSlot) {
    CrmTasksDueCard(context: $0, orgLevel: true)
  }
  r.quickAction("crm.open", title: "CRM", icon: "person.2", order: 70, screen: CrmSection.contacts.screen, requiresSite: true)
  r.quickAction("crm.deals-action", title: "Deals", icon: "dollarsign.circle", order: 72, screen: CrmSection.deals.screen, requiresSite: true)
  r.quickAction("crm.tasks-action", title: "Tasks", icon: "checklist", order: 74, screen: CrmSection.tasks.screen, requiresSite: true)
  r.deepLink("crm.page", path: "/crm", screen: CrmSection.contacts.screen)
  r.deepLink("crm.legacy-contacts", path: "/contacts", screen: CrmSection.contacts.screen)
  for section in CrmSection.allCases { r.deepLink("crm.\(section.rawValue)-page", path: "/crm/\(section.rawValue)", screen: section.screen) }
  for kind in CrmKind.allCases { r.deepLink("crm.\(kind.param)-page", path: "/crm/\(kind.collection)/:\(kind.param)", screen: kind.detailScreen) }
}

