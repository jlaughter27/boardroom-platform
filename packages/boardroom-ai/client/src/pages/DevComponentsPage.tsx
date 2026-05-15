/**
 * /dev/components — visual QA gallery for the design system.
 *
 * Gated behind `import.meta.env.DEV` in App.tsx so it doesn't ship to prod
 * bundles. Renders every UI primitive in every meaningful state for
 * pre-launch visual verification.
 *
 * Authors: Track F (2026-05-15). Audit ref: deliverable #14 in the dev-prompt.
 */
import { useState } from 'react';
import {
  Button,
  Card,
  Input,
  Badge,
  Skeleton,
  Tooltip,
  Avatar,
  Progress,
  Tabs,
  Select,
  Dialog,
  AnimatedCount,
  EmptyState,
  useToastStore,
} from '../components/ui';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-6 mt-6 first:border-t-0 first:pt-0 first:mt-0">
      <h2 className="text-lg font-semibold text-foreground mb-4">{title}</h2>
      <div className="flex flex-wrap items-start gap-4">{children}</div>
    </section>
  );
}

export default function DevComponentsPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectValue, setSelectValue] = useState('a');
  const addToast = useToastStore((s) => s.addToast);

  return (
    <div className="min-h-screen bg-background text-foreground p-8 max-w-5xl mx-auto">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold">Design System — Dev Gallery</h1>
        <p className="text-sm text-muted-foreground">
          Dev-only QA surface. Renders every primitive in every state.
        </p>
      </header>

      <Section title="Button — variants">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="success">Success</Button>
      </Section>

      <Section title="Button — sizes">
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
        <Button size="lg">Large</Button>
      </Section>

      <Section title="Button — states">
        <Button>Default</Button>
        <Button disabled>Disabled</Button>
        <Button loading>Loading…</Button>
      </Section>

      <Section title="Input">
        <div className="w-64"><Input label="Email" placeholder="you@example.com" /></div>
        <div className="w-64"><Input label="With error" error="Invalid" defaultValue="bad" /></div>
        <div className="w-64"><Input label="Number" type="number" defaultValue={42} /></div>
        <div className="w-64"><Input label="Disabled" placeholder="—" disabled /></div>
      </Section>

      <Section title="Badge">
        <Badge>Default</Badge>
        <Badge variant="success">Success</Badge>
        <Badge variant="warning">Warning</Badge>
        <Badge variant="danger">Danger</Badge>
        <Badge variant="info">Info</Badge>
      </Section>

      <Section title="Avatar">
        <Avatar name="Alice Anderson" size="sm" />
        <Avatar name="Bob Brown" size="md" />
        <Avatar name="Cara Coleman" size="lg" />
      </Section>

      <Section title="Tooltip">
        <Tooltip content="Top tooltip"><Button variant="secondary">Hover me</Button></Tooltip>
        <Tooltip side="right" content="Right tooltip"><Button variant="secondary">Right</Button></Tooltip>
        <Tooltip content="Rich tooltip with longer multi-line copy that wraps at the max-width." maxWidth="14rem">
          <Button variant="secondary">Rich</Button>
        </Tooltip>
      </Section>

      <Section title="Progress">
        <div className="w-64 space-y-3">
          <Progress value={0} />
          <Progress value={35} />
          <Progress value={75} />
          <Progress value={100} />
        </div>
      </Section>

      <Section title="AnimatedCount">
        <span className="text-3xl font-semibold">
          <AnimatedCount value={1234} />
        </span>
      </Section>

      <Section title="Skeleton">
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-10 w-64" />
      </Section>

      <Section title="Select">
        <div className="w-48">
          <Select
            value={selectValue}
            onChange={(v) => setSelectValue(v)}
            options={[
              { value: 'a', label: 'Option A' },
              { value: 'b', label: 'Option B' },
              { value: 'c', label: 'Option C' },
            ]}
          />
        </div>
      </Section>

      <Section title="Tabs">
        <Tabs
          tabs={[
            { id: 'one', label: 'Tab one', content: <p className="p-4">Tab one body.</p> },
            { id: 'two', label: 'Tab two', content: <p className="p-4">Tab two body.</p> },
          ]}
        />
      </Section>

      <Section title="Card">
        <Card>
          <Card.Header>
            <h3 className="font-semibold">Title</h3>
          </Card.Header>
          <Card.Body>Card body content goes here.</Card.Body>
        </Card>
      </Section>

      <Section title="Dialog">
        <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
        <Dialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          title="Dialog title"
          description="Short description of what this dialog does."
        >
          <p className="text-sm">Body content.</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={() => setDialogOpen(false)}>Confirm</Button>
          </div>
        </Dialog>
      </Section>

      <Section title="Toast">
        <Button onClick={() => addToast('Saved successfully', 'success')}>Success toast</Button>
        <Button variant="secondary" onClick={() => addToast('Heads up', 'info')}>Info toast</Button>
        <Button variant="secondary" onClick={() => addToast('Be careful', 'warning')}>Warning toast</Button>
        <Button variant="danger" onClick={() => addToast('Something broke', 'error')}>Error toast</Button>
      </Section>

      <Section title="EmptyState">
        <EmptyState
          title="No results"
          description="There's nothing here yet — try a different search."
        />
      </Section>
    </div>
  );
}
