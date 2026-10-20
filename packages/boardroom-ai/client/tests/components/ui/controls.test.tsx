import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { Switch } from '../../../src/components/ui/Switch';
import { Slider } from '../../../src/components/ui/Slider';
import { Tabs } from '../../../src/components/ui/Tabs';
import { Select } from '../../../src/components/ui/Select';
import { PageHeader } from '../../../src/components/ui/PageHeader';
import { Button } from '../../../src/components/ui/Button';

describe('Switch', () => {
  it('is a labelled switch that reports its next state', () => {
    const onChange = vi.fn();
    render(<Switch aria-label="Show widget" checked={false} onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'Show widget' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('reads an external label through aria-labelledby and honours disabled', () => {
    render(
      <>
        <span id="lbl">Cognitive Load</span>
        <Switch aria-labelledby="lbl" checked disabled />
      </>
    );
    const sw = screen.getByRole('switch', { name: 'Cognitive Load' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw).toHaveAttribute('data-disabled');
  });
});

describe('Slider', () => {
  it('exposes the value and formats aria-valuetext', () => {
    render(<Slider aria-label="Financial" value={0.35} min={0} max={1} step={0.01} format={(v) => v.toFixed(2)} />);
    const thumb = screen.getByRole('slider', { name: 'Financial' });
    expect(thumb).toHaveAttribute('aria-valuenow', '0.35');
    expect(thumb).toHaveAttribute('aria-valuetext', '0.35');
    // Base UI renders the slider role on a native range input: bounds are `min` / `max`.
    expect(thumb.getAttribute('aria-valuemin') ?? thumb.getAttribute('min')).toBe('0');
    expect(thumb.getAttribute('aria-valuemax') ?? thumb.getAttribute('max')).toBe('1');
  });

  it('steps with the arrow keys and reports the new value', () => {
    const onChange = vi.fn();
    render(<Slider aria-label="Technical" value={0.5} step={0.01} largeStep={0.1} onChange={onChange} />);
    const thumb = screen.getByRole('slider', { name: 'Technical' });
    thumb.focus();
    fireEvent.keyDown(thumb, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalled();
    expect(onChange.mock.calls[0][0]).toBeCloseTo(0.51, 5);
  });

  it('renders the value bubble (hidden at rest) and the readout format', () => {
    render(<Slider aria-label="People" value={0.5} format={(v) => `${Math.round(v * 100)}%`} />);
    expect(screen.getByText('50%')).toHaveClass('opacity-0');
  });
});

describe('Tabs — segmented', () => {
  const tabs = [
    { id: 'a', label: 'Decide', icon: <svg data-testid="icon-a" /> },
    { id: 'b', label: 'Plan' },
    { id: 'c', label: 'Review' },
  ];

  it('renders a capsule tablist with icons and no panels when tabs carry no content', () => {
    const { container } = render(<Tabs variant="segmented" aria-label="Analysis mode" tabs={tabs} value="a" />);
    const list = screen.getByRole('tablist', { name: 'Analysis mode' });
    expect(list.className).toContain('rounded-capsule');
    expect(within(list).getAllByRole('tab')).toHaveLength(3);
    expect(screen.getByTestId('icon-a')).toBeInTheDocument();
    expect(container.querySelector('[role="tabpanel"]')).toBeNull();
  });

  it('reports the picked segment', () => {
    const onChange = vi.fn();
    render(<Tabs variant="segmented" tabs={tabs} value="a" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Plan' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('keeps the underline variant with panels by default', () => {
    render(<Tabs tabs={[{ id: 'x', label: 'One', content: <p>Panel one</p> }, { id: 'y', label: 'Two', content: <p>Panel two</p> }]} />);
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Panel one');
  });
});

describe('Select sizes and labelling', () => {
  const options = [{ value: 'small', label: 'Small' }, { value: 'full', label: 'Full width' }];

  it('renders a 28 px trigger in the sm size that a label can point at', () => {
    render(
      <>
        <label htmlFor="size">Size</label>
        <Select id="size" size="sm" options={options} value="full" title="Why disabled" />
      </>
    );
    const trigger = screen.getByRole('combobox', { name: 'Size' });
    expect(trigger.className).toContain('h-7');
    expect(trigger).toHaveAttribute('title', 'Why disabled');
    expect(trigger).toHaveTextContent('Full width');
  });

  it('defaults to the 36 px control', () => {
    render(<Select aria-label="Frequency" options={options} />);
    expect(screen.getByRole('combobox', { name: 'Frequency' }).className).toContain('h-9');
  });
});

describe('PageHeader', () => {
  it('renders a Large-Title h1, the subtitle and the actions', () => {
    render(<PageHeader title="Settings" subtitle="Profile and billing" actions={<button type="button">Save</button>} />);
    const h1 = screen.getByRole('heading', { level: 1, name: 'Settings' });
    expect(h1.className).toContain('text-3xl');
    expect(h1.className).toContain('tracking-display');
    expect(h1.className).toContain('text-balance');
    expect(screen.getByText('Profile and billing')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
  });

  it('can render as h2 and centred', () => {
    render(<PageHeader as="h2" align="center" title="New Decision" />);
    const h2 = screen.getByRole('heading', { level: 2, name: 'New Decision' });
    expect(h2.closest('header')?.className).toContain('text-center');
  });
});

describe('Button icon size', () => {
  it('is a 32 px square', () => {
    render(<Button size="icon" variant="ghost" aria-label="Move up">↑</Button>);
    const b = screen.getByRole('button', { name: 'Move up' });
    expect(b.className).toContain('h-8');
    expect(b.className).toContain('w-8');
  });
});
