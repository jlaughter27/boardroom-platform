import type { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';

// Relationship types from Mem0 architecture
export type RelationshipType = 
  | 'works_at' | 'knows' | 'reports_to' | 'collaborates_with' | 'owns' | 'created'
  | 'located_in' | 'part_of' | 'depends_on' | 'related_to' | 'influences' | 'opposes'
  | 'supports' | 'manages' | 'participates_in' | 'affects' | 'causes' | 'precedes'
  | 'follows' | 'similar_to' | 'contradicts' | 'references' | 'mentions';

export interface EntityReference {
  id: string;
  type: string;
  name: string;
  description?: string;
}

export interface RelationshipCandidate {
  source: EntityReference;
  target: EntityReference;
  relationship: RelationshipType;
  confidence: number;
  evidence?: string;
  context?: string;
  bidirectional?: boolean;
}

export interface StructuredPrompt {
  id: string;
  name: string;
  description: string;
  template: string;
  relationshipTypes: RelationshipType[];
  entityTypePairs: [string, string][]; // [source_type, target_type]
  confidenceThreshold: number;
  examples: Array<{
    source: string;
    target: string;
    relationship: RelationshipType;
    evidence: string;
  }>;
}

export class RelationshipBuilderService {
  private prisma: PrismaClient;
  
  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
  }
  
  /**
   * Get structured prompts for relationship inference
   * Based on Mem0 architecture with 23 relationship types
   */
  getStructuredPrompts(): StructuredPrompt[] {
    return [
      {
        id: 'org_hierarchy',
        name: 'Organizational Hierarchy',
        description: 'Infer hierarchical relationships within organizations',
        template: `Given the entities {source} and {target}, analyze their potential organizational relationship.
Consider: reporting structures, team membership, management roles, and collaboration patterns.
Evidence: {evidence}`,
        relationshipTypes: ['reports_to', 'manages', 'collaborates_with', 'works_at'],
        entityTypePairs: [['PERSON', 'PERSON'], ['PERSON', 'ORGANIZATION']],
        confidenceThreshold: 0.7,
        examples: [
          {
            source: 'John Smith',
            target: 'Acme Corp',
            relationship: 'works_at',
            evidence: 'John is the CEO of Acme Corp'
          },
          {
            source: 'Jane Doe',
            target: 'John Smith',
            relationship: 'reports_to',
            evidence: 'Jane reports directly to John in the engineering department'
          }
        ]
      },
      {
        id: 'project_relationships',
        name: 'Project Relationships',
        description: 'Infer relationships involving projects, tasks, and goals',
        template: `Analyze the relationship between {source} and {target} in a project context.
Consider: dependencies, ownership, participation, and temporal ordering.
Evidence: {evidence}`,
        relationshipTypes: ['owns', 'created', 'depends_on', 'participates_in', 'manages', 'precedes', 'follows'],
        entityTypePairs: [['PERSON', 'PROJECT'], ['PERSON', 'TASK'], ['PROJECT', 'TASK'], ['TASK', 'TASK'], ['GOAL', 'PROJECT']],
        confidenceThreshold: 0.65,
        examples: [
          {
            source: 'Marketing Campaign',
            target: 'Website Redesign',
            relationship: 'depends_on',
            evidence: 'The marketing campaign cannot launch until the website redesign is complete'
          },
          {
            source: 'Sarah Chen',
            target: 'Q4 Product Launch',
            relationship: 'manages',
            evidence: 'Sarah is the project manager for the Q4 product launch'
          }
        ]
      },
      {
        id: 'temporal_relationships',
        name: 'Temporal Relationships',
        description: 'Infer temporal ordering and sequence relationships',
        template: `Determine the temporal relationship between {source} and {target}.
Consider: chronological order, deadlines, milestones, and sequencing.
Evidence: {evidence}`,
        relationshipTypes: ['precedes', 'follows', 'causes', 'affects'],
        entityTypePairs: [['TASK', 'TASK'], ['DATE', 'TASK'], ['PROJECT', 'PROJECT'], ['GOAL', 'GOAL']],
        confidenceThreshold: 0.75,
        examples: [
          {
            source: 'Design Phase',
            target: 'Development Phase',
            relationship: 'precedes',
            evidence: 'The design phase must be completed before development can begin'
          },
          {
            source: 'Budget Approval',
            target: 'Project Kickoff',
            relationship: 'causes',
            evidence: 'Project kickoff is contingent on budget approval'
          }
        ]
      },
      {
        id: 'semantic_relationships',
        name: 'Semantic Relationships',
        description: 'Infer conceptual and semantic relationships',
        template: `Analyze the semantic relationship between {source} and {target}.
Consider: similarity, opposition, influence, support, and conceptual connections.
Evidence: {evidence}`,
        relationshipTypes: ['similar_to', 'contradicts', 'influences', 'supports', 'opposes', 'related_to', 'references'],
        entityTypePairs: [['CONCEPT', 'CONCEPT'], ['GOAL', 'GOAL'], ['DECISION', 'DECISION'], ['TAG', 'TAG']],
        confidenceThreshold: 0.6,
        examples: [
          {
            source: 'Agile Methodology',
            target: 'Scrum Framework',
            relationship: 'similar_to',
            evidence: 'Scrum is an implementation of Agile principles'
          },
          {
            source: 'Cost Reduction',
            target: 'Quality Improvement',
            relationship: 'opposes',
            evidence: 'Aggressive cost reduction may compromise quality standards'
          }
        ]
      },
      {
        id: 'spatial_relationships',
        name: 'Spatial Relationships',
        description: 'Infer location-based and spatial relationships',
        template: `Determine the spatial relationship between {source} and {target}.
Consider: physical location, containment, proximity, and geographical context.
Evidence: {evidence}`,
        relationshipTypes: ['located_in', 'part_of', 'owns'],
        entityTypePairs: [['PERSON', 'LOCATION'], ['ORGANIZATION', 'LOCATION'], ['PROJECT', 'LOCATION'], ['LOCATION', 'LOCATION']],
        confidenceThreshold: 0.8,
        examples: [
          {
            source: 'New York Office',
            target: 'Global Headquarters',
            relationship: 'part_of',
            evidence: 'The New York office is part of the global headquarters organization'
          },
          {
            source: 'TechCorp Inc',
            target: 'Silicon Valley Campus',
            relationship: 'owns',
            evidence: 'TechCorp owns the Silicon Valley campus property'
          }
        ]
      }
    ];
  }
  
  /**
   * Build relationships between entities using structured prompts
   * Implements Mem0's relationship inference pipeline
   */
  async buildRelationships(
    entities: EntityReference[],
    context: {
      userId: string;
      domain?: string;
      textContext?: string;
      existingRelationships?: Array<{ sourceId: string; targetId: string; type: string }>;
    }
  ): Promise<RelationshipCandidate[]> {
    const candidates: RelationshipCandidate[] = [];
    const prompts = this.getStructuredPrompts();
    
    // Group entities by type for efficient matching
    const entitiesByType = new Map<string, EntityReference[]>();
    for (const entity of entities) {
      if (!entitiesByType.has(entity.type)) {
        entitiesByType.set(entity.type, []);
      }
      entitiesByType.get(entity.type)!.push(entity);
    }
    
    // Apply each structured prompt to relevant entity pairs
    for (const prompt of prompts) {
      for (const [sourceType, targetType] of prompt.entityTypePairs) {
        const sourceEntities = entitiesByType.get(sourceType) || [];
        const targetEntities = entitiesByType.get(targetType) || [];
        
        if (sourceEntities.length === 0 || targetEntities.length === 0) {
          continue;
        }
        
        // Generate candidate pairs
        for (const source of sourceEntities) {
          for (const target of targetEntities) {
            // Skip self-relationships
            if (source.id === target.id) {
              continue;
            }
            
            // Check if relationship already exists
            const existing = context.existingRelationships?.find(
              rel => rel.sourceId === source.id && rel.targetId === target.id
            );
            if (existing) {
              continue;
            }
            
            // Infer relationship using prompt template
            const candidate = await this.inferRelationshipWithPrompt(
              source,
              target,
              prompt,
              context
            );
            
            if (candidate && candidate.confidence >= prompt.confidenceThreshold) {
              candidates.push(candidate);
            }
          }
        }
      }
    }
    
    // Sort by confidence and deduplicate
    const uniqueCandidates = this.deduplicateCandidates(candidates);
    uniqueCandidates.sort((a, b) => b.confidence - a.confidence);
    
    logger.info('Relationship building completed', {
      userId: context.userId,
      entitiesCount: entities.length,
      candidatesCount: uniqueCandidates.length,
      domain: context.domain
    });
    
    return uniqueCandidates;
  }
  
  /**
   * Infer relationship between two entities using a structured prompt
   */
  private async inferRelationshipWithPrompt(
    source: EntityReference,
    target: EntityReference,
    prompt: StructuredPrompt,
    context: {
      userId: string;
      domain?: string;
      textContext?: string;
    }
  ): Promise<RelationshipCandidate | null> {
    try {
      // Prepare evidence from context
      const evidence = this.extractEvidence(source, target, context.textContext || '');
      
      // Build prompt for LLM inference
      const inferencePrompt = this.buildInferencePrompt(source, target, prompt, evidence);
      
      // Use LLM for relationship inference (could be optimized with embeddings)
      const relationship = await this.inferWithLLM(inferencePrompt, prompt.relationshipTypes);
      
      if (!relationship) {
        return null;
      }
      
      // Calculate confidence based on evidence strength and relationship type
      const confidence = this.calculateConfidence(relationship.type, evidence, prompt.confidenceThreshold);
      
      return {
        source,
        target,
        relationship: relationship.type,
        confidence,
        evidence: relationship.evidence || evidence,
        context: context.textContext?.substring(0, 200),
        bidirectional: this.isBidirectionalRelationship(relationship.type)
      };
    } catch (error) {
      logger.error('Relationship inference failed', {
        error,
        sourceId: source.id,
        targetId: target.id,
        promptId: prompt.id
      });
      return null;
    }
  }
  
  /**
   * Extract evidence for relationship from text context
   */
  private extractEvidence(source: EntityReference, target: EntityReference, textContext: string): string {
    if (!textContext) {
      return `No direct evidence in provided context.`;
    }
    
    // Simple keyword-based evidence extraction
    const sourceKeywords = source.name.toLowerCase().split(/\s+/);
    const targetKeywords = target.name.toLowerCase().split(/\s+/);
    
    const sentences = textContext.split(/[.!?]+/);
    const relevantSentences = sentences.filter(sentence => {
      const lowerSentence = sentence.toLowerCase();
      return sourceKeywords.some(kw => lowerSentence.includes(kw)) &&
             targetKeywords.some(kw => lowerSentence.includes(kw));
    });
    
    if (relevantSentences.length > 0) {
      return relevantSentences.slice(0, 3).join(' ');
    }
    
    return `Entities ${source.name} and ${target.name} mentioned in same context.`;
  }
  
  /**
   * Build inference prompt for LLM
   */
  private buildInferencePrompt(
    source: EntityReference,
    target: EntityReference,
    prompt: StructuredPrompt,
    evidence: string
  ): string {
    const template = prompt.template
      .replace('{source}', source.name)
      .replace('{target}', target.name)
      .replace('{evidence}', evidence);
    
    return `${template}

Available relationship types: ${prompt.relationshipTypes.join(', ')}

Examples:
${prompt.examples.map(ex => 
  `- ${ex.source} ${ex.relationship} ${ex.target}: ${ex.evidence}`
).join('\n')}

Based on the evidence and examples, what is the most likely relationship between "${source.name}" and "${target.name}"?
Return the relationship type and a brief explanation.`;
  }
  
  /**
   * Infer relationship using LLM (simplified - in production would call actual LLM)
   */
  private async inferWithLLM(
    prompt: string,
    allowedTypes: RelationshipType[]
  ): Promise<{ type: RelationshipType; evidence: string } | null> {
    // In a real implementation, this would call an LLM API
    // For now, return a mock implementation that can be replaced
    logger.debug('LLM relationship inference', { promptLength: prompt.length });
    
    // Mock implementation - in production, replace with actual LLM call
    // This would parse the LLM response and extract relationship type
    return {
      type: allowedTypes[0], // Default to first allowed type
      evidence: 'Inferred from contextual analysis'
    };
  }
  
  /**
   * Calculate confidence score for inferred relationship
   */
  private calculateConfidence(
    relationshipType: RelationshipType,
    evidence: string,
    baseThreshold: number
  ): number {
    let confidence = baseThreshold;
    
    // Adjust confidence based on evidence quality
    if (evidence.includes('directly') || evidence.includes('explicitly')) {
      confidence += 0.15;
    }
    
    if (evidence.includes('implied') || evidence.includes('suggested')) {
      confidence += 0.05;
    }
    
    if (evidence === 'No direct evidence in provided context.') {
      confidence -= 0.2;
    }
    
    // Adjust based on relationship type specificity
    const specificTypes = ['reports_to', 'owns', 'manages', 'depends_on', 'causes'];
    const genericTypes = ['related_to', 'knows', 'mentions', 'references'];
    
    if (specificTypes.includes(relationshipType)) {
      confidence += 0.1;
    } else if (genericTypes.includes(relationshipType)) {
      confidence -= 0.05;
    }
    
    return Math.min(Math.max(confidence, 0.1), 0.95);
  }
  
  /**
   * Check if relationship type is bidirectional
   */
  private isBidirectionalRelationship(type: RelationshipType): boolean {
    const bidirectionalTypes = ['knows', 'collaborates_with', 'related_to', 'similar_to'];
    return bidirectionalTypes.includes(type);
  }
  
  /**
   * Deduplicate relationship candidates
   */
  private deduplicateCandidates(candidates: RelationshipCandidate[]): RelationshipCandidate[] {
    const seen = new Set<string>();
    const unique: RelationshipCandidate[] = [];
    
    for (const candidate of candidates) {
      const key = `${candidate.source.id}:${candidate.target.id}:${candidate.relationship}`;
      const reverseKey = `${candidate.target.id}:${candidate.source.id}:${candidate.relationship}`;
      
      if (!seen.has(key) && !seen.has(reverseKey)) {
        seen.add(key);
        unique.push(candidate);
      }
    }
    
    return unique;
  }
  
  /**
   * Store inferred relationships in database
   */
  async storeRelationships(
    candidates: RelationshipCandidate[],
    userId: string,
    sourceMemoryId?: string
  ): Promise<number> {
    let storedCount = 0;
    
    for (const candidate of candidates) {
      try {
        // Store in Mem0 relationship table
        await this.prisma.mem0Relationship.create({
          data: {
            userId,
            sourceEntityId: candidate.source.id,
            sourceEntityType: candidate.source.type,
            targetEntityId: candidate.target.id,
            targetEntityType: candidate.target.type,
            relationshipType: candidate.relationship,
            confidence: candidate.confidence,
            evidence: candidate.evidence,
            context: candidate.context,
            bidirectional: candidate.bidirectional,
            sourceMemoryId,
            metadata: {
              inferred: true,
              inferenceTimestamp: new Date().toISOString()
            }
          }
        });
        
        storedCount++;
        
        // If bidirectional, create reverse relationship
        if (candidate.bidirectional) {
          await this.prisma.mem0Relationship.create({
            data: {
              userId,
              sourceEntityId: candidate.target.id,
              sourceEntityType: candidate.target.type,
              targetEntityId: candidate.source.id,
              targetEntityType: candidate.source.type,
              relationshipType: candidate.relationship,
              confidence: candidate.confidence,
              evidence: candidate.evidence,
              context: candidate.context,
              bidirectional: true,
              sourceMemoryId,
              metadata: {
                inferred: true,
                inferenceTimestamp: new Date().toISOString(),
                isReverse: true
              }
            }
          });
          
          storedCount++;
        }
      } catch (error) {
        logger.error('Failed to store relationship', {
          error,
          sourceId: candidate.source.id,
          targetId: candidate.target.id,
          relationship: candidate.relationship
        });
      }
    }
    
    logger.info('Relationships stored', {
      userId,
      storedCount,
      totalCandidates: candidates.length
    });
    
    return storedCount;
  }
  
  /**
   * Get existing relationships for a user
   */
  async getExistingRelationships(
    userId: string,
    entityIds?: string[]
  ): Promise<Array<{ sourceId: string; targetId: string; type: string }>> {
    const where: any = { userId };
    
    if (entityIds && entityIds.length > 0) {
      where.OR = [
        { sourceEntityId: { in: entityIds } },
        { targetEntityId: { in: entityIds } }
      ];
    }
    
    const relationships = await this.prisma.mem0Relationship.findMany({
      where,
      select: {
        sourceEntityId: true,
        targetEntityId: true,
        relationshipType: true
      }
    });
    
    return relationships.map(rel => ({
      sourceId: rel.sourceEntityId,
      targetId: rel.targetEntityId,
      type: rel.relationshipType
    }));
  }
}