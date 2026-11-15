import { WAVE_LIGHT_TRANSITION_NAME } from './effects';
import { INITIAL_MASKS, OVERFLOW_MARGIN } from './plan';

/** The view transition name the scope carries while a wave plays. */
export const WAVE_TRANSITION_NAME = 'view-transition-wave';
/** On `<html>` while a wave plays, so other view transitions on the page are left alone. */
export const PLAYING_CLASS = 'view-transition-wave-playing';

const STYLE_ID = 'view-transition-wave-styles';

const CSS = `
:root.${PLAYING_CLASS}::view-transition-old(${WAVE_TRANSITION_NAME}),
:root.${PLAYING_CLASS}::view-transition-new(${WAVE_TRANSITION_NAME}) {
  animation: none;
  mix-blend-mode: normal;
}
:root.${PLAYING_CLASS}::view-transition-old(${WAVE_TRANSITION_NAME}),
:root.${PLAYING_CLASS}::view-transition-new(${WAVE_TRANSITION_NAME}) {
  /*
   * A mask clips to the box, which would cut off what overflows the scope (a shadow): the snapshots are
   * laid out a margin wider on every side, the image unscaled in the middle. The masks draw in that
   * wider box; the filter's region reaches as far. The masks here are the first frame's: from then on
   * the wave sets them, and the group's filter, frame by frame (see transition.ts).
   */
  left: -${OVERFLOW_MARGIN}px;
  top: -${OVERFLOW_MARGIN}px;
  width: calc(100% + ${2 * OVERFLOW_MARGIN}px);
  height: calc(100% + ${2 * OVERFLOW_MARGIN}px);
  object-fit: none;
}
:root.${PLAYING_CLASS}::view-transition-new(${WAVE_TRANSITION_NAME}) {
  mask-image: ${INITIAL_MASKS.revealed};
}
:root.${PLAYING_CLASS}::view-transition-old(${WAVE_TRANSITION_NAME}) {
  mask-image: ${INITIAL_MASKS.remaining};
}
:root.${PLAYING_CLASS}::view-transition-group(${WAVE_LIGHT_TRANSITION_NAME}),
:root.${PLAYING_CLASS}::view-transition-new(${WAVE_LIGHT_TRANSITION_NAME}) {
  animation: none;
}
`;

/** Adds the wave's few rules to the document once. */
export const ensureStyles = (): void => {
  if (document.getElementById(STYLE_ID)) {
    return;
  }
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
};
