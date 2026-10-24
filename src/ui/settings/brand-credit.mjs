// @ts-check
// Corn branding for the Settings → Corn section: icon, author and license.

export const BRAND_NAME = 'Corn'
export const BRAND_AUTHOR = 'xingyingyuzhui'
export const BRAND_REPO_URL = 'https://github.com/xingyingyuzhui/dsh-corn-bench'
export const BRAND_LICENSE_URL = BRAND_REPO_URL + '/blob/main/LICENSE.md'

/** 40×40 WebP of assets/corn-icon.png, drawn at 20px; inline so the bundle needs no asset route. */
export const BRAND_ICON_URI =
  'data:image/webp;base64,UklGRmwFAABXRUJQVlA4WAoAAAAQAAAAJwAAJwAAQUxQSCECAAABx8EQkiRJm/MuwwEcyvlTHUNE5EHihjtfBjdae5PsTTxEyaD9JRC0bRslbbXzx3wQEf3PAE3g7eu23hbQjm1bteOMeZ+ouc2Uf2bMbPlJpbs/7nlyChExATRe3725e5mMyxnMv+c///vbtpPrV59+9m6eXG5cnLZ3n3768hqbq7u3+/kxaOTYrMzjeX/76poec7+FTNZZodP2nx5PT3+r5NggxwzjWP56fPX3zS6MYEoYaIbMzV//3l7tmMkQaWIss9xP37+5fZoDTSjjuR1mv/n+xY1RDKMMNBeWddpfbhWiYTyzWYTmdGLUmGH878lxhJnBmMxi0OSZMZYTtDIxGq1IIQzRWI5lFG2Q9TBGi+kStCgaz56mWQzMBQWtpkiVKBUpx1xc5JiEKY2OLhYytECosVlHpYoissyzQ5bJsUWrRge1XSpTLJTIhcuRhDoYjA5DBqksJ1VynMVzB5I2RgzGwMzQYdCCoiyzcLEOo1odJ63WEwdJ5diYYQ6ZQy7WiDrIFDOEGlowIzOHx1Nqy5YtqQ4TVYwy93ezhYmYloqqmRFX9/cfnM0RplClyuxTw/l9f351DlVbaZDC7MPE1cOX28MXT9ktN8oQDDJmtqfPur95fz51sodJQmZUiPP7G6desSNKRxtBYniVfa53L2cvkUwxZKbZ95f2m93YH/79ye021sU4VtvNnV/+PY9jHn78+rFTRxmt9fDb198/CgBWUDggJAMAANARAJ0BKigAKAA+USKMRKOiIRVdVgA4BQS2AFxwvGnvBv6rxPG3hmp1ecgHaA8R7cAfrx6QHqY9ADpEfQA/W7rS/279Fn//vDJAgPNA9wH0V/1vcA/VD/Udfj0M/1gZ90yOblb2n1/p++OWMqgQCz7COE7O6DrGpt0K94kmegcQLb6CicMfrhTee5YyBFRAjb6vb4FhUAAA/v+hA2HBsh0SQC5nDJQ8O/8iiNjvmV/Jq7f30V+gaVHPGt6FjyFfU38oe+fhesz4UpoRRFT/VMfUX0fONkferoZwf2I3lR3v4nW//fskLNovr4mnluffUdnwaBdtyZgQQH6wkvMPSb0+dn4K7biXWV7Gvpr/t20baKJ5IdRFKcl1ptDvaKx4/mXSG1yv+xURhT64Fff1ZFJrvs2NTd7qpe1Mg1URHOU38AvsN+5S5u9joLn/7//0WNj4Lpc7fGteJHYgUpyUOle+IFcE9/Zrn9n48rCe7lLhqTv/n4d+4HculSxBtIQlSkb7Umf8aa5OBi6cpq2B769LPVQaaGp570ctffvScpkrCOW/33BYLx/SfXPNX6M21EC4P1BWkQhvI41fr/wLxreTcXNP4q3oI3//RD/8/higlk+ku7z80CyIV5LIcqjjf/na3L5FaoY1DVRPORzfwbXjHEeqX+2sDWrsF341gHnT84v/Q6tnxa+qXhkdmHSt0PJTyiPODs6X6y2HYHDOiGaNsoM+rQ/OQCXIy+/nbetnpFlHq79kVQxVEEGyomQbK0TAL/gV3dg5aPM8oy6HB6JuKRz01apyZhMCBTYwvL7Qf+JjQ4h/47fnDSGZMNLZ/VQ19kfiE6D3ha7xlpq0PhfmHphV431/rkpcep2gaENNv4efUBwzVtOUueFVv2Orgr1ZVy5zPnH+vW0dN3HsaH7uKABY+7jmWrX/V6/4H58LMRZ+gfskLq3Y6vuNDIeRFyT5Buid6c/xDNvfMOR6duF6DD/9DzzFsLbL79uePSvPe5AueMai51nn+HbOLb6HqsTSH9MwYt8+t+1i7nQus4q3/xMexDU/o303/AirhmW3+GFAAA=='

/**
 * Pure header row: icon, "Corn · by xingyingyuzhui" and the license link.
 *
 * @param {(type: any, props?: any, ...children: any[]) => any} el
 * @param {(key: string) => string} t
 */
export function renderBrandCredit(el, t) {
  /** @param {string} href @param {string} text */
  const link = (href, text) =>
    el('a', { href, target: '_blank', rel: 'noopener noreferrer', className: 'dvb-brand-link' }, text)
  return el(
    'div',
    { className: 'dvb-brand-credit' },
    el('img', { className: 'dvb-brand-icon', src: BRAND_ICON_URI, alt: '', width: 20, height: 20 }),
    el('span', { className: 'dvb-brand-name' }, BRAND_NAME),
    el('span', { className: 'dvb-brand-sep' }, ' · by '),
    link(BRAND_REPO_URL, BRAND_AUTHOR),
    el('span', { className: 'dvb-brand-sep' }, ' · '),
    link(BRAND_LICENSE_URL, t('brandLicense')),
  )
}
