import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResponseCard } from '@/components/chat/ResponseCard';
import type { ChatMessage } from '@/types/hiv';

describe('ResponseCard', () => {
  const mockMessage: ChatMessage = {
    id: 'msg-1',
    type: 'response_card',
    sender: 'hiva',
    content: 'ANC First Visit Checklist:\n\n• Confirm pregnancy\n• Check BP and weight',
    timestamp: new Date(),
    metadata: {
      artifactId: 'anc-2024',
      topic: 'ANC First Visit',
      source: 'FMOH/WHO ANC Guidelines 2024',
    },
  };

  it('renders topic chip', () => {
    render(<ResponseCard message={mockMessage} />);
    expect(screen.getByText('ANC First Visit')).toBeInTheDocument();
  });

  it('renders content lines', () => {
    render(<ResponseCard message={mockMessage} />);
    expect(screen.getByText('ANC First Visit Checklist:')).toBeInTheDocument();
    expect(screen.getByText(/Confirm pregnancy/)).toBeInTheDocument();
  });

  it('renders source citation', () => {
    render(<ResponseCard message={mockMessage} />);
    expect(screen.getByText(/FMOH\/WHO ANC Guidelines 2024/)).toBeInTheDocument();
  });

  it('renders without metadata gracefully', () => {
    const noMetaMessage: ChatMessage = {
      ...mockMessage,
      metadata: undefined,
    };
    render(<ResponseCard message={noMetaMessage} />);
    expect(screen.getByText('Clinical Information')).toBeInTheDocument();
  });
});
