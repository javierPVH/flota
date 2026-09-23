/**
 * Copy de la entrada por SSO corporativo (SAML) y de su modal de «sin acceso»
 * — módulo por página (R3-36): el chunk se lleva su texto. `denied` va
 * indexado por el motivo que devuelve el back en `?saml=`.
 */
import { useAppLang } from '@flota/ui/i18n'

/** Motivos con los que el ACS del back devuelve al login (`?saml=<motivo>`). */
export type DeniedReason = 'no_user' | 'inactive' | 'domain' | 'error'

type DeniedCopy = Record<DeniedReason, { title: string; body: string }>

const es = {
  subtitle: 'Entra con tu cuenta corporativa de Gransolar.',
  button: 'Entrar con mi cuenta corporativa',
  redirecting: 'Abriendo el acceso corporativo…',
  unavailable: 'El acceso corporativo no está disponible ahora mismo. Avisa a Sistemas.',
  security: 'Tu identidad la comprueba Google; aquí no se guarda ninguna contraseña.',
  chooser: 'Google te pedirá elegir con qué cuenta entras: usa la corporativa.',
  noSlo: 'Al salir de la app no se cierra tu sesión de Google: en un móvil compartido, ciérrala también allí.',
  openJira: 'Abrir solicitud en Jira',
  noUrl: 'La dirección de Jira no está configurada. Avisa a la administración.',
  close: 'Entendido',
  denied: {
    no_user: {
      title: 'Aún no tienes acceso a Flota',
      body: 'Te has identificado correctamente, pero tu correo no está dado de alta en Flota. Para entrar necesitas tener un vehículo asignado: abre una solicitud en Jira y, cuando la aprueben, la administración activará tu acceso.',
    },
    inactive: {
      title: 'Tu acceso está desactivado',
      body: 'Tu usuario existe en Flota pero está dado de baja. Si crees que es un error, contacta con la administración de flota.',
    },
    domain: {
      title: 'Cuenta no permitida',
      body: 'Solo pueden entrar cuentas corporativas de Gransolar.',
    },
    error: {
      title: 'No se pudo completar el acceso',
      body: 'El acceso corporativo devolvió un error. Vuelve a intentarlo y, si sigue pasando, avisa a Sistemas.',
    },
  } satisfies DeniedCopy,
}

const en: typeof es = {
  subtitle: 'Sign in with your Gransolar corporate account.',
  button: 'Sign in with my corporate account',
  redirecting: 'Opening corporate sign-in…',
  unavailable: 'Corporate sign-in is not available right now. Contact IT.',
  security: 'Google verifies your identity; no password is stored here.',
  chooser: 'Google will ask you which account to sign in with: pick the corporate one.',
  noSlo: 'Signing out of the app does not sign you out of Google: on a shared phone, sign out there too.',
  openJira: 'Open request in Jira',
  noUrl: 'The Jira address is not configured. Please contact administration.',
  close: 'Got it',
  denied: {
    no_user: {
      title: 'You do not have access to Fleet yet',
      body: 'You signed in correctly, but your email is not registered in Fleet. To get in you need a vehicle assigned: open a request in Jira and, once approved, administration will enable your access.',
    },
    inactive: {
      title: 'Your access is disabled',
      body: 'Your user exists in Fleet but has been deactivated. If you think this is a mistake, contact fleet administration.',
    },
    domain: {
      title: 'Account not allowed',
      body: 'Only Gransolar corporate accounts can sign in.',
    },
    error: {
      title: 'Sign-in could not be completed',
      body: 'Corporate sign-in returned an error. Try again and, if it persists, contact IT.',
    },
  },
}

const dict = { es, en }

export function useSsoCopy() {
  return dict[useAppLang()]
}

export function parseDeniedReason(value: string | null): DeniedReason | null {
  return value && value in es.denied ? (value as DeniedReason) : null
}
