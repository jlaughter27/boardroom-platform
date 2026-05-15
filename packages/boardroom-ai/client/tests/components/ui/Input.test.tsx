import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from '../../../src/components/ui/Input';

describe('Input', () => {
  it('renders with default props', () => {
    render(<Input />);
    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
    expect(input).toHaveClass('bg-card');
    expect(input).toHaveClass('border-border');
    expect(input).toHaveClass('rounded-md');
  });

  it('renders with label', () => {
    render(<Input label="Email" />);
    const input = screen.getByLabelText(/email/i) as HTMLInputElement;
    expect(input).toBeInTheDocument();
    // Default type is "text" (IDL default when no attribute is set)
    expect(input.type).toBe('text');

    const inputId = input.getAttribute('id');
    const labelElement = screen.getByText('Email');
    expect(labelElement).toHaveAttribute('for', inputId);
  });

  it('renders with error message', () => {
    render(<Input error="This field is required" />);
    const input = screen.getByRole('textbox');
    const error = screen.getByText('This field is required');
    
    expect(error).toBeInTheDocument();
    expect(error).toHaveClass('text-destructive');
    expect(input).toHaveClass('border-destructive');
    expect(input).toHaveClass('focus:ring-destructive/40');
  });

  it('handles onChange events', () => {
    const handleChange = vi.fn();
    render(<Input onChange={handleChange} />);
    const input = screen.getByRole('textbox');
    
    fireEvent.change(input, { target: { value: 'test value' } });
    expect(handleChange).toHaveBeenCalledTimes(1);
  });

  it('handles different input types', () => {
    const { container, rerender } = render(<Input type="email" />);
    expect(screen.getByRole('textbox')).toHaveAttribute('type', 'email');

    rerender(<Input type="password" />);
    // Password inputs do not expose role="textbox", so query the DOM directly.
    const passwordInput = container.querySelector('input[type="password"]');
    expect(passwordInput).not.toBeNull();
    expect(passwordInput).toHaveAttribute('type', 'password');
  });

  it('applies custom className', () => {
    render(<Input className="custom-class" />);
    const input = screen.getByRole('textbox');
    expect(input).toHaveClass('custom-class');
    expect(input).toHaveClass('bg-card'); // still has default classes
  });

  it('passes additional props to input element', () => {
    render(
      <Input
        placeholder="Enter text"
        disabled
        readOnly
        data-testid="custom-input"
      />
    );
    const input = screen.getByTestId('custom-input');
    expect(input).toHaveAttribute('placeholder', 'Enter text');
    expect(input).toBeDisabled();
    expect(input).toHaveAttribute('readonly');
  });

  it('forwards ref to input element', () => {
    const ref = vi.fn();
    render(<Input ref={ref} />);
    expect(ref).toHaveBeenCalled();
    expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLInputElement);
  });

  it('generates id from label when no id provided', () => {
    render(<Input label="User Email Address" />);
    const labelElement = screen.getByText('User Email Address');
    const inputId = labelElement.getAttribute('for');
    expect(inputId).toBe('user-email-address');
    
    const input = screen.getByLabelText(/user email address/i);
    expect(input).toHaveAttribute('id', inputId);
  });

  it('uses provided id instead of generating from label', () => {
    render(<Input id="custom-id" label="Email" />);
    const labelElement = screen.getByText('Email');
    expect(labelElement).toHaveAttribute('for', 'custom-id');
    
    const input = screen.getByLabelText(/email/i);
    expect(input).toHaveAttribute('id', 'custom-id');
  });
});
