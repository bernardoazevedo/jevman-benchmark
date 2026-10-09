import { DECISION_MODELS, DEFAULT_MODEL, isModelId, type ModelId } from '../shared/models.ts';

/** Where jev calls go: Opper's TypeSafe-compatible endpoint, or TypeSafe's own System One API. */
export type JevProvider = 'opper' | 'typesafe';

export interface JevTarget {
  provider: JevProvider;
  apiKey: string;
  baseUrl: string;
}

export const OPPER_BASE_URL = 'https://api.opper.ai';
export const TYPESAFE_BASE_URL = 'https://api.typesafe.ai';

/** TypeSafe bills input tokens only (docs.typesafe.ai/models, 2026-10): $0.042 per million. */
export const TYPESAFE_USD_PER_INPUT_TOKEN = 0.042 / 1_000_000;

const PATHS: Record<JevProvider, string> = { opper: '/v3/compat/v1/systemone', typesafe: '/v1/systemone' };

const DEFAULTS: Record<JevProvider, string> = { opper: DEFAULT_MODEL, typesafe: 'jev-1.13.0' };

/**
 * The server's default System One model, for requests that name none. JEV_MODEL overrides it for both providers, so
 * the same game can drive any model that speaks the System One API, e.g. `opper/kev-4b` or `opper/clef` through Opper.
 */
export const modelFor = (provider: JevProvider, env: Record<string, string | undefined> = process.env): string =>
  env.JEV_MODEL?.trim() || DEFAULTS[provider];

/** The id to send for a model the game asked for (one of shared/models.ts, or a local model). TypeSafe's own API serves jev or local models. */
export function requestedModelFor(provider: JevProvider, model: string, env: Record<string, string | undefined> = process.env): string | null {
  if (provider === 'opper') {
    const listed: { id: string; opper?: string } | undefined = DECISION_MODELS.find((m) => m.id === model);
    return listed?.opper ?? (isModelId(model) ? model : null);
  }
  if (isModelId(model) && model !== DEFAULT_MODEL) {
    return null;
  }
  const defaultModel = modelFor('typesafe', env);
  if (model === DEFAULT_MODEL || model === defaultModel || model === 'typesafe') {
    return defaultModel;
  }
  return model;
}

/** Queries an Ollama / local endpoint for available models via GET /api/tags. */
export async function listLocalModels(baseUrl: string): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/api/tags`, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: Array<{ name?: string }> };
    return (data.models ?? []).map((m) => m.name).filter((n): n is string => typeof n === 'string' && n.length > 0);
  } catch {
    return [];
  }
}

export const endpointFor = (t: JevTarget): string => `${t.baseUrl.replace(/\/+$/, '')}${PATHS[t.provider]}`;

/** The server's own key from the environment: TYPESAFE_API_KEY (straight to TypeSafe) wins over OPPER_API_KEY. */
export function devTargetFromEnv(env: Record<string, string | undefined>): JevTarget | undefined {
  if (env.TYPESAFE_API_KEY) return { provider: 'typesafe', apiKey: env.TYPESAFE_API_KEY, baseUrl: env.TYPESAFE_BASE_URL || TYPESAFE_BASE_URL };
  if (env.OPPER_API_KEY) return { provider: 'opper', apiKey: env.OPPER_API_KEY, baseUrl: env.OPPER_BASE_URL || OPPER_BASE_URL };
  return undefined;
}
