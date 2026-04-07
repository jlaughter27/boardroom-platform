import { useState, useEffect } from 'react';
import * as api from '../lib/api';

export interface GraphNode {
  id: string;
  type: 'person' | 'project';
  label: string;
  size: number;
  domain: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  type: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function useRelationshipData() {
  const [data, setData] = useState<GraphData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    api.getRelationshipGraph().then((result) => {
      setData(result as GraphData);
      setIsLoading(false);
    }).catch(() => setIsLoading(false));
  }, []);

  return { data, isLoading, hasEnoughData: (data?.nodes?.length ?? 0) >= 3 };
}
