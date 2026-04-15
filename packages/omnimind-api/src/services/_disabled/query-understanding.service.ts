import type { PrismaClient } from '@prisma/client';
import { logger } from '../lib/logger';
import { EntityExtractorService } from './entity-extractor.service';

export type QueryIntent = 
  | 'search'           // General search for information
  | 'filter'           // Filter existing results
  | 'analyze'          // Analyze patterns or relationships
  | 'find_related'     // Find related entities
  | 'compare'          // Compare entities
  | 'timeline'         // View chronological information
  | 'summary'          // Get summary of information
  | 'recommendation'   // Get recommendations
  | 'exploration'      // Explore connections
  | 'unknown';         // Unknown intent

export type QueryComplexity = 'simple' | 'moderate' | 'complex';

export interface QueryUnderstandingResult {
  originalQuery: string;
  normalizedQuery: string;
  intent: QueryIntent;
  confidence: number;
  entities: Array<{
    text: string;
    type: string;
    confidence: number;
    normalizedText?: string;
  }>;
  filters: Record<string, any>;
  timeRange?: {
    start?: Date;
    end?: Date;
    relative?: 'today' | 'this_week' | 'this_month' | 'last_week' | 'last_month';
  };
  complexity: QueryComplexity;
  suggestedExpansions: string[];
  metadata: {
    hasTemporalConstraint: boolean;
    hasSpatialConstraint: boolean;
    hasEntityConstraint: boolean;
    hasRelationshipConstraint: boolean;
    wordCount: number;
    containsQuestions: boolean;
    containsCommands: boolean;
  };
}

export interface IntentPattern {
  intent: QueryIntent;
  patterns: RegExp[];
  keywords: string[];
  confidence: number;
  description: string;
}

export interface QueryExpansionRule {
  original: string | RegExp;
  expansions: string[];
  boost?: number;
  context?: string[];
}

export class QueryUnderstandingService {
  private prisma: PrismaClient;
  private entityExtractor: EntityExtractorService;
  private intentPatterns: IntentPattern[];
  private expansionRules: QueryExpansionRule[];
  
  constructor(prisma: PrismaClient) {
    this.prisma = prisma;
    this.entityExtractor = new EntityExtractorService(prisma, true);
    this.intentPatterns = this.initializeIntentPatterns();
    this.expansionRules = this.initializeExpansionRules();
  }
  
