import { example, cycle, validate } from "./core.js";
const $ = (id) => document.getElementById(id),
  NS = "http://www.w3.org/2000/svg";
let result = null,
  worker = null,
  selected = null,
  history = [];
const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
function shape(tag, attrs, text) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  return n;
}
const color = (i) =>
  ["#d7a9b8", "#a8c2b8", "#dfc28f", "#b4afd3", "#a9c4d5", "#ceb59c"][i] ??
  `hsl(${(i * 137.508) % 360} 32% 74%)`;
function run(raw, remember = true) {
  let input;
  try {
    input = validate(raw);
  } catch (e) {
    $("status").textContent = e.message;
    return;
  }
  worker?.terminate();
  if (remember && result) {
    history.push(structuredClone(result.input));
    if (history.length > 30) history.shift();
  }
  $("result").hidden = true;
  $("status").textContent =
    "Constructing witnesses and searching unresolved color counts…";
  worker = new Worker("./worker.js", { type: "module" });
  worker.onmessage = ({ data }) => {
    worker.terminate();
    worker = null;
    if (data.error) {
      $("status").textContent = data.error;
      return;
    }
    result = data.result;
    $("result").hidden = false;
    $("json").value = JSON.stringify(input, null, 2);
    $("palette").value = input.palette;
    $("budget").value = input.budget;
    $("undo").disabled = !history.length;
    if (!input.vertices.includes(selected)) selected = input.vertices[0];
    $("status").textContent = result.optimal
      ? `Proved chromatic number ${result.upperBound}. The assignment satisfies every conflict edge.`
      : `Search budget reached. Chromatic number remains between ${result.lowerBound} and ${result.upperBound}; the displayed ${result.upperBound}-color assignment is verified.`;
    $("lower").textContent = result.lowerBound;
    $("upper").textContent = result.upperBound;
    $("feasibility").textContent = `${input.palette}: ${result.paletteStatus}`;
    $("visits").textContent =
      `${result.searchVisits.toLocaleString()} / ${input.budget.toLocaleString()}`;
    for (const key of ["from", "to"])
      $(key).replaceChildren(
        ...input.vertices.map((v) => {
          const o = el("option", v);
          o.value = v;
          return o;
        }),
      );
    if (input.vertices.length > 1) $("to").value = input.vertices[1];
    $("graph-note").textContent =
      `${input.vertices.length} vertices · ${input.edges.length} conflict edges. Displayed assignment uses ${result.upperBound} colors; requested palette is ${input.palette}.`;
    $("bounds-note").textContent =
      `Clique witness: ${result.clique.join(", ")} (${result.clique.length} mutually adjacent vertices). ${
        result.trials.filter((t) => t.status === "impossible").length
          ? `Completed searches ruled out ${result.trials
              .filter((t) => t.status === "impossible")
              .map((t) => t.palette)
              .join(", ")} colors.`
          : "No infeasible palette has been established by completed search."
      } ${result.optimal ? "Matching lower and upper bounds establish optimality." : "The remaining gap is unresolved."}`;
    $("groups").replaceChildren(
      ...Array.from({ length: result.upperBound }, (_, i) => {
        const box = el("div", undefined, "group");
        box.style.borderTopColor = color(i);
        box.append(
          el("strong", `Color ${i + 1}`),
          el(
            "p",
            result.assignment
              .filter((x) => x.color === i + 1)
              .map((x) => x.vertex)
              .join(", "),
          ),
        );
        return box;
      }),
    );
    $("trials").replaceChildren(
      ...result.trials.map((t) => {
        const box = el("div", undefined, "trial-card");
        box.append(
          el("strong", `${t.palette} colors`),
          el("p", `${t.status} · ${t.visits} search nodes`),
        );
        return box;
      }),
    );
    if (!result.trials.length)
      $("trials").append(
        el(
          "p",
          "Clique and greedy-coloring bounds already match. No exact search was required.",
          "hint",
        ),
      );
    $("trial").replaceChildren(
      ...result.trials.map((t, i) => {
        const o = el("option", `${t.palette} colors · ${t.status}`);
        o.value = i;
        return o;
      }),
    );
    $("trial").disabled = !result.trials.length;
    renderGraph();
    renderInspector();
    renderTrace();
  };
  worker.onerror = () => {
    $("status").textContent = "The solver worker failed. Reload and retry.";
    worker?.terminate();
    worker = null;
  };
  worker.postMessage(input);
}
function renderGraph() {
  const graph = $("graph");
  graph.replaceChildren();
  graph.append(shape("rect", { width: 620, height: 540, fill: "#f6f7fb" }));
  graph.append(
    shape("title", {}, `Verified ${result.upperBound}-color assignment`),
  );
  const n = result.input.vertices.length,
    positions = new Map(
      result.input.vertices.map((v, i) => {
        const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
        return [
          v,
          {
            x: n === 1 ? 310 : 310 + 205 * Math.cos(angle),
            y: n === 1 ? 270 : 270 + 205 * Math.sin(angle),
          },
        ];
      }),
    ),
    clique = $("clique").checked,
    neighbors = result.assignment.find((x) => x.vertex === selected).neighbors;
  for (const [a, b] of result.input.edges) {
    const p = positions.get(a),
      q = positions.get(b),
      witness =
        clique && result.clique.includes(a) && result.clique.includes(b),
      incident = a === selected || b === selected;
    graph.append(
      shape("line", {
        x1: p.x,
        y1: p.y,
        x2: q.x,
        y2: q.y,
        stroke: witness ? "#956779" : incident ? "#a997a2" : "#b8bfd2",
        "stroke-width": witness ? 3 : incident ? 1.8 : 1,
        opacity: witness || incident ? 1 : 0.85,
      }),
    );
  }
  result.assignment.forEach((entry, i) => {
    const p = positions.get(entry.vertex),
      witness = clique && result.clique.includes(entry.vertex),
      chosen = entry.vertex === selected,
      group = shape("g", {
        class: "vertex",
        role: "button",
        tabindex: 0,
        "aria-label": `${entry.vertex}, color ${entry.color}, ${entry.neighbors.length} neighbors`,
      });
    if (witness)
      group.append(
        shape("circle", {
          cx: p.x,
          cy: p.y,
          r: 29,
          fill: "none",
          stroke: "#956779",
          "stroke-width": 2,
          "stroke-dasharray": "3 3",
        }),
      );
    group.append(
      shape("circle", {
        cx: p.x,
        cy: p.y,
        r: 23,
        fill: color(entry.color - 1),
        stroke: chosen
          ? "#292f49"
          : neighbors.includes(entry.vertex)
            ? "#a997a2"
            : "#f6f7fb",
        "stroke-width": chosen ? 3 : 2,
      }),
    );
    group.append(
      shape(
        "text",
        {
          x: p.x,
          y: p.y + 4,
          "text-anchor": "middle",
          "font-family": "Arial",
          "font-size": 12,
          fill: "#292f49",
          "pointer-events": "none",
        },
        String(entry.color),
      ),
    );
    group.append(
      shape(
        "text",
        {
          x: p.x,
          y: p.y + 42,
          "text-anchor": "middle",
          "font-family": "Consolas,monospace",
          "font-size": 11,
          fill: "#292f49",
          "pointer-events": "none",
        },
        entry.vertex,
      ),
    );
    const choose = () => {
      selected = entry.vertex;
      renderGraph();
      renderInspector();
      graph.querySelectorAll(".vertex")[i]?.focus({ preventScroll: true });
    };
    group.onclick = choose;
    group.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        choose();
      }
    };
    graph.append(group);
  });
  graph.append(
    shape(
      "text",
      {
        x: 310,
        y: 528,
        "text-anchor": "middle",
        "font-family": "Arial",
        "font-size": 10,
        fill: "#907f88",
      },
      "Numbers identify color groups · dashed rings mark clique vertices",
    ),
  );
}
function renderInspector() {
  const entry = result.assignment.find((x) => x.vertex === selected);
  $("vertex-title").textContent = entry.vertex;
  $("vertex-info").textContent =
    `Color ${entry.color}. ${entry.neighbors.length} adjacent ${entry.neighbors.length === 1 ? "vertex" : "vertices"} must receive different colors.`;
  $("neighbors").replaceChildren(
    ...entry.neighbors.map((v) => {
      const b = el("button", v);
      b.onclick = () => {
        selected = v;
        renderGraph();
        renderInspector();
      };
      return b;
    }),
  );
  if (!entry.neighbors.length)
    $("neighbors").append(el("p", "No conflicts for this vertex.", "hint"));
}
function renderTrace() {
  const trial = result.trials[Number($("trial").value)];
  $("trace").replaceChildren();
  if (!trial) {
    $("trace-note").textContent = "No exact-search events.";
    return;
  }
  $("trace-note").textContent =
    `${trial.visits} visited search states. Showing ${trial.trace.length} events${trial.traceTruncated ? " (preview truncated)" : ""}. Trial result: ${trial.status}.`;
  $("trace").replaceChildren(
    ...trial.trace.map((event) => {
      const row = el("tr");
      for (const value of [
        event.action,
        event.depth,
        event.vertex,
        event.color ?? "—",
      ])
        row.append(el("td", String(value)));
      return row;
    }),
  );
}
$("settings").onsubmit = (e) => {
  e.preventDefault();
  run({
    ...result.input,
    palette: Number($("palette").value),
    budget: Number($("budget").value),
  });
};
$("example").onclick = () => run(example);
$("cycle").onclick = () => run(cycle);
$("clique").onchange = renderGraph;
$("trial").onchange = renderTrace;
$("undo").onclick = () => {
  const previous = history.pop();
  if (previous) run(previous, false);
};
$("edge-form").onsubmit = (e) => {
  e.preventDefault();
  const from = $("from").value,
    to = $("to").value,
    edges = structuredClone(result.input.edges);
  if (from === to) {
    $("status").textContent = "A conflict must join two different vertices.";
    return;
  }
  const index = edges.findIndex(
    (edge) => edge.includes(from) && edge.includes(to),
  );
  if ($("edge-action").value === "add") {
    if (index !== -1) {
      $("status").textContent = "That conflict already exists.";
      return;
    }
    edges.push([from, to]);
  } else {
    if (index === -1) {
      $("status").textContent = "That conflict does not exist.";
      return;
    }
    edges.splice(index, 1);
  }
  run({ ...result.input, edges });
};
$("apply").onclick = () => {
  try {
    run(JSON.parse($("json").value));
  } catch (e) {
    $("status").textContent = e.message;
  }
};
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = el("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("save").onclick = () => {
  if (result)
    download(
      "palette-proof-graph.json",
      JSON.stringify(result.input, null, 2),
      "application/json",
    );
};
$("export").onclick = () => {
  if (result)
    download(
      "palette-proof-evidence.json",
      JSON.stringify(result, null, 2),
      "application/json",
    );
};
$("csv").onclick = () =>
  download(
    "palette-proof-assignment.csv",
    [
      "vertex,color",
      ...result.assignment.map((x) => `${x.vertex},${x.color}`),
    ].join("\r\n"),
    "text/csv",
  );
$("svg").onclick = () =>
  download(
    "palette-proof-graph.svg",
    new XMLSerializer().serializeToString($("graph")),
    "image/svg+xml",
  );
$("open").onclick = () => $("file").click();
$("file").onchange = async () => {
  const file = $("file").files[0];
  if (!file) return;
  try {
    if (file.size > 100000) throw Error("Graph files must be at most 100 KB.");
    const data = JSON.parse(await file.text());
    run(data.input ?? data);
  } catch (e) {
    $("status").textContent = e.message;
  } finally {
    $("file").value = "";
  }
};
run(example, false);

for (const button of document.querySelectorAll("[data-view]")) {
  button.onclick = () => {
    for (const tab of document.querySelectorAll("[data-view]"))
      tab.setAttribute("aria-pressed", String(tab === button));
    for (const view of ["canvas", "evidence", "source"])
      $(view + "-view").hidden = view !== button.dataset.view;
  };
}
