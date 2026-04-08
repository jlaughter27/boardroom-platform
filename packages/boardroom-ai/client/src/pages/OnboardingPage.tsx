import { useNavigate } from 'react-router-dom';
import { usePageTitle } from '../hooks/usePageTitle';
import { useOnboarding } from '../hooks/useOnboarding';
import { WizardStep } from '../components/onboarding/WizardStep';
import { AboutYouStep } from '../components/onboarding/steps/AboutYouStep';
import { GoalsStep } from '../components/onboarding/steps/GoalsStep';
import { ProjectsStep } from '../components/onboarding/steps/ProjectsStep';
import { PeopleStep } from '../components/onboarding/steps/PeopleStep';
import { ContextStep } from '../components/onboarding/steps/ContextStep';

export default function OnboardingPage() {
  usePageTitle('Welcome');
  const {
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
  } = useOnboarding();
  const navigate = useNavigate();

  const handleComplete = async () => {
    try {
      await complete();
      navigate('/');
    } catch {
      // Error is set in the hook
    }
  };

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">Welcome to BoardRoom</h1>
          <p className="text-gray-400">Let's set up your AI advisory board in a few minutes.</p>
        </div>

        {/* Error banner */}
        {error && (
          <div className="mb-4 bg-red-500/10 border border-red-500/20 rounded-lg p-3">
            <p className="text-sm text-red-400">{error}</p>
          </div>
        )}

        {/* Step 1: About You */}
        {step === 1 && (
          <WizardStep
            title="About You"
            description="Help us understand your role and context so your advisory board can give relevant advice."
            stepNumber={1}
            totalSteps={5}
            onNext={next}
            isFirst
            nextDisabled={!data.role.trim()}
          >
            <AboutYouStep data={data} onUpdate={updateData} />
          </WizardStep>
        )}

        {/* Step 2: Goals */}
        {step === 2 && (
          <WizardStep
            title="Your Goals"
            description="Tell us what you're working toward. We'll extract structured goals from your description."
            stepNumber={2}
            totalSteps={5}
            onNext={next}
            onPrev={prev}
            onSkip={next}
            isLoading={isExtracting}
          >
            <GoalsStep
              data={data}
              onUpdate={updateData}
              onExtract={extractGoals}
              isExtracting={isExtracting}
            />
          </WizardStep>
        )}

        {/* Step 3: Projects */}
        {step === 3 && (
          <WizardStep
            title="Active Projects"
            description="What are you actively working on? We'll track these to give context-aware advice."
            stepNumber={3}
            totalSteps={5}
            onNext={next}
            onPrev={prev}
            onSkip={next}
            isLoading={isExtracting}
          >
            <ProjectsStep
              data={data}
              onUpdate={updateData}
              onExtract={extractProjects}
              isExtracting={isExtracting}
            />
          </WizardStep>
        )}

        {/* Step 4: Key People */}
        {step === 4 && (
          <WizardStep
            title="Key People"
            description="Who are the important people in your work life? BoardRoom will factor them into its advice."
            stepNumber={4}
            totalSteps={5}
            onNext={next}
            onPrev={prev}
            onSkip={next}
          >
            <PeopleStep data={data} onUpdate={updateData} />
          </WizardStep>
        )}

        {/* Step 5: Context */}
        {step === 5 && (
          <WizardStep
            title="Current Context"
            description="Share what's top of mind. This gives your advisory board immediate context."
            stepNumber={5}
            totalSteps={5}
            onNext={handleComplete}
            onPrev={prev}
            isLast
            isLoading={isSubmitting}
          >
            <ContextStep data={data} onUpdate={updateData} />
          </WizardStep>
        )}
      </div>
    </div>
  );
}
