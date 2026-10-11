# Interactive knowledge-graph visualization and graph-aware search UX (state of the art, October 2026)

Scope note: this research targets upgrading the existing Obsidian-style canvas force graph in `packages/boardroom-ai/client/src/components/graph/KnowledgeGraphView.tsx` (React 19, `react-force-graph-2d` ^1.29.2, hover-fade neighbourhood model, shape+colour encoding per type, reduced-motion path, `warmupTicks`/`cooldownTicks` tuning, `zoomToFit`, `focusNode`). Several vendor domains (cosmograph.app, sigmajs.org, g6.antv.antgroup.com, obsidian.md, neo4j.com, cambridge-intelligence.com, skewed.de, arxiv.org, cdn.jsdelivr.net) were unreachable from this sandbox (DNS blocked), so some findings rest on search-engine excerpts of those pages rather than full fetches; those are flagged.

---

## KQ1 — Rendering libraries: performance ceilings, React 19 fit, bundle, licence, maintenance

### Takeaway
As of Oct 2026 the realistic candidates are (a) keep `react-force-graph-2d` (canvas, d3-force, MIT, fine to ~1–3k visible nodes with careful painting), (b) move to **Sigma.js v3/v4 + Graphology** (WebGL, MIT, "tens of thousands" of nodes, large ecosystem for layouts/communities, React bindings via `@react-sigma`), or (c) **Cosmograph / cosmos.gl** for GPU-simulated force layouts at 100k+ scale — but Cosmograph's packaged library is **CC-BY-NC-4.0 (non-commercial)** and the underlying cosmos.gl engine is MIT. G6 v5 and Cytoscape.js are credible but heavier/less React-idiomatic; Reagraph is Three.js-based and feature-rich but smaller-community. Commercial toolkits (Ogma/KeyLines/yFiles) are quote-only.

### Cited Findings

