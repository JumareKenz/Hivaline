import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { useRouter } from '@/router/useRouter';

describe('useRouter', () => {
  beforeEach(() => {
    window.location.hash = '';
  });

  afterEach(() => {
    window.location.hash = '';
  });

  it('returns root path when hash is empty', () => {
    const { result } = renderHook(() => useRouter());
    expect(result.current.path).toBe('/');
  });

  it('parses simple hash path', () => {
    window.location.hash = '#/chat';
    const { result } = renderHook(() => useRouter());
    expect(result.current.path).toBe('/chat');
  });

  it('parses parameterized path', () => {
    window.location.hash = '#/knowledge/malaria-2024';
    const { result } = renderHook(() => useRouter());
    expect(result.current.path).toBe('/knowledge/malaria-2024');
    expect(result.current.params.id).toBe('malaria-2024');
  });

  it('navigates to a new path', () => {
    const { result } = renderHook(() => useRouter());
    result.current.navigate('/settings');
    expect(window.location.hash).toBe('#/settings');
  });

  it('matches current route for knowledge detail', () => {
    window.location.hash = '#/knowledge/anc-2024';
    const { result } = renderHook(() => useRouter());
    expect(result.current.currentRoute).toBe('/knowledge/:id');
  });

  it('matches current route for decision tree', () => {
    window.location.hash = '#/decision-tree/malaria-assessment';
    const { result } = renderHook(() => useRouter());
    expect(result.current.currentRoute).toBe('/decision-tree/:id');
  });

  it('matches current route for drug table', () => {
    window.location.hash = '#/drug-table/act-artemether';
    const { result } = renderHook(() => useRouter());
    expect(result.current.currentRoute).toBe('/drug-table/:id');
  });

  it('updates on hashchange event', async () => {
    const { result } = renderHook(() => useRouter());
    window.location.hash = '#/chat';
    window.dispatchEvent(new Event('hashchange'));
    await waitFor(() => {
      expect(result.current.path).toBe('/chat');
    });
  });
});
