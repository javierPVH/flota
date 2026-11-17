# Ejemplos de importación masiva

Ficheros de ejemplo para el asistente **Importar** (botón en *Vehículos* y en
*Usuarios*, junto a *Exportar CSV*). Datos **ficticios** (sin datos personales
reales — RGPD).

| Fichero | Entidad | Filas |
|---|---|---|
| `vehiculos.csv` | Vehículos (pestaña Flota) | 8 |
| `vehiculos-actualizacion.csv` | Vehículos que ya existen: solo matrícula, estado, seguro, km y combustible | 5 |
| `conductores.csv` | Personas (conductores/supervisores) | 6 |

## Cómo usarlos
1. Vehículos (o Usuarios) → **Importar** → arrastra el CSV.
2. El auto-mapeo asigna todas las columnas solo (las cabeceras usan los alias
   estándar); revisa y pulsa **Validar fichero**.
3. **Importar N registros** → barra de progreso → al acabar sin errores se
   cierra solo y recarga el listado.

## Formato
- Separador `;` (también vale `,` o tabulador — se detecta solo) y UTF-8.
- **La fila 1 es la cabecera.** Filas totalmente vacías se ignoran.
- Fechas: `YYYY-MM-DD` o `DD/MM/YYYY` (ambas aparecen en el ejemplo).
- Booleanos: `sí` / `no` (también `x`, `1`, `true`…).
- Choices por etiqueta o valor: `Diésel`, `En mantenimiento`, `Renting`…
- Roles (personas): `conductor`, `supervisor`, `admin`, separados por comas.

## Columnas por nombre que deben EXISTIR en la BD
`Sociedad`, `Proyecto`, `CECO`, `Supervisor` (email/usuario) y `Conductor`
(email/usuario) se resuelven **por nombre contra la base de datos**: si el valor no
existe, esa fila sale en el informe de errores. En los ejemplos van vacías para
que importen limpio en cualquier entorno; rellénalas con valores reales de tu BD
si quieres probar la resolución.

Si la matrícula (o el email/usuario) **ya existe**, la fila no se duplica: se
actualizan sus datos con los del fichero, solo los que cambian. Para cambiar un
dato de muchos coches, asigna solo la matrícula y ese campo:
`vehiculos-actualizacion.csv` es el ejemplo.

Estos ficheros se descargan también desde la Ayuda de gestión (capítulo
«Importar en bloque»): la copia servida está en
`front-gestion/public/tutorial/ejemplos/` y una prueba (`chapters.test.ts`)
falla si deja de ser igual que esta. Al cambiar un CSV, cópialo allí.

> El **DNI ya no se guarda** (se retiró por minimización). Una hoja que aún
> traiga esa columna importa igual —se ignora—, pero una que identifique al
> **conductor por su DNI** ya no lo resolverá: usa su correo o su usuario.
