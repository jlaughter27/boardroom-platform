import { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Button, Card, Input } from '../ui';

interface SimulationButtonProps {
  defaultPath?: string;
  isSimulating: boolean;
  onSimulate: (chosenPath: string) => void;
}

export function SimulationButton({ defaultPath, isSimulating, onSimulate }: SimulationButtonProps) {
  const [chosenPath, setChosenPath] = useState(defaultPath ?? '');
  const [expanded, setExpanded] = useState(false);

  function handleSubmit() {
    if (!chosenPath.trim()) return;
    onSimulate(chosenPath.trim());
  }

  if (!expanded) {
    return (
      <Button
        variant="secondary"
        onClick={() => setExpanded(true)}
        disabled={isSimulating}
      >
        {isSimulating ? 'Simulating...' : '\uD83E\uDDEA Run Simulation'}
      </Button>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      className="overflow-hidden"
    >
      <Card className="bg-accent-secondary/10 border-accent-secondary/30 space-y-3">
        <div className="text-sm font-medium text-text-primary">Simulate a decision path</div>
        <textarea
          value={chosenPath}
          onChange={(e) => setChosenPath(e.target.value)}
          placeholder="Describe the path you want to simulate..."
          rows={2}
          className="w-full bg-bg-base border border-line rounded-md p-3 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent/30 outline-none resize-y"
        />
        <div className="flex items-center gap-2">
          <Button variant="primary" onClick={handleSubmit} disabled={!chosenPath.trim() || isSimulating}>
            {isSimulating ? 'Simulating...' : 'Run Simulation'}
          </Button>
          <Button variant="ghost" onClick={() => setExpanded(false)}>
            Cancel
          </Button>
        </div>
      </Card>
    </motion.div>
  );
}
