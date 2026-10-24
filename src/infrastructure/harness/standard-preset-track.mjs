// @ts-check
/**
 * Which `standard` preset snapshot the Vision模式 declaration restates.
 *
 * DSH presets are self-contained, so Vision模式 copies standard's child rows
 * from a snapshot generated per DSH release. The running registry tells the
 * track apart by capability rather than by guessing an install prefix: DSH
 * 0.2.x added `readDocument` (Remote `read`) and `inspectCompositions`;
 * DSH 0.1.7.x has neither.
 *
 * On 0.2.x the live standard declaration is also read (names only, never
 * mounted or evaluated) so a standard edited upstream or in the Web preset
 * editor shows up as a health warning instead of a silent tool-set mismatch.
 */
import {
  buildStandardPresetChildren as buildLegacyChildren,
  STANDARD_PRESET_SNAPSHOT_CONTRACT as LEGACY_CONTRACT,
} from './standard-preset-snapshot-0.1.7.mjs'
import {
  buildStandardPresetChildren as buildPrimaryChildren,
  STANDARD_PRESET_SNAPSHOT_CONTRACT as PRIMARY_CONTRACT,
} from './standard-preset-snapshot.mjs'

/**
 * @typedef {{ contract: string, build: typeof buildPrimaryChildren }} StandardSnapshot
 */

/** @param {any} agentPresets */
export function hasDocumentReader(agentPresets) {
  return !!agentPresets && typeof agentPresets.readDocument === 'function'
}

/**
 * @param {any} agentPresets
 * @returns {StandardSnapshot}
 */
export function selectStandardSnapshot(agentPresets) {
  if (agentPresets && typeof agentPresets.register === 'function' && !hasDocumentReader(agentPresets)) {
    return { contract: LEGACY_CONTRACT, build: buildLegacyChildren }
  }
  return { contract: PRIMARY_CONTRACT, build: buildPrimaryChildren }
}

/**
 * Plugin names of a row list, nested groups included.
 * @param {ReadonlyArray<{ name?: unknown, group?: unknown, config?: unknown }>} rows
 * @returns {Set<string>}
 */
export function rowNames(rows) {
  /** @type {Set<string>} */
  const out = new Set()
  for (const row of rows) {
    if (typeof row?.name === 'string') out.add(row.name)
    if (row?.group === true && Array.isArray(row.config)) for (const name of rowNames(row.config)) out.add(name)
  }
  return out
}

/**
 * Plugin names declared in a `readDocument` entry-list YAML.
 * @param {string} content
 * @returns {Set<string>}
 */
export function documentNames(content) {
  /** @type {Set<string>} */
  const out = new Set()
  for (const match of String(content || '').matchAll(/^\s*(?:-\s+)?name:\s*['"]?([^'"\s#]+)['"]?\s*$/gm)) {
    out.add(match[1])
  }
  return out
}

/**
 * Compare the snapshot rows with the host's live standard declaration.
 * Never throws; an older host or an unreadable document is "unchecked".
 *
 * @param {any} agentPresets
 * @param {ReadonlyArray<{ name?: unknown, group?: unknown, config?: unknown }>} rows
 * @returns {Promise<{ checked: boolean, missing: string[], extra: string[] }>}
 */
export async function standardDrift(agentPresets, rows) {
  if (!hasDocumentReader(agentPresets)) return { checked: false, missing: [], extra: [] }
  try {
    const doc = await agentPresets.readDocument('standard')
    const live = documentNames(doc && doc.content)
    if (live.size === 0) return { checked: false, missing: [], extra: [] }
    const ours = rowNames(rows)
    return {
      checked: true,
      missing: [...live].filter((name) => !ours.has(name)).sort(),
      extra: [...ours].filter((name) => !live.has(name)).sort(),
    }
  } catch {
    return { checked: false, missing: [], extra: [] }
  }
}

/**
 * @param {{ missing: string[], extra: string[] }} drift
 * @returns {string}
 */
export function describeStandardDrift(drift) {
  const parts = []
  if (drift.missing.length) parts.push(`缺少 standard 中的 ${drift.missing.join(', ')}`)
  if (drift.extra.length) parts.push(`多出 standard 已移除的 ${drift.extra.join(', ')}`)
  return parts.length ? `Corn模式 工具集与当前 standard 预设不一致：${parts.join('；')}。请升级插件。` : ''
}
