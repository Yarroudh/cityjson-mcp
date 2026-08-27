#!/usr/bin/env python3
"""Render the repository's Mermaid flowcharts to high-resolution PNGs.

This renderer intentionally supports the small Mermaid subset used in diagrams/*.mmd:
node declarations and directed `-->` edges with optional `|label|` edge labels.
The Mermaid files remain the canonical diagram source embedded in README.md.
Graphviz is used for a deterministic 300-DPI PNG export without requiring a browser.
"""
from pathlib import Path
import html
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
DIAGRAMS = ROOT / "diagrams"

NODE_RE = re.compile(r'^\s*([A-Za-z][A-Za-z0-9_]*)\["(.*)"\]\s*$')
EDGE_RE = re.compile(r'^\s*([A-Za-z][A-Za-z0-9_]*)\s*-->\s*(?:\|([^|]+)\|\s*)?([A-Za-z][A-Za-z0-9_]*)\s*$')


def parse_mermaid(text: str):
    nodes = {}
    edges = []
    for line in text.splitlines():
        m = NODE_RE.match(line)
        if m:
            nodes[m.group(1)] = m.group(2).replace('<br/>', '\n')
            continue
        m = EDGE_RE.match(line)
        if m:
            edges.append((m.group(1), m.group(3), m.group(2)))
    if not nodes or not edges:
        raise ValueError("Unsupported or empty Mermaid diagram")
    return nodes, edges


def q(value: str) -> str:
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n') + '"'


def render(path: Path):
    nodes, edges = parse_mermaid(path.read_text(encoding="utf-8"))
    direction = "TB" if "flowchart TD" in path.read_text(encoding="utf-8") else "LR"
    dot = [
        "digraph G {",
        f"  rankdir={direction};",
        "  graph [bgcolor=white, pad=0.35, nodesep=0.55, ranksep=0.8, dpi=300];",
        "  node [shape=box, style=\"rounded,filled\", fillcolor=\"#F7F8FA\", color=\"#5E6A7D\", fontname=\"DejaVu Sans\", fontsize=14, margin=\"0.20,0.14\", penwidth=1.3];",
        "  edge [color=\"#697386\", fontcolor=\"#364152\", fontname=\"DejaVu Sans\", fontsize=11, arrowsize=0.8, penwidth=1.2];",
    ]
    for node_id, label in nodes.items():
        dot.append(f"  n_{node_id} [label={q(label)}];")
    for src, dst, label in edges:
        attrs = f" [label={q(label)}]" if label else ""
        dot.append(f"  n_{src} -> n_{dst}{attrs};")
    dot.append("}")
    out = path.with_suffix(".png")
    with tempfile.NamedTemporaryFile("w", suffix=".dot", delete=False, encoding="utf-8") as f:
        f.write("\n".join(dot))
        dot_path = Path(f.name)
    try:
        subprocess.run(["dot", "-Tpng", "-Gdpi=300", str(dot_path), "-o", str(out)], check=True)
    finally:
        dot_path.unlink(missing_ok=True)
    print(out.relative_to(ROOT))


def main():
    for path in sorted(DIAGRAMS.glob("*.mmd")):
        render(path)

if __name__ == "__main__":
    main()
