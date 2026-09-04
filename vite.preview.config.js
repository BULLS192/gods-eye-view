import baseConfig from './vite.config.js';
import { defineConfig } from 'vite';
import { mobilityProxyPlugin } from './src/server/mobilityProxy.js';

/**
 * Production preview adapter.
 *
 * The upstream project implements many same-origin API proxies as Vite
 * configureServer hooks because it was primarily designed for local dev.
 * Vite preview is substantially lighter on memory, but it normally does not
 * invoke those hooks. For the hosted-keyless test deployment we safely mirror
 * configureServer -> configurePreviewServer only when a plugin has not already
 * provided a preview-specific implementation.
 *
 * The hosted fork also appends its small civilian-mobility proxy here. Keeping
 * that code outside the large upstream vite.config.js makes the customization
 * easy to review/rebase while preserving the low-memory preview runtime.
 */
export default defineConfig(async (env) => {
  const resolved = typeof baseConfig === 'function'
    ? await baseConfig(env)
    : baseConfig;

  const adaptPlugin = (plugin) => {
    if (!plugin || typeof plugin !== 'object') return plugin;
    if (typeof plugin.configureServer !== 'function' || typeof plugin.configurePreviewServer === 'function') {
      return plugin;
    }
    return {
      ...plugin,
      configurePreviewServer: plugin.configureServer,
    };
  };

  const upstreamPlugins = Array.isArray(resolved?.plugins)
    ? resolved.plugins.map(adaptPlugin)
    : [];
  const hostedMobilityPlugin = adaptPlugin(mobilityProxyPlugin());

  return {
    ...resolved,
    plugins: [...upstreamPlugins, hostedMobilityPlugin],
  };
});