**react-force-graph (current stack)**
- Published as four packages: `react-force-graph-2d` (HTML Canvas), `-3d` (ThreeJS/WebGL), `-vr` (A-Frame), `-ar` (AR.js); "uses canvas/WebGL for rendering and d3-force-3d for the underlying physics engine", with ngraph optional; MIT; ~3.3k stars, 358 forks, 218 open issues, 668 commits — [GitHub vasturiano/react-force-graph](https://github.com/vasturiano/react-force-graph)
- Performance knobs documented: `autoPauseRedraw` (default true) pauses 2D redraws when the simulation halts; `pauseAnimation`/`resumeAnimation`; disabling `enablePointerInteraction` "is recommended for maximum speed"; `warmupTicks`; `cooldownTicks` (default Infinity) and `cooldownTime` (default 15000 ms); a large-graph example is included — [GitHub vasturiano/react-force-graph](https://github.com/vasturiano/react-force-graph)
- `nodeCanvasObject` (2D only) paints custom node shapes with replace/before/after modes; `zoomToFit` with duration/padding/node filter; `dagMode` for top-down/left-right/radial hierarchical layouts; link particles via `linkDirectionalParticles`/`emitParticle` — [GitHub vasturiano/react-force-graph](https://github.com/vasturiano/react-force-graph)
- The React packages are a thin adapter over `force-graph`, which the maintainer describes as "high performance rendering suitable for medium to large graphs"; no measured node-count benchmark published — [best-of-web force-graph](https://best-of-web.builder.io/library/vasturiano/force-graph); [force-graph docs](https://docsearch.algolia.com/mcp/docs/repo/vasturiano/force-graph)
- Existing repo already runs it on React ^19.0.0 (`packages/boardroom-ai/package.json`) — local codebase, not a web source.

**Sigma.js + Graphology**
- "A JavaScript library aimed at visualizing graphs of thousands of nodes and edges" using WebGL, built on graphology; MIT; ~12.2k stars, 1.6k forks; v3 and v4 development sponsored by gdotv; companion packages `@sigma/node-image`, `@sigma/node-border`, `@sigma/node-piechart`, label attachment rendering, Leaflet/MapLibre background layers, image export — [GitHub jacomyal/sigma.js](https://github.com/jacomyal/sigma.js)
- npm `sigma` at 3.0.2 (MIT) per npm metadata; a v4 beta site exists ("This is the v4-beta website. Looking for v3 documentation?") and its rendering page says Sigma "achieves smooth performance with tens of thousands of nodes and edges" — [npm sigma](https://npmjs.com/package/sigma); [v4.sigmajs.org](https://v4.sigmajs.org/); [v4 rendering concepts](https://v4.sigmajs.org/concepts/rendering/)
- Architecture: a Sigma instance wraps a graphology Graph, a container element and settings; manages camera, mouse/touch, per-frame rendering through pluggable node and edge "programs" (shaders) — [v4 rendering concepts](https://v4.sigmajs.org/concepts/rendering/)
- An unverified third-party page claims 100k nodes at 30–60 fps on mid-range hardware — [knogin.com](https://knogin.com/en/developers/sigma-large-graph-rendering) (treat as unverified; the search summary itself flagged it as non-authoritative)
- React bindings: `react-sigma` ("A set of react components to display graphs with Sigma v3"), MIT, 238 stars, 304 commits, 3 open issues; releases/React-version range not shown on the repo page — [GitHub sim51/react-sigma](https://github.com/sim51/react-sigma)
- Sigma's own tutorial calls hover-neighbourhood highlighting "the most common interactive pattern in graph visualization": neighbours stay coloured while everything else fades to grey, and it recommends rendering the highlighted subgraph on a layer above the dimmed items — [sigma v4 hover-search how-to](https://v4.sigmajs.org/how-to/interactivity/hover-search/); [add interactivity](https://v4.sigmajs.org/get-started/add-interactivity/)

**Cosmograph / cosmos.gl**
- cosmos.gl (engine): MIT; "hundreds of thousands of points and links on modern hardware"; all computation and drawing on the GPU in shaders; v3.0 moves rendering to luma.gl (WebGL 2, peer dep ~9.3.0); point-clustering force (`setPointClusters`, `setClusterPositions`, `setPointClusterStrength`), GPU collision force, `findPointsInRect/Polygon`, point dragging, `fitViewOnInit`, pinch zoom; known issues: Android devices without `OES_texture_float` unsupported; iOS 15.4 broke the Many-Body force (latest iOS works again); ~1.3k stars, 780 commits; no React wrapper in the engine repo — [GitHub cosmosgl/graph](https://github.com/cosmosgl/graph)
- Cosmograph (library/app on top of cosmos.gl): "What's new" lists 2.0 (Nov 2025: DuckDB, Mosaic, SQLRooms, latest cosmos.gl), 2.1 (Dec 2025), 2.2 (Apr 2026: point shapes and images); README for 2.3.2 says it is "especially suited to knowledge graphs" and "millions of points and edges on modern hardware" — [Cosmograph What's new](https://cosmograph.app/docs-general/whats-new/); [jsDelivr @cosmograph/cosmograph 2.3.2 README](https://cdn.jsdelivr.net/npm/@cosmograph/cosmograph@2.3.2/README.md) (page content via search excerpt; site DNS-blocked here)
- **Licence**: "Cosmograph is available free of charge for non-commercial use under the CC BY-NC 4.0 public license. If you're planning to use Cosmograph commercially, reach out to us for a proprietary license." Business tier is "Contact us" with "Commercial use, Dedicated support…"; `@cosmograph/react` 2.3.2 on jsDelivr shows licence CC-BY-NC-4.0 — [cosmograph.app/licensing](https://cosmograph.app/licensing/); [jsDelivr @cosmograph/react](https://www.jsdelivr.com/package/npm/@cosmograph/react?tab=files); [npm @cosmograph/react](https://npmjs.com/package/@cosmograph/react)
- Cosmograph ships React components including a histogram/timeline and a Python widget; a Stanford CESTA talk (Apr 2026) used it for network graphs from text embeddings — [next.cosmograph.app histogram component](https://next.cosmograph.app/docs/lib/components/histogram); [Stanford CESTA](https://cesta.stanford.edu/news/seeing-shape-knowledge-network-graphs-text-embeddings-and-cosmograph); [PyBay 2025 talk](https://pyvideo.org/pybay-2025/visualizing-large-graphs-and-ai-embeddings-with-ease.html)

**AntV G6 v5**
- Built on the @antv/g engine; Canvas, SVG and WebGL renderers (`@antv/g-webgl`); layered canvases can mix renderers; new layout engine with some Rust implementations and WebGPU-accelerated options; `@antv/layout-wasm` provides ForceAtlas2; flatter options (`behaviors` replaces `modes`); tree graphs via `treeToGraphData`; `g6-extension-3d` — [G6 What's new](https://g6.antv.antgroup.com/en/manual/whats-new/feature); [G6 React integration](https://g6.antv.antgroup.com/en/manual/getting-started/integration/react)
- MIT; ~12.3k stars, 322 open issues; "supports React nodes for richer node styling"; Graphin is the simple React wrapper; "more than 10 common layouts … some use GPU and Rust parallel computing" — [GitHub antvis/G6](https://github.com/antvis/G6)
- Plugins: Hull plugin (member node ids + concavity, default convex) and BubbleSets plugin exist in G6 v5 — [G6 hull plugin](https://g6.antv.antgroup.com/en/manual/plugin/hull); [G6 bubble-sets plugin](https://g6.antv.antgroup.com/en/manual/plugin/bubble-sets)

**Cytoscape.js**
- WebGL renderer introduced as a preview in 3.31.0 (13 Jan 2025): "initial, experimental WebGL rendering support … currently does not support all styles (e.g. segments edges are not supported)"; motivation: canvas renderer is single-threaded JS and frame rate drops with element count; WebGL and TypeScript were "preview features … may have API-breaking changes" — [Cytoscape.js WebGL preview](https://blog.js.cytoscape.org/2025/01/13/webgl-preview/); [3.31.0 release](https://blog.js.cytoscape.org/2025/01/13/3.31.0-release/)
- Newer releases: 3.33.0 on the blog index; v3.34.0 published 2 June 2026 (Zenodo); docs list 3.35.0-unstable — [Cytoscape.js blog](https://blog.js.cytoscape.org/); [Zenodo v3.34.0](https://zenodo.org/records/891013/latest)
- `cytoscape-bubblesets` plugin exposes `bubbleSets().addPath(nodes, edges, avoidNodes)` — [npm cytoscape-bubblesets](https://npmjs.org/package/cytoscape-bubblesets)

**Reagraph**
- "High-performance network graph visualization built in WebGL for React"; Apache-2.0; ~1.1k stars, 1,154 commits, 10 open issues; layouts: Force Directed 2D/3D, Circular, Tree (TD/LR, 2D/3D), Radial Out, Hierarchical, No Overlap, ForceAtlas2, Concentric; features: clustering, path finding between nodes, lasso selection, edge bundling, advanced label placement, node sizing by attribute/centrality, expand/collapse, badges — [GitHub reaviz/reagraph](https://github.com/reaviz/reagraph)
- npm 4.30.8; built on Three.js, React Three Fiber, D3 and Graphology; a mirror shows last push 3 Mar 2026; depscope health 66/100 — [npm reagraph](https://npmjs.com/package/reagraph); [skills.sh reagraph](https://www.skills.sh/reaviz/skills/reagraph); [depscope reagraph](https://depscope.dev/pkg/npm/reagraph)

**Pixi-based**
- `pixi-graph` (PixiJS + Graphology) is self-labelled "pre-release, use at your own risk"; layout is any `nodes => positions` function — [gitee mirror pixi-graph](https://gitee.com/baopengdu/pixi-graph)
- `ngraph.pixi` renders with `PIXI.Graphics`, which "has decent pressure on garbage collector, since all primitives are rerendered on each frame" — [GitHub anvaka/ngraph.pixi](https://github.com/anvaka/ngraph.pixi)
- A demo renders a 15,745-node / 69,839-edge citation network in Pixi with zoom, drag and neighbour highlighting — [GitHub RaleighHan/pixi-network-visualization](https://github.com/RaleighHan/pixi-network-visualization)
- GraphAware's series on moving D3 to Pixi + WebWorker layout reports SVG D3 slows beyond ~1000 nodes — [GraphAware blog](https://graphaware.com/blog/scale-up-your-d3-graph-visualisation-webgl-canvas-with-pixi-js/); [part 2](https://community.neo4j.com/t/scale-up-your-d3-graph-visualisation-part-2-webworker-layout-and-pixi-js-rendering-performance-improvements/19457)
- NetV.js claims "up to 50 thousand nodes and 1 million edges" — [DOAJ Visual Informatics 2021](https://doaj.org/article/a199b80883cc47a1b6b53ac02ad185a2)

**Commercial**
- Ogma (Linkurious, "a Nuix company") is "Contact vendor" pricing with a free trial — [Capterra Ogma](https://www.capterra.com/p/10011703/Ogma/)
- Linkurious Enterprise: "Filter results, explore timelines, switch to geo-mode, or use the no-code query builder and preset specific queries for all users"; shared graph views across teams — [AWS Neptune docs: Linkurious](https://docs.amazonaws.cn/en_us/neptune/latest/userguide/visualization-Linkurious.md)
- Neo4j Bloom/Explore: same product under two names ("the functionality in both cases is the same"); Bloom 2.37.0 released 23 Sep 2026 and upgraded its visualisation library to NVL 2.0.0 — [Neo4j feedback thread](https://aura.feedback.neo4j.com/desktop-v2/p/in-neo4j-desktop-for-mac-it-says-explore-instead-of-bloom-if-you-are-advertising); [Bloom 2.37.0 release notes](https://neo4j.com/release-notes/bloom/bloom-2370/)
- KeyLines publishes an accessibility guide (keyboard navigation, screen readers, colour/contrast, animation safety aligned to WCAG/508) — [Cambridge Intelligence accessibility](https://cambridge-intelligence.com/build-accessible-data-visualization-apps-with-keylines/)

### Inferences
- For "hundreds to tens of thousands" of nodes, the current canvas stack is adequate up to the low thousands if painting is cheap (no per-node text measurement every frame, labels only above a zoom threshold, `autoPauseRedraw`), but hover-hit-testing and per-frame custom painting will bottleneck well before 10k. A WebGL renderer (Sigma) is the lowest-risk step up because Graphology also supplies layouts (ForceAtlas2 in a worker, noverlap) and community detection in the same ecosystem.
- Cosmograph is the only option that does the *simulation* on the GPU; that is what gives it the "instant" feel on 50k+ nodes. But the packaged React library is non-commercial-licensed; BoardRoom is a paid SaaS, so either budget for a licence or use raw `cosmos.gl` (MIT) with a hand-rolled React wrapper (more work, no built-in search/timeline components).
- G6 v5 is the most "batteries-included" (hull, bubble-sets, minimap, timebar, Rust/WebGPU layouts) but is a large framework with its own rendering engine and React-node bridging; adoption cost is high relative to the existing component.
- Reagraph gives path-finding, clustering, edge bundling and lasso out of the box in React, but its Three.js/R3F dependency chain is heavy and its community is ~10× smaller than Sigma's or G6's.

### Gaps
- No library publishes reproducible 2026 FPS benchmarks at 1k/10k/50k nodes; the only numbers found are vendor claims or unverified third-party pages. A local benchmark with the real OmniMind graph is required.
- Exact React 19 peer-dependency ranges for `react-force-graph-2d`, `react-sigma`, `reagraph`, Graphin could not be verified (npm/jsDelivr pages returned 403/DNS errors). The current repo already runs `react-force-graph-2d` on React 19, which is empirical evidence it works.
- Bundle sizes (unpacked/gzipped) could not be retrieved for any library.
- Cosmograph commercial pricing is quote-only; no figure found.

---

## KQ2 — Layout and structure: semantic zoom/LOD, community detection + hulls, hierarchical/radial/timeline, embedding-based layouts, edge bundling, time-lapse, pinning/saved views

### Takeaway
The evidence-backed structural upgrades are: weight-ranked label visibility per zoom level (semantic zoom), Louvain/Leiden communities rendered as hulls or bubble sets with cluster labels, and a *second* layout mode that places memories by projected embedding (UMAP) rather than by force, with the force graph kept for local neighbourhoods. Edge bundling is available but mostly research-grade for WebGL; time-lapse exists in Obsidian and is a cheap win if timestamps are present.

### Cited Findings

**Semantic zoom / LOD**
- rtopmap rule: "For each level, nodes are sorted by their weight. A node is made visible at a level if its bounding box does not overlap with the bounding boxes of nodes ranked above it" — [arXiv 1706.04979](https://arxiv.org/pdf/1706.04979)
- Zoomable Multi-Level Tree (Eurographics 2020): "All nodes at the current level and higher levels are labeled and there are no label overlaps"; anything visible at one level stays visible at deeper levels; web prototype exists — [De Luca et al.](https://cs.paperswithcode.com/paper/multi-level-tree-based-approach-for)
- Wiens et al. (K-CAP 2017) ontology semantic zoom: three discrete detail layers; "edges may be aggregated and labels can be hidden"; user study reported better readability but "participants asked for additional indicators, tooltips, and reported back a steep learning curve" — [arXiv 1906.05996](https://arxiv.org/pdf/1906.05996)
- KIELER "smart zoom": important labels/icons are scaled and positioned to stay visible when zoomed out — [Fraunhofer/KIELER](https://publica.fraunhofer.de/handle/publica/401362)

**Community detection and hulls**
- `graphology-communities-louvain`: "works both for undirected & directed graph by using the relevant modularity computations … also works on multi graphs but won't work with mixed graph"; cites the Leiden paper — [unpkg README](https://unpkg.com/graphology-communities-louvain@2.0.2/README.md)
- No mainstream JS Leiden: `ngraph.leiden` 0.2.0 (Leiden + Louvain for ngraph) has depscope health 40/100, 1 maintainer, no TS types, last update Aug 2025 — [depscope ngraph.leiden](https://mcp.depscope.dev/pkg/npm/ngraph.leiden)
- `bubblesets` (bubblesets-js): JS port of Collins' Bubble Sets, no deps, full TypeScript types, "sparse potential area computation"; operates on rectangles and emits an SVG path string — [npm bubblesets](https://npmjs.org/package/bubblesets)
- Bubble Sets paper: convex hulls are "fast to calculate and well-suited to cohesive clusters which are separated from neighbouring groups"; bubble sets help when set members are spread out or other items sit inside the convex region — [Collins et al. PDF](https://vis.pku.edu.cn/course/datavis_f23/material/bubble_sets_revealing_set_relations_with_isocontours_over_existing_visualizations.pdf)
- Kumu: "automated community detection colors elements by community and highlights bridges between communities"; clustering links elements that share data — [Kumu network mapping](https://kumu.io/markets/network-mapping); [Kumu tour](https://kumu.io/tour)
- InfraNodus: "most influential words are shown bigger, and nodes that often occur together are grouped into colored topical clusters"; "structural gap detection" flags parts of the graph that could connect but don't — [InfraNodus text network analysis](https://infranodus.com/use-case/text-network-analysis); [InfraNodus creative thinking](https://infranodus.com/use-case/creative-thinking)

**Hierarchical / radial / timeline layouts**
- `react-force-graph` `dagMode` (td/lr/radial) is already available in the current stack — [GitHub react-force-graph](https://github.com/vasturiano/react-force-graph)
- Reagraph ships Tree, Radial Out, Hierarchical, Concentric, No Overlap, ForceAtlas2 — [GitHub reagraph](https://github.com/reaviz/reagraph)
- Litmaps uses a time axis: "the horizontal axis is time, the vertical axis is citation density, and papers are rendered as nodes whose size reflects influence"; reviewers say Litmaps "still leads on advanced visualization/filters" — [Sourcely May 2026](https://www.sourcely.net/resources/research-rabbit-vs-connected-papers-tool-finds-related-studies); [Ponder.ing](https://ponder.ing/blog/connected-papers-alternatives)
- Connected Papers: "Its graph is unordered and spatial" — papers cluster by co-citation similarity even without direct links; reviewers call it the "fastest and easiest to use single-seed map" that "creates cleaner visual graphs" — [Ponder.ing CP vs RR](https://ponder.ing/blog/connected-papers-vs-research-rabbit); [Digital Orientalist Mar 2025](https://digitalorientalist.com/2025/03/18/tools-for-literature-mapping/)

**Embedding-based layout (UMAP)**
- UMAP "constructs a weighted k-nearest neighbors graph … then optimizes the layout … to minimize the cross-entropy between the two topological representations"; the second step "resembles conventional graph layout computation, where repulsive and attractive forces are iteratively applied" — [arXiv 2107.01887](https://arxiv.org/pdf/2107.01887)
- `n_neighbors` controls local vs global scale; `min_dist` controls cluster tightness — [MetricGate UMAP docs, May 2026](https://metricgate.com/docs/umap-uniform-manifold/)
- A JS helper `convertEmbeddingsToUMAP` exists in airesearch.js — [airesearch.js](https://airesearch.js.org/functions/convertEmbeddingsToUMAP.html)
- Stanford CESTA (Apr 2026) presented "network graphs, text embeddings and Cosmograph" (page DNS-blocked; title only) — [Stanford CESTA](https://cesta.stanford.edu/news/seeing-shape-knowledge-network-graphs-text-embeddings-and-cosmograph)
- Fiddler ships UMAP embedding visualization as a product feature — [Fiddler docs](https://docs.fiddler.ai/observability/platform/embedding-visualization-with-umap)

**Edge bundling**
- Force-directed edge bundling (Holten & van Wijk 2009) models each edge as a spring; compatible nearby edges attract — [vasturiano/d3.ForceBundle](https://github.com/vasturiano/d3.ForceBundle); Observable example wiring `@john-guerra/force-edge-bundling` into a d3 simulation per tick — [Observable](https://observablehq.com/@john-guerra/force-graph-edge-bundling)
- Texture-based WebGL bundling reported ~240× speedup vs D3 on ~2k edges but "can not handle very large graphs due to the texture size limitation"; the paper proposes pixel-based bundling (PBEB) for scalability — [UNL 2023 PBEB paper](https://par.nsf.gov/servlets/purl/10539354)
- Reagraph lists edge bundling as a built-in feature — [GitHub reagraph](https://github.com/reaviz/reagraph)

**Time-lapse**
- Obsidian: the Animate button starts a time-lapse where "notes and attachments appear in chronological order based on their creation time"; users asked for speed/pause controls (not built in) — [Obsidian help: Graph view](https://obsidian.md/help/plugins/graph); [Obsidian forum design talk](https://forum.obsidian.md/t/design-talk-about-the-graph-view/22594/32)
- Linkurious Enterprise: "explore timelines" is a first-class feature — [AWS Neptune docs](https://docs.amazonaws.cn/en_us/neptune/latest/userguide/visualization-Linkurious.md)
- Cosmograph ships a histogram/timeline component — [next.cosmograph.app histogram](https://next.cosmograph.app/docs/lib/components/histogram)
- Zep stores per-edge "datetime attributes for when the fact becomes valid and when it becomes invalid" (bitemporal edges) — [Zep docs: understanding the graph](https://help.getzep.com/v2/understanding-the-graph)

**Pinning / saved views**
- Linkurious: "share graph views and investigation results across teams or at the organization level" — [AWS Neptune docs](https://docs.amazonaws.cn/en_us/neptune/latest/userguide/visualization-Linkurious.md)
- Obsidian forum complaint: "the search history for the graph is not saved" — [Obsidian forum: Enhanced graph search](https://forum.obsidian.md/t/enhanced-graph-search/113084)
- Obsidian groups: "You can divide nodes in graph view into groups based on queries, and customize the color of each group" (v0.11.0, 2021) — [Obsidian changelog 0.11.0](https://obsidian.md/changelog/2021-02-09-desktop-v0.11.0)

### Inferences
- The project's data already carries OpenAI 1536-dim embeddings for memories (CLAUDE.md); a server-side UMAP (or PCA→UMAP) to 2D cached per tenant would let the client offer a "semantic map" mode where force layout only acts within communities. Effort M; risk: UMAP axes are not interpretable and change on recompute, so positions must be cached and only re-projected on demand.
- Communities computed in Graphology (Louvain) in a Web Worker, then outlined with `bubblesets` or a concave hull, plus one auto-generated label per community (top-TF-IDF terms or an LLM one-liner) reproduces the InfraNodus/Kumu "named clusters" feel. Effort M; risk: Louvain is non-deterministic across runs → persist community ids.
- Semantic zoom à la rtopmap (rank nodes by degree×recency, show label only if its box doesn't collide with higher-ranked labels at this zoom) is implementable in the current `nodeCanvasObject` with a per-frame grid; Effort S–M.
- Edge bundling is not worth it for a KG of this size with typed edges; it hides edge identity and the WebGL versions are research code. Prefer edge fading + hover reveal.
- Time-lapse is cheap because every entity has `createdAt`; a scrubber that filters by date and "grows" the graph is Effort S on top of the existing filter→reheat pipeline.

### Gaps
- No benchmark comparing Louvain vs Leiden quality in JS; the only Leiden package is low-health.
- Obsidian's actual 2025–2026 graph-view changes could not be verified (changelog pages unreachable; only unverified third-party claim of "improved graph view performance for large vaults" in a 2026 release).
- No published evaluation of embedding-projected layouts vs force layouts for note-taking/KM tools specifically.

---

## KQ3 — Search integration patterns

### Takeaway
The consistent pattern across Obsidian plugins, Sigma tutorials, Linkurious and Neo4j Explore is: a ⌘K palette drives the camera, search acts as a **spotlight (highlight + dim) by default with filter (hide) as an option**, facets/time slicers live in a side panel, and path finding / expand-collapse are first-class actions. Natural-language → structured query is viable but needs schema-constrained generation and a visible fallback.

### Cited Findings
- Obsidian forum proposal "Enhanced graph search": the built-in search "is a filter that hides all non-matching nodes, which loses the surrounding structure"; proposes highlighting the match, centring the camera, and dimming rather than hiding — [forum.obsidian.md/t/enhanced-graph-search](https://forum.obsidian.md/t/enhanced-graph-search/113084)
- Community plugin "Graph Type to Search" implements a spotlight: "draws a soft glow ring around matching nodes and dims the non-matching nodes, with an option to keep the whole graph on screen rather than filtering" — [obsidianstats: Graph Type to Search](https://www.obsidianstats.com/plugins/graph-type-to-search)
- Sigma.js hover+search how-to: neighbours stay coloured, others fade to grey; render highlighted subgraph on an upper layer so its edges are not hidden — [sigma v4 hover-search](https://v4.sigmajs.org/how-to/interactivity/hover-search/)
- Obsidian local graph: "a local Graph view shows you notes connected to the active note"; depth slider where "each level of depth will show notes connected to the notes revealed at the previous depth"; filters include tags, attachments, orphans; "Text fade threshold" controls label alpha — [Obsidian help: Graph view](https://obsidian.md/help/plugins/graph)
- Kumu focus mode: select an element, click the target icon to show only it and its connections; arrows "increase or decrease the chain of connections visible" — [Duke Stained University map guide](https://sites.duke.edu/staineduniversity/smoke-and-mirrors-duke-university-the-tobacco-industry-and-entanglements-in-scientific-research/smoke-and-mirrors-map-information-guide/)
- ResearchRabbit expands "through six discovery modes: Similar Work, Earlier Work, Later Work, Citations, References, and Authors"; its 2025 revamp delivered a "cleaner iterative 'rabbit hole' flow, a more configurable citation graph" — [Aaron Tay Substack](https://aarontay.substack.com/p/researchrabbits-2025-revamp-iterative); [Ponder.ing](https://ponder.ing/blog/research-rabbit-alternatives)
- Linkurious Enterprise: filter results, timelines, geo-mode, "no-code query builder and preset specific queries for all users" — [AWS Neptune docs](https://docs.amazonaws.cn/en_us/neptune/latest/userguide/visualization-Linkurious.md)
- Neo4j Aura Explore is "a graph exploration tool for visually interacting with graph data", same functionality as standalone Bloom — [Neo4j Aura Explore intro](https://neo4j.com/docs/aura/explore/introduction/) (page DNS-blocked; description via search excerpt and the Neo4j feedback thread above)
- Command palette: shadcn `Command` is built on `cmdk` (fuzzy filtering, keyboard nav, a11y wiring); typical pattern is `CommandDialog` + global keydown; `kbar` is the main alternative (action registry) — [shadcn.io command](https://www.shadcn.io/ui/command); [buildmvpfast ⌘K guide 2026](https://www.buildmvpfast.com/blog/how-to-add-cmd-k-command-palette-saas-2026)
- Mem0 Platform graph view (Pro/Enterprise): "explore entities, trace connections, and search and filter the graph in the dashboard" — [Mem0 docs graph memory](https://docs.mem0.ai/platform/features/graph-memory.md)
- Zep Graph Explorer (Q1 2025): "visualize and explore every knowledge graph you create, by visiting the page of the relevant user or group in the web app" — [Zep Q1 2025 round-up](https://blog.getzep.com/zep-q1-2025-product-round-up/)
- Text2Cypher (GenAIK 2025): "Cypher requires specialized knowledge, which can present a challenge for non-expert users"; "LLMs often struggle to capture complex nuances, resulting in incomplete or incorrect outputs"; fine-tuning "has proven to be a more promising approach"; combined dataset of 44,387 instances — [arXiv 2412.10064](https://arxiv.org/html/2412.10064v1); [ACL Anthology GenAIK 2025](https://preview.aclanthology.org/setup/2025.genaik-1.11)
- Path finding is built into Reagraph ("path finding between nodes") — [GitHub reagraph](https://github.com/reaviz/reagraph)
- Keyboard model from a shipped product (Oracle Graph Visualization Toolkit 26.3.0 ACR): Tab/Shift+Tab move focus between elements, arrow keys move between adjacent nodes or edges, +/- zoom; charts should have a text alternative such as a data table — [Oracle ACR 26.3.0](https://www.oracle.com/anz/corporate/accessibility/templates/t2-19397.html)
- Oracle's graph interaction docs describe standard interactions (focus, highlight, expand) — [Oracle pgjsd graph interaction](https://docs.oracle.com/cd/G10423_01/pgjsd/pages/features/graph-interaction.html)

### Inferences
- Because OmniMind already exposes hybrid `POST /memories/search` with scores (CLAUDE.md), the highest-leverage integration is: palette query → server hybrid search → client receives `{id, score}` list → graph spotlights hits with ring glow scaled by score, dims the rest, and `zoomToFit(hits)`; a "Filter" toggle converts the spotlight into a hide. Effort S–M; risk: hits not present in the loaded subgraph → need lazy fetch of missing nodes + 1-hop.
- Faceted filters (type, tenant, date range, status, tags) should be *server-side query params* so the client subgraph stays under the render ceiling; the client only animates diffs. The existing component already re-heats on visible-id-set change, so facet changes slot in.
- "Explain this neighbourhood": select node or lasso → send the k-hop subgraph (ids, types, edge types, snippets) to a Haiku call that returns a 2–3 sentence summary + 3 suggested follow-up queries; render in the inspector. Effort M; risk: cost/latency — cache per (focus id, depth, graph version).
- "Ask the graph" (NL → structured filter) should target a *constrained JSON filter schema* (Zod-validated per project rule) rather than free Cypher; the Text2Cypher literature shows base LLMs mis-generate complex queries, and this project has no Cypher backend anyway.
- Breadcrumbs/history: keep a ring buffer of focus ids (Obsidian users explicitly complain that graph search history is lost); back/forward via Alt+←/→.

### Gaps
- No controlled study comparing spotlight (dim) vs filter (hide) for graph search was found; the preference is practitioner consensus (Obsidian plugin authors, Sigma docs).
- No public documentation of Neo4j Explore "search phrases" or Perspectives could be fetched (DNS-blocked).
- Mobile touch patterns for graph search were not covered by any source found; only cosmos.gl's pinch-to-zoom support and Android/iOS WebGL caveats surfaced.

---

## KQ4 — Exemplars and what makes them feel good

### Takeaway
The exemplars that reviewers praise share four traits: (1) a *single fast entry point* (one seed/one search) that yields a clean local view, (2) named, coloured clusters rather than raw hairballs, (3) a second organising axis (time in Litmaps, similarity in Connected Papers, bitemporal validity in Zep), and (4) iterative expansion controls (depth sliders, discovery modes) instead of showing everything at once.

### Cited Findings
- Obsidian graph: rebuilt in v0.9.0 (Sep 2020) with filters, tags/attachments/orphans options, node size/link thickness/forces controls; simulation engine rewritten in v0.9.2 for performance and battery; query-based colour groups in v0.11.0 — [Obsidian changelog 0.9.0](https://obsidian.md/changelog/2020-09-21-desktop-v0.9.0/); [0.9.2](https://obsidian.md/changelog/2020-09-30-desktop-v0.9.2?lang=zh); [0.11.0](https://obsidian.md/changelog/2021-02-09-desktop-v0.11.0)
- Obsidian 2026 releases focus elsewhere (v1.12.0, 10 Feb 2026: CLI, Bases search button, attachment deletion prompt, resizable images) — [Obsidian changelog 1.12.0](https://obsidian.md/sv/changelog/2026-02-10-desktop-v1.12.0/)
- Obsidian forum "Design talk about the Graph View": requests include a "Functional Local Graph for the Big Graph", timelapse speed/pause controls, timelapse as loading screen — [forum thread](https://forum.obsidian.md/t/design-talk-about-the-graph-view/22594?page=2); [post 32](https://forum.obsidian.md/t/design-talk-about-the-graph-view/22594/32); [post 60](https://forum.obsidian.md/t/design-talk-about-the-graph-view/22594/60)
- Obsidian users also want the graph to react to activity ("Open Files are Highlighted") — [forum](https://forum.obsidian.md/t/make-graph-view-react-to-obsidian-activity-open-files-are-highlighted/3424/25)
- InfraNodus: interactive graph with filtering, drill into themes, read excerpts behind nodes; GraphRAG focus on selected concepts; Obsidian graph-view plugin and MCP server listed; EU-hosted; from €19/month in one 2025 review (€12 in a directory listing) — [InfraNodus text visualization tools](https://infranodus.com/docs/text-visualization-tools); [Towards Data Science review](https://towardsdatascience.com/infranodus-excellent-tool-for-textual-data-analysis-2b4839e6cd10/); [fitgap listing](https://us.fitgap.com/products/infranodus)
- Kumu: point-and-click data-driven decorations (size, colour, line thickness) plus a CSS-like selector language; focus mode; community detection with bridges — [Kumu tour](https://kumu.io/tour); [Kumu data-driven decorations](https://docs.kumu.io/guides/decorate/data-driven-decorations); [Kumu selector reference](https://docs.kumu.io/overview/advanced-editor-hub/selector-reference)
- Connected Papers vs Litmaps vs ResearchRabbit: single-seed cleanliness vs time-axis + multi-seed filters vs iterative discovery modes + Zotero sync — [Ponder.ing](https://ponder.ing/blog/connected-papers-alternatives); [Sourcely May 2026](https://www.sourcely.net/resources/research-rabbit-vs-connected-papers-tool-finds-related-studies); [Aaron Tay](https://aarontay.substack.com/p/researchrabbits-2025-revamp-iterative)
- Neo4j Bloom 2.37.0 (23 Sep 2026) on NVL 2.0.0; Explore in Aura/Desktop — [Bloom 2.37.0](https://neo4j.com/release-notes/bloom/bloom-2370/); [Neo4j feedback](https://aura.feedback.neo4j.com/desktop-v2/p/in-neo4j-desktop-for-mac-it-says-explore-instead-of-bloom-if-you-are-advertising)
- Zep: Graph Explorer per user/group page; Graphiti temporal graph; validity intervals per edge — [Zep Q1 2025](https://blog.getzep.com/zep-q1-2025-product-round-up/); [Zep graph overview](https://help.getzep.com/v3/graph-overview)
- Mem0: hosted graph on Pro/Enterprise; OSS graph memory on Neo4j; a third-party `mem0-graph` visualiser exists — [Mem0 platform graph memory](https://docs.mem0.ai/platform/features/graph-memory.md); [Mem0 OSS graph memory](https://docs.mem0.ai/open-source/graph-memory); [mem0-graph](https://awesome.ecosyste.ms/projects/github.com%2Frangzen%2Fmem0-graph)
- Cosmograph demos/app: 2.x adds DuckDB-backed data prep, multi-target node selection, point shapes/images — [Cosmograph What's new](https://cosmograph.app/docs-general/whats-new/)

### Inferences
- The BoardRoom graph should default to a **local graph with depth control** around the active goal/project/decision (the Obsidian and Kumu pattern), with the global view as a secondary "map" mode; this matches the CLAUDE.md goal "Active goals → linked projects → critical path tasks → involved people".
- A Litmaps-style **timeline layout** (x = time, y = type lane or community) is a natural alternative view for decisions and commitments, because every entity has timestamps and the product is about decisions over time.
- Kumu-style **rule-based decorations** (user-defined "colour nodes where status=blocked red") can be implemented as saved facet rules; this is how Obsidian groups and Neo4j Bloom rule styling work.

### Gaps
- GitHub "Code graph", Palantir, Arc/Notion AI views: no reliable 2026 sources found in this session; omitted rather than speculated.
- No fetched first-hand description of InfraNodus/Kumu/Neo4j UI details beyond marketing/doc excerpts.

---

## KQ5 — Colour and accessibility

### Takeaway
Use an 8-colour CVD-safe categorical set (Okabe-Ito or Paul Tol "bright"/"vibrant"/"muted") with black swapped for a light tone on dark backgrounds, keep the existing shape+colour redundancy, add label halos, and honour `prefers-reduced-motion`. Keyboard navigation (Tab between nodes, arrows across edges, +/- zoom) and a table alternative are the accepted accessibility baseline for graphs.

### Cited Findings
- Okabe-Ito: 8 colours "distinguishable for people with all common types of color vision deficiency": #E69F00, #56B4E9, #009E73, #F0E442, #0072B2, #D55E00, #CC79A7, #000000 — [ConceptViz Okabe-Ito reference](https://dev.conceptviz.app/fr/blog/okabe-ito-palette-hex-codes-complete-reference)
- amCharts ships `ColorblindTheme` extended by `ColorblindDarkTheme`, reordered so the first series is a hue and black is kept for later series — [amCharts v5 docs](https://www.amcharts.com/docs/v5/?p=405240)
- Paul Tol: "the bright, contrast, vibrant and muted color schemes are color-blind safe"; bright max 7, vibrant max 7, muted max 9/10; "qualitative color schemes must be used as given (no interpolation)"; pale and dark schemes "are not very distinct … should be used as a text background" — [khroma vignette (Tol)](https://www.stats.bris.ac.uk/R/web/packages/khroma/vignettes/tol.html); [USGS on Tol colours](https://waterdata.usgs.gov/blog/tolcolors)
- IBM 8-colour accessible palette: #648FFF, #785EF0, #DC267F, #FE6100, #FFB000 plus black/white/grey — [ADA infographic palettes reference](https://cdn.jsdelivr.net/npm/@saibolla/ada@0.1.3/skills/infographics/references/color_palettes.md)
- KeyLines accessibility guide covers keyboard navigation, screen reader support, colour and contrast, text/icon clarity and animation safety per WCAG/Section 508 — [Cambridge Intelligence](https://cambridge-intelligence.com/build-accessible-data-visualization-apps-with-keylines/)
- Data Navigator (IEEE VIS 2023): many visualizations "lack an underlying navigable structure, fail to engage necessary input modalities, and rely heavily on visual-only rendering practices"; toolkit builds navigable graphs with screen reader, keyboard and speech input — [IEEE VIS 2023](https://virtual.ieeevis.org/year/2023/paper_v-full-1580.html)
- MIT "Benthic": screen-reader traversal via hypergraph structure at multiple levels of detail — [MIT DSpace](https://dspace.mit.edu/handle/1721.1/156821?show=full)
- Oracle Graph Visualization Toolkit 26.3.0 ACR: Tab/Shift+Tab across elements, arrows between adjacent nodes/edges, +/- zoom; "charts should have a text alternative, such as a data table" — [Oracle ACR](https://www.oracle.com/anz/corporate/accessibility/templates/t2-19397.html)
- W3C SVG a11y thread (2015): "there is no good way for a AT user to work their way through large network diagrams"; suggests breadcrumb labels and a table view — [W3C lists](https://lists.w3.org/Archives/Public/public-svg-a11y/2015Oct/0016.html)
- Edge-direction encodings differ significantly in performance and preference (PacificVis 2011 study of five directed-edge representations; tapered edges evaluated) — [TU/e tapered edges evaluation](https://research.tue.nl/en/publications/an-extended-evaluation-of-the-readability-of-tapered-animated-and/)

### Inferences
- For six to eight node types (memory, person, goal, project, task, decision, + commitment/pattern), Okabe-Ito minus black (7 hues) or Tol "muted" (9) are the safest; derive dark-mode variants by lightening L* rather than changing hue, and validate contrast against the dark canvas. Keep the existing per-type shapes (already in `graph-theme.ts`) so colour is never the sole channel.
- Label halos (stroke behind text in canvas) are standard for readability over edges; the repo's "text fade threshold"-style label alpha should keep halos at full alpha ratio.
- Accessibility baseline achievable at Effort S: an off-canvas list/table of visible nodes (role=listbox) that mirrors selection, arrow-key neighbour traversal from the selected node, and live-region announcements of "X, project, 5 links".

### Gaps
- No source directly validated an 8-colour palette on dark backgrounds; needs a local CVD simulator check (the dataviz skill in this repo has a validator).
- WCAG 2.2 text specific to node-link diagrams was not found; only vendor and research guidance.

---

## KQ6 — Critiques of force graphs ("hairballs") and what to do instead

### Takeaway
Published critiques agree hairballs are a density + interpretation problem: force layouts manufacture visible "clusters" that may be artefacts, and users read different things from the same large node-link picture. The remedies with evidence are: show less (filter, local graph, degree/centrality-driven emphasis), add structure (communities, visual summaries, matrices for dense subgraphs), and combine with lists/tables rather than relying on the picture alone — while noting that for ≤ moderate density node-link still beats matrices in a 600-participant study.

### Cited Findings
- Skewed.de (Tiago Peixoto): network visualization "is often done in the wrong way: first a network layout is produced using a heuristic, and then follow-up analyses are performed"; clustering patterns seen in a layout "may be artifacts of the layout algorithm or of human pattern-seeking"; proposes statistical inference (SBMs) first — [skewed.de hairball post](https://skewed.de/lab/posts/hairball/)
- Downes commentary: "a pattern in the layout may reflect the layout algorithm rather than the underlying data"; counterpoint that hairball-avoiding methods "don't address community structure" — [downes.ca](https://www.downes.ca/post/56776/rd)
- Cambridge Intelligence "How to fix hairballs": focus on entities analysts care about; derive relationships/metrics such as betweenness centrality to reveal key structures (plus filtering, grouping, time bar) — [cambridge-intelligence.com/how-to-fix-hairballs](https://cambridge-intelligence.com/how-to-fix-hairballs/); [fixing data hairballs](https://cambridge-intelligence.com/?p=24339)
- Ma & Muelder survey: alternatives include treemaps, space-filling curves, semantic substrates, centrality-based methods — [Computer, June 2013 summary](https://tm.durusau.net/?p=54406)
- Masaryk University: graph views fail "when everything is connected to everything else"; "creating nodes and edges from everything does not always make sense" — [CEDRR article](https://religionistika.phil.muni.cz/cedrr/news/articles/407147u-why-is-the-graph-visualisation-not-always-an-ideal-way-to-display-network-data)
- Mahfuza, Mondal & Gutwin (GI 2025): "the information perceived from traditional node-link representations can vary substantially, especially when the nodes are uniformly distributed rather than forming clusters"; visual summaries improve interpretation — [GI25 slides](https://www.cs.usask.ca/faculty/dmondal/Presentations/GI25-2.pdf)
- N=600 study: "understanding was best for the node-link visualization, with higher accuracy and faster task times than the two matrix visualizations" — [arXiv 2303.17066](https://www.arxiv.org/abs/2303.17066)
- Hyperlink-connectivity study: non-experts found node-link diagrams "easy to understand and helpful", animated edges helped follow connections — [arXiv 2210.00160](https://arxiv.org/pdf/2210.00160)
- Huang eye-tracking: "in some situations, edge crossings may not be as bad as we normally think" — [NSF PAR](https://par.nsf.gov/biblio/10146467)
- Obsidian users themselves ask for a "Functional Local Graph for the Big Graph" because the global graph is not actionable — [forum design talk p2](https://forum.obsidian.md/t/design-talk-about-the-graph-view/22594?page=2)

### Inferences
- The right default for BoardRoom is **list + local graph** (inspector list of neighbours sorted by edge type/recency beside a depth-limited graph), with the global map as an opt-in "overview" that is only ever shown with communities/hulls and LOD labels — never as a raw hairball.
- Centrality (degree, betweenness computed server-side or in a worker via Graphology metrics) should drive node size and label priority, which is also what the semantic-zoom literature prescribes.
- Because hairball "clusters" can be layout artefacts, cluster membership should come from Louvain/embedding similarity and be *drawn* (hulls), not inferred visually.

### Gaps
- No Nielsen Norman Group article specifically on network diagrams surfaced in search.
- Full text of the skewed.de and Cambridge Intelligence pieces could not be fetched; findings rest on excerpts.

---

## (a) Library comparison table

### Takeaway
Sigma.js + Graphology is the best-fit upgrade path for a commercial React 19 SaaS at 1k–50k nodes; cosmos.gl/Cosmograph is the performance ceiling but licence-gated; staying on react-force-graph-2d with a worker layout and LOD is the cheapest credible option.

### Cited Findings
Table cells are drawn from the citations in KQ1; "n/v" = not verifiable this session.

| Library | Renderer / sim | Stated ceiling | React 19 | Licence | Maintenance signal (2026) | Built-ins relevant here | Main risk |
|---|---|---|---|---|---|---|---|
| react-force-graph-2d (current) | Canvas 2D; d3-force-3d (CPU) | "medium to large graphs"; no numbers ([GitHub](https://github.com/vasturiano/react-force-graph)) | Runs in this repo on React ^19 | MIT | 3.3k★, 218 open issues | `dagMode`, `zoomToFit`, custom canvas paint, particles | CPU sim + per-frame canvas paint caps at low thousands; labels/hit-testing cost |
| Sigma.js v3 (+ v4 beta) + Graphology | WebGL programs; layouts in Graphology (ForceAtlas2 worker, noverlap) | "tens of thousands of nodes and edges" ([v4 docs](https://v4.sigmajs.org/concepts/rendering/)) | via `react-sigma` (Sigma v3) ([GitHub](https://github.com/sim51/react-sigma)); range n/v | MIT | 12.2k★; v3/v4 sponsored ([GitHub](https://github.com/jacomyal/sigma.js)) | node-border/image/piechart programs, hover-dim pattern, Louvain, metrics | Custom shaders for shapes; v4 still beta |
| cosmos.gl | GPU sim + GPU draw (luma.gl/WebGL2) | "hundreds of thousands" ([GitHub](https://github.com/cosmosgl/graph)) | No wrapper; DIY | MIT | 1.3k★, 780 commits | cluster force, collision, rect/polygon select, drag | Labels/overlays DIY; Android/iOS WebGL caveats |
| Cosmograph (lib + React) | cosmos.gl + DuckDB/Mosaic | "millions of points and edges" (README 2.3.2) | `@cosmograph/react` | **CC-BY-NC-4.0**; commercial = contact ([licensing](https://cosmograph.app/licensing/)) | 2.0 Nov 2025 → 2.2 Apr 2026 ([What's new](https://cosmograph.app/docs-general/whats-new/)) | timeline/histogram, search, clusters, shapes/images | Licence cost/unknown price; vendor lock |
| AntV G6 v5 (+Graphin) | @antv/g: Canvas/SVG/WebGL; Rust/WebGPU layouts | no numbers; "GPU and Rust parallel" ([GitHub](https://github.com/antvis/G6)) | React nodes; Graphin wrapper | MIT | 12.3k★, 322 open issues | Hull, BubbleSets, minimap, timebar, 3D ext | Heavy framework; options churn v4→v5 |
| Cytoscape.js | Canvas; WebGL preview since 3.31 (Jan 2025) | no numbers; WebGL "experimental" ([blog](https://blog.js.cytoscape.org/2025/01/13/webgl-preview/)) | via react-cytoscapejs (n/v) | MIT | v3.34.0 Jun 2026 ([Zenodo](https://zenodo.org/records/891013/latest)) | bubblesets plugin, many layouts, compound nodes | WebGL incomplete; imperative API |
| Reagraph | Three.js / R3F WebGL | "high-performance" ([GitHub](https://github.com/reaviz/reagraph)) | React-first | Apache-2.0 | 1.1k★; push Mar 2026 ([mirror](https://gittrend.io/repo/reaviz/reagraph)) | path finding, clustering, lasso, edge bundling, radial/tree/3D | Heavy deps; small community |
| pixi-graph / ngraph.pixi | PixiJS | demo 15.7k nodes ([demo](https://github.com/RaleighHan/pixi-network-visualization)) | DIY | MIT (n/v) | "pre-release" / GC-heavy | none | Unmaintained risk |
| react-force-graph-3d / Three.js | WebGL 3D | n/v | same family | MIT | same repo | 3D, VR/AR | 3D hurts readability for KM tasks |
| Ogma / KeyLines / yFiles | WebGL commercial | vendor claims (n/v) | SDKs | Proprietary, quote-only ([Capterra Ogma](https://www.capterra.com/p/10011703/Ogma/)) | active | timelines, combos, a11y guide | Cost; overkill |

### Inferences
- Recommended path: **Sigma.js + Graphology** behind the existing `KnowledgeGraphViewHandle` interface, keeping `react-force-graph-2d` as the fallback renderer for small graphs or no-WebGL devices. Trigger a cosmos.gl spike only if tenant graphs exceed ~20k visible nodes.

### Gaps
- Bundle sizes, exact versions/dates of latest releases, and peer-dep ranges are unverified for every row (403/DNS failures on npm/jsDelivr).

---

## (b) Ranked top-10 highest-leverage upgrades

### Takeaway
Order by (visible improvement × searchability) ÷ effort, respecting BoardRoom rules (OmniMind owns data; Zod at boundaries; Haiku for cheap LLM calls).

### Cited Findings
Each item links back to the evidence above.

1. **Search spotlight wired to hybrid search** — ⌘K (cmdk) → `POST /memories/search` → highlight hits with score-scaled glow rings, dim rest, `zoomToFit(hits)`, "Filter" toggle to hide instead. Effort **S–M**. Risk: hits outside loaded subgraph (lazy-fetch 1-hop). Evidence: [Obsidian Enhanced graph search](https://forum.obsidian.md/t/enhanced-graph-search/113084); [Graph Type to Search](https://www.obsidianstats.com/plugins/graph-type-to-search); [Sigma hover-search](https://v4.sigmajs.org/how-to/interactivity/hover-search/); [shadcn Command](https://www.shadcn.io/ui/command)
2. **Local-graph-first with depth slider + neighbour list** — default to focus node + depth 1–3, inspector lists neighbours grouped by edge type; global map opt-in. Effort **S**. Risk: users expecting the "whole brain" view. Evidence: [Obsidian help](https://obsidian.md/help/plugins/graph); [Kumu focus](https://sites.duke.edu/staineduniversity/smoke-and-mirrors-duke-university-the-tobacco-industry-and-entanglements-in-scientific-research/smoke-and-mirrors-map-information-guide/); [GI 2025 readability](https://www.cs.usask.ca/faculty/dmondal/Presentations/GI25-2.pdf)
3. **Server-side facets (type, tenant, date range, status, tags) as query params** so the client never renders more than the ceiling; animated diff on change. Effort **M**. Risk: API contract churn (update `docs/contracts/`). Evidence: [Linkurious filters/timelines](https://docs.amazonaws.cn/en_us/neptune/latest/userguide/visualization-Linkurious.md)
4. **Communities + hulls + cluster labels** — Louvain in a worker (Graphology), persist community ids, outline with `bubblesets`, one auto label per community. Effort **M**. Risk: non-determinism across runs; label quality. Evidence: [graphology-communities-louvain](https://unpkg.com/graphology-communities-louvain@2.0.2/README.md); [bubblesets](https://npmjs.org/package/bubblesets); [InfraNodus clusters](https://infranodus.com/use-case/text-network-analysis); [Kumu community detection](https://kumu.io/markets/network-mapping)
5. **Semantic zoom / LOD labels** — rank nodes by centrality×recency, show a label only if its box does not collide with higher-ranked labels at current zoom; aggregate edges below a zoom threshold. Effort **S–M**. Risk: label flicker at zoom boundaries (hysteresis). Evidence: [rtopmap](https://arxiv.org/pdf/1706.04979); [Multi-level tree semantic zoom](https://cs.paperswithcode.com/paper/multi-level-tree-based-approach-for)
6. **Renderer upgrade to Sigma.js + Graphology (WebGL)** behind the current handle interface, keep canvas fallback. Effort **L**. Risk: custom shape programs, v4 beta churn, React 19 binding verification. Evidence: [sigma.js](https://github.com/jacomyal/sigma.js); [react-sigma](https://github.com/sim51/react-sigma)
7. **Time-lapse / timeline slicer** — date scrubber that grows the graph by `createdAt`, plus a Litmaps-style "time axis" layout mode for decisions/commitments. Effort **S** (scrubber) / **M** (axis layout). Risk: layout thrash on scrub (freeze positions, fade in). Evidence: [Obsidian time-lapse](https://obsidian.md/help/plugins/graph); [Litmaps time axis](https://www.sourcely.net/resources/research-rabbit-vs-connected-papers-tool-finds-related-studies); [Cosmograph timeline](https://next.cosmograph.app/docs/lib/components/histogram)
8. **Embedding "semantic map" mode** — server-side UMAP of memory embeddings cached per tenant; force only within clusters; toggle between topology and semantic layouts. Effort **M–L**. Risk: positions shift on recompute; axes uninterpretable. Evidence: [UMAP as graph layout](https://arxiv.org/pdf/2107.01887); [Stanford CESTA + Cosmograph](https://cesta.stanford.edu/news/seeing-shape-knowledge-network-graphs-text-embeddings-and-cosmograph)
9. **"Explain this neighbourhood" + "Ask the graph"** — Haiku summarises the selected k-hop subgraph and proposes follow-ups; NL → Zod-validated structured filter (not free Cypher). Effort **M**. Risk: cost/latency and hallucinated filters (constrain to schema, show the generated filter chips). Evidence: [Text2Cypher limits](https://arxiv.org/html/2412.10064v1); [InfraNodus GraphRAG focus](https://infranodus.com/docs/text-visualization-tools)
10. **Path finding, history and accessibility baseline** — shortest path between two picked nodes (BFS over typed edges, highlighted), back/forward focus history, Tab/arrow keyboard traversal, off-canvas node table, CVD-safe palette (Okabe-Ito without black / Tol muted) with halos and reduced-motion. Effort **S–M**. Risk: palette change needs design review across themes. Evidence: [Reagraph path finding](https://github.com/reaviz/reagraph); [Oracle keyboard model](https://www.oracle.com/anz/corporate/accessibility/templates/t2-19397.html); [Okabe-Ito](https://dev.conceptviz.app/fr/blog/okabe-ito-palette-hex-codes-complete-reference); [Tol schemes](https://www.stats.bris.ac.uk/R/web/packages/khroma/vignettes/tol.html); [Data Navigator](https://virtual.ieeevis.org/year/2023/paper_v-full-1580.html)

### Inferences
- Items 1–5 and 7 and 10 are achievable on the existing `react-force-graph-2d` stack and should ship first; item 6 (renderer swap) is the gate for scaling beyond a few thousand visible nodes and should be preceded by a benchmark on real tenant data; item 8 depends on an OmniMind endpoint returning cached 2D projections (OmniMind owns data; client must not compute UMAP on raw embeddings).
- Deliberately *not* recommended: edge bundling (hides typed-edge identity; WebGL implementations are research code), 3D/VR modes (no readability evidence for KM tasks), and raw global hairball as default.

### Gaps
- No A/B or usability data exists for this specific product; the ranking is an inference from the cited sources plus the repo's constraints, and should be validated with a quick user test on items 1–2 before investing in 6 or 8.
