import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Input } from '@/components/ui/Input';

describe('Input', () => {
  it('renders with label', () => {
    render(<Input value="" onChange={() => {}} label="Server Code" />);
    expect(screen.getByText('Server Code')).toBeInTheDocument();
  });

  it('renders with placeholder', () => {
    render(<Input value="" onChange={() => {}} placeholder="FMOH–XXXX" />);
    expect(screen.getByPlaceholderText('FMOH–XXXX')).toBeInTheDocument();
  });

  it('calls onChange when typing', () => {
    const handleChange = vi.fn();
    render(<Input value="" onChange={handleChange} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'FMOH' } });
    expect(handleChange).toHaveBeenCalledWith('FMOH');
  });

  it('auto-capitalizes when enabled', () => {
    const handleChange = vi.fn();
    render(<Input value="" onChange={handleChange} autoCapitalize />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'fmoh' } });
    expect(handleChange).toHaveBeenCalledWith('FMOH');
  });

  it('displays error message', () => {
    render(<Input value="" onChange={() => {}} error="Invalid format" />);
    expect(screen.getByText('Invalid format')).toBeInTheDocument();
  });

  it('renders as password type', () => {
    render(<Input value="secret" onChange={() => {}} type="password" />);
    expect(screen.getByDisplayValue('secret')).toHaveAttribute('type', 'password');
  });

  it('is disabled when disabled prop is true', () => {
    render(<Input value="" onChange={() => {}} disabled />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});
