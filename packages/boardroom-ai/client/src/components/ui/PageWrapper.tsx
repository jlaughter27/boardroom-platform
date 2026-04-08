import { motion } from 'motion/react';
import { pageTransition } from '../../lib/motion';

export function PageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <motion.div {...pageTransition}>
      {children}
    </motion.div>
  );
}
