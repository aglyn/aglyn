// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// The update review of a copied listing, the console's `ArtifactUpdateDialog`: the version pair, why it cannot be merged
/// or that nothing changes, a schema's effect on stored records, then the changes in three groups — safe to take, yours
/// kept, and changed on both sides with "Take theirs" — and Install as a new copy or Apply.
struct ArtifactUpdateSheet: View {
  let context: NativePluginContext
  let listing: ListingRow
  let runner: PluginActionRunner
  /// Installs the new version as a fresh copy where the update route cannot detach one (anything but a component or a layout).
  let installCopy: () -> Void
  let close: () -> Void
  @State private var preview: ArtifactUpdatePreview?
  @State private var failed: String?
  @State private var take: Set<String> = []
  @State private var confirmDestructive = false

  private var api: ArtifactUpdateAPI? { context.hostID.map { ArtifactUpdateAPI(api: context.api, hostID: $0) } }

  var body: some View {
    NavigationStack {
      List {
        if let failed {
          Section { AglynNotice(failed, tone: .error) }
        } else if let preview {
          content(preview)
        } else {
          Section { SkeletonRows(count: 5) }
        }
        if let error = runner.error { Section { AglynNotice(error, tone: .error) } }
      }
      .aglynListBackground()
      .navigationTitle("Update \(listing.name)")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { runner.error = nil; close() } }
      }
      .safeAreaInset(edge: .bottom) { actions.padding(AglynSpace.two).background(.bar) }
      .task(id: listing.id) {
        guard let api else { return }
        do {
          preview = try await api.preview(listingID: listing.id)
        } catch {
          failed = (error as? ConsoleAPIError)?.message ?? "Could not read this update"
        }
      }
    }
    .accessibilityIdentifier("artifact-update")
  }

  @ViewBuilder
  private func content(_ preview: ArtifactUpdatePreview) -> some View {
    Section {
      Text(preview.versionLine).font(AglynFont.subheadline).foregroundStyle(.secondary)
      if !preview.mergeable {
        AglynNotice(preview.reason ?? "", tone: .info)
      } else if preview.identical {
        AglynNotice("Your copy already matches the new version — nothing to take.", tone: .success)
      }
      if let schema = preview.schema {
        AglynNotice(
          "\(schema.added) field(s) added, \(schema.removed) removed, \(schema.retyped) retyped.\n"
            + (preview.destructive
              ? "This dataset holds \(schema.recordCount) record(s). Removing or retyping a field changes how their existing values read."
              : "Additive only — nothing already stored is reinterpreted."),
          tone: preview.destructive ? .warning : .info)
      }
    }
    if preview.mergeable {
      group("Safe to take", "Changed by the publisher, untouched here. Applied when you update.", preview.safe)
      group("Your changes, kept", "Edited here and not upstream. The update leaves these alone.", preview.kept)
      if !preview.conflicts.isEmpty {
        Section {
          ForEach(preview.conflicts) { change in
            Toggle(isOn: Binding(get: { take.contains(change.path) }, set: { on in if on { take.insert(change.path) } else { take.remove(change.path) } })) {
              row(change)
            }
            .accessibilityIdentifier("artifact-update-take-\(change.path)")
          }
        } header: {
          header("Changed on both sides", preview.conflicts.count)
        } footer: {
          Text("Both you and the publisher changed these. Yours is kept unless you tick it.")
        }
      }
      if preview.unchanged > 0 {
        Section { Text("\(preview.unchanged) field(s) identical in both versions.").font(AglynFont.caption).foregroundStyle(.secondary) }
      }
    }
    if preview.destructive, let schema = preview.schema {
      Section {
        Toggle("I understand this affects \(schema.recordCount) existing record(s)", isOn: $confirmDestructive)
          .accessibilityIdentifier("artifact-update-confirm-destructive")
      }
    }
  }

  @ViewBuilder
  private func group(_ title: String, _ caption: String, _ changes: [ArtifactChange]) -> some View {
    if !changes.isEmpty {
      Section {
        ForEach(changes) { row($0) }
      } header: {
        header(title, changes.count)
      } footer: {
        Text(caption)
      }
    }
  }

  private func header(_ title: String, _ count: Int) -> some View {
    HStack(spacing: AglynSpace.one) {
      Text(title)
      StatusChip("\(count)")
    }
  }

  private func row(_ change: ArtifactChange) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(describeChange(path: change.path, added: change.added, removed: change.removed))
        .font(AglynFont.subheadline.monospaced()).textSelection(.enabled)
      if !change.added && !change.removed {
        Text("yours: \(summarizeValue(change.current)) · theirs: \(summarizeValue(change.incoming))")
          .font(AglynFont.caption).foregroundStyle(.secondary)
      }
    }
  }

  private var actions: some View {
    HStack(spacing: AglynSpace.one) {
      Button("Install as a new copy") { copy() }
        .buttonStyle(.aglynSecondary)
        .disabled(runner.busy || preview == nil)
        .accessibilityIdentifier("artifact-update-copy")
      Spacer()
      Button(preview?.applyLabel(taken: take.count) ?? "Apply safe changes") { merge() }
        .buttonStyle(.aglynProminent)
        .disabled(runner.busy || preview?.mergeable != true || (preview?.destructive == true && !confirmDestructive))
        .accessibilityIdentifier("artifact-update-apply")
    }
  }

  private func merge() {
    guard let api, let preview else { return }
    let paths = preview.conflicts.map(\.path).filter(take.contains)
    let confirm = confirmDestructive
    // Left open on failure: a destructive schema update comes back asking for the tick, and closing would hide it.
    runner.run(onDone: close) {
      runner.notice = try await api.apply(listingID: listing.id, mode: "merge", takePaths: paths, confirmDestructive: confirm)
    }
  }

  /// Only a component or a layout has a link to detach; for anything else a fresh copy is the ordinary install.
  private func copy() {
    guard let api else { return }
    if listing.artifactType == "component" || listing.artifactType == "layout" {
      runner.run(onDone: close) { runner.notice = try await api.apply(listingID: listing.id, mode: "copy") }
    } else {
      installCopy()
    }
  }
}
