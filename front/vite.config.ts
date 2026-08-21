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
  'domain/index': resolve('./src/domain/index.ts'),
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
          output: {
            preserveModules: false,
            // Nombres de chunk ESTABLES (sin hash de contenido).
            //
            // Las apps consumen este `dist/` por symlink y el dev server de Vite
            // lo sirve como fuente: cada chunk compartido es un módulo más de su
            // grafo, identificado por su ruta. Con `[name]-[hash].js`, reconstruir
            // el DS renombraba todos los chunks, y un dev server ya levantado se
            // quedaba pidiendo un nombre que acababa de desaparecer —un 500 de
            // «Failed to resolve import» que no se cura con recargar, solo
            // reiniciando el server. Con el nombre fijo, el rebuild sustituye el
            // contenido en el sitio y el HMR lo recoge.
            //
            // No se pierde cache-busting en producción: este `dist/` no lo sirve
            // ningún navegador, lo re-empaquetan los builds de las apps con sus
            // propios hashes. Van a `chunks/` para no poder colisionar con los
            // directorios de entrada (`auth/`, `http/`, `ui/`…).
            chunkFileNames: 'chunks/[name].js',
          },
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