  /**
   * Initialize intent detection patterns
   */
  private initializeIntentPatterns(): IntentPattern[] {
    return [
      {
        intent: 'search',
        patterns: [
          /find (?:all|some|any) (?:information|data|details) about/i,
          /search for/i,
          /look up/i,
          /what (?:is|are) (?:the|any)/i,
        ],
        keywords: ['find', 'search', 'look', 'what', 'where', 'when', 'who', 'how'],
        confidence: 0.8,
        description: 'General information search'
      },
      {
        intent: 'filter',
        patterns: [
          /show (?:only|just) (?:the|my)/i,
          /filter by/i,
          /where (?:.*) (?:is|equals|contains|matches)/i,
          /with (?:.*) (?:greater|less|before|after)/i,
        ],
        keywords: ['filter', 'only', 'just', 'where', 'with', 'without', 'except'],
        confidence: 0.85,
        description: 'Filter existing results'
      },
      {
        intent: 'analyze',
        patterns: [
          /analyze (?:the|my)/i,
          /what (?:patterns|trends|insights)/i,
          /how (?:many|much|often)/i,
          /statistics (?:for|about)/i,
        ],
        keywords: ['analyze', 'analysis', 'trend', 'pattern', 'insight', 'statistic', 'count', 'average'],
        confidence: 0.9,
        description: 'Analyze patterns and relationships'
      },
      {
        intent: 'find_related',
        patterns: [
          /find (?:related|connected|associated)/i,
          /what (?:is|are) (?:related|connected|linked) to/i,
          /show (?:connections|relationships) (?:for|between)/i,
          /who (?:works|reports|collaborates) with/i,
        ],
        keywords: ['related', 'connected', 'associated', 'linked', 'relationship', 'connection', 'network'],
        confidence: 0.85,
        description: 'Find related entities'
      },
      {
        intent: 'compare',
        patterns: [
          /compare (?:.*) (?:and|with|to)/i,
          /difference between/i,
          /similarities (?:between|among)/i,
          /which (?:is|are) (?:better|worse|faster|slower)/i,
        ],
        keywords: ['compare', 'comparison', 'difference', 'similar', 'versus', 'vs', 'contrast'],
        confidence: 0.9,
        description: 'Compare entities or concepts'
      },
      {
        intent: 'timeline',
        patterns: [
          /timeline (?:of|for)/i,
          /what happened (?:on|during|between)/i,
          /show (?:events|activities) (?:from|to)/i,
          /chronological (?:order|sequence)/i,
        ],
        keywords: ['timeline', 'chronological', 'sequence', 'order', 'history', 'events', 'timeline'],
        confidence: 0.8,
        description: 'View chronological information'
      },
      {
        intent: 'summary',
        patterns: [
          /summarize/i,
          /overview (?:of|for)/i,
          /brief (?:summary|overview)/i,
          /what (?:is|are) the (?:key|main) (?:points|findings)/i,
        ],
        keywords: ['summary', 'summarize', 'overview', 'brief', 'key points', 'main findings'],
        confidence: 0.85,
        description: 'Get summary of information'
      },
      {
        intent: 'recommendation',
        patterns: [
          /recommend (?:.*) (?:for|to)/i,
          /what (?:should|would) (?:I|we)/i,
          /suggest (?:.*)/i,
          /best (?:practice|approach|way)/i,
        ],
        keywords: ['recommend', 'recommendation', 'suggest', 'advice', 'best', 'should', 'would'],
        confidence: 0.8,
        description: 'Get recommendations'
      },
      {
        intent: 'exploration',
        patterns: [
          /explore (?:.*)/i,
          /browse (?:.*)/i,
          /discover (?:.*)/i,
          /what (?:else|other) (?:is|are) (?:there|available)/i,
        ],
        keywords: ['explore', 'browse', 'discover', 'navigate', 'exploration'],
        confidence: 0.75,
        description: 'Explore connections and relationships'
      }
    ];
  }
  
  /**
   * Initialize query expansion rules
   */
  private initializeExpansionRules(): QueryExpansionRule[] {
    return [
      {
        original: /project/i,
        expansions: ['initiative', 'program', 'campaign', 'effort'],
        boost: 0.3,
        context: ['work', 'business', 'management']
      },
      {
        original: /person/i,
        expansions: ['individual', 'stakeholder', 'contact', 'user'],
        boost: 0.4,
        context: ['team', 'organization', 'network']
      },
      {
        original: /organization/i,
        expansions: ['company', 'firm', 'institution', 'entity'],
        boost: 0.3,
        context: ['business', 'corporate', 'enterprise']
      },
      {
        original: /task/i,
        expansions: ['action', 'item', 'todo', 'assignment'],
        boost: 0.4,
        context: ['work', 'project', 'management']
      },
      {
        original: /goal/i,
        expansions: ['objective', 'target', 'aim', 'purpose'],
        boost: 0.5,
        context: ['planning', 'strategy', 'performance']
      },
      {
        original: /meeting/i,
        expansions: ['discussion', 'session', 'conference', 'call'],
        boost: 0.3,
        context: ['communication', 'collaboration', 'planning']
      },
      {
        original: /recent/i,
        expansions: ['latest', 'current', 'new', 'fresh'],
        boost: 0.4,
        context: ['time', 'recency', 'updates']
      },
      {
        original: /important/i,
        expansions: ['critical', 'crucial', 'significant', 'vital'],
        boost: 0.5,
        context: ['priority', 'urgency', 'significance']
      },
      {
        original: /related to/i,
        expansions: ['connected with', 'associated with', 'linked to', 'pertaining to'],
        boost: 0.3,
        context: ['relationships', 'connections', 'associations']
      },
      {
        original: /before/i,
        expansions: ['prior to', 'earlier than', 'preceding'],
        boost: 0.4,
        context: ['time', 'sequence', 'chronology']
      },
      {
        original: /after/i,
        expansions: ['following', 'subsequent to', 'later than'],
        boost: 0.4,
        context: ['time', 'sequence', 'chronology']
      }
    ];
  }
  
