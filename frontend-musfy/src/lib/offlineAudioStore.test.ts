import { describe, expect, it, vi } from 'vitest';
import {
  createOfflineAudioStore,
  resolveLocalForageModule,
  type LocalForageImportShape
} from './offlineAudioStore';

function createLocalForageShape(createInstance: () => unknown): LocalForageImportShape {
  return { createInstance } as unknown as LocalForageImportShape;
}

function createDefaultLocalForageShape(createInstance: () => unknown): LocalForageImportShape {
  return { default: { createInstance } } as unknown as LocalForageImportShape;
}

describe('offlineAudioStore', () => {
  it('resolves localforage when createInstance is exported at the module root', () => {
    const createInstance = vi.fn(() => ({ getItem: vi.fn() }));

    const localforage = resolveLocalForageModule(createLocalForageShape(createInstance));

    expect(localforage.createInstance).toBe(createInstance);
  });

  it('resolves localforage when Vite places it under default', () => {
    const createInstance = vi.fn(() => ({ getItem: vi.fn() }));

    const localforage = resolveLocalForageModule(createDefaultLocalForageShape(createInstance));

    expect(localforage.createInstance).toBe(createInstance);
  });

  it('creates the MusFy offline audio store with the expected stable keys', () => {
    const store = { getItem: vi.fn() };
    const createInstance = vi.fn(() => store);

    const result = createOfflineAudioStore(createDefaultLocalForageShape(createInstance));

    expect(result).toBe(store);
    expect(createInstance).toHaveBeenCalledWith({
      name: 'musfy-offline',
      storeName: 'audio_cache'
    });
  });

  it('throws a business-safe message when the offline cache adapter is unavailable', () => {
    expect(() => resolveLocalForageModule({ default: {} } as unknown as LocalForageImportShape)).toThrow(
      'Cache offline indisponivel nesta sessao.'
    );
  });
});
