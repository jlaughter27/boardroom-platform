import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SuggestionChips } from '../../../src/components/decision/SuggestionChips';
import { SAMPLE_DECISION_QUESTIONS } from '../../../src/lib/persona-metadata';

describe('SuggestionChips', () => {
  it('renders all sample chips when input is empty', () => {
    render(<SuggestionChips value="" onPick={() => {}} />);
    expect(screen.getByTestId('suggestion-chips')).toBeInTheDocument();
    for (const q of SAMPLE_DECISION_QUESTIONS) {
      expect(screen.getByRole('button', { name: q })).toBeInTheDocument();
    }
  });

  it('renders chips when input is whitespace-only', () => {
    render(<SuggestionChips value="     " onPick={() => {}} />);
    expect(screen.getByTestId('suggestion-chips')).toBeInTheDocument();
  });

  it('hides chips when input has content', () => {
    render(<SuggestionChips value="should I do X?" onPick={() => {}} />);
    expect(screen.queryByTestId('suggestion-chips')).toBeNull();
  });

  it('clicking a chip calls onPick with the sample question', () => {
    const onPick = vi.fn();
    render(<SuggestionChips value="" onPick={onPick} />);
    const first = SAMPLE_DECISION_QUESTIONS[0];
    fireEvent.click(screen.getByRole('button', { name: first }));
    expect(onPick).toHaveBeenCalledWith(first);
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('passes className through to the wrapper', () => {
    render(<SuggestionChips value="" onPick={() => {}} className="custom-chip-wrap" />);
    expect(screen.getByTestId('suggestion-chips')).toHaveClass('custom-chip-wrap');
  });
});
