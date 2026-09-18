import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * `virtual:start-sheet`: what the new-career screen reads off the world — the
 * places each entry year opens in, whether each door opens there and how many
 * clubs it is placed among, where the year's starters stand — worked out here,
 * as the site is built, by the engine's own functions on the same data
 * (src/engine/me/startSheet.ts), and handed to the page as a small table.
 *
 * Reported 2026-09-18 (an outside audit, finding 05): the home page fetched every
 * roster book and every circuit's calendar, 6.7 MB (1.4 MB gzipped), before
 * anyone opened a career, and the new-career screen was one reason it had to.
 * The world now comes with the career (src/App.tsx).
 *
 * The engine is TypeScript that reads JSON, so it is loaded with tsx, as the
 * checks load it. Under the dev server the table is worked out once and again
 * on the next page load after a file under src/engine or src/data changes.
 */
function startSheet(): Plugin {
  const ID = 'virtual:start-sheet'
  const RESOLVED = `\0${ID}`
  let root = process.cwd()
  return {
    name: 'val-start-sheet',
    configResolved(c) { root = c.root },
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    configureServer(server) {
      server.watcher.on('change', (file) => {
        if (!/[\\/]src[\\/](engine|data)[\\/]/.test(file)) return
        const mod = server.moduleGraph.getModuleById(RESOLVED)
        if (mod) server.moduleGraph.invalidateModule(mod)
      })
    },
    async load(id) {
      if (id !== RESOLVED) return undefined
      const { tsImport } = await import('tsx/esm/api')
      const at = pathToFileURL(path.resolve(root, 'src/engine/me/startSheet.ts')).href
      const m = await tsImport(at, import.meta.url)
      return `export default ${JSON.stringify(m.buildStartSheet())}\n`
    },
  }
}

// base: './' keeps the build working both at a domain root and under a
// GitHub Pages project subpath (/Val_Manager/).
export default defineConfig({
  plugins: [react(), startSheet()],
  base: './',
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // React changes once a year; the game changes every week. Kept in its
        // own chunk, an update no longer invalidates the framework in every
        // player's cache.
        manualChunks(id: string) {
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'vendor'
          // The datasets are the biggest things in the build, and Rollup's
          // default grouping put the 370 KB of rosters in the same chunk as the
          // changelog text — which the front page needs. So the page that had
          // been carefully kept clear of the game engine downloaded the game
          // anyway, to draw a panel of release notes.
          //
          // Named explicitly: each dataset is its own chunk, fetched by
          // whichever page actually reads it and by nothing else.
          if (id.includes('src/data/world.json')) return 'world'
          // the open era's roster book and its real calendar: only a 2021 career reads them
          if (id.includes('src/data/world_2021.json')) return 'world2021'
          if (id.includes('src/data/circuit.json') || id.includes('src/data/routes.json')
            || id.includes('src/data/routes_partnered.json')) return 'circuit'
          // the roster book past 2021: only a career that entered in 2021 and plays on reads it
          if (id.includes('src/data/timeline.json')) return 'timeline'
          // which 2026 face and crest belong to which 2021 person and club: read wherever a face is drawn
          if (id.includes('src/data/bridge_2026.json')) return 'dossier'
          if (id.includes('src/data/dossier.json')) return 'dossier'
          if (id.includes('src/data/prospects.json')) return 'world'
          if (id.includes('src/data/changelog')) return 'changelog'
        },
      },
    },
  },
})