  /**
   * Understand and analyze a user query
   */
  async understandQuery(
    query: string,
    userId: string,
    context?: { domain?: string; previousQueries?: string[] }
  ): Promise<QueryUnderstandingResult> {
    const startTime = Date.now();
    
    try {
      // Step 1: Normalize query
      const normalizedQuery = this.normalizeQuery(query);
      
      // Step 2: Detect intent
      const intentResult = this.detectIntent(normalizedQuery);
      
      // Step 3: Extract entities
      const extractionResult = await this.entityExtractor.extractFromText(
        normalizedQuery,
        userId,
        { domain: context?.domain }
      );
      
      // Step 4: Extract filters and constraints
      const filters = this.extractFilters(normalizedQuery);
      
      // Step 5: Detect time range
      const timeRange = this.extractTimeRange(normalizedQuery);
      
      // Step 6: Determine query complexity
      const complexity = this.determineComplexity(normalizedQuery, extractionResult);
      
      // Step 7: Generate query expansions
      const suggestedExpansions = this.generateExpansions(normalizedQuery, intentResult.intent);
      
      // Step 8: Build metadata
      const metadata = this.buildMetadata(normalizedQuery, extractionResult, filters, timeRange);
      
      const processingTimeMs = Date.now() - startTime;
      
      logger.info('Query understanding completed', {
        userId,
        originalQuery: query,
        normalizedQuery,
        intent: intentResult.intent,
        confidence: intentResult.confidence,
        entitiesCount: extractionResult.entities.length,
        processingTimeMs
      });
      
      return {
        originalQuery: query,
        normalizedQuery,
        intent: intentResult.intent,
        confidence: intentResult.confidence,
        entities: extractionResult.entities.map(entity => ({
          text: entity.text,
          type: entity.type,
          confidence: entity.confidence,
          normalizedText: entity.normalizedText
        })),
        filters,
        timeRange,
        complexity,
        suggestedExpansions,
        metadata
      };
      
    } catch (error) {
      logger.error('Query understanding failed', {
        error: error instanceof Error ? error.message : String(error),
        query,
        userId
      });
      
      // Return fallback result
      return {
        originalQuery: query,
        normalizedQuery: query.toLowerCase().trim(),
        intent: 'unknown',
        confidence: 0.1,
        entities: [],
        filters: {},
        complexity: 'simple',
        suggestedExpansions: [],
        metadata: {
          hasTemporalConstraint: false,
          hasSpatialConstraint: false,
          hasEntityConstraint: false,
          hasRelationshipConstraint: false,
          wordCount: query.split(/\s+/).length,
          containsQuestions: /\?/.test(query),
          containsCommands: /^(show|find|get|list|display)/i.test(query)
        }
      };
    }
  }
  
  /**
   * Normalize query text
   */
  private normalizeQuery(query: string): string {
    // Convert to lowercase
    let normalized = query.toLowerCase();
    
    // Remove extra whitespace
    normalized = normalized.replace(/\s+/g, ' ').trim();
    
    // Remove punctuation (keep some for intent detection)
    normalized = normalized.replace(/[^\w\s?]/g, ' ');
    
    // Remove common stop words (optional, based on context)
    const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by'];
    const words = normalized.split(/\s+/);
    const filteredWords = words.filter(word => !stopWords.includes(word));
    
    return filteredWords.join(' ');
  }
  
  /**
   * Detect query intent
   */
  private detectIntent(query: string): { intent: QueryIntent; confidence: number } {
    let bestIntent: QueryIntent = 'unknown';
    let bestConfidence = 0;
    
    for (const pattern of this.intentPatterns) {
      // Check patterns
      for (const regex of pattern.patterns) {
        if (regex.test(query)) {
          if (pattern.confidence > bestConfidence) {
            bestIntent = pattern.intent;
            bestConfidence = pattern.confidence;
          }
        }
      }
      
      // Check keywords
      const keywordMatches = pattern.keywords.filter(keyword => 
        query.includes(keyword.toLowerCase())
      ).length;
      
      if (keywordMatches > 0) {
        const keywordConfidence = pattern.confidence * (keywordMatches / pattern.keywords.length);
        if (keywordConfidence > bestConfidence) {
          bestIntent = pattern.intent;
          bestConfidence = keywordConfidence;
        }
      }
    }
    
    // Adjust confidence based on query length and specificity
    const wordCount = query.split(/\s+/).length;
    const lengthFactor = Math.min(wordCount / 10, 1); // Cap at 1.0
    bestConfidence = bestConfidence * (0.7 + 0.3 * lengthFactor);
    
    return {
      intent: bestIntent,
      confidence: Math.min(bestConfidence, 0.95)
    };
  }
  
