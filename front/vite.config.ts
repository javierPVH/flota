import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import dts from 'vite-plugin-dts'

const resolve = (p: string) => fileURLToPath(new URL(p, import.meta.url))

const alias = {
  '@': resolve('./src'),
}

// Dependencias que NO se empaquetan en el build de librería (las aporta la app consumidora).
const external = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react-router-dom',
  'framer-motion',
  'lucide-react',
  'xlsx',
]

// Subpaths públicos del paquete → entradas de la librería.
const libEntries = {
  index: resolve('./src/index.ts'),
  'ui/index': resolve('./src/ui/index.ts'),
  'ui/table/index': resolve('./src/ui/table/index.ts'),
  'excel/index': resolve('./src/excel/index.ts'),
  'forms/index': resolve('./src/forms/index.ts'),
  'hooks/index': resolve('./src/hooks/index.ts'),
  'utils/index': resolve('./src/utils/index.ts'),
  'http/index': resolve('./src/http/index.ts'),
  'auth/index': resolve('./src/auth/index.ts'),
  'i18n/index': resolve('./src/i18n/index.ts'),
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  // `mode === 'app'` fuerza el rol de app (playground) también en build/preview.
  const isLibraryBuild = command === 'build' && mode !== 'app'

  const plugins = [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
  ]

  if (isLibraryBuild) {
    // ---- Rol LIBRERÍA: build a dist/ con tipos por subpath ----
    return {
      resolve: { alias },
      plugins: [
        ...plugins,
        dts({ tsconfigPath: './tsconfig.build.json' }),
      ],
      build: {
        lib: {
          entry: libEntries,
          formats: ['es'],
        },
        rollupOptions: {
          external: (id) => external.includes(id) || external.some((e) => id.startsWith(`${e}/`)),
          output: { preserveModules: false },
        },
        sourcemap: true,
      },
    }
  }

  // ---- Rol APP: playground levantable de forma independiente ----
  return {
    resolve: { alias },
    plugins,
    build: { outDir: 'dist-app' },
  }
})
