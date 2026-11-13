import test from "node:test";
import assert from "node:assert/strict";
import { analyze, validate, verifyColoring, example, cycle } from "../core.js";
test("exact search improves a suboptimal greedy coloring", () => {
  const vertices = Array.from({ length: 10 }, (_, i) => `V${i}`);
  const pairs = [
    [0, 1],
    [0, 2],
    [0, 3],
    [0, 4],
    [0, 7],
    [1, 4],
    [1, 5],
    [1, 6],
    [1, 7],
    [1, 8],
    [1, 9],
    [2, 6],
    [3, 5],
    [4, 7],
    [4, 8],
    [4, 9],
    [5, 7],
    [5, 8],
    [5, 9],
    [8, 9],
  ];
  const input = {
    vertices,
    edges: pairs.map((e) => e.map((i) => vertices[i])),
    palette: 4,
    budget: 10000,
  };
  const result = analyze(input);
  assert.equal(result.heuristic.count, 5);
  assert.equal(result.upperBound, 4);
  assert.equal(result.lowerBound, 4);
  assert.equal(result.trials[0].status, "feasible");
  assert.ok(verifyColoring(input, result.colors));
  assert.equal(oracle(input), 4);
});
function oracle(input) {
  const n = input.vertices.length,
    edges = input.edges.map((e) => e.map((v) => input.vertices.indexOf(v)));
  for (let k = 1; k <= n; k++) {
    const c = Array(n).fill(-1);
    function visit(v) {
      if (v === n) return true;
      for (let x = 0; x < k; x++) {
        if (
          edges.some(
            ([a, b]) => (a === v && c[b] === x) || (b === v && c[a] === x),
          )
        )
          continue;
        c[v] = x;
        if (visit(v + 1)) return true;
        c[v] = -1;
      }
      return false;
    }
    if (visit(0)) return k;
  }
}
test("odd cycle proves three colors despite a two-vertex clique bound", () => {
  const r = analyze(cycle);
  assert.equal(r.clique.length, 2);
  assert.equal(r.lowerBound, 3);
  assert.equal(r.upperBound, 3);
  assert.equal(r.paletteStatus, "impossible");
  assert.equal(r.trials[0].status, "impossible");
});
test("triangle-free Mycielski example requires four colors", () => {
  const r = analyze(example);
  assert.equal(r.clique.length, 2);
  assert.equal(r.lowerBound, 4);
  assert.equal(r.upperBound, 4);
  assert.deepEqual(
    r.trials.map((t) => [t.palette, t.status]),
    [
      [2, "impossible"],
      [3, "impossible"],
    ],
  );
});
test("200 random graphs match independent fixed-order exhaustive color enumeration", () => {
  let seed = 41;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let trial = 0; trial < 200; trial++) {
    const n = 2 + (trial % 7),
      vertices = Array.from({ length: n }, (_, i) => `V${i}`),
      edges = [];
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (rand() < 0.15 + 0.1 * (trial % 7))
          edges.push([vertices[i], vertices[j]]);
    const input = { vertices, edges, palette: 1 + (trial % n), budget: 200000 },
      expected = oracle(input),
      r = analyze(input);
    assert.equal(r.optimal, true);
    assert.equal(r.lowerBound, expected);
    assert.equal(r.upperBound, expected);
    assert.equal(
      r.paletteStatus,
      input.palette >= expected ? "feasible" : "impossible",
    );
    assert.ok(verifyColoring(input, r.colors));
  }
});
test("budget exhaustion preserves valid bounds and never claims infeasibility for an unresolved palette", () => {
  const r = analyze({ ...cycle, budget: 1 });
  assert.equal(r.optimal, false);
  assert.equal(r.lowerBound, 2);
  assert.equal(r.upperBound, 3);
  assert.equal(r.paletteStatus, "unresolved");
  assert.equal(r.searchVisits, 1);
  assert.equal(r.budgetExhausted, true);
  assert.ok(verifyColoring(r.input, r.colors));
  assert.equal(
    analyze({ ...cycle, budget: 1, palette: 3 }).paletteStatus,
    "feasible",
  );
  assert.equal(
    analyze({ ...cycle, budget: 1, palette: 1 }).paletteStatus,
    "impossible",
  );
});
test("complete and edgeless graphs meet matching bounds without search", () => {
  for (const n of [1, 2, 8, 24]) {
    const vertices = Array.from({ length: n }, (_, i) => `V${i}`),
      edges = [];
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) edges.push([vertices[i], vertices[j]]);
    const full = analyze({ vertices, edges, palette: n, budget: 1 });
    assert.equal(full.lowerBound, n);
    assert.equal(full.searchVisits, 0);
    const empty = analyze({ vertices, edges: [], palette: 1, budget: 1 });
    assert.equal(empty.upperBound, 1);
    assert.equal(empty.searchVisits, 0);
  }
});
test("disconnected components can reuse colors", () => {
  const r = analyze({
    vertices: ["A", "B", "C", "D", "E", "F"],
    edges: [
      ["A", "B"],
      ["B", "C"],
      ["A", "C"],
      ["D", "E"],
    ],
    palette: 3,
    budget: 100,
  });
  assert.equal(r.upperBound, 3);
  assert.equal(r.paletteStatus, "feasible");
});
test("all budget-limited results bracket the independently known chromatic number", () => {
  const expected = oracle(example);
  for (const budget of [1, 2, 5, 10, 20, 50, 100]) {
    const r = analyze({ ...example, budget });
    assert.ok(r.lowerBound <= expected && expected <= r.upperBound);
    assert.ok(r.searchVisits <= budget);
    assert.ok(verifyColoring(r.input, r.colors));
  }
});
test("clique witnesses are pairwise adjacent and traces are bounded", () => {
  const r = analyze(example);
  for (let i = 0; i < r.clique.length; i++)
    for (let j = i + 1; j < r.clique.length; j++)
      assert.ok(
        r.input.edges.some(
          (e) => e.includes(r.clique[i]) && e.includes(r.clique[j]),
        ),
      );
  assert.ok(r.trials.every((t) => t.trace.length <= 200));
});
test("edge orientation has no semantic effect and input is not mutated", () => {
  const original = structuredClone(example),
    a = analyze(example),
    b = analyze({
      ...example,
      edges: example.edges.map((e) => [...e].reverse()),
    });
  assert.deepEqual(a, b);
  assert.deepEqual(example, original);
  assert.deepEqual(a, analyze(example));
});
test("strict validation rejects loops, duplicate edges, unknown vertices and invalid limits", () => {
  for (const change of [
    { vertices: ["A", "A"] },
    { edges: [["a", "a"]] },
    {
      edges: [
        ["a", "b"],
        ["b", "a"],
      ],
    },
    { edges: [["a", "unknown"]] },
    { palette: 0 },
    { budget: 0 },
    { budget: 1.5 },
  ])
    assert.throws(() => validate({ ...example, ...change }));
  assert.equal(verifyColoring(cycle, [0, 0, 0, 0, 0]), false);
  assert.equal(verifyColoring(cycle, [0]), false);
});
