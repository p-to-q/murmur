/**
 * RadioPlayer — stub only.
 * Real radio stream feature was scoped out. This file is kept as a
 * no-op placeholder so existing imports do not break.
 */
export class RadioPlayer {
  stop() {}
  dispose() {}
}

let _instance: RadioPlayer | null = null;
export function getRadioPlayer(): RadioPlayer {
  if (!_instance) _instance = new RadioPlayer();
  return _instance;
}
