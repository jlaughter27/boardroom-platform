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

const STORAGE_KEY = 'boardroom_onboarding_draft';
const STEP_KEY = 'boardroom_onboarding_step';

function loadDraft(): OnboardingData {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : { ...defaults };
  } catch {
    return { ...defaults };
  }
}

function loadStep(): number {
  try {
    const saved = sessionStorage.getItem(STEP_KEY);
    return saved ? parseInt(saved, 10) : 1;
  } catch {
    return 1;
  }
}

export function useOnboarding() {
  const [step, setStep] = useState(loadStep);
  const [data, setData] = useState<OnboardingData>(loadDraft);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateData = useCallback((partial: Partial<OnboardingData>) => {
    setData(prev => {
      const next = { ...prev, ...partial };
      try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* full */ }
      return next;
    });
  }, []);

  const next = () => {
    setStep(s => {
      const nextStep = Math.min(s + 1, 5);
      try { sessionStorage.setItem(STEP_KEY, String(nextStep)); } catch { /* full */ }
      return nextStep;
    });
  };

  const prev = () => {
    setStep(s => {
      const prevStep = Math.max(s - 1, 1);
      try { sessionStorage.setItem(STEP_KEY, String(prevStep)); } catch { /* full */ }
      return prevStep;
    });
  };

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

      // Clear draft on success
      sessionStorage.removeItem(STORAGE_KEY);
      sessionStorage.removeItem(STEP_KEY);
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
