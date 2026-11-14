import type { ProviderResult } from '@portfolio/contracts';

export interface ProviderCall<T> {
  result: ProviderResult;
  /** null whenever the provider did not give a usable answer. */
  data: T | null;
}

export const unconfigured = <T>(provider: string, purpose: string, detail: string): ProviderCall<T> => ({
  result: { provider, purpose, status: 'unconfigured', latencyMs: 0, detail },
  data: null,
});

export const skipped = <T>(provider: string, purpose: string, detail: string): ProviderCall<T> => ({
  result: { provider, purpose, status: 'skipped', latencyMs: 0, detail },
  data: null,
});
