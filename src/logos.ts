import { appPath } from './paths';

/**
 * Each decision model's maker mark, as the maker shows it on its own profiles (site, GitHub, Hugging Face). Jared
 * Palmer publishes Kev as himself, so Kev's mark is his avatar; Convai Innovations uses its brain-and-circuit logo.
 */
const LOGOS: Record<string, { src: string; maker: string; shape?: 'round' | 'tile' }> = {
  'typesafe/jev-1.13.0': { src: 'logos/typesafe.png', maker: 'TypeSafe', shape: 'tile' },
  'opper/clef': { src: 'logos/cloudflare.svg', maker: 'Cloudflare' },
  'opper/clef-flash': { src: 'logos/cloudflare.svg', maker: 'Cloudflare' },
  'opper/kev-4b': { src: 'logos/jared-palmer.webp', maker: 'Jared Palmer', shape: 'round' },
  'berget/convaiinnovations/laya': { src: 'logos/convai.webp', maker: 'Convai Innovations', shape: 'tile' },
  'openai/gpt-6-luna-decisions': { src: 'logos/openai.svg', maker: 'OpenAI' },
};

export const makerOf = (model: string): string | undefined => LOGOS[model]?.maker;

/** The model's maker mark as an <img>, or nothing for a model without one (say, a self-reported submission). */
export function logoFor(model: string): HTMLImageElement | null {
  const l = LOGOS[model];
  if (!l) return null;
  const img = document.createElement('img');
  img.src = appPath(l.src);
  img.alt = '';
  img.className = `logo${l.shape ? ` ${l.shape}` : ''}`;
  img.width = 18;
  img.height = 18;
  return img;
}
