import { useEffect, useRef, useState } from 'react';
import type { GraphData, GraphNode, GraphEdge } from '../../hooks/useRelationshipData';
import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3-force';

// D3 simulation extends our nodes with x/y/vx/vy
interface SimNode extends GraphNode, SimulationNodeDatum {}

interface SimEdge extends SimulationLinkDatum<SimNode> {
  weight: number;
  type: string;
}

// Domain colors (match Tailwind persona colors)
const DOMAIN_COLORS: Record<string, string> = {
  business: '#3b82f6',
  personal: '#22c55e',
  ministry: '#a855f7',
  'ai-systems': '#06b6d4',
  default: '#6b7280',
};

export function RelationshipGraph({ data, compact }: { data: GraphData; compact?: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const height = compact ? 300 : 500;

  useEffect(() => {
    if (!svgRef.current || !data.nodes.length) return;

    // Dynamic import D3 modules
    Promise.all([
      import('d3-force'),
      import('d3-selection'),
      import('d3-zoom'),
    ]).then(([d3Force, d3Selection, d3Zoom]) => {
      const width = svgRef.current!.clientWidth;
      const svg = d3Selection.select(svgRef.current);
      svg.selectAll('*').remove(); // clear previous

      // Deep-copy nodes and edges so D3 can mutate them
      const simNodes: SimNode[] = data.nodes.map(n => ({ ...n }));
      const simEdges: SimEdge[] = data.edges.map(e => ({ ...e }));

      // Create force simulation
      const simulation = d3Force.forceSimulation<SimNode>(simNodes)
        .force('link', d3Force.forceLink<SimNode, SimEdge>(simEdges).id(d => d.id).distance(100))
        .force('charge', d3Force.forceManyBody().strength(-200))
        .force('center', d3Force.forceCenter(width / 2, height / 2))
        .force('collision', d3Force.forceCollide<SimNode>().radius(d => d.size + 5));

      // Add zoom
      const g = svg.append('g');
      // @ts-expect-error — D3 zoom generic mismatch with SVG selection
      svg.call(d3Zoom.zoom().scaleExtent([0.3, 3]).on('zoom', (event: d3Zoom.D3ZoomEvent<SVGSVGElement, unknown>) => {
        g.attr('transform', event.transform.toString());
      }));

      // Draw edges
      const links = g.selectAll('line').data(simEdges).join('line')
        .attr('stroke', '#4b5563').attr('stroke-width', (d: SimEdge) => d.weight).attr('opacity', 0.6);

      // Draw nodes
      const nodes = g.selectAll<SVGGElement, SimNode>('g.node').data(simNodes).join('g')
        .attr('class', 'node')
        .style('cursor', 'pointer')
        .on('click', (_: MouseEvent, d: SimNode) => setSelectedNode(d));

      // Person = circle, Project = rect
      nodes.each(function (this: SVGGElement, d: SimNode) {
        const el = d3Selection.select(this);
        const color = DOMAIN_COLORS[d.domain] ?? DOMAIN_COLORS.default;
        if (d.type === 'person') {
          el.append('circle').attr('r', d.size).attr('fill', color).attr('opacity', 0.8);
        } else {
          el.append('rect').attr('width', d.size * 2).attr('height', d.size * 1.5)
            .attr('x', -d.size).attr('y', -d.size * 0.75)
            .attr('fill', color).attr('opacity', 0.8).attr('rx', 4);
        }
        el.append('text').text(d.label).attr('dy', d.size + 15)
          .attr('text-anchor', 'middle').attr('fill', '#d1d5db').attr('font-size', 11);
      });

      // Simulation tick — after simulation runs, source/target are SimNode objects
      simulation.on('tick', () => {
        links
          .attr('x1', d => (d.source as SimNode).x ?? 0)
          .attr('y1', d => (d.source as SimNode).y ?? 0)
          .attr('x2', d => (d.target as SimNode).x ?? 0)
          .attr('y2', d => (d.target as SimNode).y ?? 0);
        nodes.attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`);
      });

      // Cleanup
      return () => {
        simulation.stop();
      };
    });
  }, [data, height]);

  return (
    <div className="bg-card rounded-lg p-4">
      <svg ref={svgRef} className="w-full" style={{ height }} />
      {selectedNode && !compact && (
        <div className="mt-4 p-3 bg-card rounded-lg">
          <p className="text-foreground font-medium">{selectedNode.label}</p>
          <p className="text-muted-foreground text-sm">{selectedNode.type} &bull; {selectedNode.domain || 'no domain'}</p>
        </div>
      )}
    </div>
  );
}
