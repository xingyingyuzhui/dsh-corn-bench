import { fileKind, filePassesFilter, fileTreeId, findProjectFile } from './project-tree-model.mjs'


const DEFAULT_MAX_NODES = 200
const DEFAULT_MAX_EDGES = 120

function basenameOf(path) {
  const parts = String(path || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
  return parts.length ? parts[parts.length - 1] : ''
}

/**
 * @param {unknown[]} groups
 * @param {unknown[]} includeEdges
 * @param {{ maxNodes?: number, maxEdges?: number, filter?: string, search?: string, backendTruncated?: boolean }} [opts]
 */
export function buildProjectGraph(groups, includeEdges, opts = {}) {
  const maxNodes = Number(opts.maxNodes) > 0 ? Number(opts.maxNodes) : DEFAULT_MAX_NODES
  const maxEdges = Number(opts.maxEdges) > 0 ? Number(opts.maxEdges) : DEFAULT_MAX_EDGES
  const filter = opts.filter || 'all'
  const needle = String(opts.search || '')
    .trim()
    .toLowerCase()
  const backendTruncated = !!opts.backendTruncated

  const nodes = []
  const clusters = []
  let nodesCapped = false

  for (const group of Array.isArray(groups) ? groups : []) {
    const clusterId = `cluster:${String(group.name || '')}`
    const nodeIds = []
    const rawFiles = Array.isArray(group.files) ? group.files : []

    for (const file of rawFiles) {
      if (nodes.length >= maxNodes) {
        nodesCapped = true
        break
      }
      if (!filePassesFilter(file, filter)) continue
      const id = fileTreeId(file)
      const label = String(file.name || basenameOf(id))
      const hay = `${label} ${id}`.toLowerCase()
      if (needle) {
        const fnHit = (file.functions || []).some((fn) =>
          String(fn?.name || '')
            .toLowerCase()
            .includes(needle),
        )
        if (!hay.includes(needle) && !fnHit) continue
      }

      const node = {
        id,
        label,
        rel: id,
        groupId: clusterId,
        groupName: String(group.name || ''),
        kind: fileKind(file),
      }
      nodes.push(node)
      nodeIds.push(id)
    }

    if (nodeIds.length) {
      clusters.push({ id: clusterId, label: String(group.name || ''), nodeIds })
    }
    if (nodesCapped) break
  }

  const nodeSet = new Set(nodes.map((n) => n.id))
  const edges = []
  let edgesCapped = false
  let unresolvedEdgeCount = 0
  let filteredEdgeCount = 0
  let cappedEdgeCount = 0
  const inputEdges = Array.isArray(includeEdges) ? includeEdges : []
  const inputEdgeCount = inputEdges.length

  for (const raw of inputEdges) {
    if (edges.length >= maxEdges) {
      edgesCapped = true
      cappedEdgeCount += 1
      continue
    }
    const fromHit = findProjectFile(groups, raw?.from)
    const toHit = findProjectFile(groups, raw?.to || raw?.name)
    const from = fromHit ? fileTreeId(fromHit.file) : ''
    const to = toHit ? fileTreeId(toHit.file) : ''
    if (!from || !to) {
      unresolvedEdgeCount += 1
      continue
    }
    if (!nodeSet.has(from) || !nodeSet.has(to)) {
      filteredEdgeCount += 1
      continue
    }
    edges.push({
      id: `e:${from}:${to}:${edges.length}`,
      from,
      to,
      resolved: raw?.resolved !== false,
    })
  }

  const renderedEdgeCount = edges.length
  const orphanEdges = unresolvedEdgeCount + filteredEdgeCount

  return {
    nodes,
    edges,
    clusters,
    maxEdges,
    maxNodes,
    capped: nodesCapped || edgesCapped,
    edgesCapped,
    nodesCapped,
    orphanEdges,
    truncation: {
      inputEdgeCount,
      renderedEdgeCount,
      unresolvedEdgeCount,
      filteredEdgeCount,
      cappedEdgeCount,
      backendTruncated,
    },
  }
}

/** @param {string} selectedId @param {{ edges: { id: string, from: string, to: string }[], kind?: string }} graph */
export function graphNeighborhood(selectedId, graph) {
  const id = String(selectedId || '')
  if (!id || !graph?.edges?.length) return { edgeIds: new Set(), nodeIds: new Set() }
  const edgeIds = new Set()
  const nodeIds = new Set([id])
  for (const edge of graph.edges) {
    if (edge.from === id || edge.to === id) {
      edgeIds.add(edge.id)
      nodeIds.add(edge.from)
      nodeIds.add(edge.to)
    }
  }
  if (graph.kind === 'call') {
    let changed = true
    while (changed) {
      changed = false
      for (const edge of graph.edges) {
        if (nodeIds.has(edge.to) && !edgeIds.has(edge.id)) {
          edgeIds.add(edge.id)
          nodeIds.add(edge.from)
          changed = true
        }
      }
    }
  }
  return { edgeIds, nodeIds }
}

/**
 * Function graph of the mapped project. Nodes are the real functions found in
 * `groups`; edges come from `calls` ({ from, to } function names) when the
 * backend supplies them. Without call data the graph lists functions only and
 * says so; it never substitutes a demo graph.
 * @param {any[]} [groups]
 * @param {{ search?: string, depth?: string }} [opts]
 * @param {Array<{ from: string, to: string }>} [calls]
 */
export function buildFunctionCallGraph(groups = [], opts = {}, calls = []) {
  const depthStr = opts.depth || '2'
  const needle = String(opts.search || '').trim().toLowerCase()
  const maxNodes = 100
  /** @type {Map<string, any>} */
  const byName = new Map()
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const file of Array.isArray(group?.files) ? group.files : []) {
      const rel = String(file?.rel || file?.name || '')
      for (const fn of Array.isArray(file?.functions) ? file.functions : []) {
        const name = String(fn?.name || '')
        if (!name || byName.has(name)) continue
        const line = Number(fn.line) || 0
        byName.set(name, {
          id: `fn:${name}`,
          name,
          label: name,
          file: rel,
          line,
          location: line ? `${rel}:${line}` : rel,
          kind: 'function',
          callers: [],
          callees: [],
        })
      }
    }
  }
  const ref = (/** @type {any} */ n) => ({ id: n.id, name: n.name, location: n.location, expanded: true })
  /** @type {Array<[string, string]>} */
  const pairs = []
  for (const call of Array.isArray(calls) ? calls : []) {
    const from = byName.get(String(call?.from || ''))
    const to = byName.get(String(call?.to || ''))
    if (!from || !to || from === to) continue
    if (pairs.some(([a, b]) => a === from.id && b === to.id)) continue
    pairs.push([from.id, to.id])
    from.callees.push(ref(to))
    to.callers.push(ref(from))
  }
  const hasCalls = pairs.length > 0
  const root = byName.get('main')
  let nodes = [...byName.values()]
  if (hasCalls && root && depthStr !== 'all') {
    const maxDepth = depthStr === '1' ? 1 : depthStr === '2' ? 2 : 3
    /** @type {Map<string, number>} */
    const depth = new Map([[root.id, 0]])
    const queue = [root]
    while (queue.length) {
      const node = queue.shift()
      const d = /** @type {number} */ (depth.get(node.id))
      if (d >= maxDepth) continue
      for (const callee of node.callees) {
        if (depth.has(callee.id)) continue
        depth.set(callee.id, d + 1)
        queue.push(byName.get(callee.name))
      }
    }
    nodes = nodes.filter((n) => depth.has(n.id))
  }
  if (needle) {
    nodes = nodes.filter(
      (n) => n.label.toLowerCase().includes(needle) || String(n.location).toLowerCase().includes(needle),
    )
  }
  const nodesCapped = nodes.length > maxNodes
  nodes = nodes.slice(0, maxNodes)
  const nodeSet = new Set(nodes.map((n) => n.id))
  const edges = pairs
    .filter(([from, to]) => nodeSet.has(from) && nodeSet.has(to))
    .map(([from, to], index) => ({ id: `e:${from}:${to}:${index}`, from, to, resolved: true }))
  const scopeNote = !byName.size
    ? '当前工程未识别到函数'
    : !hasCalls
      ? `已识别 ${byName.size} 个函数；暂无调用关系数据`
      : root && depthStr !== 'all'
        ? `当前范围: main 的 ${depthStr} 层调用`
        : '当前范围: 全部调用'
  return {
    kind: 'call',
    focus: root ? 'main' : nodes[0]?.name || '',
    nodes,
    edges,
    clusters: [],
    maxEdges: 100,
    maxNodes,
    capped: nodesCapped,
    edgesCapped: false,
    nodesCapped,
    orphanEdges: 0,
    scopeNote,
  }
}
