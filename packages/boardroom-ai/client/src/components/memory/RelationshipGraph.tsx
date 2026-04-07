import { useEffect, useRef, useState } from 'react';
import type { GraphData, GraphNode } from '../../hooks/useRelationshipData';

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
      const simNodes = data.nodes.map(n => ({ ...n }));
      const simEdges = data.edges.map(e => ({ ...e }));

      // Create force simulation
      const simulation = d3Force.forceSimulation(simNodes as any)
        .force('link', d3Force.forceLink(simEdges as any).id((d: any) => d.id).distance(100))
        .force('charge', d3Force.forceManyBody().strength(-200))
        .force('center', d3Force.forceCenter(width / 2, height / 2))
        .force('collision', d3Force.forceCollide().radius((d: any) => d.size + 5));

      // Add zoom
      const g = svg.append('g');
      svg.call(d3Zoom.zoom().scaleExtent([0.3, 3]).on('zoom', (event: any) => {
        g.attr('transform', event.transform);
      }) as any);

      // Draw edges
      const links = g.selectAll('line').data(simEdges).join('line')
        .attr('stroke', '#4b5563').attr('stroke-width', (d: any) => d.weight).attr('opacity', 0.6);

      // Draw nodes
      const nodes = g.selectAll('g.node').data(simNodes).join('g')
        .attr('class', 'node')
        .style('cursor', 'pointer')
        .on('click', (_: any, d: any) => setSelectedNode(d));

      // Person = circle, Project = rect
      nodes.each(function (this: SVGGElement, d: any) {
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

      // Simulation tick
      simulation.on('tick', () => {
        links.attr('x1', (d: any) => d.source.x).attr('y1', (d: any) => d.source.y)
          .attr('x2', (d: any) => d.target.x).attr('y2', (d: any) => d.target.y);
        nodes.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
      });

      // Cleanup
      return () => {
        simulation.stop();
      };
    });
  }, [data, height]);

  return (
    <div className="bg-gray-900 rounded-lg p-4">
      <svg ref={svgRef} className="w-full" style={{ height }} />
      {selectedNode && !compact && (
        <div className="mt-4 p-3 bg-gray-800 rounded-lg">
          <p className="text-white font-medium">{selectedNode.label}</p>
          <p className="text-gray-400 text-sm">{selectedNode.type} &bull; {selectedNode.domain || 'no domain'}</p>
        </div>
      )}
    </div>
  );
}
