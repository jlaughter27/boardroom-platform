import type { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';
import { EntityExtractorService } from './entity-extractor.service';
import { queueEmbedding } from './embedding-queue';

/**
 * Mem0 Entity Extraction Pipeline Service
 * Implements Mem0's two-phase retrieval pipeline with LLM tool calls
 */
export class Mem0EntityPipeline {
  private prisma: PrismaClient;
  private entityExtractor: EntityExtractorService;
  
  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.entityExtractor = new EntityExtractorService(prisma, true);
  }
  
  /**
   * Mem0 Two-Phase Retrieval Pipeline
   * Phase 1: Extract entities from query using LLM tool calls
   * Phase 2: Hybrid search combining vector, graph, and BM25
   */
  async searchWithMem0Pipeline(
    userId: string,
    queryText: string,
    queryEmbedding: number[],
    options: {
      limit?: number;
      vectorWeight?: number;
      graphWeight?: number;
      bm25Weight?: number;
      minEntityConfidence?: number;
      minRelationshipConfidence?: number;
    } = {}
  ): Promise<{
    memories: any[];
    extractedEntities: any[];
    extractedRelationships: any[];
    explanation: string;
    pipelineMetrics: {
      extractionTimeMs: number;
      searchTimeMs: number;
      entitiesExtracted: number;
      relationshipsExtracted: number;
      memoriesRetrieved: number;
    };
  }> {
    const startTime = Date.now();
    
    const limit = options.limit || 20;
    const vectorWeight = options.vectorWeight || 0.4;
    const graphWeight = options.graphWeight || 0.3;
    const bm25Weight = options.bm25Weight || 0.3;
    const minEntityConfidence = options.minEntityConfidence || 0.7;
    const minRelationshipConfidence = options.minRelationshipConfidence || 0.6;
    
    try {
      // Phase 1: Extract entities from query using LLM tool calls
      const extractionStart = Date.now();
      const extractionResult = await this.entityExtractor.extractFromText(
        queryText,
        userId,
        { domain: 'search' }
      );
      
      const extractionTimeMs = Date.now() - extractionStart;
      
      // Filter entities and relationships by confidence thresholds
      const filteredEntities = extractionResult.entities.filter(
        e => e.confidence >= minEntityConfidence
      );
      const filteredRelationships = extractionResult.relationships.filter(
        r => r.confidence >= minRelationshipConfidence
      );
      
      // Store extracted entities in Mem0 tables
      const storedEntities = await this.storeExtractedEntities(
        userId,
        filteredEntities,
        queryText
      );
      
      // Phase 2: Hybrid search combining vector, graph, and BM25
      const searchStart = Date.now();
      
      // Use PostgreSQL hybrid_search function
      const searchResults = await this.prisma.$queryRaw<any[]>`
        SELECT 
          memory_id,
          title,
          content,
          relevance_score,
          vector_score,
          graph_score,
          bm25_score,
          explanation
        FROM hybrid_search(
          ${userId}::UUID,
          ${queryText},
          ${queryEmbedding}::vector,
          ${limit},
          ${vectorWeight},
          ${graphWeight},
          ${bm25Weight}
        )
      `;
      
      const searchTimeMs = Date.now() - searchStart;
      
      // Get full memory details for top results
      const memories = await this.prisma.memoryEntry.findMany({
        where: {
          id: { in: searchResults.map(r => r.memory_id) },
          userId,
          deletedAt: null,
        },
        select: {
          id: true,
          title: true,
          content: true,
          domain: true,
          tags: true,
          importance: true,
          createdAt: true,
          updatedAt: true,
          embedding: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      
      // Enhance memories with entity and relationship context
      const enhancedMemories = await this.enhanceWithEntityContext(memories, userId);
      
      const totalTimeMs = Date.now() - startTime;
      
      logger.info('Mem0 pipeline search completed', {
        userId,
        queryText,
        extractionTimeMs,
        searchTimeMs,
        totalTimeMs,
        entitiesExtracted: filteredEntities.length,
        relationshipsExtracted: filteredRelationships.length,
        memoriesRetrieved: memories.length,
        vectorWeight,
        graphWeight,
        bm25Weight,
      });
      
      return {
        memories: enhancedMemories,
        extractedEntities: storedEntities,
        extractedRelationships: filteredRelationships,
        explanation: searchResults[0]?.explanation || 'Mem0 hybrid search results',
        pipelineMetrics: {
          extractionTimeMs,
          searchTimeMs,
          entitiesExtracted: filteredEntities.length,
          relationshipsExtracted: filteredRelationships.length,
          memoriesRetrieved: memories.length,
        },
      };
      
    } catch (error) {
      logger.error('Mem0 pipeline search failed', {
        error: error instanceof Error ? error.message : String(error),
        userId,
        queryText,
      });
      
      // Fall back to simple semantic search
      const fallbackResults = await this.prisma.memoryEntry.findMany({
        where: {
          userId,
          deletedAt: null,
          status: { not: 'ARCHIVED' },
        },
        select: {
          id: true,
          title: true,
          content: true,
          domain: true,
          tags: true,
          importance: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
      
      return {
        memories: fallbackResults,
        extractedEntities: [],
        extractedRelationships: [],
        explanation: 'Fallback to simple retrieval (Mem0 pipeline failed)',
        pipelineMetrics: {
          extractionTimeMs: 0,
          searchTimeMs: Date.now() - startTime,
          entitiesExtracted: 0,
          relationshipsExtracted: 0,
          memoriesRetrieved: fallbackResults.length,
        },
      };
    }
  }
  
  /**
   * Store extracted entities in Mem0 tables
   */
  private async storeExtractedEntities(
    userId: string,
    entities: any[],
    sourceText: string
  ): Promise<any[]> {
    const storedEntities = [];
    
    for (const entity of entities) {
      // Check if entity already exists
      const existingEntity = await this.prisma.$queryRaw<any[]>`
        SELECT id FROM extracted_entities 
        WHERE entity_type = ${entity.type.toLowerCase()} 
          AND entity_name = ${entity.text}
      `;
      
      if (existingEntity.length > 0) {
        // Update existing entity
        await this.prisma.$queryRaw`
          UPDATE extracted_entities 
          SET 
            occurrence_count = occurrence_count + 1,
            last_seen_at = NOW(),
            updated_at = NOW()
          WHERE id = ${existingEntity[0].id}
        `;
        
        storedEntities.push({
          id: existingEntity[0].id,
          entity_type: entity.type.toLowerCase(),
          entity_name: entity.text,
          status: 'updated',
        });
      } else {
        // Create new entity
        const newEntity = await this.prisma.$queryRaw<any[]>`
          INSERT INTO extracted_entities (
            entity_type,
            entity_name,
            canonical_name,
            description,
            confidence_score,
            occurrence_count,
            created_by,
            created_at,
            updated_at
          ) VALUES (
            ${entity.type.toLowerCase()},
            ${entity.text},
            ${entity.normalizedText || entity.text},
            ${entity.metadata?.description || ''},
            ${entity.confidence},
            1,
            ${userId}::UUID,
            NOW(),
            NOW()
          ) RETURNING id, entity_type, entity_name
        `;
        
        storedEntities.push({
          id: newEntity[0].id,
          entity_type: newEntity[0].entity_type,
          entity_name: newEntity[0].entity_name,
          status: 'created',
        });
        
        // Queue embedding generation for new entity
        if (entity.text.length > 3) {
          await queueEmbedding(
            userId,
            entity.text,
            'entity',
            entity.type.toLowerCase(),
            newEntity[0].id
          );
        }
      }
    }
    
    // Log extraction event
    await this.prisma.$queryRaw`
      INSERT INTO entity_extraction_events (
        memory_id,
        user_id,
        extraction_method,
        extraction_model,
        extraction_timestamp,
        extracted_entities,
        extraction_confidence
      ) VALUES (
        NULL, -- No specific memory for query extraction
        ${userId}::UUID,
        'llm_tool_call',
        'claude-3-opus-20240229',
        NOW(),
        ${JSON.stringify(entities)}::jsonb,
        0.8
      )
    `;
    
    return storedEntities;
  }
  
  /**
   * Enhance memories with entity and relationship context
   */
  private async enhanceWithEntityContext(
    memories: any[],
    userId: string
  ): Promise<any[]> {
    const enhancedMemories = [];
    
    for (const memory of memories) {
      // Get entities linked to this memory
      const linkedEntities = await this.prisma.$queryRaw<any[]>`
        SELECT 
          ee.entity_type,
          ee.entity_name,
          ee.description,
          ee.confidence_score
        FROM extracted_entities ee
        JOIN memory_entity_links mel ON ee.id::text = mel.entity_id
        WHERE mel.memory_id = ${memory.id}
          AND mel.entity_type = ee.entity_type
        ORDER BY ee.confidence_score DESC
        LIMIT 5
      `;
      
      // Get relationships involving these entities
      const relationships = await this.prisma.$queryRaw<any[]>`
        SELECT 
          er.relationship_type,
          er.source_entity_name,
          er.target_entity_name,
          er.relationship_strength,
          er.confidence_score
        FROM entity_relationships er
        WHERE er.source_entity_id IN (
          SELECT id FROM extracted_entities 
          WHERE id::text IN (
            SELECT entity_id FROM memory_entity_links 
            WHERE memory_id = ${memory.id}
          )
        )
          OR er.target_entity_id IN (
            SELECT id FROM extracted_entities 
            WHERE id::text IN (
              SELECT entity_id FROM memory_entity_links 
              WHERE memory_id = ${memory.id}
            )
          )
        ORDER BY er.confidence_score DESC
        LIMIT 3
      `;
      
      // Get graph traversal context
      const graphContext = await this.prisma.$queryRaw<any[]>`
        WITH memory_entities AS (
          SELECT id FROM extracted_entities 
          WHERE id::text IN (
            SELECT entity_id FROM memory_entity_links 
            WHERE memory_id = ${memory.id}
          )
          LIMIT 1
        )
        SELECT 
          entity_id,
          entity_name,
          entity_type,
          relationship_path,
          total_distance,
          path_confidence
        FROM find_related_entities(
          (SELECT id FROM memory_entities),
          2,
          NULL,
          0.5
        )
        LIMIT 5
      `;
      
      enhancedMemories.push({
        ...memory,
        linked_entities: linkedEntities,
        relationships: relationships,
        graph_context: graphContext,
        entity_count: linkedEntities.length,
        relationship_count: relationships.length,
      });
    }
    
    return enhancedMemories;
  }
  
  /**
   * Process memory through Mem0 pipeline (extract entities and relationships)
   */
  async processMemoryThroughPipeline(
    memoryId: string,
    userId: string
  ): Promise<{
    extractionResult: any;
    storedEntities: any[];
    storedRelationships: any[];
    pipelineMetrics: {
      extractionTimeMs: number;
      entityStorageTimeMs: number;
      relationshipStorageTimeMs: number;
      totalEntities: number;
      totalRelationships: number;
    };
  }> {
    const startTime = Date.now();
    
    try {
      // Extract entities and relationships from memory
      const extractionStart = Date.now();
      const extractionResult = await this.entityExtractor.extractFromMemory(memoryId, userId);
      const extractionTimeMs = Date.now() - extractionStart;
      
      // Store entities in Mem0 tables
      const entityStorageStart = Date.now();
      const storedEntities = await this.storeMemoryEntities(
        userId,
        memoryId,
        extractionResult.entities
      );
      const entityStorageTimeMs = Date.now() - entityStorageStart;
      
      // Store relationships in Mem0 tables
      const relationshipStorageStart = Date.now();
      const storedRelationships = await this.storeMemoryRelationships(
        userId,
        memoryId,
        extractionResult.relationships,
        extractionResult.entities
      );
      const relationshipStorageTimeMs = Date.now() - relationshipStorageStart;
      
      const totalTimeMs = Date.now() - startTime;
      
      logger.info('Memory processed through Mem0 pipeline', {
        memoryId,
        userId,
        extractionTimeMs,
        entityStorageTimeMs,
        relationshipStorageTimeMs,
        totalTimeMs,
        totalEntities: storedEntities.length,
        totalRelationships: storedRelationships.length,
      });
      
      return {
        extractionResult,
        storedEntities,
        storedRelationships,
        pipelineMetrics: {
          extractionTimeMs,
          entityStorageTimeMs,
          relationshipStorageTimeMs,
          totalEntities: storedEntities.length,
          totalRelationships: storedRelationships.length,
        },
      };
      
    } catch (error) {
      logger.error('Memory pipeline processing failed', {
        error: error instanceof Error ? error.message : String(error),
        memoryId,
        userId,
      });
      
      return {
        extractionResult: { entities: [], relationships: [] },
        storedEntities: [],
        storedRelationships: [],
        pipelineMetrics: {
          extractionTimeMs: 0,
          entityStorageTimeMs: 0,
          relationshipStorageTimeMs: 0,
          totalEntities: 0,
          totalRelationships: 0,
        },
      };
    }
  }
  
  /**
   * Store memory entities in Mem0 tables
   */
  private async storeMemoryEntities(
    userId: string,
    memoryId: string,
    entities: any[]
  ): Promise<any[]> {
    const storedEntities = [];
    
    for (const entity of entities) {
      if (entity.confidence < 0.7) continue;
      
      // Check if entity already exists
      const existingEntity = await this.prisma.$queryRaw<any[]>`
        SELECT id FROM extracted_entities 
        WHERE entity_type = ${entity.type.toLowerCase()} 
          AND entity_name = ${entity.text}
          OR canonical_name = ${entity.normalizedText || entity.text}
      `;
      
      let entityId;
      
      if (existingEntity.length > 0) {
        entityId = existingEntity[0].id;
        
        // Update existing entity
        await this.prisma.$queryRaw`
          UPDATE extracted_entities 
          SET 
            occurrence_count = occurrence_count + 1,
            last_seen_at = NOW(),
            updated_at = NOW(),
            source_domains = source_domains || ${JSON.stringify([entity.metadata?.domain || 'general'])}::jsonb
          WHERE id = ${entityId}
        `;
      } else {
        // Create new entity
        const newEntity = await this.prisma.$queryRaw<any[]>`
          INSERT INTO extracted_entities (
            entity_type,
            entity_name,
            canonical_name,
            description,
            confidence_score,
            occurrence_count,
            source_domains,
            created_by,
            created_at,
            updated_at
          ) VALUES (
            ${entity.type.toLowerCase()},
            ${entity.text},
            ${entity.normalizedText || entity.text},
            ${entity.metadata?.description || ''},
            ${entity.confidence},
            1,
            ${JSON.stringify([entity.metadata?.domain || 'general'])}::jsonb,
            ${userId}::UUID,
            NOW(),
            NOW()
          ) RETURNING id
        `;
        
        entityId = newEntity[0].id;
        
        // Queue embedding generation
        if (entity.text.length > 3) {
          await queueEmbedding(
            userId,
            entity.text,
            'entity',
            entity.type.toLowerCase(),
            entityId
          );
        }
      }
      
      // Create entity extraction event
      await this.prisma.$queryRaw`
        INSERT INTO entity_extraction_events (
          memory_id,
          user_id,
          extraction_method,
          extraction_model,
          extraction_timestamp,
          extracted_entities,
          extraction_confidence
        ) VALUES (
          ${memoryId},
          ${userId}::UUID,
          'llm_tool_call',
          'claude-3-opus-20240229',
          NOW(),
          ${JSON.stringify([entity])}::jsonb,
          ${entity.confidence}
        )
      `;
      
      storedEntities.push({
        id: entityId,
        entity_type: entity.type.toLowerCase(),
        entity_name: entity.text,
        confidence: entity.confidence,
      });
    }
    
    return storedEntities;
  }
  
  /**
   * Store memory relationships in Mem0 tables
   */
  private async storeMemoryRelationships(
    userId: string,
    memoryId: string,
    relationships: any[],
    entities: any[]
  ): Promise<any[]> {
    const storedRelationships = [];
    
    for (const relationship of relationships) {
      if (relationship.confidence < 0.6) continue;
      
      // Find source and target entity IDs
      const sourceEntity = entities.find(e => 
        e.text === relationship.source.text || e.normalizedText === relationship.source.text
      );
      const targetEntity = entities.find(e => 
        e.text === relationship.target.text || e.normalizedText === relationship.target.text
      );
      
      if (!sourceEntity || !targetEntity) continue;
      
      // Find entity IDs in extracted_entities table
      const sourceEntityRecord = await this.prisma.$queryRaw<any[]>`
        SELECT id FROM extracted_entities 
        WHERE entity_name = ${sourceEntity.text} 
          OR canonical_name = ${sourceEntity.normalizedText || sourceEntity.text}
        LIMIT 1
      `;
      
      const targetEntityRecord = await this.prisma.$queryRaw<any[]>`
        SELECT id FROM extracted_entities 
        WHERE entity_name = ${targetEntity.text} 
          OR canonical_name = ${targetEntity.normalizedText || targetEntity.text}
        LIMIT 1
      `;
      
      if (sourceEntityRecord.length === 0 || targetEntityRecord.length === 0) continue;
      
      const sourceEntityId = sourceEntityRecord[0].id;
      const targetEntityId = targetEntityRecord[0].id;
      
      // Check if relationship already exists
      const existingRelationship = await this.prisma.$queryRaw<any[]>`
        SELECT id FROM entity_relationships 
        WHERE source_entity_id = ${sourceEntityId}
          AND target_entity_id = ${targetEntityId}
          AND relationship_type = ${relationship.relationship}
      `;
      
      let relationshipId;
      
      if (existingRelationship.length > 0) {
        relationshipId = existingRelationship[0].id;
        
        // Update existing relationship
        await this.prisma.$queryRaw`
          UPDATE entity_relationships 
          SET 
            relationship_strength = GREATEST(relationship_strength, ${relationship.confidence}),
            confidence_score = GREATEST(confidence_score, ${relationship.confidence}),
            evidence_count = evidence_count + 1,
            last_observed_at = NOW(),
            updated_at = NOW(),
            source_memory_ids = source_memory_ids || ${memoryId}::UUID
          WHERE id = ${relationshipId}
        `;
      } else {
        // Create new relationship
        const newRelationship = await this.prisma.$queryRaw<any[]>`
          INSERT INTO entity_relationships (
            relationship_type,
            relationship_strength,
            source_entity_id,
            source_entity_type,
            source_entity_name,
            target_entity_id,
            target_entity_type,
            target_entity_name,
            confidence_score,
            evidence_count,
            first_observed_at,
            last_observed_at,
            source_memory_ids,
            created_by,
            created_at,
            updated_at
          ) VALUES (
            ${relationship.relationship},
            ${relationship.confidence},
            ${sourceEntityId},
            ${sourceEntity.type.toLowerCase()},
            ${sourceEntity.text},
            ${targetEntityId},
            ${targetEntity.type.toLowerCase()},
            ${targetEntity.text},
            ${relationship.confidence},
            1,
            NOW(),
            NOW(),
            ARRAY[${memoryId}::UUID],
            ${userId}::UUID,
            NOW(),
            NOW()
          ) RETURNING id
        `;
        
        relationshipId = newRelationship[0].id;
      }
      
      // Create relationship evidence
      await this.prisma.$queryRaw`
        INSERT INTO relationship_evidence (
          relationship_id,
          memory_id,
          evidence_text,
          confidence_score,
          extraction_method,
          created_at
        ) VALUES (
          ${relationshipId},
          ${memoryId},
          ${relationship.context || 'Extracted from text'},
          ${relationship.confidence},
          'llm_tool_call',
          NOW()
        )
      `;
      
      storedRelationships.push({
        id: relationshipId,
        relationship_type: relationship.relationship,
        source_entity_id: sourceEntityId,
        target_entity_id: targetEntityId,
        confidence: relationship.confidence,
      });
    }
    
    return storedRelationships;
  }
  
  /**
   * Get entity statistics for user
   */
  async getUserEntityStats(userId: string): Promise<{
    totalEntities: number;
    entityTypes: Record<string, number>;
    totalRelationships: number;
    relationshipTypes: Record<string, number>;
    extractionEvents: number;
    avgExtractionConfidence: number;
  }> {
    const entityStats = await this.prisma.$queryRaw<any[]>`
      SELECT 
        COUNT(*) as total_entities,
        jsonb_object_agg(entity_type, COUNT(*)) as entity_types,
        AVG(confidence_score) as avg_confidence
      FROM extracted_entities
      WHERE created_by = ${userId}::UUID
    `;
    
    const relationshipStats = await this.prisma.$queryRaw<any[]>`
      SELECT 
        COUNT(*) as total_relationships,
        jsonb_object_agg(relationship_type, COUNT(*)) as relationship_types,
        AVG(confidence_score) as avg_confidence
      FROM entity_relationships
      WHERE created_by = ${userId}::UUID
    `;
    
    const extractionStats = await this.prisma.$queryRaw<any[]>`
      SELECT 
        COUNT(*) as total_events,
        AVG(extraction_confidence) as avg_confidence
      FROM entity_extraction_events
      WHERE user_id = ${userId}::UUID
    `;
    
    return {
      totalEntities: entityStats[0]?.total_entities || 0,
      entityTypes: entityStats[0]?.entity_types || {},
      totalRelationships: relationshipStats[0]?.total_relationships || 0,
      relationshipTypes: relationshipStats[0]?.relationship_types || {},
      extractionEvents: extractionStats[0]?.total_events || 0,
      avgExtractionConfidence: extractionStats[0]?.avg_confidence || 0,
    };
  }
}