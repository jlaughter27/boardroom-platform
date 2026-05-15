import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  MeetAdvisorsModal,
  hasSeenAdvisorsTour,
  markAdvisorsTourSeen,
  resetAdvisorsTour,
} from '../../../src/components/decision/MeetAdvisorsModal';

describe('MeetAdvisorsModal', () => {
  beforeEach(() => {
    resetAdvisorsTour();
  });

  it('hasSeenAdvisorsTour defaults to false on a clean slate', () => {
    expect(hasSeenAdvisorsTour()).toBe(false);
  });

  it('markAdvisorsTourSeen flips the flag', () => {
    markAdvisorsTourSeen();
    expect(hasSeenAdvisorsTour()).toBe(true);
  });

  it('renders nothing when closed', () => {
    render(<MeetAdvisorsModal open={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders all 7 persona names when open', () => {
    render(<MeetAdvisorsModal open={true} onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('The Optimist')).toBeInTheDocument();
    expect(screen.getByText('The Critic')).toBeInTheDocument();
    expect(screen.getByText('The Alternate')).toBeInTheDocument();
    expect(screen.getByText('The Technician')).toBeInTheDocument();
    expect(screen.getByText('The Questionnaire')).toBeInTheDocument();
    expect(screen.getByText('The Doer')).toBeInTheDocument();
    expect(screen.getByText('The CEO')).toBeInTheDocument();
  });

  it('clicking the primary CTA calls onClose with dontShowAgain=true by default', () => {
    const onClose = vi.fn();
    render(<MeetAdvisorsModal open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('unchecking "Don\'t show this again" passes false to onClose', () => {
    const onClose = vi.fn();
    render(<MeetAdvisorsModal open={true} onClose={onClose} />);
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /got it/i }));
    expect(onClose).toHaveBeenCalledWith(false);
  });

  it('ESC key closes the modal', () => {
    const onClose = vi.fn();
    render(<MeetAdvisorsModal open={true} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('clicking the backdrop closes the modal', () => {
    const onClose = vi.fn();
    render(<MeetAdvisorsModal open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('meet-advisors-backdrop'));
    expect(onClose).toHaveBeenCalledWith(true);
  });

  it('clicking inside the dialog does NOT close it', () => {
    const onClose = vi.fn();
    render(<MeetAdvisorsModal open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('has proper ARIA attributes for the dialog', () => {
    render(<MeetAdvisorsModal open={true} onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(dialog).toHaveAttribute('aria-describedby');
  });
});