  /**
   * Extract filters from query
   */
  private extractFilters(query: string): Record<string, any> {
    const filters: Record<string, any> = {};
    
    // Date filters
    const datePatterns = [
      { pattern: /(?:after|since|from)\s+(\d{4}-\d{2}-\d{2})/i, key: 'date_after' },
      { pattern: /(?:before|until|to)\s+(\d{4}-\d{2}-\d{2})/i, key: 'date_before' },
      { pattern: /(?:on|at)\s+(\d{4}-\d{2}-\d{2})/i, key: 'date_on' },
      { pattern: /last\s+(\d+)\s+(?:days|weeks|months|years)/i, key: 'last_period' },
      { pattern: /next\s+(\d+)\s+(?:days|weeks|months|years)/i, key: 'next_period' }
    ];
    
    for (const { pattern, key } of datePatterns) {
      const match = query.match(pattern);
      if (match) {
        filters[key] = match[1];
      }
    }
    
    // Status filters
    const statusKeywords = ['active', 'completed', 'pending', 'archived', 'deleted'];
    for (const status of statusKeywords) {
      if (query.includes(status)) {
        filters.status = status;
        break;
      }
    }
    
    // Importance filters
    const importanceKeywords = ['important', 'critical', 'urgent', 'high priority'];
    for (const importance of importanceKeywords) {
      if (query.includes(importance)) {
        filters.importance = 'high';
        break;
      }
    }
    
    // Type filters
    const typePatterns = [
      { pattern: /(?:type|kind)\s+(?:of\s+)?(\w+)/i, key: 'type' },
      { pattern: /(?:category)\s+(?:of\s+)?(\w+)/i, key: 'category' },
      { pattern: /(?:tagged|labeled)\s+(?:with\s+)?(\w+)/i, key: 'tag' }
    ];
    
    for (const { pattern, key } of typePatterns) {
      const match = query.match(pattern);
      if (match) {
        filters[key] = match[1];
      }
    }
    
    // Domain filters
    const domainMatch = query.match(/(?:in|for)\s+(?:the\s+)?(\w+)\s+(?:domain|area|field)/i);
    if (domainMatch) {
      filters.domain = domainMatch[1];
    }
    
    return filters;
  }
  
  /**
   * Extract time range from query
   */
  private extractTimeRange(query: string): QueryUnderstandingResult['timeRange'] {
    const timeRange: QueryUnderstandingResult['timeRange'] = {};
    
    // Relative time ranges
    if (query.includes('today')) {
      timeRange.relative = 'today';
    } else if (query.includes('this week')) {
      timeRange.relative = 'this_week';
    } else if (query.includes('this month')) {
      timeRange.relative = 'this_month';
    } else if (query.includes('last week')) {
      timeRange.relative = 'last_week';
    } else if (query.includes('last month')) {
      timeRange.relative = 'last_month';
    }
    
    // Specific date patterns
    const datePattern = /\d{4}-\d{2}-\d{2}/;
    const dateMatch = query.match(datePattern);
    if (dateMatch) {
      const date = new Date(dateMatch[0]);
      if (query.includes('after') || query.includes('since') || query.includes('from')) {
        timeRange.start = date;
      } else if (query.includes('before') || query.includes('until') || query.includes('to')) {
        timeRange.end = date;
      } else {
        timeRange.start = date;
        timeRange.end = new Date(date.getTime() + 24 * 60 * 60 * 1000); // Next day
      }
    }
    
    return Object.keys(timeRange).length > 0 ? timeRange : undefined;
  }
  
  /**
   * Determine query complexity
   */
  private determineComplexity(
    query: string,
    extractionResult: any
  ): QueryComplexity {
    const wordCount = query.split(/\s+/).length;
    const entityCount = extractionResult.entities.length;
    const hasMultipleClauses = /(?:and|or|but|however|although)/i.test(query);
    const hasNestedStructure = /(?:that|which|who|whom|whose)/i.test(query);
    
    let score = 0;
    score += Math.min(wordCount / 5, 3); // Max 3 points for length
    score += Math.min(entityCount / 2, 2); // Max 2 points for entities
    score += hasMultipleClauses ? 1 : 0;
    score += hasNestedStructure ? 1 : 0;
    
    if (score >= 4) return 'complex';
    if (score >= 2) return 'moderate';
    return 'simple';
  }
  
