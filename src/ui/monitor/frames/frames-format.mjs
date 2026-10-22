export function framePayloadHex(frame) {
  const f = frame || {}
  if (f.hex) return String(f.hex).replace(/[^0-9a-f]/gi, '')
  const dir = String(f.direction || f.wireRole || 'tx').toLowerCase()
  // Transaction frames: hex fields only. Their request/response text is a
  // description (e.g. simulated "SIM RX 110"), not bytes to be scraped.
  if ('requestHex' in f || 'responseHex' in f) {
    const hex = dir === 'rx' || dir === 'in' || dir === 'recv' ? f.responseHex : f.requestHex
    return String(hex || '').replace(/[^0-9a-f]/gi, '')
  }
  if (dir === 'rx' || dir === 'in' || dir === 'recv') {
    return String(f.responseHex || f.response || f.text || f.line || '').replace(/[^0-9a-f]/gi, '')
  }
  return String(f.requestHex || f.request || f.response || f.text || f.line || '').replace(/[^0-9a-f]/gi, '')
}

export function formatHexDisplay(hex) {
  const clean = String(hex || '')
    .replace(/[^0-9a-f]/gi, '')
    .toUpperCase()
  return clean.replace(/(.{2})/g, '$1 ').trim()
}

export function hexToUtf8Preview(hex) {
  const clean = String(hex || '').replace(/[^0-9a-f]/gi, '')
  if (!clean) return ''
  const bytes = []
  for (let i = 0; i + 1 < clean.length; i += 2) bytes.push(Number.parseInt(clean.slice(i, i + 2), 16))
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes))
  } catch {
    return bytes.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join('')
  }
}

export function frameByteCount(frame) {
  const f = frame || {}
  const n = Number(f.bytes || f.byteLength)
  if (Number.isFinite(n) && n > 0) return n
  const hex = framePayloadHex(f)
  return hex ? Math.floor(hex.length / 2) : 0
}

export function frameDirection(frame) {
  const d = String(frame?.direction || 'tx').toLowerCase()
  return d === 'rx' || d === 'in' || d === 'recv' ? 'rx' : 'tx'
}

export function formatFrameClock(ts) {
  const d = new Date(ts || Date.now())
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * Port column text: the frame's real endpoint, never one derived from the
 * connection id. Ids default to c1, c2, … and used to be shown as COM1, COM2
 * even for simulated or TCP links. Simulated links read "SIM", TCP links
 * host:port, RTU links their configured serial port (COMn uppercased, POSIX
 * device paths verbatim); otherwise the frame's own port or the connection name.
 * @param {any} frame
 * @param {any[]} [connections]
 * @returns {string}
 */
export function formatPortName(frame, connections = []) {
  const f = frame || {}
  const rawPort = String(f.port || '').trim()
  const connId = String(f.connectionId || '').trim()
  const conns = Array.isArray(connections) ? connections : []
  const conn = conns.find((c) => c && (c.id === connId || c.id === rawPort))
  const cfg = (conn && conn.conn) || {}
  const serial = (/** @type {string} */ p) => (/^com\d+$/i.test(p) ? p.toUpperCase() : p)
  if (cfg.sim) return 'SIM'
  if (cfg.mode === 'tcp' && cfg.host) return `${cfg.host}:${cfg.tcpPort || 502}`
  const configured = String(cfg.port || '').trim()
  if (configured) return serial(configured)
  if (rawPort && rawPort !== connId && (!conn || rawPort !== conn.id)) return serial(rawPort)
  return String((conn && conn.name) || rawPort || connId || '—')
}
