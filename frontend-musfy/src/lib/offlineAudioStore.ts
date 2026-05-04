import type localforage from 'localforage';

export type LocalForageApi = Pick<typeof localforage, 'createInstance'>;
export type LocalForageImportShape = typeof localforage | { default: typeof localforage };
export type OfflineAudioStore = ReturnType<typeof localforage.createInstance>;

export function resolveLocalForageModule(module: LocalForageImportShape): LocalForageApi {
  const candidate = 'createInstance' in module ? module : module.default;

  if (!candidate || typeof candidate.createInstance !== 'function') {
    throw new Error('Cache offline indisponivel nesta sessao.');
  }

  return candidate;
}

export function createOfflineAudioStore(module: LocalForageImportShape): OfflineAudioStore {
  return resolveLocalForageModule(module).createInstance({
    name: 'musfy-offline',
    storeName: 'audio_cache'
  });
}
