import { NS } from '../i18n/copy.mjs'

export function registerView(ctx, React, t, DebugPage, HmiPage, MonitorPage) {
  const slots = ctx.slots
  if (slots == null || React == null) return function () {}
  const stopDebug = slots.inject('conversation.view', function () {
    return slots.register(
      {
        name: 'conversation.view',
        id: 'corn-bench-debug',
        order: 20,
        locale: NS,
        label() {
          return t('tabDebug')
        },
      },
      DebugPage,
    )
  })
  const stopHmi = slots.inject('conversation.view', function () {
    return slots.register(
      {
        name: 'conversation.view',
        id: 'corn-bench-hmi',
        order: 21,
        locale: NS,
        label() {
          return t('tabHmi')
        },
      },
      HmiPage,
    )
  })
  const stopMonitor =
    MonitorPage &&
    slots.inject('conversation.view', function () {
      return slots.register(
        {
          name: 'conversation.view',
          id: 'corn-bench-monitor',
          order: 22,
          locale: NS,
          label() {
            return t('tabMonitor')
          },
        },
        MonitorPage,
      )
    })
  return function () {
    if (typeof stopDebug === 'function') stopDebug()
    if (typeof stopHmi === 'function') stopHmi()
    if (typeof stopMonitor === 'function') stopMonitor()
  }
}
