/**
 * Host half of dsh-sao-theme.
 *
 * The theme is entirely a browser concern (tokens + injected CSS), so the host
 * side only has to exist: load the plugin entry so the client bundle gets
 * composed into `__DSH_BOOT__`. No services are requested, because asking for
 * one that a composition does not provide would park the fiber forever.
 */
export const name = 'dsh-sao-theme'

export function apply() {}
