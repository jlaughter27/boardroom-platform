import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { usePageTitle } from '../hooks/usePageTitle';
import { useOnboarding } from '../hooks/useOnboarding';
import { useToastStore } from '../components/ui';
import { WizardStep } from '../components/onboarding/WizardStep';
import { BootstrapStep } from '../components/onboarding/steps/BootstrapStep';
import { AboutYouStep } from '../components/onboarding/steps/AboutYouStep';
import { GoalsStep } from '../components/onboarding/steps/GoalsStep';
import { ProjectsStep } from '../components/onboarding/steps/ProjectsStep';
import { PeopleStep } from '../components/onboarding/steps/PeopleStep';
import { ContextStep } from '../components/onboarding/steps/ContextStep';

const CONFETTI_COLORS = [
  'var(--color-primary)',
  'var(--color-primary-warm)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-info)',
];

function CelebrationScreen() {
  const particles = useMemo(
    () =>
      Array.from({ length: 25 }, (_, i) => ({
        id: i,
        x: (Math.random() - 0.5) * 400,
        y: (Math.random() - 0.5) * 400,
        rotation: Math.random() * 720 - 360,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        size: 4 + Math.random() * 6,
        delay: Math.random() * 0.3,
      })),
    []
  );

  return (
    <div className="relative flex flex-col items-center justify-center py-16">
      {/* Confetti */}
      {particles.map((p) => (
        <motion.div
          key={p.id}
          initial={{ opacity: 1, x: 0, y: 0, scale: 1, rotate: 0 }}
          animate={{
            opacity: 0,
            x: p.x,
            y: p.y,
            scale: 0.5,
            rotate: p.rotation,
          }}
          transition={{ duration: 1.5, delay: p.delay, ease: 'easeOut' }}
          className="absolute rounded-full"
          style={{
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
          }}
        />
      ))}

      {/* Checkmark */}
      <motion.div
        initial={{ opacity: 0, scale: 0.5 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
        className="w-16 h-16 rounded-full bg-success/20 flex items-center justify-center mb-6"
      >
        <span className="text-success text-3xl">{'\u2713'}</span>
      </motion.div>

      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-2xl font-semibold text-foreground mb-2"
      >
        You're all set!
      </motion.h2>
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="text-muted-foreground"
      >
        Redirecting to your dashboard...
      </motion.p>
    </div>
  );
}

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
    bootstrapFromDoc,
    bootstrapFromVoice,
    skipBootstrap,
    complete,
    isExtracting,
    isSubmitting,
    error,
  } = useOnboarding();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const [showCelebration, setShowCelebration] = useState(false);
  const [direction, setDirection] = useState(1); // 1 = forward, -1 = backward

  const handleNext = () => {
    setDirection(1);
    next();
  };

  const handlePrev = () => {
    setDirection(-1);
    prev();
  };

  const handleComplete = async () => {
    try {
      await complete();
      setShowCelebration(true);
      setTimeout(() => navigate('/'), 2000);
    } catch {
      if (error) addToast(error, 'error');
    }
  };

  // Show error as toast
  if (error && !showCelebration) {
    addToast(error, 'error');
  }

  const slideVariants = {
    enter: (d: number) => ({ x: d > 0 ? 20 : -20, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (d: number) => ({ x: d > 0 ? -20 : 20, opacity: 0 }),
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-2xl relative z-10">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="font-display text-3xl font-bold mb-2">
            <span className="text-blue-600 dark:text-blue-400">Welcome</span> <span className="text-foreground">to BoardRoom</span>
          </h1>
          <p className="text-muted-foreground">Let's set up your AI advisory board in a few minutes.</p>
        </div>

        {showCelebration ? (
          <div className="bg-card rounded-xl border border-border shadow-lg">
            <CelebrationScreen />
          </div>
        ) : (
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            >
              {step === 0 && (
                <div className="bg-card rounded-xl border border-border shadow-lg p-6 sm:p-8">
                  <BootstrapStep
                    onUploadDoc={async (file) => {
                      setDirection(1);
                      await bootstrapFromDoc(file);
                    }}
                    onUploadVoice={async (blob, mimeType) => {
                      setDirection(1);
                      await bootstrapFromVoice(blob, mimeType);
                    }}
                    onSkip={() => {
                      setDirection(1);
                      skipBootstrap();
                    }}
                    isProcessing={isExtracting}
                    error={error}
                  />
                </div>
              )}

              {step === 1 && (
                <WizardStep
                  title="About You"
                  description="Help us understand your role and context so your advisory board can give relevant advice."
                  stepNumber={1}
                  totalSteps={5}
                  onNext={handleNext}
                  onPrev={handlePrev}
                  nextDisabled={!data.role.trim()}
                >
                  <AboutYouStep data={data} onUpdate={updateData} />
                </WizardStep>
              )}

              {step === 2 && (
                <WizardStep
                  title="Your Goals"
                  description="Tell us what you're working toward. We'll extract structured goals from your description."
                  stepNumber={2}
                  totalSteps={5}
                  onNext={handleNext}
                  onPrev={handlePrev}
                  onSkip={handleNext}
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

              {step === 3 && (
                <WizardStep
                  title="Active Projects"
                  description="What are you actively working on? We'll track these to give context-aware advice."
                  stepNumber={3}
                  totalSteps={5}
                  onNext={handleNext}
                  onPrev={handlePrev}
                  onSkip={handleNext}
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

              {step === 4 && (
                <WizardStep
                  title="Key People"
                  description="Who are the important people in your work life? BoardRoom will factor them into its advice."
                  stepNumber={4}
                  totalSteps={5}
                  onNext={handleNext}
                  onPrev={handlePrev}
                  onSkip={handleNext}
                >
                  <PeopleStep data={data} onUpdate={updateData} />
                </WizardStep>
              )}

              {step === 5 && (
                <WizardStep
                  title="Current Context"
                  description="Share what's top of mind. This gives your advisory board immediate context."
                  stepNumber={5}
                  totalSteps={5}
                  onNext={handleComplete}
                  onPrev={handlePrev}
                  isLast
                  isLoading={isSubmitting}
                >
                  <ContextStep data={data} onUpdate={updateData} />
                </WizardStep>
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  );
}
