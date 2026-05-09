import { useState, useCallback } from 'react';
import * as api from '../lib/api';
import type { BootstrapExtractionResponse } from '../lib/api';

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
    return saved ? parseInt(saved, 10) : 0; // step 0 = BootstrapStep (optional)
  } catch {
    return 0;
  }
}

// Normalize a string for dedupe comparison (trim + lowercase).
function norm(s: string): string {
  return s.trim().toLowerCase();
}

// Clamp + round a goal level to a 0..3 integer. Without this a fractional
// `level` from the LLM (e.g. 1.5) passes ExtractedGoalsSchema but fails
// CreateGoalRequestSchema (.int()) — the 422 bug from report Chapter 5.
function normalizeLevel(level: number | undefined | null): number {
  if (level == null || Number.isNaN(Number(level))) return 1;
  return Math.max(0, Math.min(3, Math.round(Number(level))));
}

export function useOnboarding() {
  const [step, setStep] = useState(loadStep);
  const [data, setData] = useState<OnboardingData>(loadDraft);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const persist = (next: OnboardingData) => {
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* full */ }
  };

  const updateData = useCallback((partial: Partial<OnboardingData>) => {
    setData(prev => {
      const next = { ...prev, ...partial };
      persist(next);
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
      const prevStep = Math.max(s - 1, 0);
      try { sessionStorage.setItem(STEP_KEY, String(prevStep)); } catch { /* full */ }
      return prevStep;
    });
  };

  const goToStep = (stepNumber: number) => {
    const clamped = Math.max(0, Math.min(5, stepNumber));
    setStep(clamped);
    try { sessionStorage.setItem(STEP_KEY, String(clamped)); } catch { /* full */ }
  };

  // Step 2: extract goals from freeform text.
  //
  // Merges with dedupe-by-normalized-title. A user may have bootstrap-
  // extracted goals already in the list when they land on this step, then
  // type a few MORE into the textarea. We APPEND new ones; we NEVER replace
  // the existing array (report Chapter 4 bug).
  const extractGoals = async () => {
    if (!data.goalsText.trim()) return;
    setIsExtracting(true);
    setError(null);
    try {
      const result = await api.extractOnboardingGoals(data.goalsText);
      setData((prev) => {
        const seen = new Set(prev.extractedGoals.map((g) => norm(g.title)));
        const additions = result
          .filter((g) => g.title.trim() && !seen.has(norm(g.title)))
          .map((g) => ({ ...g, level: normalizeLevel(g.level) }));
        const nextData = { ...prev, extractedGoals: [...prev.extractedGoals, ...additions] };
        persist(nextData);
        return nextData;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract goals');
    } finally {
      setIsExtracting(false);
    }
  };

  // Step 3: same merge-with-dedupe pattern as goals.
  const extractProjects = async () => {
    if (!data.projectsText.trim()) return;
    setIsExtracting(true);
    setError(null);
    try {
      const result = await api.extractOnboardingProjects(data.projectsText);
      setData((prev) => {
        const seen = new Set(prev.extractedProjects.map((p) => norm(p.title)));
        const additions = result.filter((p) => p.title.trim() && !seen.has(norm(p.title)));
        const nextData = { ...prev, extractedProjects: [...prev.extractedProjects, ...additions] };
        persist(nextData);
        return nextData;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract projects');
    } finally {
      setIsExtracting(false);
    }
  };

  /**
   * Merge a BootstrapExtraction (from /onboarding-bootstrap/doc or /voice)
   * into the wizard state. Scalar fields overwrite ONLY if empty. Array
   * fields dedupe-append. People array replaces its single empty placeholder
   * if that's all that exists, otherwise dedupes by name.
   */
  const mergeBootstrap = useCallback((extraction: BootstrapExtractionResponse) => {
    setData((prev) => {
      const pickScalar = (currentValue: string, extractedValue: string) =>
        currentValue.trim() || extractedValue.trim() || currentValue;

      const goalSeen = new Set(prev.extractedGoals.map((g) => norm(g.title)));
      const newGoals = extraction.goals
        .filter((g) => g.title.trim() && !goalSeen.has(norm(g.title)))
        .map((g) => ({ ...g, level: normalizeLevel(g.level) }));

      const projectSeen = new Set(prev.extractedProjects.map((p) => norm(p.title)));
      const newProjects = extraction.projects.filter(
        (p) => p.title.trim() && !projectSeen.has(norm(p.title)),
      );

      // People: if the only entry is the blank placeholder, replace it.
      const existingPeople = prev.people.filter((p) => p.name.trim().length > 0);
      const personSeen = new Set(existingPeople.map((p) => norm(p.name)));
      const newPeople = extraction.people.filter(
        (p) => p.name.trim() && !personSeen.has(norm(p.name)),
      );
      const mergedPeople = existingPeople.length > 0
        ? [...existingPeople, ...newPeople]
        : newPeople.length > 0
          ? newPeople
          : prev.people;

      const next: OnboardingData = {
        ...prev,
        role: pickScalar(prev.role, extraction.role),
        industry: pickScalar(prev.industry, extraction.industry),
        decisionFrequency: pickScalar(prev.decisionFrequency, extraction.decisionFrequency),
        extractedGoals: [...prev.extractedGoals, ...newGoals],
        extractedProjects: [...prev.extractedProjects, ...newProjects],
        people: mergedPeople,
        biggestDecision: pickScalar(prev.biggestDecision, extraction.biggestDecision),
        worries: pickScalar(prev.worries, extraction.worries),
      };
      persist(next);
      return next;
    });
  }, []);

  /**
   * Step 0 — Bootstrap from a document upload (file, paste, etc.).
   * On success, merges the extraction into wizard state and advances to
   * the About You step (step 1) so the user can review before committing.
   */
  const bootstrapFromDoc = useCallback(async (file: File) => {
    setIsExtracting(true);
    setError(null);
    try {
      const extraction = await api.bootstrapFromDoc(file);
      mergeBootstrap(extraction);
      goToStep(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to extract from document');
      throw err;
    } finally {
      setIsExtracting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergeBootstrap]);

  /**
   * Step 0 — Bootstrap from a voice recording. Transcribed server-side.
   */
  const bootstrapFromVoice = useCallback(async (blob: Blob, mimeType: string) => {
    setIsExtracting(true);
    setError(null);
    try {
      const { extraction } = await api.bootstrapFromVoice(blob, mimeType);
      mergeBootstrap(extraction);
      goToStep(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to transcribe and extract');
      throw err;
    } finally {
      setIsExtracting(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergeBootstrap]);

  /** Skip the bootstrap step and go straight to the manual wizard. */
  const skipBootstrap = () => goToStep(1);

  // Final submit — creates all entities and marks onboarding complete.
  //
  // Guards against the 422 from POST /goals (report Chapter 5):
  //   - Skip any goal/project/person with empty title/name after trimming.
  //   - Coerce `level` to an integer 0..3 before createGoal.
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
        if (!goal.title.trim()) continue;
        await api.createGoal({
          title: goal.title.trim(),
          level: normalizeLevel(goal.level),
          domain: goal.domain,
        });
      }

      // Create projects
      for (const project of data.extractedProjects) {
        if (!project.title.trim()) continue;
        await api.createProject({
          title: project.title.trim(),
          domain: project.domain,
          status: project.status,
        });
      }

      // Create people (skip empty rows)
      for (const person of data.people) {
        if (person.name.trim()) {
          await api.createPerson({
            name: person.name.trim(),
            role: person.role,
            relationshipToUser: person.relationship,
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
    goToStep,
    extractGoals,
    extractProjects,
    bootstrapFromDoc,
    bootstrapFromVoice,
    skipBootstrap,
    mergeBootstrap,
    complete,
    isExtracting,
    isSubmitting,
    error,
  };
}
