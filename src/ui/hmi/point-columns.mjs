// @ts-check
/**
 * Point table column sets. Viewing a device shows the columns people watch;
 * scale/offset and alarm thresholds only matter while editing, so they fold
 * into a range summary beside the alarm switch until then.
 */

/** Columns shown only while editing or adding points. */
export const EDIT_ONLY_COLS = ['scale', 'offset', 'min', 'max', 'deadband']

/** Extra width the alarm column needs for its range summary in view mode. */
export const ALARM_SUMMARY_EXTRA = 64

const EDIT_ONLY_CLASSES = new Set(EDIT_ONLY_COLS.map((k) => `dvb-col-${k}`))

/** @param {boolean} showOps */
export function visiblePointCols(showOps) {
  const all = ['name', 'monitor', 'fn', 'addr', 'value', 'unit', 'scale', 'offset', 'alarm', 'min', 'max', 'deadband']
  return showOps ? all : all.filter((k) => !EDIT_ONLY_COLS.includes(k))
}

/**
 * `el` for a point row that drops edit-only cells in view mode.
 * @param {Function} el
 * @param {boolean} showOps
 */
export function pointRowElement(el, showOps) {
  if (showOps) return el
  return (/** @type {any} */ type, /** @type {any} */ props, /** @type {any[]} */ ...kids) =>
    el(type, props, ...kids.filter((k) => !(k && k.props && EDIT_ONLY_CLASSES.has(k.props.className))))
}

/**
 * Alarm thresholds as one short line, e.g. "<10 · >50" (alarm below min or above max); empty when none set.
 * @param {{ alarmMin?: unknown, alarmMax?: unknown }} point
 */
export function alarmRangeText(point) {
  const parts = []
  if (point.alarmMin != null && point.alarmMin !== '') parts.push(`<${point.alarmMin}`)
  if (point.alarmMax != null && point.alarmMax !== '') parts.push(`>${point.alarmMax}`)
  return parts.join(' · ')
}
