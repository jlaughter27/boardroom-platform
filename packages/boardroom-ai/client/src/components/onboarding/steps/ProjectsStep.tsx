import { motion, AnimatePresence } from 'motion/react';
import type { OnboardingData } from '../../../hooks/useOnboarding';
import { Button, Card, Badge, Input } from '../../ui';
import { staggerContainer, staggerItem } from '../../../lib/motion';

const STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'planning', label: 'Planning' },
  { value: 'paused', label: 'Paused' },
];

interface Props {
  data: OnboardingData;
  onUpdate: (partial: Partial<OnboardingData>) => void;
  onExtract: () => void;
  isExtracting: boolean;
}

export function ProjectsStep({ data, onUpdate, onExtract, isExtracting }: Props) {
  const updateProject = (index: number, field: string, value: string) => {
    const updated = [...data.extractedProjects];
    updated[index] = { ...updated[index], [field]: value };
    onUpdate({ extractedProjects: updated });
  };

  const removeProject = (index: number) => {
    onUpdate({ extractedProjects: data.extractedProjects.filter((_, i) => i !== index) });
  };

  const addProject = () => {
    onUpdate({
      extractedProjects: [...data.extractedProjects, { title: '', domain: 'business', status: 'active' }],
    });
  };

  const statusVariant = (s: string): 'success' | 'info' | 'default' =>
    s === 'active' ? 'success' : s === 'planning' ? 'info' : 'default';

  return (
    <div className="space-y-5">
      <div>
        <label className="block text-sm font-medium text-muted-foreground mb-1.5">
          What projects are you actively working on?
        </label>
        <textarea
          value={data.projectsText}
          onChange={(e) => onUpdate({ projectsText: e.target.value })}
          placeholder="e.g. We're rebuilding our mobile app, migrating to a new CRM, preparing for a Series B fundraise..."
          rows={4}
          className="w-full bg-background border border-border rounded-md px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/40 focus:ring-1 focus:ring-ring/30 transition-all duration-fast outline-none resize-none"
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={onExtract}
          disabled={isExtracting || !data.projectsText.trim()}
          className="mt-2"
        >
          {isExtracting ? 'Extracting...' : '\u2728 Extract Projects'}
        </Button>
      </div>

      <AnimatePresence>
        {data.extractedProjects.length > 0 && (
          <motion.div {...staggerContainer} className="space-y-3">
            <p className="text-sm text-muted-foreground">Review and edit your projects:</p>
            {data.extractedProjects.map((project, i) => (
              <motion.div key={i} {...staggerItem}>
                <Card hover className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <Input
                      value={project.title}
                      onChange={(e) => updateProject(i, 'title', e.target.value)}
                      placeholder="Project title"
                      className="flex-1"
                    />
                    <Button variant="ghost" size="sm" onClick={() => removeProject(i)}>
                      Remove
                    </Button>
                  </div>
                  <div className="flex gap-3 items-center">
                    <Badge variant={statusVariant(project.status)}>
                      {STATUS_OPTIONS.find((o) => o.value === project.status)?.label ?? 'Active'}
                    </Badge>
                    <Input
                      value={project.domain}
                      onChange={(e) => updateProject(i, 'domain', e.target.value)}
                      placeholder="Domain (e.g. business, personal)"
                      className="flex-1"
                    />
                  </div>
                </Card>
              </motion.div>
            ))}
            <Button variant="ghost" size="sm" onClick={addProject}>
              + Add another project
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
