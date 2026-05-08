import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Toggle } from '@/components/ui/Toggle';

describe('Toggle', () => {
  it('renders unchecked by default', () => {
    render(<Toggle checked={false} onChange={() => {}} label="Dark Mode" />);
    const switchEl = screen.getByRole('switch');
    expect(switchEl).toHaveAttribute('aria-checked', 'false');
  });

  it('renders checked', () => {
    render(<Toggle checked={true} onChange={() => {}} label="Dark Mode" />);
    const switchEl = screen.getByRole('switch');
    expect(switchEl).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onChange with true when clicked unchecked', () => {
    const handleChange = vi.fn();
    render(<Toggle checked={false} onChange={handleChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(handleChange).toHaveBeenCalledWith(true);
  });

  it('calls onChange with false when clicked checked', () => {
    const handleChange = vi.fn();
    render(<Toggle checked={true} onChange={handleChange} />);
    fireEvent.click(screen.getByRole('switch'));
    expect(handleChange).toHaveBeenCalledWith(false);
  });

  it('renders label when provided', () => {
    render(<Toggle checked={false} onChange={() => {}} label="Dark Mode" />);
    expect(screen.getByText('Dark Mode')).toBeInTheDocument();
  });
});