  /**
   * Generate query expansions
   */
  private generateExpansions(query: string, intent: QueryIntent): string[] {
    const expansions: string[] = [];
    
    // Apply expansion rules
    for (const rule of this.expansionRules) {
      if (typeof rule.original === 'string') {
        if (query.includes(rule.original)) {
          expansions.push(...rule.expansions);
        }
      } else {
        if (rule.original.test(query)) {
          expansions.push(...rule.expansions);
        }
      }
    }
    
    // Intent-specific expansions
    switch (intent) {
      case 'search':
        expansions.push('information about', 'details regarding', 'data on');
        break;
      case 'filter':
        expansions.push('narrow down', 'refine results', 'limit to');
        break;
      case 'analyze':
        expansions.push('examine patterns in', 'study trends of', 'investigate');
        break;
      case 'find_related':
        expansions.push('discover connections to', 'explore associations with', 'find links between');
        break;
    }
    
    // Remove duplicates and limit to 5 expansions
    return [...new Set(expansions)].slice(0, 5);
  }
  
  /**
   * Build query metadata
   */
  private buildMetadata(
    query: string,
    extractionResult: any,
    filters: Record<string, any>,
    timeRange?: QueryUnderstandingResult['timeRange']
  ): QueryUnderstandingResult['metadata'] {
    return {
      hasTemporalConstraint: !!timeRange || Object.keys(filters).some(key => key.includes('date')),
      hasSpatialConstraint: query.includes('location') || query.includes('where'),
      hasEntityConstraint: extractionResult.entities.length > 0,
      hasRelationshipConstraint: query.includes('related') || query.includes('connected') || query.includes('with'),
      wordCount: query.split(/\s+/).length,
      containsQuestions: /\?/.test(query),
      containsCommands: /^(show|find|get|list|display|analyze|compare)/i.test(query)
    };
  }
  
