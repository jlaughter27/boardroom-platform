// Simulation types — Decision impact simulation after CEO synthesis

export type SimulationType = 'resource' | 'timeline' | 'stakeholder' | 'full';

export type RiskLevel = 'low' | 'medium' | 'high';

export interface SimulationRequest {
  sessionId: string;
  chosenPath: string;
  sessionQuestion: string;
  simulationType: SimulationType;
}

export interface ResourceSimulation {
  budgetRequired: string;
  peopleRequired: string;
  gapAnalysis: string;
  confidence: number;
}

export interface TimelineMilestone {
  name: string;
  date: string;
  risk: RiskLevel;
}

export interface TimelineSimulation {
  estimatedDuration: string;
  milestones: TimelineMilestone[];
  historicalComparison: string;
  confidence: number;
}

export interface ImpactedPerson {
  name: string;
  impact: string;
  action: string;
}

export interface StakeholderSimulation {
  impactedPeople: ImpactedPerson[];
  rippleEffects: string[];
  communicationNeeded: string[];
}

export interface SimulationResult {
  resourceImpact: ResourceSimulation;
  timelineImpact: TimelineSimulation;
  stakeholderImpact: StakeholderSimulation;
  overallRisk: RiskLevel;
}
