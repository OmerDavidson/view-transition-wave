import { WAVE_LIGHT_TRANSITION_NAME } from './effects';
import { WAVE_FILTER_ID } from './filter';
import { OVERFLOW_MARGIN } from './plan';

/** The view transition name the scope carries while a wave plays. */
export const WAVE_TRANSITION_NAME = 'view-transition-wave';
/** On `<html>` while a wave plays, so other view transitions on the page are left alone. */
export const PLAYING_CLASS = 'view-transition-wave-playing';
/** The masks that split the scope between the new and old snapshot along the front, redrawn every frame. */
export const REVEAL_PROPERTY = '--view-transition-wave-reveal';
export const REMAIN_PROPERTY = '--view-transition-wave-remain';

const STYLE_ID = 'view-transition-wave-styles';

const CSS = `
:root.${PLAYING_CLASS}::view-transition-old(${WAVE_TRANSITION_NAME}),
:root.${PLAYING_CLASS}::view-transition-new(${WAVE_TRANSITION_NAME}) {
  animation: none;
  mix-blend-mode: normal;
  filter: url(#${WAVE_FILTER_ID});
}
:root.${PLAYING_CLASS}::view-transition-old(${WAVE_TRANSITION_NAME}),
:root.${PLAYING_CLASS}::view-transition-new(${WAVE_TRANSITION_NAME}) {
  /*
   * A mask clips to the box, which would cut off what overflows the scope (a shadow): the snapshots are
   * laid out a margin wider on every side, the image unscaled in the middle. The filter and masks draw
   * in that wider box.
   */
  left: -${OVERFLOW_MARGIN}px;
  top: -${OVERFLOW_MARGIN}px;
  width: calc(100% + ${2 * OVERFLOW_MARGIN}px);
  height: calc(100% + ${2 * OVERFLOW_MARGIN}px);
  object-fit: none;
}
:root.${PLAYING_CLASS}::view-transition-new(${WAVE_TRANSITION_NAME}) {
  mask-image: var(${REVEAL_PROPERTY});
}
:root.${PLAYING_CLASS}::view-transition-old(${WAVE_TRANSITION_NAME}) {
  mask-image: var(${REMAIN_PROPERTY});
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
