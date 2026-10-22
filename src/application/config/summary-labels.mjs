// @ts-check
/**
 * Human labels for journal summaries. The Operation log showed raw ids
 * ("添加可视化 viz_mvivdpmr0n4fvl", "添加点位 pmviv453sqmix,pmviv45ubutbt");
 * a name comes first and the id stays for traceability.
 */

/**
 * @param {{ id?: unknown, name?: unknown } | null | undefined} item
 * @param {unknown} [fallbackId]
 * @returns {string}
 */
export function labelOf(item, fallbackId = '') {
  const id = String((item && item.id) || fallbackId || '')
  const name = String((item && item.name) || '').trim()
  return name && name !== id ? `${name}（${id}）` : id
}

/**
 * @param {Array<{ id?: unknown, name?: unknown }>} items
 * @param {number} [max]
 * @returns {string}
 */
export function labelList(items, max = 3) {
  const labels = items.map((item) => labelOf(item))
  return labels.length > max ? `${labels.slice(0, max).join('、')} 等 ${labels.length} 项` : labels.join('、')
}

/**
 * @param {Array<{ id?: unknown }>} pool
 * @param {unknown[]} ids
 */
export function pickById(pool, ids) {
  return ids.map((id) => pool.find((item) => item && item.id === id) || { id })
}
