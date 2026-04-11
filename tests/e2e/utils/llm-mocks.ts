// LLM mocking utilities for E2E and integration tests
// Provides deterministic responses to avoid actual API calls

import { Anthropic } from '@anthropic-ai/sdk';

const MOCK_RESPONSES = {
  // Session-related responses
  sessionQuestion: `Based on the analysis of expanding into the European market this quarter:

**Pros:**
- Access to new customer base (approx. 500M potential users)
- First-mover advantage in emerging EU tech markets
- Diversification reduces dependency on domestic market

**Cons:**
- Regulatory complexity (GDPR, local compliance)
- Higher operational costs (estimated 30-40% increase)
- Cultural and language barriers

**Recommendation:** Proceed with a phased approach:
1. Pilot in 2-3 strategic EU countries
2. Budget for regulatory consultation
3. Hire local market experts

**Confidence:** Medium-High (75%)`,

  // Persona responses
  personaCFO: `**CFO Analysis:**
- Initial investment: $2.5M (setup, compliance, hiring)
- Break-even timeline: 18-24 months
- ROI projection: 22% over 3 years
- Risk assessment: Moderate (currency fluctuations, regulatory changes)
- Recommendation: Proceed if Q2 revenue targets are met`,

  personaCMO: `**CMO Analysis:**
- Market opportunity: $15B TAM in target verticals
- Competitive landscape: 3 major players, moderate saturation
- Brand positioning: Premium AI decision intelligence
- Go-to-market: Digital-first, partnerships with EU tech hubs
- Success metrics: 10% market share within 12 months`,

  personaCTO: `**CTO Analysis:**
- Technical feasibility: High (existing infrastructure adaptable)
- Compliance requirements: GDPR, data localization, security certifications
- Timeline: 3-4 months for MVP, 6-8 months for full deployment
- Team scaling: Need 5-7 additional engineers with EU market experience
- Key risks: Data sovereignty laws, cross-border latency`,

  // Memory extraction
  memoryProposals: [
    {
      index: 0,
      title: 'European market expansion financial projections',
      content: 'Initial investment required: $2.5M. Break-even timeline: 18-24 months. ROI projection: 22% over 3 years.',
      domain: 'finance',
      memoryClass: 'SEMANTIC',
      importance: 0.8,
      confidence: 'HIGH'
    },
    {
      index: 1,
      title: 'EU regulatory compliance requirements',
      content: 'Must comply with GDPR, data localization laws, and obtain necessary security certifications for EU operations.',
      domain: 'legal',
      memoryClass: 'SEMANTIC',
      importance: 0.9,
      confidence: 'HIGH'
    }
  ],

  // Sufficiency scoring
  sufficiencyScore: {
    sufficiency: 0.65,
    ambiguity: 0.35,
    questions: [
      'Which specific European countries are being considered?',
      'What is the current Q2 revenue projection?',
      'Are there existing partnerships or relationships in the target markets?'
    ]
  }
};

export function createMockAnthropicClient(): Anthropic {
  const mockClient = {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: MOCK_RESPONSES.sessionQuestion }],
        id: 'msg_mock',
        model: 'claude-3-sonnet-20241022',
        role: 'assistant',
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 500 }
      })
    }
  } as unknown as Anthropic;

  return mockClient;
}

export function getMockPersonaResponse(persona: string): string {
  switch (persona.toLowerCase()) {
    case 'cfo':
      return MOCK_RESPONSES.personaCFO;
    case 'cmo':
      return MOCK_RESPONSES.personaCMO;
    case 'cto':
      return MOCK_RESPONSES.personaCTO;
    default:
      return `**${persona} Analysis:**\nMock response for ${persona} persona.`;
  }
}

export function getMockMemoryProposals() {
  return MOCK_RESPONSES.memoryProposals;
}

export function getMockSufficiencyScore() {
  return MOCK_RESPONSES.sufficiencyScore;
}

export function mockLLMResponses() {
  // This function should be called in test setup to mock LLM responses
  if (process.env.MOCK_LLM === 'true') {
    console.log('⚠️  LLM responses are mocked for testing');
    // Implementation would patch the actual LLM clients
    // This is a placeholder for actual mocking implementation
  }
}
