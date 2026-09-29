/* eslint-disable global-require */
const plugin = require('tailwindcss/plugin');

const config = {
  content: ['./src/**/*.{html,js,svelte,ts}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Noto Sans SC', 'Noto Sans JP', 'sans-serif'],
        serif: ['Noto Serif JP', 'serif']
      },
      colors: {
        'background-color': 'var(--background-color)',
        /*
         * Tailwind can't put an alpha modifier on the `currentColor` keyword:
         * `border-current/20` generated no rule at all, so every one of the
         * ~90 uses of the border/divider idiom this repo documents silently
         * fell back to preflight's gray-200 — a hard light-grey line that
         * ignores the theme, which is exactly what the palette contract
         * exists to prevent. It only looked right on light themes.
         *
         * color-mix restores the intended meaning. The theme system already
         * depends on it (`hover-soft` is color-mix over currentColor), so
         * this adds no new browser requirement.
         */
        current: ({ opacityValue }) => {
          // Without a modifier Tailwind passes the opacity *variable* here
          // (`var(--tw-border-opacity)`), not undefined — feeding that to
          // Number() yields NaN and emits `currentColor NaN%`, which the
          // parser drops, silently killing plain `border-current`. So treat
          // anything non-numeric as "no alpha requested".
          const alpha = Number(opacityValue);
          if (!Number.isFinite(alpha) || alpha >= 1) return 'currentColor';
          const percent = +(alpha * 100).toFixed(4);
          return `color-mix(in srgb, currentColor ${percent}%, transparent)`;
        }
      },
      spacing: {
        21: '5.25rem'
      },
      maxWidth: {
        '60vw': '60vw'
      }
    }
  },
  plugins: [
    require('@tailwindcss/aspect-ratio'),
    require('@tailwindcss/forms'),
    plugin(({ addUtilities }) => {
      addUtilities(require('./tailwindcss/material-elevation.cjs'));
    })
  ],
  safelist: [
    {
      pattern: /grid-cols-(2|3)/,
      variants: ['md']
    },
    'animate-[pulse_0.5s_cubic-bezier(0.4,0,0.6,1)_1]',
    'animate-[pulse_1s_cubic-bezier(0.4,0,0.6,1)_infinite]'
  ]
};

module.exports = config;
