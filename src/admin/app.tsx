import type { StrapiApp } from '@strapi/strapi/admin';
import { darkTheme, lightTheme } from '@strapi/design-system';
import type { RouteObject } from 'react-router-dom';

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

const buildCustomWebhookRoutes = () => {
  const createRoute: RouteObject = {
    path: 'webhooks/create',
    lazy: async () => {
      const { ProtectedCustomWebhookCreatePage } = await import('./pages/Webhooks/CustomWebhookPage');
      return { Component: ProtectedCustomWebhookCreatePage };
    },
  };

  const editRoute: RouteObject = {
    path: 'webhooks/:id',
    lazy: async () => {
      const { ProtectedCustomWebhookEditPage } = await import('./pages/Webhooks/CustomWebhookPage');
      return { Component: ProtectedCustomWebhookEditPage };
    },
  };

  return { createRoute, editRoute };
};

const replaceWebhookSettingsRoutes = (routes: RouteObject[]): RouteObject[] => {
  const { createRoute, editRoute } = buildCustomWebhookRoutes();

  return routes.map((route) => {
    if (route.path !== 'settings/*' || !Array.isArray(route.children)) {
      return route;
    }

    const children = route.children.map((child) => {
      if (child.path === 'webhooks/create') {
        return createRoute;
      }

      if (child.path === 'webhooks/:id') {
        return editRoute;
      }

      return child;
    });

    return {
      ...route,
      children,
    };
  });
};

export default {
  register(app: StrapiApp) {
    // There is no public injection zone for the built-in Webhooks create/edit form.
    // We replace only those two settings routes to keep the native list page experience.
    (app as any).router.addRoute((routes: RouteObject[]) => replaceWebhookSettingsRoutes(routes));
  },
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