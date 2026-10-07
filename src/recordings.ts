/**
 * The game Watch plays for each model: one real benchmark game (the classic ghosts, the 300 s cap), the one of three
 * closest to the model's leaderboard average, recorded with `npm run bench -- --games 1 --pacman jev --pacman-model
 * <id> --ghosts greedy --max 300 --record public/demo/<file>`. jev's is the original 120 s demo. Recordings cost
 * nothing to watch; no model is called.
 */
export const RECORDINGS: Record<string, string> = {
  'typesafe/jev-1.13.0': '/demo/jev-demo.json',
  'opper/clef': '/demo/clef-demo.json',
  'opper/clef-flash': '/demo/clef-flash-demo.json',
  'openai/gpt-6-luna-decisions': '/demo/gpt-6-luna-demo.json',
  'opper/kev-4b': '/demo/kev-4b-demo.json',
  'berget/convaiinnovations/laya': '/demo/laya-demo.json',
};
