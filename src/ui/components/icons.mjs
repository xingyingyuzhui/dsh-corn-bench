// @ts-check
/**
 * Line icons in the DSH style (24px grid, 1.75 stroke, currentColor), so
 * buttons stop mixing text glyphs (▶ ↻ ＋ ⛶ ⚠️) with DSH's outline icons.
 */

/** @type {Record<string, string[]>} */
const PATHS = {
  play: ['M7 4.5v15l12-7.5z'],
  pause: ['M8 5v14', 'M16 5v14'],
  stop: ['M6 6h12v12H6z'],
  stepOver: ['M4 15a8 8 0 0 1 15-3.5', 'M19 6v6h-6', 'M12 20h.01'],
  stepInto: ['M12 4v10', 'M7 9l5 5 5-5', 'M12 20h.01'],
  stepOut: ['M12 14V4', 'M7 9l5-5 5 5', 'M12 20h.01'],
  refresh: ['M21 12a9 9 0 1 1-2.64-6.36L21 8', 'M21 3v5h-5'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  close: ['M18 6 6 18', 'M6 6l12 12'],
  warning: ['M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z', 'M12 9v4', 'M12 17h.01'],
  fit: ['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M16 21h3a2 2 0 0 0 2-2v-3'],
  chevronRight: ['m9 18 6-6-6-6'],
  chevronDown: ['m6 9 6 6 6-6'],
}

/**
 * @param {Function} el React.createElement
 * @param {keyof typeof PATHS} name
 * @param {number} [size]
 */
export function icon(el, name, size = 14) {
  const filled = name === 'play' || name === 'stop'
  return el(
    'svg',
    {
      className: `dvb-icon dvb-icon-${name}`,
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: filled ? 'currentColor' : 'none',
      stroke: 'currentColor',
      strokeWidth: 1.75,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': 'true',
      focusable: 'false',
    },
    ...PATHS[name].map((d) => el('path', { key: d, d })),
  )
}

/**
 * Icon followed by its text, laid out as one inline unit.
 * @param {Function} el
 * @param {keyof typeof PATHS} name
 * @param {unknown} text
 */
export function iconLabel(el, name, text) {
  return el('span', { className: 'dvb-icon-label' }, icon(el, name), text)
}