  /**
   * Classify query by domain
   */
  async classifyQueryDomain(
    query: string,
    userId: string
  ): Promise<{ domain: string; confidence: number; alternatives: string[] }> {
    try {
      // Extract entities to infer domain
      const extractionResult = await this.entityExtractor.extractFromText(query, userId);
      
      // Analyze entity types for domain inference
      const entityTypes = extractionResult.entities.map(e => e.type);
      const typeCounts = entityTypes.reduce((acc, type) => {
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>);
      
      // Determine domain based on entity types
      let domain = 'general';
      let confidence = 0.5;
      const alternatives: string[] = [];
      
      if (typeCounts['PERSON'] > 0 && typeCounts['ORGANIZATION'] > 0) {
        domain = 'business';
        confidence = 0.8;
        alternatives.push('professional', 'corporate');
      } else if (typeCounts['PROJECT'] > 0 || typeCounts['TASK'] > 0) {
        domain = 'project_management';
        confidence = 0.75;
        alternatives.push('work', 'planning');
      } else if (typeCounts['GOAL'] > 0) {
        domain = 'strategy';
        confidence = 0.7;
        alternatives.push('planning', 'objectives');
      } else if (typeCounts['DECISION'] > 0) {
        domain = 'decision_making';
        confidence = 0.7;
        alternatives.push('analysis', 'evaluation');
      } else if (typeCounts['DATE'] > 0) {
        domain = 'temporal';
        confidence = 0.6;
        alternatives.push('timeline', 'schedule');
      }
      
      // Check for domain keywords
      const domainKeywords = {
        technical: ['code', 'software', 'system', 'technical', 'bug', 'feature'],
        creative: ['design', 'creative', 'art', 'visual', 'brand'],
        analytical: ['data', 'analysis', 'metrics', 'statistics', 'report'],
        communication: ['meeting', 'email', 'message', 'conversation', 'discussion']
      };
      
      for (const [dom, keywords] of Object.entries(domainKeywords)) {
        const matches = keywords.filter(keyword => query.toLowerCase().includes(keyword)).length;
        if (matches > 0) {
          const matchConfidence = 0.5 + (matches / keywords.length) * 0.3;
          if (matchConfidence > confidence) {
            domain = dom;
            confidence = matchConfidence;
          }
          alternatives.push(dom);
        }
      }
      
      return {
        domain,
        confidence,
        alternatives: [...new Set(alternatives)].slice(0, 3)
      };
      
    } catch (error) {
      logger.error('Query domain classification failed', {
        error: error instanceof Error ? error.message : String(error),
        query
      });
      
      return {
        domain: 'general',
        confidence: 0.1,
        alternatives: []
      };
    }
  }
  
  /**
   * Enhance query with context and expansions
   */
  async enhanceQuery(
    query: string,
    userId: string,
    context?: {
      previousQueries?: string[];
      recentEntities?: string[];
      userPreferences?: Record<string, any>;
    }
  ): Promise<{
    enhancedQuery: string;
    expansions: string[];
    contextAdditions: string[];
  }> {
    const enhancements: string[] = [];
    const expansions: string[] = [];
    const contextAdditions: string[] = [];
    
    // Get query understanding
    const understanding = await this.understandQuery(query, userId);
    
    // Add intent-based expansions
    expansions.push(...understanding.suggestedExpansions);
    
    // Add context from previous queries
    if (context?.previousQueries && context.previousQueries.length > 0) {
      const lastQuery = context.previousQueries[context.previousQueries.length - 1];
      const lastUnderstanding = await this.understandQuery(lastQuery, userId);
      
      // Carry over filters from previous query if relevant
      if (lastUnderstanding.filters && Object.keys(lastUnderstanding.filters).length > 0) {
        contextAdditions.push(`(continuing with similar filters)`);
      }
    }
    
    // Add recent entities context
    if (context?.recentEntities && context.recentEntities.length > 0) {
      const recentEntities = context.recentEntities.slice(0, 3).join(', ');
      contextAdditions.push(`(recently mentioned: ${recentEntities})`);
    }
    
    // Add user preferences context
    if (context?.userPreferences?.defaultFilters) {
      const defaultFilters = context.userPreferences.defaultFilters;
      if (defaultFilters.importance === 'high') {
        contextAdditions.push(`(showing important items by default)`);
      }
    }
    
    // Build enhanced query
    let enhancedQuery = query;
    
    // Add expansions if query is short
    if (query.split(/\s+/).length < 3 && expansions.length > 0) {
      enhancedQuery = `${query} ${expansions[0]}`;
    }
    
    // Add context if available
    if (contextAdditions.length > 0) {
      enhancedQuery = `${enhancedQuery} ${contextAdditions.join(' ')}`;
    }
    
    return {
      enhancedQuery: enhancedQuery.trim(),
      expansions,
      contextAdditions
    };
  }
  
  /**
   * Validate query for search optimization
   */
  validateQueryForSearch(query: string): {
    isValid: boolean;
    issues: string[];
    suggestions: string[];
  } {
    const issues: string[] = [];
    const suggestions: string[] = [];
    
    // Check query length
    const wordCount = query.split(/\s+/).length;
    if (wordCount < 2) {
      issues.push('Query is too short');
      suggestions.push('Add more specific terms');
    }
    
    if (wordCount > 20) {
      issues.push('Query is too long');
      suggestions.push('Focus on key concepts');
    }
    
    // Check for vague terms
    const vagueTerms = ['thing', 'stuff', 'something', 'anything', 'everything'];
    const vagueMatches = vagueTerms.filter(term => query.toLowerCase().includes(term));
    if (vagueMatches.length > 0) {
      issues.push('Contains vague terms');
      suggestions.push('Replace vague terms with specific concepts');
    }
    
    // Check for stop word overload
    const stopWords = ['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at'];
    const stopWordCount = query.split(/\s+/).filter(word => stopWords.includes(word.toLowerCase())).length;
    const stopWordRatio = stopWordCount / wordCount;
    
    if (stopWordRatio > 0.5) {
      issues.push('Too many stop words');
      suggestions.push('Focus on content words');
    }
    
    // Check for proper formatting
    if (query === query.toUpperCase()) {
      issues.push('Query is in all caps');
      suggestions.push('Use normal capitalization');
    }
    
    return {
      isValid: issues.length === 0,
      issues,
      suggestions
    };
  }
}