/**
 * Tamaño del modal de «Enviar correo»: el MISMO en los cuatro pasos —si
 * encogiera o creciera al avanzar, el pie bailaría bajo el cursor— y ancho,
 * que ahí se lee y se escribe un correo entero. Lo ponen los seis sitios que
 * lo abren, desde aquí, para que no se les vaya cada uno por su lado.
 */
export const EMAIL_MODAL_SIZE = {
  maxWidth: 'min(1080px, 94vw)',
  height: 'min(780px, 88dvh)',
} as const
