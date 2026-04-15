import type { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';

export interface GraphTraversalOptions {
  maxDepth?: number;
  relationshipTypes?: string[];
  minConfidence?: number;
  direction?: 'outgoing' | 'incoming' | 'both';
  excludeEntityTypes?: string[];
  includeEntityTypes?: string[];
  limit?: number;
}

export interface GraphPath {
  sourceEntityId: string;
  targetEntityId: string;
  targetEntityName: string;
  targetEntityType: string;
  relationshipPath: string[];
  pathIds: string[];
  totalDistance: number;
  pathConfidence: number;
  relationshipTypes: string[];
  pathDescription: string;
}

export interface ShortestPathResult {
  pathFound: boolean;
  path?: GraphPath;
  totalPathsExplored: number;
  searchTimeMs: number;
  explanation?: string;
}

export interface GraphQueryResult {
  entities: Array<{
    id: string;
    name: string;
    type: string;
    degree: number; // Number of connections
    centrality: number; // Importance in graph
    clusterId?: string; // Community detection
  }>;
  relationships: Array<{
    sourceId: string;
    targetId: string;
    type: string;
    confidence: number;
    strength: number;
    evidenceCount: number;
  }>;
  metrics: {
    totalEntities: number;
    totalRelationships: number;
    averageDegree: number;
    density: number;
    diameter: number;
    averagePathLength: number;
  };
}

export class GraphTraversalService {
  private prisma: PrismaClient;
  
  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }
  
  /**
   * Find entities related to a source entity with advanced graph traversal
   * Uses PostgreSQL recursive CTE with configurable depth and filters
   */
  async findRelatedEntities(
    sourceEntityId: string,
    options: GraphTraversalOptions = {}
  ): Promise<GraphPath[]> {
    const {
      maxDepth = 3,
      relationshipTypes = null,
      minConfidence = 0.5,
      direction = 'both',
      excludeEntityTypes = [],
      includeEntityTypes = [],
      limit = 50
    } = options;
    
    try {
      // Convert arrays to PostgreSQL array format
      const relTypesArray = relationshipTypes && relationshipTypes.length > 0 
        ? `ARRAY[${relationshipTypes.map(t => `'${t}'`).join(',')}]::TEXT[]`
        : 'NULL';
      
      const excludeTypesArray = excludeEntityTypes.length > 0
        ? `ARRAY[${excludeEntityTypes.map(t => `'${t}'`).join(',')}]::TEXT[]`
        : 'NULL';
      
      const includeTypesArray = includeEntityTypes.length > 0
        ? `ARRAY[${includeEntityTypes.map(t => `'${t}'`).join(',')}]::TEXT[]`
        : 'NULL';
      
      // Build direction filter
      let directionFilter = '';
      if (direction === 'outgoing') {
        directionFilter = 'AND er.source_entity_id = eg.id';
      } else if (direction === 'incoming') {
        directionFilter = 'AND er.target_entity_id = eg.id';
      }
      
      // Build entity type filters
      let entityTypeFilter = '';
      if (excludeEntityTypes.length > 0) {
        entityTypeFilter += `AND CASE WHEN eg.id = er.source_entity_id THEN te.entity_type ELSE se.entity_type END != ALL(${excludeTypesArray})`;
      }
      if (includeEntityTypes.length > 0) {
        entityTypeFilter += `AND CASE WHEN eg.id = er.source_entity_id THEN te.entity_type ELSE se.entity_type END = ANY(${includeTypesArray})`;
      }
      
      const query = `
        WITH RECURSIVE entity_graph AS (
          -- Base case: source entity
          SELECT 
            e.id,
            e.entity_name,
            e.entity_type,
            ARRAY[e.entity_name]::TEXT[] as path_names,
            ARRAY[e.id::text]::TEXT[] as path_ids,
            ARRAY[]::TEXT[] as rel_types,
            0 as depth,
            1.0 as path_confidence
          FROM extracted_entities e
          WHERE e.id = $1::UUID
          
          UNION ALL
          
          -- Recursive case: traverse relationships with advanced filters
          SELECT 
            CASE 
              WHEN eg.id = er.source_entity_id THEN er.target_entity_id
              ELSE er.source_entity_id
            END as id,
            CASE 
              WHEN eg.id = er.source_entity_id THEN te.entity_name
              ELSE se.entity_name
            END as entity_name,
            CASE 
              WHEN eg.id = er.source_entity_id THEN te.entity_type
              ELSE se.entity_type
            END as entity_type,
            CASE 
              WHEN eg.id = er.source_entity_id THEN eg.path_names || te.entity_name
              ELSE eg.path_names || se.entity_name
            END as path_names,
            CASE 
              WHEN eg.id = er.source_entity_id THEN eg.path_ids || te.id::text
              ELSE eg.path_ids || se.id::text
            END as path_ids,
            eg.rel_types || er.relationship_type as rel_types,
            eg.depth + 1 as depth,
            eg.path_confidence * er.confidence_score as path_confidence
          FROM entity_graph eg
          JOIN entity_relationships er ON (
            er.source_entity_id = eg.id OR er.target_entity_id = eg.id
          )
          JOIN extracted_entities se ON er.source_entity_id = se.id
          JOIN extracted_entities te ON er.target_entity_id = te.id
          WHERE eg.depth < $2
            AND er.confidence_score >= $3
            ${directionFilter}
            ${entityTypeFilter}
            AND ($4::TEXT[] IS NULL OR er.relationship_type = ANY($4::TEXT[]))
            -- Avoid cycles
            AND NOT (
              CASE 
                WHEN eg.id = er.source_entity_id THEN te.id::text
                ELSE se.id::text
              END = ANY(eg.path_ids)
            )
        )
        SELECT 
          eg.id as entity_id,
          eg.entity_name,
          eg.entity_type,
          eg.path_names as relationship_path,
          eg.path_ids,
          eg.depth as total_distance,
          eg.path_confidence,
          eg.rel_types as relationship_types
        FROM entity_graph eg
        WHERE eg.depth > 0
        ORDER BY eg.path_confidence DESC, eg.depth
        LIMIT $5
      `;
      
      const results = await this.prisma.$queryRaw<any[]>(query, [
        sourceEntityId,
        maxDepth,
        minConfidence,
        relationshipTypes,
        limit
      ]);
      
      return results.map(row => ({
        sourceEntityId,
        targetEntityId: row.entity_id,
        targetEntityName: row.entity_name,
        targetEntityType: row.entity_type,
        relationshipPath: row.relationship_path,
        pathIds: row.path_ids,
        totalDistance: row.total_distance,
        pathConfidence: row.path_confidence,
        relationshipTypes: row.relationship_types || [],
        pathDescription: this.buildPathDescription(row.relationship_path, row.relationship_types)
      }));
      
    } catch (error) {
      logger.error('Graph traversal failed', {
        error: error instanceof Error ? error.message : String(error),
        sourceEntityId,
        options
      });
      throw new Error(`Graph traversal failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Find shortest path between two entities using breadth-first search pattern
   */
  async findShortestPath(
    sourceEntityId: string,
    targetEntityId: string,
    options: GraphTraversalOptions = {}
  ): Promise<ShortestPathResult> {
    const startTime = Date.now();
    const {
      maxDepth = 5,
      relationshipTypes = null,
      minConfidence = 0.5
    } = options;
    
    try {
      const query = `
        WITH RECURSIVE entity_graph AS (
          -- Base case: source entity
          SELECT 
            e.id,
            e.entity_name,
            e.entity_type,
            ARRAY[e.entity_name]::TEXT[] as path_names,
            ARRAY[e.id::text]::TEXT[] as path_ids,
            ARRAY[]::TEXT[] as rel_types,
            0 as depth,
            1.0 as path_confidence
          FROM extracted_entities e
          WHERE e.id = $1::UUID
          
          UNION ALL
          
          -- Recursive BFS traversal
          SELECT 
            CASE 
              WHEN eg.id = er.source_entity_id THEN er.target_entity_id
              ELSE er.source_entity_id
            END as id,
            CASE 
              WHEN eg.id = er.source_entity_id THEN te.entity_name
              ELSE se.entity_name
            END as entity_name,
            CASE 
              WHEN eg.id = er.source_entity_id THEN te.entity_type
              ELSE se.entity_type
            END as entity_type,
            CASE 
              WHEN eg.id = er.source_entity_id THEN eg.path_names || te.entity_name
              ELSE eg.path_names || se.entity_name
            END as path_names,
            CASE 
              WHEN eg.id = er.source_entity_id THEN eg.path_ids || te.id::text
              ELSE eg.path_ids || se.id::text
            END as path_ids,
            eg.rel_types || er.relationship_type as rel_types,
            eg.depth + 1 as depth,
            eg.path_confidence * er.confidence_score as path_confidence
          FROM entity_graph eg
          JOIN entity_relationships er ON (
            er.source_entity_id = eg.id OR er.target_entity_id = eg.id
          )
          JOIN extracted_entities se ON er.source_entity_id = se.id
          JOIN extracted_entities te ON er.target_entity_id = te.id
          WHERE eg.depth < $2
            AND er.confidence_score >= $3
            AND ($4::TEXT[] IS NULL OR er.relationship_type = ANY($4::TEXT[]))
            -- Avoid cycles
            AND NOT (
              CASE 
                WHEN eg.id = er.source_entity_id THEN te.id::text
                ELSE se.id::text
              END = ANY(eg.path_ids)
            )
            -- Stop if we found the target
            AND NOT EXISTS (
              SELECT 1 FROM entity_graph eg2 
              WHERE eg2.id = $5::UUID
            )
        )
        SELECT 
          eg.id as entity_id,
          eg.entity_name,
          eg.entity_type,
          eg.path_names as relationship_path,
          eg.path_ids,
          eg.depth as total_distance,
          eg.path_confidence,
          eg.rel_types as relationship_types,
          (SELECT COUNT(*) FROM entity_graph) as total_paths_explored
        FROM entity_graph eg
        WHERE eg.id = $5::UUID
        ORDER BY eg.depth, eg.path_confidence DESC
        LIMIT 1
      `;
      
      const results = await this.prisma.$queryRaw<any[]>(query, [
        sourceEntityId,
        maxDepth,
        minConfidence,
        relationshipTypes,
        targetEntityId
      ]);
      
      const searchTimeMs = Date.now() - startTime;
      
      if (results.length === 0) {
        return {
          pathFound: false,
          totalPathsExplored: 0,
          searchTimeMs,
          explanation: `No path found within ${maxDepth} hops between entities`
        };
      }
      
      const row = results[0];
      const path: GraphPath = {
        sourceEntityId,
        targetEntityId: row.entity_id,
        targetEntityName: row.entity_name,
        targetEntityType: row.entity_type,
        relationshipPath: row.relationship_path,
        pathIds: row.path_ids,
        totalDistance: row.total_distance,
        pathConfidence: row.path_confidence,
        relationshipTypes: row.relationship_types || [],
        pathDescription: this.buildPathDescription(row.relationship_path, row.relationship_types)
      };
      
      return {
        pathFound: true,
        path,
        totalPathsExplored: Number(row.total_paths_explored) || 0,
        searchTimeMs,
        explanation: `Found path with ${row.total_distance} hops and confidence ${row.path_confidence.toFixed(3)}`
      };
      
    } catch (error) {
      logger.error('Shortest path search failed', {
        error: error instanceof Error ? error.message : String(error),
        sourceEntityId,
        targetEntityId,
        options
      });
      
      const searchTimeMs = Date.now() - startTime;
      return {
        pathFound: false,
        totalPathsExplored: 0,
        searchTimeMs,
        explanation: `Search failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
  
  /**
   * Analyze graph structure around an entity
   */
  async analyzeEntityGraph(
    entityId: string,
    radius: number = 2
  ): Promise<GraphQueryResult> {
    try {
      // Get all entities and relationships within radius
      const relatedEntities = await this.findRelatedEntities(entityId, {
        maxDepth: radius,
        direction: 'both',
        limit: 1000
      });
      
      // Extract unique entities
      const entityMap = new Map<string, { id: string; name: string; type: string; degree: number }>();
      
      // Add source entity
      const sourceEntity = await this.prisma.extractedEntity.findUnique({
        where: { id: entityId },
        select: { id: true, entityName: true, entityType: true }
      });
      
      if (sourceEntity) {
        entityMap.set(sourceEntity.id, {
          id: sourceEntity.id,
          name: sourceEntity.entityName,
          type: sourceEntity.entityType,
          degree: 0 // Will be calculated
        });
      }
      
      // Add related entities
      for (const path of relatedEntities) {
        if (!entityMap.has(path.targetEntityId)) {
          entityMap.set(path.targetEntityId, {
            id: path.targetEntityId,
            name: path.targetEntityName,
            type: path.targetEntityType,
            degree: 0
          });
        }
      }
      
      // Get relationships between these entities
      const entityIds = Array.from(entityMap.keys());
      const relationships = await this.prisma.entityRelationship.findMany({
        where: {
          OR: [
            { sourceEntityId: { in: entityIds } },
            { targetEntityId: { in: entityIds } }
          ],
          confidenceScore: { gte: 0.5 }
        },
        select: {
          sourceEntityId: true,
          targetEntityId: true,
          relationshipType: true,
          confidenceScore: true,
          relationshipStrength: true,
          evidenceCount: true
        }
      });
      
      // Update degrees
      for (const rel of relationships) {
        const source = entityMap.get(rel.sourceEntityId);
        const target = entityMap.get(rel.targetEntityId);
        
        if (source) source.degree++;
        if (target) target.degree++;
      }
      
      // Calculate centrality (simplified: degree centrality)
      const entities = Array.from(entityMap.values()).map(entity => ({
        ...entity,
        centrality: entity.degree / Math.max(1, entityMap.size - 1),
        clusterId: this.detectCommunity(entity.id, relationships, entityMap)
      }));
      
      // Calculate graph metrics
      const totalEntities = entities.length;
      const totalRelationships = relationships.length;
      const averageDegree = totalEntities > 0 
        ? entities.reduce((sum, e) => sum + e.degree, 0) / totalEntities 
        : 0;
      
      // Density: actual edges / possible edges (undirected)
      const possibleEdges = totalEntities * (totalEntities - 1) / 2;
      const density = possibleEdges > 0 ? totalRelationships / possibleEdges : 0;
      
      return {
        entities,
        relationships: relationships.map(rel => ({
          sourceId: rel.sourceEntityId,
          targetId: rel.targetEntityId,
          type: rel.relationshipType,
          confidence: rel.confidenceScore,
          strength: rel.relationshipStrength,
          evidenceCount: rel.evidenceCount
        })),
        metrics: {
          totalEntities,
          totalRelationships,
          averageDegree,
          density,
          diameter: this.estimateDiameter(relatedEntities),
          averagePathLength: this.calculateAveragePathLength(relatedEntities)
        }
      };
      
    } catch (error) {
      logger.error('Graph analysis failed', {
        error: error instanceof Error ? error.message : String(error),
        entityId,
        radius
      });
      
      return {
        entities: [],
        relationships: [],
        metrics: {
          totalEntities: 0,
          totalRelationships: 0,
          averageDegree: 0,
          density: 0,
          diameter: 0,
          averagePathLength: 0
        }
      };
    }
  }
  
  /**
   * Find entities by relationship patterns
   */
  async findEntitiesByPattern(
    pattern: {
      sourceType?: string;
      targetType?: string;
      relationshipType?: string;
      minConfidence?: number;
    },
    options: GraphTraversalOptions = {}
  ): Promise<Array<{
    sourceEntity: { id: string; name: string; type: string };
    targetEntity: { id: string; name: string; type: string };
    relationship: { type: string; confidence: number; evidenceCount: number };
  }>> {
    const {
      sourceType,
      targetType,
      relationshipType,
      minConfidence = 0.5
    } = pattern;
    
    try {
      const whereConditions: any[] = [];
      const params: any[] = [];
      
      if (sourceType) {
        whereConditions.push('se.entity_type = $' + (params.length + 1));
        params.push(sourceType);
      }
      
      if (targetType) {
        whereConditions.push('te.entity_type = $' + (params.length + 1));
        params.push(targetType);
      }
      
      if (relationshipType) {
        whereConditions.push('er.relationship_type = $' + (params.length + 1));
        params.push(relationshipType);
      }
      
      whereConditions.push('er.confidence_score >= $' + (params.length + 1));
      params.push(minConfidence);
      
      const whereClause = whereConditions.length > 0 
        ? 'WHERE ' + whereConditions.join(' AND ')
        : '';
      
      const query = `
        SELECT 
          se.id as source_id,
          se.entity_name as source_name,
          se.entity_type as source_type,
          te.id as target_id,
          te.entity_name as target_name,
          te.entity_type as target_type,
          er.relationship_type,
          er.confidence_score,
          er.evidence_count
        FROM entity_relationships er
        JOIN extracted_entities se ON er.source_entity_id = se.id
        JOIN extracted_entities te ON er.target_entity_id = te.id
        ${whereClause}
        ORDER BY er.confidence_score DESC
        LIMIT ${options.limit || 100}
      `;
      
      const results = await this.prisma.$queryRaw<any[]>(query, params);
      
      return results.map(row => ({
        sourceEntity: {
          id: row.source_id,
          name: row.source_name,
          type: row.source_type
        },
        targetEntity: {
          id: row.target_id,
          name: row.target_name,
          type: row.target_type
        },
        relationship: {
          type: row.relationship_type,
          confidence: row.confidence_score,
          evidenceCount: row.evidence_count
        }
      }));
      
    } catch (error) {
      logger.error('Pattern search failed', {
        error: error instanceof Error ? error.message : String(error),
        pattern
      });
      return [];
    }
  }
  
  /**
   * Build human-readable path description
   */
  private buildPathDescription(pathNames: string[], relationshipTypes: string[]): string {
    if (pathNames.length < 2) return '';
    
    let description = pathNames[0];
    for (let i = 1; i < pathNames.length; i++) {
      const relType = relationshipTypes[i - 1] || 'related_to';
      const readableRel = relType.replace(/_/g, ' ');
      description += ` ${readableRel} ${pathNames[i]}`;
    }
    
    return description;
  }
  
  /**
   * Simple community detection using label propagation
   */
  private detectCommunity(
    entityId: string,
    relationships: any[],
    entityMap: Map<string, any>
  ): string {
    // Simplified community detection
    // In production, this would use a proper algorithm like Louvain
    const neighbors = relationships
      .filter(rel => rel.sourceEntityId === entityId || rel.targetEntityId === entityId)
      .map(rel => rel.sourceEntityId === entityId ? rel.targetEntityId : rel.sourceEntityId);
    
    if (neighbors.length === 0) return 'isolated';
    
    // Use the most connected neighbor's type as community indicator
    const neighborTypes = neighbors
      .map(id => entityMap.get(id)?.type)
      .filter(Boolean);
    
    if (neighborTypes.length === 0) return 'unknown';
    
    // Find most frequent neighbor type
    const typeCounts = neighborTypes.reduce((acc, type) => {
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    return Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])[0][0];
  }
  
  /**
   * Estimate graph diameter from paths
   */
  private estimateDiameter(paths: GraphPath[]): number {
    if (paths.length === 0) return 0;
    
    const maxDistance = Math.max(...paths.map(p => p.totalDistance));
    return maxDistance;
  }
  
  /**
   * Calculate average path length
   */
  private calculateAveragePathLength(paths: GraphPath[]): number {
    if (paths.length === 0) return 0;
    
    const totalDistance = paths.reduce((sum, p) => sum + p.totalDistance, 0);
    return totalDistance / paths.length;
  }
  
  /**
   * Get graph statistics for monitoring
   */
  async getGraphStatistics(userId?: string): Promise<{
    totalEntities: number;
    totalRelationships: number;
    entityTypes: Record<string, number>;
    relationshipTypes: Record<string, number>;
    averageConfidence: number;
    graphDensity: number;
    connectedComponents: number;
  }> {
    try {
      // Get entity statistics
      const entityStats = await this.prisma.extractedEntity.groupBy({
        by: ['entityType'],
        _count: { id: true },
        where: userId ? { userId } : undefined
      });
      
      // Get relationship statistics
      const relationshipStats = await this.prisma.entityRelationship.groupBy({
        by: ['relationshipType'],
        _count: { id: true },
        _avg: { confidenceScore: true },
        where: userId ? { userId } : undefined
      });
      
      const totalEntities = entityStats.reduce((sum, stat) => sum + stat._count.id, 0);
      const totalRelationships = relationshipStats.reduce((sum, stat) => sum + stat._count.id, 0);
      
      // Calculate average confidence
      const totalConfidence = relationshipStats.reduce(
        (sum, stat) => sum + (stat._avg.confidenceScore || 0) * stat._count.id, 
        0
      );
      const averageConfidence = totalRelationships > 0 ? totalConfidence / totalRelationships : 0;
      
      // Calculate graph density (simplified)
      const possibleEdges = totalEntities * (totalEntities - 1) / 2;
      const graphDensity = possibleEdges > 0 ? totalRelationships / possibleEdges : 0;
      
      return {
        totalEntities,
        totalRelationships,
        entityTypes: entityStats.reduce((acc, stat) => {
          acc[stat.entityType] = stat._count.id;
          return acc;
        }, {} as Record<string, number>),
        relationshipTypes: relationshipStats.reduce((acc, stat) => {
          acc[stat.relationshipType] = stat._count.id;
          return acc;
        }, {} as Record<string, number>),
        averageConfidence,
        graphDensity,
        connectedComponents: await this.countConnectedComponents(userId)
      };
      
    } catch (error) {
      logger.error('Failed to get graph statistics', { error });
      return {
        totalEntities: 0,
        totalRelationships: 0,
        entityTypes: {},
        relationshipTypes: {},
        averageConfidence: 0,
        graphDensity: 0,
        connectedComponents: 0
      };
    }
  }
  
  /**
   * Count connected components in the graph
   */
  private async countConnectedComponents(userId?: string): Promise<number> {
    try {
      // Simplified connected components count
      // In production, this would use a proper graph algorithm
      const query = `
        WITH RECURSIVE component_traversal AS (
          -- Start from each entity
          SELECT 
            e.id as start_id,
            e.id as current_id,
            ARRAY[e.id::text] as visited
          FROM extracted_entities e
          ${userId ? 'WHERE e.user_id = $1::UUID' : ''}
          
          UNION ALL
          
          -- Traverse relationships
          SELECT 
            ct.start_id,
            CASE 
              WHEN er.source_entity_id = ct.current_id THEN er.target_entity_id
              ELSE er.source_entity_id
            END as current_id,
            ct.visited || CASE 
              WHEN er.source_entity_id = ct.current_id THEN er.target_entity_id::text
              ELSE er.source_entity_id::text
            END
          FROM component_traversal ct
          JOIN entity_relationships er ON (
            er.source_entity_id = ct.current_id OR er.target_entity_id = ct.current_id
          )
          WHERE NOT (
            CASE 
              WHEN er.source_entity_id = ct.current_id THEN er.target_entity_id::text
              ELSE er.source_entity_id::text
            END = ANY(ct.visited)
          )
        )
        SELECT COUNT(DISTINCT start_id) as component_count
        FROM (
          SELECT DISTINCT start_id
          FROM component_traversal
        ) components
      `;
      
      const results = await this.prisma.$queryRaw<any[]>(
        query,
        userId ? [userId] : []
      );
      
      return Number(results[0]?.component_count) || 0;
      
    } catch (error) {
      logger.error('Failed to count connected components', { error });
      return 0;
    }
  }
}