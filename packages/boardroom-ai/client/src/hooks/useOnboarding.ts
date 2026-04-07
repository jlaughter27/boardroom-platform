import { useState, useCallback } from 'react';
import * as api from '../lib/api';

export interface OnboardingData {
  // Step 1: About You
  role: string;
  industry: string;
  decisionFrequency: string;
  // Step 2: Goals
  goalsText: string;
  extractedGoals: { title: string; level: number; domain: string }[];
  // Step 3: Projects
  projectsText: string;
  extractedProjects: { title: string; domain: string; status: string }[];
  // Step 4: Key People
  people: { name: string; role: string; relationship: string }[];
  // Step 5: Context
  biggestDecision: string;
  worries: string;
}

const defaults: OnboardingData = {
  role: '',
  industry: '',
  decisionFrequency: '',
  goalsText: '',
  extractedGoals: [],
  projectsText: '',
  extractedProjects: [],
  people: [{ name: '', role: '', relationship: '' }],
  biggestDecision: '',
  worries: '',
};

export function useOnboarding() {
  const [step, setStep] = useState(1);
  const [data, setData] = useState<OnboardingData>({ ...defaults });
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateData = useCallback((partial: Partial<OnboardingData>) => {
    setData(prev => ({ ...prev, ...partial }));
  }, []);

  const next = () => setStep(s => Math.min(s + 1, 5));
  const prev = () => setStep(s => Math.max(s - 1, 1));

  // Step 2: extract goals from freeform text
  const extractGoals = async () => {
    if (!data.goalsText.trim()) return;
    setIsExtracting(true);
    setError(null);
    try {
      const result = await api.extractOnboardingGoals(data.goalsText);
      updateData({ extractedGoals: result });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract goals');
    } finally {
      setIsExtracting(false);
    }
  };

  // Step 3: extract projects
  const extractProjects = async () => {
    if (!data.projectsText.trim()) return;
    setIsExtracting(true);
    setError(null);
    try {
      const result = await api.extractOnboardingProjects(data.projectsText);
      updateData({ extractedProjects: result });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract projects');
    } finally {
      setIsExtracting(false);
    }
  };

  // Final submit — creates all entities and marks onboarding complete
  const complete = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      // Save profile
      await api.updateUserProfile({
        role: data.role,
        industry: data.industry,
        decisionFrequency: data.decisionFrequency,
      });

      // Create goals
      for (const goal of data.extractedGoals) {
        await api.createGoal({
          title: goal.title,
          level: goal.level,
          domain: goal.domain,
        });
      }

      // Create projects
      for (const project of data.extractedProjects) {
        await api.createProject({
          title: project.title,
          domain: project.domain,
          status: project.status,
        });
      }

      // Create people (skip empty rows)
      for (const person of data.people) {
        if (person.name.trim()) {
          await api.createPerson({
            name: person.name,
            role: person.role,
            relationship: person.relationship,
          });
        }
      }

      // Create context memories
      if (data.biggestDecision.trim()) {
        await api.createMemory({
          title: 'Current biggest decision',
          content: data.biggestDecision,
          domain: 'personal',
          sourceType: 'MANUAL',
          memoryClass: 'SEMANTIC',
          importance: 0.9,
        });
      }

      if (data.worries.trim()) {
        await api.createMemory({
          title: 'Current concerns',
          content: data.worries,
          domain: 'personal',
          sourceType: 'MANUAL',
          memoryClass: 'SEMANTIC',
          importance: 0.8,
        });
      }

      // Mark onboarding complete
      await api.completeOnboarding();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete onboarding');
      throw err;
    } finally {
      setIsSubmitting(false);
    }
  };

  return {
    step,
    data,
    updateData,
    next,
    prev,
    extractGoals,
    extractProjects,
    complete,
    isExtracting,
    isSubmitting,
    error,
  };
}
