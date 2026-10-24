import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BRAND_AUTHOR,
  BRAND_ICON_URI,
  BRAND_LICENSE_URL,
  BRAND_REPO_URL,
  renderBrandCredit,
} from '../../src/ui/settings/brand-credit.mjs'
import { COPY_EN } from '../../src/ui/i18n/copy-en.mjs'
import { COPY_ZH } from '../../src/ui/i18n/copy-zh.mjs'

const el = (type, props, ...children) => ({
  type,
  props: props || {},
  children: children.flat().filter((c) => c != null && c !== false),
})

test('brand credit shows the corn icon, author link and license link', () => {
  const node = renderBrandCredit(el, (key) => COPY_ZH[key])
  assert.equal(node.props.className, 'dvb-brand-credit')
  const icon = node.children.find((c) => c.type === 'img')
  assert.equal(icon.props.src, BRAND_ICON_URI)
  assert.equal(icon.props.alt, '')
  const links = node.children.filter((c) => c.type === 'a')
  assert.deepEqual(
    links.map((a) => [a.props.href, a.children[0]]),
    [
      [BRAND_REPO_URL, BRAND_AUTHOR],
      [BRAND_LICENSE_URL, COPY_ZH.brandLicense],
    ],
  )
  for (const a of links) assert.equal(a.props.rel, 'noopener noreferrer')
})

test('brand constants point at the author repository and the noncommercial license', () => {
  assert.equal(BRAND_AUTHOR, 'xingyingyuzhui')
  assert.equal(BRAND_REPO_URL, 'https://github.com/xingyingyuzhui/dsh-vision-bench')
  assert.match(BRAND_LICENSE_URL, /\/LICENSE\.md$/)
  assert.match(BRAND_ICON_URI, /^data:image\/webp;base64,/)
  assert.match(COPY_ZH.brandLicense, /PolyForm Noncommercial 1\.0\.0/)
  assert.match(COPY_EN.brandLicense, /PolyForm Noncommercial 1\.0\.0/)
})
