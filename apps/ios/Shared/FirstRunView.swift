// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynUI
import SwiftUI

/// What an account with no workspace sees (the console's workspace chooser with nothing in it): the workspace its
/// sign-up asked for being created, the notice when that failed with the name offered back, and creating one.
struct FirstRunView: View {
  @Environment(AppModel.self) private var model
  @State private var creating = false
  @State private var name = ""

  var body: some View {
    VStack(alignment: .leading, spacing: AglynSpace.two) {
      // A pending invite is the reason this person just signed up — lead with it rather than creating a workspace
      // (AGL-851). It joins on its own (AGL-4023): this says it is joining, or that access is almost ready.
      if model.firstRun != .provisioning {
        InviteJoinList()
      }
      switch model.firstRun {
      case .provisioning:
        HStack(spacing: AglynSpace.one) {
          ProgressView()
          Text("Setting up your workspace…").foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 160)
      case .failed(let failed, let reason):
        AglynNotice(
          "We couldn’t create your workspace “\(failed)” during sign-up\(reason.map { " — \($0)" } ?? ""). Your account is ready; the workspace still needs creating.",
          tone: .warning, actionTitle: "Create it now",
          action: {
            name = failed
            creating = true
          })
        emptyState
      case .idle:
        emptyState
      }
    }
    .sheet(isPresented: $creating) { createSheet }
    .task(id: "\(model.auth?.user?.uid ?? "")-\(model.auth?.user?.emailVerified == true)") { await model.joinInvites() }
  }

  private var emptyState: some View {
    AglynEmptyState(
      "No workspaces yet", systemImage: "building.2",
      message: "A workspace is your organization: its sites, team, billing and plan live together."
    ) {
      Button("Create an organization") { creating = true }
        .buttonStyle(.aglynProminent)
        .accessibilityIdentifier("first-run-create")
    }
  }

  private var createSheet: some View {
    CreateWorkspaceSheet(name: name) { creating = false }
  }
}

/// Creates a workspace (the console's "Create an organization"): from the first run, and from Add workspace in the
/// workspace picker.
struct CreateWorkspaceSheet: View {
  @Environment(AppModel.self) private var model
  @State var name: String
  let done: () -> Void
  @State private var busy = false
  @State private var error: String?

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Organization name", text: $name)
            .accessibilityIdentifier("first-run-organization")
        } footer: {
          Text(SignUpRules.organization(name).map { name.isEmpty ? WorkspaceName.helper(workspaceDomain: domain) : $0 }
            ?? WorkspaceName.helper(workspaceDomain: domain))
        }
        if let error { Text(error).foregroundStyle(AglynColor.error) }
      }
      .formStyle(.grouped)
      .navigationTitle("Create an organization")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { done() } }
        ToolbarItem(placement: .confirmationAction) {
          if busy {
            ProgressView()
          } else {
            Button("Create") { create() }.disabled(SignUpRules.organization(name) != nil)
              .accessibilityIdentifier("create-workspace-submit")
          }
        }
      }
    }
    .aglynSheetMinimumSize(width: 420, height: 240)
  }

  private var domain: String { model.config?.workspaceDomain ?? "aglyn.com" }

  private func create() {
    busy = true
    error = nil
    Task {
      if let failure = await model.createWorkspace(named: name) {
        error = failure
      } else {
        done()
      }
      busy = false
    }
  }
}
