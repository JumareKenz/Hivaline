import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from '@/components/ui/Button';

describe('Button', () => {
  it('renders primary button with text', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('calls onClick when clicked', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Click me</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick when disabled', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick} disabled>Click me</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('renders fullWidth button', () => {
    render(<Button fullWidth>Full width</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toContain('w-full');
  });

  it('renders with icon', () => {
    render(<Button icon={<span data-testid="icon">★</span>}>With icon</Button>);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
  });

  it('renders different sizes', () => {
    const { rerender } = render(<Button size="sm">Small</Button>);
    expect(screen.getByRole('button').className).toContain('h-9');
    
    rerender(<Button size="md">Medium</Button>);
    expect(screen.getByRole('button').className).toContain('h-11');
    
    rerender(<Button size="lg">Large</Button>);
    expect(screen.getByRole('button').className).toContain('h-14');
  });

  it('renders different variants', () => {
    const { rerender } = render(<Button variant="primary">Primary</Button>);
    expect(screen.getByRole('button').className).toContain('bg-accent-600');
    
    rerender(<Button variant="secondary">Secondary</Button>);
    expect(screen.getByRole('button').className).toContain('border');
    
    rerender(<Button variant="ghost">Ghost</Button>);
    expect(screen.getByRole('button').className).toContain('text-accent-600');
    
    rerender(<Button variant="danger">Danger</Button>);
    expect(screen.getByRole('button').className).toContain('bg-error');
  });
});
