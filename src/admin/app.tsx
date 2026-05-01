import type { StrapiApp } from '@strapi/strapi/admin';
import { darkTheme, lightTheme } from '@strapi/design-system';

const greenLightColors = {
  buttonPrimary500: '#1f8f57',
  buttonPrimary600: '#177246',
  primary100: '#e8f7ee',
  primary200: '#cdeedc',
  primary500: '#2aa866',
  primary600: '#1f8f57',
  primary700: '#177246',
  secondary100: '#edf9f2',
  secondary200: '#d8f1e4',
  secondary500: '#45b977',
  secondary600: '#2f9f63',
  secondary700: '#23814f',
};

const greenDarkColors = {
  buttonPrimary500: '#39b36f',
  buttonPrimary600: '#2b9a5d',
  primary100: '#1f3a2b',
  primary200: '#29543a',
  primary500: '#4ac37f',
  primary600: '#39b36f',
  primary700: '#2b9a5d',
  secondary100: '#1b3326',
  secondary200: '#244a34',
  secondary500: '#58cc89',
  secondary600: '#46b777',
  secondary700: '#359960',
};

export default {
  config: {
    theme: {
      light: {
        ...lightTheme,
        colors: {
          ...lightTheme.colors,
          ...greenLightColors,
        },
      },
      dark: {
        ...darkTheme,
        colors: {
          ...darkTheme.colors,
          ...greenDarkColors,
        },
      },
    },
  },
  bootstrap(_app: StrapiApp) {},
};