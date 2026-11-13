export function validate(raw) {
  if (
    !raw ||
    !Array.isArray(raw.vertices) ||
    raw.vertices.length < 1 ||
    raw.vertices.length > 24 ||
    raw.vertices.some(
      (x) => typeof x !== "string" || !/^[A-Za-z][A-Za-z0-9_-]{0,19}$/.test(x),
    ) ||
    new Set(raw.vertices).size !== raw.vertices.length
  )
    throw Error("Use 1–24 unique ASCII vertex names (20 characters maximum).");
  if (!Array.isArray(raw.edges) || raw.edges.length > 276)
    throw Error("Use at most 276 edges.");
  const seen = new Set(),
    edges = raw.edges.map((edge) => {
      if (
        !Array.isArray(edge) ||
        edge.length !== 2 ||
        edge.some((x) => !raw.vertices.includes(x)) ||
        edge[0] === edge[1]
      )
        throw Error("Edges must join two distinct known vertices.");
      const indices = edge
          .map((x) => raw.vertices.indexOf(x))
          .sort((a, b) => a - b),
        key = indices.join(":");
      if (seen.has(key)) throw Error("Duplicate undirected edge.");
      seen.add(key);
      return indices.map((i) => raw.vertices[i]);
    });
  for (const [key, min, max] of [
    ["palette", 1, 24],
    ["budget", 1, 200000],
  ])
    if (!Number.isInteger(raw[key]) || raw[key] < min || raw[key] > max)
      throw Error(`${key} must be an integer from ${min} through ${max}.`);
  return {
    vertices: [...raw.vertices],
    edges,
    palette: raw.palette,
    budget: raw.budget,
  };
}
function graph(input) {
  const adj = input.vertices.map(() => new Set());
  for (const [u, v] of input.edges) {
    const a = input.vertices.indexOf(u),
      b = input.vertices.indexOf(v);
    adj[a].add(b);
    adj[b].add(a);
  }
  return adj;
}
function select(adj, colors) {
  let best = -1,
    saturation = -1,
    degree = -1;
  for (let v = 0; v < adj.length; v++)
    if (colors[v] < 0) {
      const s = new Set([...adj[v]].map((u) => colors[u]).filter((c) => c >= 0))
        .size;
      if (s > saturation || (s === saturation && adj[v].size > degree)) {
        best = v;
        saturation = s;
        degree = adj[v].size;
      }
    }
  return best;
}
export function verifyColoring(input, colors) {
  if (
    !Array.isArray(colors) ||
    colors.length !== input.vertices.length ||
    colors.some(
      (c) => !Number.isInteger(c) || c < 0 || c >= input.vertices.length,
    )
  )
    return false;
  return input.edges.every(
    ([u, v]) =>
      colors[input.vertices.indexOf(u)] !== colors[input.vertices.indexOf(v)],
  );
}
function greedy(adj) {
  const colors = Array(adj.length).fill(-1),
    order = [];
  for (let step = 0; step < adj.length; step++) {
    const v = select(adj, colors),
      used = new Set([...adj[v]].map((u) => colors[u]));
    let color = 0;
    while (used.has(color)) color++;
    colors[v] = color;
    order.push({
      vertex: v,
      color,
      saturation: new Set(
        [...adj[v]].map((u) => colors[u]).filter((c) => c >= 0),
      ).size,
    });
  }
  return { colors, order, count: Math.max(...colors) + 1 };
}
function cliqueWitness(adj) {
  const order = adj
    .map((_, i) => i)
    .sort((a, b) => adj[b].size - adj[a].size || a - b);
  let best = [];
  for (const start of order) {
    const clique = [start];
    for (const v of order)
      if (v !== start && clique.every((u) => adj[v].has(u))) clique.push(v);
    if (clique.length > best.length) best = clique;
  }
  return best;
}
function search(adj, k, clique, budget) {
  const colors = Array(adj.length).fill(-1),
    trace = [];
  clique.forEach((v, i) => (colors[v] = i));
  let visits = 0,
    solution = null,
    traceCount = 0;
  const record = (event) => {
    traceCount++;
    if (trace.length < 200) trace.push(event);
  };
  function dfs(depth) {
    if (visits >= budget) return "limit";
    visits++;
    const v = select(adj, colors);
    if (v === -1) {
      solution = [...colors];
      return "feasible";
    }
    const used = new Set([...adj[v]].map((u) => colors[u]));
    const maximum = Math.min(k - 1, Math.max(...colors) + 1);
    let tried = false;
    for (let color = 0; color <= maximum; color++)
      if (!used.has(color)) {
        tried = true;
        colors[v] = color;
        record({ action: "assign", depth, vertex: v, color });
        const status = dfs(depth + 1);
        if (status !== "impossible") return status;
        colors[v] = -1;
        record({ action: "backtrack", depth, vertex: v, color });
      }
    if (!tried) record({ action: "dead-end", depth, vertex: v, color: null });
    return "impossible";
  }
  const status = dfs(clique.length);
  return {
    status,
    visits,
    colors: solution,
    trace,
    traceTruncated: traceCount > trace.length,
  };
}
export function analyze(raw) {
  const input = validate(raw),
    adj = graph(input),
    heuristic = greedy(adj),
    clique = cliqueWitness(adj),
    trials = [];
  let lower = clique.length,
    upper = heuristic.count,
    colors = heuristic.colors,
    used = 0;
  while (lower < upper) {
    const attempt = search(adj, lower, clique, input.budget - used);
    used += attempt.visits;
    trials.push({ palette: lower, ...attempt });
    if (attempt.status === "feasible") {
      upper = lower;
      colors = attempt.colors;
      break;
    }
    if (attempt.status === "limit") break;
    lower++;
  }
  if (!verifyColoring(input, colors))
    throw Error("Internal coloring verification failed.");
  const cliqueValid = clique.every((v, i) =>
    clique.slice(i + 1).every((u) => adj[v].has(u)),
  );
  if (!cliqueValid) throw Error("Internal clique verification failed.");
  const paletteStatus =
    input.palette >= upper
      ? "feasible"
      : input.palette < lower
        ? "impossible"
        : "unresolved";
  return {
    format: "palette-proof-evidence-v1",
    input,
    lowerBound: lower,
    upperBound: upper,
    optimal: lower === upper,
    paletteStatus,
    searchVisits: used,
    budgetExhausted: trials.some((t) => t.status === "limit"),
    colors,
    assignment: input.vertices.map((vertex, i) => ({
      vertex,
      color: colors[i] + 1,
      neighbors: [...adj[i]].map((j) => input.vertices[j]),
    })),
    clique: clique.map((i) => input.vertices[i]),
    heuristic: {
      ...heuristic,
      order: heuristic.order.map((x) => ({
        ...x,
        vertex: input.vertices[x.vertex],
        color: x.color + 1,
      })),
    },
    trials: trials.map((t) => ({
      ...t,
      trace: t.trace.map((x) => ({
        ...x,
        vertex: input.vertices[x.vertex],
        color: x.color === null ? null : x.color + 1,
      })),
    })),
    verified: true,
  };
}
const vertices = [
  "a",
  "b",
  "c",
  "d",
  "e",
  "u_a",
  "u_b",
  "u_c",
  "u_d",
  "u_e",
  "w",
];
const edges = [];
for (let i = 0; i < 5; i++) {
  const j = (i + 1) % 5;
  edges.push(
    [vertices[i], vertices[j]],
    [vertices[5 + i], vertices[j]],
    [vertices[5 + j], vertices[i]],
    [vertices[5 + i], "w"],
  );
}
export const example = { vertices, edges, palette: 3, budget: 50000 };
export const cycle = {
  vertices: ["A", "B", "C", "D", "E"],
  edges: [
    ["A", "B"],
    ["B", "C"],
    ["C", "D"],
    ["D", "E"],
    ["E", "A"],
  ],
  palette: 2,
  budget: 50000,
};
