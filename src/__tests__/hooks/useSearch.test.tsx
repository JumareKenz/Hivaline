import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSearch } from '@/hooks/useSearch';
import { HIVFileProvider } from '@/context/HIVFileContext';
import { FALLBACK_RESPONSE } from '@/data/mockResponses';

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <HIVFileProvider>{children}</HIVFileProvider>
);

describe('useSearch', () => {
  it('matches ACT dosing query', async () => {
    const { result } = renderHook(() => useSearch(), { wrapper });
    const searchResult = await result.current.searchResponse('ACT dose for 12kg child');
    expect(searchResult.response.type).toBe('drug_table');
    expect(searchResult.response.metadata?.drugId).toBe('act-artemether');
  });

  it('matches severe malaria query', async () => {
    const { result } = renderHook(() => useSearch(), { wrapper });
    const searchResult = await result.current.searchResponse('Signs of severe malaria');
    expect(searchResult.response.type).toBe('decision_tree');
    expect(searchResult.response.metadata?.treeId).toBe('malaria-assessment');
  });

  it('matches danger sign query', async () => {
    const { result } = renderHook(() => useSearch(), { wrapper });
    const searchResult = await result.current.searchResponse('convulsion seizure');
    expect(searchResult.response.type).toBe('danger_sign');
    expect(searchResult.response.content).toContain('DANGER SIGN');
  });

  it('matches ANC query', async () => {
    const { result } = renderHook(() => useSearch(), { wrapper });
    const searchResult = await result.current.searchResponse('ANC first visit');
    expect(searchResult.response.type).toBe('response_card');
    expect(searchResult.response.metadata?.artifactId).toBe('anc-2024');
  });

  it('matches pneumonia query', async () => {
    const { result } = renderHook(() => useSearch(), { wrapper });
    const searchResult = await result.current.searchResponse('pneumonia assessment');
    expect(searchResult.response.type).toBe('response_card');
  });

  it('returns fallback for unknown query', async () => {
    const { result } = renderHook(() => useSearch(), { wrapper });
    const searchResult = await result.current.searchResponse('COVID vaccine schedule');
    expect(searchResult.response.type).toBe(FALLBACK_RESPONSE.type);
    expect(searchResult.response.content).toContain("don't have information");
  });

  it('returns fallback for empty input', async () => {
    const { result } = renderHook(() => useSearch(), { wrapper });
    const searchResult = await result.current.searchResponse('');
    expect(searchResult.response.type).toBe(FALLBACK_RESPONSE.type);
  });

  it('returns fallback for punctuation-only input', async () => {
    const { result } = renderHook(() => useSearch(), { wrapper });
    const searchResult = await result.current.searchResponse('!!!???');
    expect(searchResult.response.type).toBe(FALLBACK_RESPONSE.type);
  });

  it('handles mixed case input', async () => {
    const { result } = renderHook(() => useSearch(), { wrapper });
    const searchResult = await result.current.searchResponse('AcT DoSe');
    expect(searchResult.response.type).toBe('drug_table');
  });
});
