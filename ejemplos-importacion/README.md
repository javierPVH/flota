# Ejemplos de importación masiva

Ficheros de ejemplo para el asistente **Importar** (botón en *Vehículos* y en
*Conductores*, junto a *Exportar CSV*). Datos **ficticios** (sin datos personales
reales — RGPD).

| Fichero | Entidad | Filas |
|---|---|---|
| `vehiculos.csv` | Vehículos (pestaña Flota) | 8 |
| `conductores.csv` | Personas (conductores/supervisores) | 6 |

## Cómo usarlos
1. Vehículos (o Conductores) → **Importar** → arrastra el CSV.
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
(email/DNI) se resuelven **por nombre contra la base de datos**: si el valor no
existe, esa fila sale en el informe de errores. En los ejemplos van vacías para
que importen limpio en cualquier entorno; rellénalas con valores reales de tu BD
si quieres probar la resolución.

Si un fichero se reimporta, las filas ya existentes (matrícula / email-usuario /
DNI) se marcan como «ya existe» y no se duplican.
