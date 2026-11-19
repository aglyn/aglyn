// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/// The console page view's SEO card, as a section of the page's details: the search title (variables resolved and
/// counted as a search result shows them), description, breadcrumb label, the social image picked from the media library
/// with its size and description, Save SEO, and the site's SEO check answered for this page. The Kotlin kit's
/// PageSeoSection in PageSeoScreens.kt.
struct PageSeoSection: View {
  let context: NativePluginContext
  let hostID: String
  let page: PageNode
  let livePath: String?
  let screen: [String: Any]?
  let host: [String: Any]?
  let api: PageSettingsAPI
  let runner: ActionRunner
  let canEdit: Bool
  @State private var title: String?
  @State private var description: String?
  @State private var breadcrumb: String?
  @State private var image: PageSocialImage?
  @State private var checking = false
  @State private var check: CheckAnswer?

  enum CheckAnswer: Equatable {
    case page(SeoPageReport)
    case unchecked
    case error(String)
  }

  private var stored: PageSeo { PageSeo(screen?["seo"] as? [String: Any]) }
  private var dirty: Bool {
    (title != nil && title != stored.title) || (description != nil && description != stored.description)
      || (breadcrumb != nil && breadcrumb != stored.breadcrumb) || (image != nil && image != stored.image)
  }

  private func text(_ staged: Binding<String?>, _ storedValue: String) -> Binding<String> {
    Binding(get: { staged.wrappedValue ?? storedValue }, set: { staged.wrappedValue = $0 })
  }

  var body: some View {
    let seo = stored
    let titleValue = title ?? seo.title
    let siteSEO = host?["seo"] as? [String: Any]
    let resolved = resolveSeoTitleVariables(
      titleValue, pageName: page.name, siteName: (siteSEO?["title"] as? String) ?? (host?["displayName"] as? String) ?? "",
      separator: siteSEO?["separator"] as? String ?? "")
    let currentImage = image ?? seo.image
    Section("SEO") {
      AglynCountedField(
        "Title", text: text($title, seo.title),
        error: resolved.count > PageSeoLimits.title ? "\(resolved.count)/\(PageSeoLimits.title) — longer than a search result shows" : nil,
        supporting: hasSeoTitleVariables(titleValue)
          ? "\(resolved.count)/\(PageSeoLimits.title) — renders as “\(resolved)”"
          : "\(titleValue.count)/\(PageSeoLimits.title) — published verbatim; the site title is not appended. Add a "
            + "variable to keep it in step with Host setup → SEO.",
        enabled: canEdit)
      .accessibilityIdentifier("page-seo-title")
      Menu("Insert a variable") {
        ForEach(pageSeoTitleVariables, id: \.name) { variable in
          Button(variable.label) { title = (title ?? seo.title) + "{{\(variable.name)}}" }
        }
      }
      .disabled(!canEdit)
      .accessibilityIdentifier("page-seo-insert-variable")
      AglynCountedField(
        "Description", text: text($description, seo.description), max: PageSeoLimits.description, multiline: true,
        enabled: canEdit)
      .accessibilityIdentifier("page-seo-description")
      AglynCountedField(
        "Breadcrumb label", text: text($breadcrumb, seo.breadcrumb), max: PageSeoLimits.breadcrumb,
        supporting: "The page’s name in a breadcrumb trail", enabled: canEdit)
      .accessibilityIdentifier("page-seo-breadcrumb")
      MediaPickField(
        context: context, label: "Social image", value: currentImage?.image ?? "", enabled: canEdit,
        supporting: "The picture shown when this page is shared. Leave it unset to use the site default from Site setup "
          + "▸ SEO. Recommended: 1200×630 PNG or JPG — the size social networks crop to.",
        onPick: { chosen in
          image = PageSocialImage(
            image: chosen.reference, width: chosen.item.width ?? 0, height: chosen.item.height ?? 0,
            alt: inheritedSocialImageAlt(current: currentImage?.alt ?? "", assetAlt: chosen.item.alt))
        },
        onClear: { image = PageSocialImage(image: "", width: 0, height: 0, alt: "") })
      if let currentImage, !currentImage.image.isEmpty {
        AglynCountedField(
          "Image description",
          text: Binding(
            get: { currentImage.alt },
            set: { alt in
              var next = currentImage
              next.alt = String(alt.prefix(PageSeoLimits.imageAlt))
              image = next
            }),
          max: PageSeoLimits.imageAlt, multiline: true,
          supporting: "Read aloud by screen readers in a social preview. Describe the picture, not the page.",
          placeholder: "What the picture shows", enabled: canEdit)
        .accessibilityIdentifier("page-seo-image-alt")
      }
      HStack {
        Button("Save SEO") { save() }
          .buttonStyle(.aglynProminent)
          .disabled(!canEdit || !dirty || runner.busy)
          .accessibilityIdentifier("page-seo-save")
        if dirty {
          Button("Discard") { discard() }.buttonStyle(.borderless)
        }
      }
      checkView
    }
  }

  @ViewBuilder
  private var checkView: some View {
    VStack(alignment: .leading, spacing: AglynSpace.one) {
      HStack(spacing: AglynSpace.one) {
        Button(check == nil ? "Check this page" : "Check again") { runCheck() }
          .buttonStyle(.aglynSecondary)
          .disabled(checking)
          .accessibilityIdentifier("page-seo-check")
        if checking { ProgressView().controlSize(.small).accessibilityLabel("Checking this page") }
        if case .page(let report) = check {
          Text("Score \(report.score) of 100, as published").font(AglynFont.caption).foregroundStyle(.secondary)
        }
      }
      switch check {
      case .error(let message)?: AglynNotice(message, tone: .warning)
      case .unchecked?:
        AglynHelperText(
          "This page is not in the sitemap — it is unpublished, not public, a template or an error page — so the SEO "
            + "check does not cover it.")
      case .page(let report)?:
        if report.findings.isEmpty {
          Text("Nothing found: this page has what a search result needs.").font(AglynFont.subheadline)
        } else {
          ForEach(report.findings, id: \.self) { finding in
            (Text(seoFindingLabel(finding)).bold() + Text(" — \(finding.message)")).font(AglynFont.subheadline)
          }
        }
      case nil: EmptyView()
      }
    }
  }

  private func runCheck() {
    checking = true
    Task { @MainActor in
      defer { checking = false }
      do {
        let report = try await runSeoCheck(api: context.api, hostID: hostID, keywords: "")
        check = report.pages.first { $0.screenId == page.id }.map(CheckAnswer.page) ?? .unchecked
      } catch {
        check = .error((error as? ConsoleAPIError)?.message ?? "The SEO check could not run — try again.")
      }
    }
  }

  private func discard() {
    title = nil
    description = nil
    breadcrumb = nil
    image = nil
  }

  private func save() {
    let update = buildScreenSeoUpdate(
      screen?["seo"] as? [String: Any], title: title, description: description, breadcrumb: breadcrumb, image: image)
    runner.run("SEO saved") {
      try await api.saveSeo(page.id, seo: update, livePath: livePath)
      discard()
    }
  }
}
