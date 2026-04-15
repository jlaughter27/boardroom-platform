import type { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';
import { RelationshipBuilderService, type EntityReference } from './relationship-builder.service';

// Define entity types based on Mem0 architecture
export type EntityType = 'PERSON' | 'ORGANIZATION' | 'PROJECT' | 'TASK' | 'GOAL' | 'DECISION' | 'COMMITMENT' | 'TAG' | 'DATE' | 'LOCATION';

export interface ExtractedEntity {
  text: string;
  type: EntityType;
  confidence: number;
  metadata?: Record<string, any>;
  normalizedText?: string;
  startIndex?: number;
  endIndex?: number;
}

export interface ExtractedRelationship {
  source: ExtractedEntity;
  target: ExtractedEntity;
  relationship: string; // 'works-at', 'knows', 'part-of', 'reports-to', 'owns', 'manages', 'depends-on'
  confidence: number;
  context?: string;
  bidirectional?: boolean;
}

export interface ExtractionResult {
  entities: ExtractedEntity[];
  relationships: ExtractedRelationship[];
  rawResponse?: any;
}

export class EntityExtractorService {
  private prisma: PrismaClient;
  private useLLM: boolean;
  
  constructor(prisma: PrismaClient, useLLM = true) {
    this.prisma = prisma;
    this.useLLM = useLLM;
  }
  
  /**
   * Extract entities and relationships from text content
   * Implements Mem0's two-phase extraction approach
   */
  async extractFromText(
    text: string,
    userId: string,
    context?: { domain?: string; relatedEntities?: string[] }
  ): Promise<ExtractionResult> {
    try {
      if (this.useLLM) {
        return await this.extractWithLLM(text, userId, context);
      } else {
        return await this.extractWithPatterns(text, userId);
      }
    } catch (error) {
      logger.error('Entity extraction failed', { error, textLength: text.length });
      return { entities: [], relationships: [] };
    }
  }
  
  /**
   * Extract from existing memory entry
   */
  async extractFromMemory(
    memoryId: string,
    userId: string
  ): Promise<ExtractionResult> {
    const memory = await this.prisma.memoryEntry.findFirst({
      where: { id: memoryId, userId, deletedAt: null },
      select: { id: true, title: true, content: true, domain: true }
    });
    
    if (!memory) {
      throw new Error('Memory not found or access denied');
    }
    
    const text = `${memory.title}\n\n${memory.content}`;
    const context = { domain: memory.domain };
    
    return this.extractFromText(text, userId, context);
  }
  
   /**
    * LLM-based extraction using tool calls (Mem0's approach)
    */
   private async extractWithLLM(
     text: string,
     userId: string,
     context?: { domain?: string; relatedEntities?: string[] }
   ): Promise<ExtractionResult> {
     try {
       // Import Anthropic SDK for LLM tool calls
       const { Anthropic } = await import('@anthropic-ai/sdk');
       
       const anthropic = new Anthropic({
         apiKey: process.env.ANTHROPIC_API_KEY || '',
       });
       
       // Define extraction tools based on Mem0 architecture
       const extractionTools = [
         {
           name: 'extract_entities',
           description: 'Extract entities from text with type, confidence, and context',
           input_schema: {
             type: 'object',
             properties: {
               entities: {
                 type: 'array',
                 items: {
                   type: 'object',
                   properties: {
                     text: { type: 'string', description: 'Entity text as appears in content' },
                     type: { 
                       type: 'string', 
                       enum: ['person', 'organization', 'project', 'goal', 'task', 'concept', 'date', 'location', 'technology'],
                       description: 'Type of entity'
                     },
                     confidence: { type: 'number', minimum: 0, maximum: 1 },
                     canonical_name: { type: 'string', description: 'Normalized/standardized name' },
                     description: { type: 'string', description: 'Brief description or role' },
                     start_index: { type: 'number', minimum: 0 },
                     end_index: { type: 'number', minimum: 0 },
                   },
                   required: ['text', 'type', 'confidence']
                 }
               }
             },
             required: ['entities']
           }
         },
         {
           name: 'extract_relationships',
           description: 'Extract relationships between entities with type and confidence',
           input_schema: {
             type: 'object',
             properties: {
               relationships: {
                 type: 'array',
                 items: {
                   type: 'object',
                   properties: {
                     source_text: { type: 'string', description: 'Source entity text' },
                     target_text: { type: 'string', description: 'Target entity text' },
                     relationship_type: { 
                       type: 'string',
                       enum: [
                         'works_at', 'knows', 'reports_to', 'collaborates_with', 'owns', 'created',
                         'located_in', 'part_of', 'depends_on', 'related_to', 'influences', 'opposes',
                         'supports', 'manages', 'participates_in', 'affects', 'causes', 'precedes',
                         'follows', 'similar_to', 'contradicts', 'references', 'mentions'
                       ]
                     },
                     confidence: { type: 'number', minimum: 0, maximum: 1 },
                     evidence: { type: 'string', description: 'Supporting text evidence' },
                     bidirectional: { type: 'boolean', default: false },
                   },
                   required: ['source_text', 'target_text', 'relationship_type', 'confidence']
                 }
               }
             },
             required: ['relationships']
           }
         }
       ];
       
       // Prepare context for extraction
       const systemPrompt = `You are an entity and relationship extraction assistant for Mem0 memory system.
Extract entities and relationships from the provided text with high precision.

Entity Types:
- person: Individuals, people, stakeholders
- organization: Companies, institutions, teams
- project: Projects, initiatives, programs
- goal: Goals, objectives, targets
- task: Tasks, actions, to-do items
- concept: Abstract concepts, ideas, themes
- date: Dates, time periods, deadlines
- location: Places, locations, addresses
- technology: Technologies, tools, systems

Relationship Types:
- works_at: Person works at organization
- knows: Person knows another person
- reports_to: Person reports to another person
- collaborates_with: Person collaborates with another person/organization
- owns: Person/organization owns something
- created: Person/organization created something
- located_in: Entity located in location
- part_of: Entity is part of larger entity
- depends_on: Entity depends on another entity
- related_to: Generic relatedness
- influences: Entity influences another
- opposes: Entity opposes another
- supports: Entity supports another
- manages: Person manages project/task/people
- participates_in: Entity participates in activity
- affects: Entity affects another
- causes: Entity causes effect
- precedes: Temporal ordering (before)
- follows: Temporal ordering (after)
- similar_to: Similarity relationship
- contradicts: Contradicts or conflicts with
- references: References or mentions
- mentions: Mentions without strong relationship

Rules:
1. Only extract entities with confidence >= 0.7
2. Only extract relationships with confidence >= 0.6
3. Include exact text positions for entities
4. Provide canonical names for entities (normalized forms)
5. Extract both explicit and implicit relationships
6. Focus on relationships that provide contextual memory value`;
       
       const userPrompt = `Text to analyze:
${text.substring(0, 8000)} ${text.length > 8000 ? '... (truncated)' : ''}

Context:
- Domain: ${context?.domain || 'general'}
- Related entities: ${context?.relatedEntities?.join(', ') || 'none'}

Extract entities and relationships following the rules above.`;
       
       // Call Anthropic with tool use
       const response = await anthropic.messages.create({
         model: 'claude-3-opus-20240229',
         max_tokens: 4000,
         temperature: 0.1,
         system: systemPrompt,
         messages: [
           {
             role: 'user',
             content: userPrompt
           }
         ],
         tools: extractionTools,
         tool_choice: { type: 'any' },
       });
       
       // Parse tool call results
       const entities: ExtractedEntity[] = [];
       const relationships: ExtractedRelationship[] = [];
       
       for (const content of response.content) {
         if (content.type === 'tool_use') {
           if (content.name === 'extract_entities') {
             const toolResult = content.input as { entities: any[] };
             
             for (const entityData of toolResult.entities) {
               if (entityData.confidence >= 0.7) {
                 entities.push({
                   text: entityData.text,
                   type: this.mapEntityType(entityData.type),
                   confidence: entityData.confidence,
                   metadata: {
                     canonical_name: entityData.canonical_name,
                     description: entityData.description,
                   },
                   normalizedText: entityData.canonical_name || entityData.text,
                   startIndex: entityData.start_index,
                   endIndex: entityData.end_index,
                 });
               }
             }
           } else if (content.name === 'extract_relationships') {
             const toolResult = content.input as { relationships: any[] };
             
             for (const relData of toolResult.relationships) {
               if (relData.confidence >= 0.6) {
                 // Find source and target entities in extracted entities
                 const sourceEntity = entities.find(e => 
                   e.text === relData.source_text || e.normalizedText === relData.source_text
                 );
                 const targetEntity = entities.find(e => 
                   e.text === relData.target_text || e.normalizedText === relData.target_text
                 );
                 
                 if (sourceEntity && targetEntity) {
                   relationships.push({
                     source: sourceEntity,
                     target: targetEntity,
                     relationship: relData.relationship_type,
                     confidence: relData.confidence,
                     context: relData.evidence,
                     bidirectional: relData.bidirectional,
                   });
                 }
               }
             }
           }
         }
       }
       
       // Normalize entity text (fuzzy matching against existing entities)
       await this.normalizeEntities(entities, userId);
       
       // Log extraction metrics
       logger.info('LLM entity extraction completed', {
         textLength: text.length,
         entitiesExtracted: entities.length,
         relationshipsExtracted: relationships.length,
         userId,
         domain: context?.domain,
       });
       
       return {
         entities,
         relationships,
         rawResponse: {
           method: 'llm-tool-calls',
           model: 'claude-3-opus-20240229',
           timestamp: new Date().toISOString(),
           tool_calls: response.content.filter(c => c.type === 'tool_use').length,
         }
       };
       
     } catch (error) {
       logger.error('LLM extraction failed, falling back to patterns', { 
         error: error instanceof Error ? error.message : String(error),
         userId 
       });
       
       // Fall back to pattern-based extraction
       return await this.extractWithPatterns(text, userId);
     }
   }
   
   /**
    * Map LLM entity type to internal type
    */
   private mapEntityType(llmType: string): EntityType {
     const typeMap: Record<string, EntityType> = {
       'person': 'PERSON',
       'organization': 'ORGANIZATION',
       'project': 'PROJECT',
       'goal': 'GOAL',
       'task': 'TASK',
       'concept': 'TAG', // Map concepts to tags
       'date': 'DATE',
       'location': 'LOCATION',
       'technology': 'TAG', // Map technology to tags
     };
     
     return typeMap[llmType.toLowerCase()] || 'TAG';
   }
  
  /**
   * Pattern-based extraction (fallback when LLM is unavailable)
   */
  private async extractWithPatterns(
    text: string,
    userId: string
  ): Promise<ExtractionResult> {
    const entities = [
      ...this.extractPeople(text),
      ...this.extractOrganizations(text),
      ...this.extractProjects(text),
      ...this.extractDates(text),
    ];
    
    // Simple normalization
    for (const entity of entities) {
      entity.normalizedText = entity.text.toLowerCase().trim();
    }
    
    return {
      entities,
      relationships: [],
      rawResponse: { method: 'pattern-only', timestamp: new Date().toISOString() }
    };
  }
  
  /**
   * Extract people entities from text
   */
  private extractPeople(text: string): ExtractedEntity[] {
    const people: ExtractedEntity[] = [];
    const patterns = [
      // Titles followed by names
      /(?:Mr\.|Ms\.|Mrs\.|Dr\.|Prof\.)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/g,
      // Capitalized names (simple heuristic)
      /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\b(?!\s+(?:Inc|Corp|Ltd|LLC))/g,
    ];
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const name = match[1];
        // Skip common false positives
        if (!this.isFalsePositive(name)) {
          people.push({
            text: name,
            type: 'PERSON',
            confidence: 0.7,
            startIndex: match.index,
            endIndex: match.index + match[0].length,
          });
        }
      }
    }
    
    return people;
  }
  
  /**
   * Extract organization entities
   */
  private extractOrganizations(text: string): ExtractedEntity[] {
    const orgs: ExtractedEntity[] = [];
    const patterns = [
      /([A-Z][A-Za-z\s&]+)\s+(?:Inc|Corp|Corporation|Ltd|LLC|Company|Co\.)/g,
      /\b(?:at|from|of)\s+([A-Z][A-Za-z\s&]+)\b/g,
    ];
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const orgName = match[1].trim();
        orgs.push({
          text: orgName,
          type: 'ORGANIZATION',
          confidence: 0.6,
          startIndex: match.index,
          endIndex: match.index + match[0].length,
        });
      }
    }
    
    return orgs;
  }
  
  /**
   * Extract project references
   */
  private extractProjects(text: string): ExtractedEntity[] {
    const projects: ExtractedEntity[] = [];
    const patterns = [
      /project\s+["']([^"']+)["']/gi,
      /\b(?:initiative|program)\s+["']([^"']+)["']/gi,
      /#(\w+)/g, // Hashtag style
    ];
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        projects.push({
          text: match[1],
          type: 'PROJECT',
          confidence: 0.8,
          startIndex: match.index,
          endIndex: match.index + match[0].length,
        });
      }
    }
    
    return projects;
  }
  
  /**
   * Extract dates
   */
  private extractDates(text: string): ExtractedEntity[] {
    const dates: ExtractedEntity[] = [];
    const patterns = [
      /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/g,
      /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/gi,
      /\b\d{4}\b/g, // Just year
    ];
    
    for (const pattern of patterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        dates.push({
          text: match[0],
          type: 'DATE',
          confidence: 0.9,
          startIndex: match.index,
          endIndex: match.index + match[0].length,
        });
      }
    }
    
    return dates;
  }
  
  /**
   * Infer relationships between entities based on context
   */
  private inferRelationship(
    source: ExtractedEntity,
    target: ExtractedEntity,
    text: string
  ): ExtractedRelationship | null {
    // Simple relationship inference based on entity types and proximity
    const relationshipTypes: Record<string, string[]> = {
      'PERSON-ORGANIZATION': ['works-at', 'founded', 'consulted-for', 'left'],
      'PERSON-PROJECT': ['manages', 'works-on', 'leads', 'contributes-to'],
      'PROJECT-ORGANIZATION': ['sponsored-by', 'hosted-by', 'part-of'],
      'PERSON-PERSON': ['reports-to', 'collaborates-with', 'mentors', 'supervises'],
    };
    
    const key = `${source.type}-${target.type}`;
    const possibleRels = relationshipTypes[key] || relationshipTypes[`${target.type}-${source.type}`];
    
    if (!possibleRels) {
      return null;
    }
    
    // Check for relationship indicators in text between entities
    const sourceIndex = source.startIndex || 0;
    const targetIndex = target.startIndex || 0;
    const start = Math.min(sourceIndex, targetIndex);
    const end = Math.max(
      (source.endIndex || sourceIndex + source.text.length),
      (target.endIndex || targetIndex + target.text.length)
    );
    
    const context = text.substring(start, Math.min(end + 100, text.length));
    const relationship = this.detectRelationshipFromContext(context, possibleRels);
    
    if (relationship) {
      return {
        source,
        target,
        relationship,
        confidence: 0.6,
        context: context.substring(0, 200),
      };
    }
    
    return null;
  }
  
  /**
   * Detect relationship from context text
   */
  private detectRelationshipFromContext(context: string, possibleRels: string[]): string | null {
    const indicators: Record<string, RegExp[]> = {
      'works-at': [/works at/i, /employed at/i, /job at/i],
      'manages': [/manages/i, /leads/i, /heads/i],
      'reports-to': [/reports to/i, /reports directly to/i],
      'collaborates-with': [/collaborates with/i, /works with/i, /partners with/i],
      'part-of': [/part of/i, /within/i, /under/i],
    };
    
    for (const rel of possibleRels) {
      const patterns = indicators[rel];
      if (patterns) {
        for (const pattern of patterns) {
          if (pattern.test(context)) {
            return rel;
          }
        }
      }
    }
    
    return possibleRels[0] || null;
  }
  
  /**
   * Normalize entities by matching against existing database entities
   */
  private async normalizeEntities(entities: ExtractedEntity[], userId: string): Promise<void> {
    for (const entity of entities) {
      if (entity.type === 'PERSON') {
        // Try to find matching person in database
        const match = await this.prisma.person.findFirst({
          where: {
            userId,
            deletedAt: null,
            OR: [
              { name: { equals: entity.text, mode: 'insensitive' } },
              { name: { contains: entity.text, mode: 'insensitive' } },
            ],
          },
          select: { id: true, name: true },
        });
        
        if (match) {
          entity.normalizedText = match.name;
          entity.metadata = { ...entity.metadata, dbId: match.id };
        }
      } else if (entity.type === 'PROJECT') {
        const match = await this.prisma.project.findFirst({
          where: {
            userId,
            deletedAt: null,
            OR: [
              { title: { equals: entity.text, mode: 'insensitive' } },
              { title: { contains: entity.text, mode: 'insensitive' } },
            ],
          },
          select: { id: true, title: true },
        });
        
        if (match) {
          entity.normalizedText = match.title;
          entity.metadata = { ...entity.metadata, dbId: match.id };
        }
      }
    }
  }
  
  /**
   * Check if a name is a false positive
   */
  private isFalsePositive(name: string): boolean {
    const falsePositives = [
      'The', 'This', 'That', 'These', 'Those',
      'And', 'But', 'Or', 'Nor', 'For', 'Yet', 'So',
      'With', 'From', 'About', 'Into', 'During',
      'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    
    return falsePositives.includes(name) || name.length < 2;
  }
  
  /**
   * Build relationships between extracted entities using structured prompts
   * Implements Mem0's relationship inference with structured prompts
   */
  async buildRelationshipsWithStructuredPrompts(
    entities: ExtractedEntity[],
    textContext: string,
    userId: string,
    domain?: string
  ): Promise<ExtractedRelationship[]> {
    const relationshipBuilder = new RelationshipBuilderService(this.prisma);
    
    // Convert extracted entities to entity references
    const entityReferences: EntityReference[] = entities
      .filter(entity => entity.confidence >= 0.5)
      .map(entity => ({
        id: entity.metadata?.dbId || `temp_${entity.text}_${entity.type}`,
        type: entity.type,
        name: entity.normalizedText || entity.text,
        description: entity.metadata?.description
      }));
    
    // Get existing relationships to avoid duplicates
    const existingRelationships = await relationshipBuilder.getExistingRelationships(
      userId,
      entityReferences.map(e => e.id)
    );
    
    // Build relationships using structured prompts
    const candidates = await relationshipBuilder.buildRelationships(
      entityReferences,
      {
        userId,
        domain,
        textContext,
        existingRelationships
      }
    );
    
    // Convert relationship candidates to extracted relationships
    const relationships: ExtractedRelationship[] = [];
    
    for (const candidate of candidates) {
      // Find source and target entities
      const sourceEntity = entities.find(e => 
        (e.metadata?.dbId === candidate.source.id) ||
        (e.normalizedText === candidate.source.name && e.type === candidate.source.type)
      );
      
      const targetEntity = entities.find(e => 
        (e.metadata?.dbId === candidate.target.id) ||
        (e.normalizedText === candidate.target.name && e.type === candidate.target.type)
      );
      
      if (sourceEntity && targetEntity) {
        relationships.push({
          source: sourceEntity,
          target: targetEntity,
          relationship: candidate.relationship,
          confidence: candidate.confidence,
          context: candidate.evidence,
          bidirectional: candidate.bidirectional
        });
      }
    }
    
    logger.info('Structured relationship building completed', {
      userId,
      entitiesCount: entities.length,
      relationshipsBuilt: relationships.length,
      domain
    });
    
    return relationships;
  }
  
  /**
   * Enhanced extraction with relationship building using structured prompts
   */
  async extractAndBuildRelationships(
    text: string,
    userId: string,
    context?: { domain?: string; relatedEntities?: string[] }
  ): Promise<ExtractionResult> {
    // First, extract entities using LLM
    const extraction = await this.extractFromText(text, userId, context);
    
    // Then build additional relationships using structured prompts
    if (extraction.entities.length >= 2) {
      const builtRelationships = await this.buildRelationshipsWithStructuredPrompts(
        extraction.entities,
        text,
        userId,
        context?.domain
      );
      
      // Merge relationships, avoiding duplicates
      const existingRelationshipKeys = new Set(
        extraction.relationships.map(rel => 
          `${rel.source.text}:${rel.target.text}:${rel.relationship}`
        )
      );
      
      for (const builtRel of builtRelationships) {
        const key = `${builtRel.source.text}:${builtRel.target.text}:${builtRel.relationship}`;
        const reverseKey = `${builtRel.target.text}:${builtRel.source.text}:${builtRel.relationship}`;
        
        if (!existingRelationshipKeys.has(key) && !existingRelationshipKeys.has(reverseKey)) {
          extraction.relationships.push(builtRel);
          existingRelationshipKeys.add(key);
        }
      }
    }
    
    return extraction;
  }
  
  /**
   * Create entities and relationships in database with enhanced relationship storage
   */
  async persistExtraction(
    userId: string,
    memoryId: string,
    extraction: ExtractionResult
  ): Promise<{ entityLinks: number; relationships: number }> {
    const entityLinks = [];
    const relationships = [];
    
    // Create entity links for each extracted entity
    for (const entity of extraction.entities) {
      if (entity.confidence < 0.5) continue; // Skip low confidence entities
      
      let entityId: string | undefined = entity.metadata?.dbId as string;
      
      // If no existing entity, create a new one based on type
      if (!entityId && entity.type === 'PERSON') {
        const person = await this.prisma.person.create({
          data: {
            userId,
            name: entity.normalizedText || entity.text,
            domains: [],
            importance: 0.5,
            interactionFrequency: 0,
          },
        });
        entityId = person.id;
      } else if (!entityId && entity.type === 'PROJECT') {
        const project = await this.prisma.project.create({
          data: {
            userId,
            title: entity.normalizedText || entity.text,
            domain: '',
            status: 'active',
          },
        });
        entityId = project.id;
      }
      
      if (entityId) {
        const link = await this.prisma.memoryEntityLink.create({
          data: {
            memoryId,
            entityType: entity.type.toLowerCase(),
            entityId,
            linkType: 'extracted',
          },
        });
        entityLinks.push(link);
      }
    }
    
    // Store relationships using relationship builder service
    const relationshipBuilder = new RelationshipBuilderService(this.prisma);
    
    // Convert extracted relationships to candidates for storage
    const relationshipCandidates = extraction.relationships
      .filter(rel => rel.confidence >= 0.5)
      .map(rel => {
        const sourceId = rel.source.metadata?.dbId as string;
        const targetId = rel.target.metadata?.dbId as string;
        
        if (!sourceId || !targetId) {
          return null;
        }
        
        return {
          source: {
            id: sourceId,
            type: rel.source.type,
            name: rel.source.normalizedText || rel.source.text,
            description: rel.source.metadata?.description
          },
          target: {
            id: targetId,
            type: rel.target.type,
            name: rel.target.normalizedText || rel.target.text,
            description: rel.target.metadata?.description
          },
          relationship: rel.relationship as any, // Cast to RelationshipType
          confidence: rel.confidence,
          evidence: rel.context,
          context: rel.context,
          bidirectional: rel.bidirectional
        };
      })
      .filter(Boolean);
    
    // Store relationships in Mem0 relationship table
    if (relationshipCandidates.length > 0) {
      const storedCount = await relationshipBuilder.storeRelationships(
        relationshipCandidates,
        userId,
        memoryId
      );
      relationships.push(...relationshipCandidates.slice(0, storedCount));
    }
    
    logger.info('Extraction persisted with enhanced relationship storage', {
      userId,
      memoryId,
      entityLinks: entityLinks.length,
      relationships: relationships.length
    });
    
    return {
      entityLinks: entityLinks.length,
      relationships: relationships.length,
    };
  }
}