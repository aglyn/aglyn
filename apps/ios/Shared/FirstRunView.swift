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
  @State private var startingSite = false
  @State private var siteError: String?

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
    // The console's empty home (AGL-3761): the first site sets the workspace up, or a workspace is made on its own.
    AglynEmptyState(
      "Create your first site", systemImage: "square.stack.3d.up",
      message: "Your first site sets up your workspace automatically — no separate setup needed."
    ) {
      VStack(spacing: AglynSpace.one) {
        if let siteError { AglynNotice(siteError, tone: .error) }
        Button(startingSite ? "Setting up your workspace…" : "Create site") { startFirstSite() }
          .buttonStyle(.aglynProminent)
          .disabled(startingSite)
          .accessibilityIdentifier("first-run-create-site")
        Button("Create an organization") { creating = true }
          .buttonStyle(.borderless)
          .accessibilityIdentifier("first-run-create")
      }
    }
  }

  private func startFirstSite() {
    startingSite = true
    siteError = nil
    Task {
      siteError = await model.createFirstSite()
      startingSite = false
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
  /// The Workspace URL (the console's field): made from the name until the person types their own.
  @State private var slug: String?

  private var shownSlug: String { slug ?? WorkspaceName.slug(name) }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Organization name", text: $name)
            .accessibilityIdentifier("first-run-organization")
          LabeledContent {
            HStack(spacing: 2) {
              TextField(
                "Workspace URL", text: Binding(get: { shownSlug }, set: { slug = WorkspaceName.urlInput($0) }),
                prompt: Text("acme-inc")
              )
              .labelsHidden()
              .autocorrectionDisabled()
              #if os(iOS)
                .textInputAutocapitalization(.never)
                .keyboardType(.URL)
              #endif
              .multilineTextAlignment(.trailing)
              .accessibilityIdentifier("create-workspace-url")
              Text(".\(domain)").foregroundStyle(.secondary)
            }
          } label: {
            Text("Workspace URL")
          }
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
      if let failure = await model.createWorkspace(named: name, slug: shownSlug) {
        error = failure
      } else {
        done()
      }
      busy = false
    }
  }
}
