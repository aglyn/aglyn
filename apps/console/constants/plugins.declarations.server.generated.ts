/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * The plugins' DECLARATIONS (AGL-2939): the light registrations core
 * reads before any plugin surface loads, imported dynamically like the
 * loader manifests. One of the sanctioned @aglyn/plugins-* references
 * outside libs/plugins (AGL-417).
 * Source of truth: plugins.config.json.
 */
/* eslint-disable @nx/enforce-module-boundaries */

let done: Promise<void> | undefined

/** Registers every plugin's server declarations once per process. */
export function registerPluginServerDeclarations(): Promise<void> {
  done ??= (async () => {
    ;(await import('@aglyn/plugins-outreach/declarations.console-server')).registerOutreachConsoleServerDeclarations()
    ;(await import('@aglyn/plugins-ai/declarations')).registerAiDeclarations()
    ;(await import('@aglyn/plugins-ai/declarations.server')).registerAiServerDeclarations()
    ;(await import('@aglyn/plugins-video-delivery/declarations.server')).registerVideoDeliveryServerDeclarations()
  })()
  return done
}
