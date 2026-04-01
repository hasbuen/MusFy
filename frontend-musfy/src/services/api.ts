import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

type RetryableConfig = InternalAxiosRequestConfig & {
  _triedBaseUrls?: string[];
};

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function buildCandidateBaseUrls() {
  const envBaseUrl = import.meta.env.VITE_API_BASE_URL
    ? String(import.meta.env.VITE_API_BASE_URL)
    : '';
  const desktopConfig = typeof window !== 'undefined' ? window.musfyDesktop?.getServiceConfig?.() || null : null;
  const desktopBaseUrl = desktopConfig?.baseUrl || '';
  const desktopPort = Number(desktopConfig?.port || 0) || 0;

  if (typeof window === 'undefined') {
    return unique([envBaseUrl, 'http://localhost:3001', 'http://127.0.0.1:3001']);
  }

  const { protocol, hostname, port, origin } = window.location;
  const sameOriginBackend =
    (protocol === 'http:' || protocol === 'https:') &&
    desktopPort > 0 &&
    port === String(desktopPort)
      ? origin
      : '';
  const hostnameBackend = hostname
    ? `http://${hostname}:${desktopPort > 0 ? desktopPort : 3001}`
    : '';

  return unique([
    envBaseUrl,
    desktopBaseUrl,
    sameOriginBackend,
    hostnameBackend,
    'http://localhost:3001',
    'http://127.0.0.1:3001'
  ]);
}

let activeBaseUrl = buildCandidateBaseUrls()[0] || 'http://localhost:3001';

const api = axios.create({
  baseURL: activeBaseUrl,
  timeout: 20000
});

api.interceptors.request.use((config) => {
  const nextConfig = config as RetryableConfig;
  const liveBaseUrl = buildCandidateBaseUrls()[0] || activeBaseUrl;
  if (liveBaseUrl && liveBaseUrl !== activeBaseUrl) {
    activeBaseUrl = liveBaseUrl;
    api.defaults.baseURL = activeBaseUrl;
  }
  nextConfig.baseURL = nextConfig.baseURL || activeBaseUrl;
  nextConfig._triedBaseUrls = nextConfig._triedBaseUrls || [];
  return nextConfig;
});

api.interceptors.response.use(
  (response) => {
    if (response.config.baseURL) {
      activeBaseUrl = response.config.baseURL;
      api.defaults.baseURL = activeBaseUrl;
    }
    return response;
  },
  async (error: AxiosError) => {
    const config = error.config as RetryableConfig | undefined;
    const isNetworkFailure = !error.response;

    if (!config || !isNetworkFailure) {
      throw error;
    }

    const triedBaseUrls = new Set(config._triedBaseUrls || []);
    if (config.baseURL) {
      triedBaseUrls.add(config.baseURL);
    }

    for (const candidate of buildCandidateBaseUrls()) {
      if (!candidate || triedBaseUrls.has(candidate)) continue;

      triedBaseUrls.add(candidate);

      try {
        const retryConfig = {
          ...config,
          baseURL: candidate,
          _triedBaseUrls: [...triedBaseUrls]
        } as RetryableConfig;

        const response = await api.request(retryConfig);

        activeBaseUrl = candidate;
        api.defaults.baseURL = candidate;
        return response;
      } catch (retryError) {
        const nested = retryError as AxiosError;
        if (nested.response) {
          throw nested;
        }
      }
    }

    throw error;
  }
);

export default api;
