"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";

export type RolDemo = "COMERCIANTE" | "DISTRIBUIDORA_B2B";

export interface SesionUsuarioStockia {
  usuarioId: string;
  nombreUsuario: string;
  email: string;
  rol: RolDemo;
  nombreEntidad: string;
  ubicacion: string;
  comercioId?: string | null;
  modoDemo?: boolean;
}

interface RoleContextValue {
  sesion: SesionUsuarioStockia | null;
  hidratado: boolean;
  rol: RolDemo;
  setRol: (nuevoRol: RolDemo) => void;
  iniciarSesion: (datos: SesionUsuarioStockia) => void;
  cerrarSesion: () => void;
}

const SESSION_STORAGE_KEY = "stockia_auth_session_v1";
const ROLE_STORAGE_KEY = "stockia_demo_rol_v1";
const AUTH_CHANGE_EVENT = "stockia-auth-session-change";

let ultimoJsonSesion: string | null = null;
let ultimaSesionParseada: SesionUsuarioStockia | null = null;

function subscribeAuthStore(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(AUTH_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(AUTH_CHANGE_EVENT, onStoreChange);
  };
}

function getClientSessionSnapshot(): SesionUsuarioStockia | null {
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      ultimoJsonSesion = null;
      ultimaSesionParseada = null;
      return null;
    }
    if (raw === ultimoJsonSesion) {
      return ultimaSesionParseada;
    }
    const parsed = JSON.parse(raw) as SesionUsuarioStockia;
    if (
      parsed &&
      typeof parsed.email === "string" &&
      (parsed.rol === "COMERCIANTE" || parsed.rol === "DISTRIBUIDORA_B2B")
    ) {
      ultimoJsonSesion = raw;
      ultimaSesionParseada = parsed;
      return parsed;
    }
  } catch {
    // Ignorar JSON corrupto o modo privado restringido
  }
  return null;
}

function getServerSessionSnapshot(): SesionUsuarioStockia | null {
  return null;
}

function subscribeHydration() {
  return () => {};
}

const RoleContext = createContext<RoleContextValue | undefined>(undefined);

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const sesion = useSyncExternalStore(
    subscribeAuthStore,
    getClientSessionSnapshot,
    getServerSessionSnapshot
  );

  const hidratado = useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false
  );

  const rol: RolDemo = sesion?.rol ?? "COMERCIANTE";

  const iniciarSesion = useCallback((datos: SesionUsuarioStockia) => {
    try {
      const serializado = JSON.stringify(datos);
      ultimoJsonSesion = serializado;
      ultimaSesionParseada = datos;
      window.localStorage.setItem(SESSION_STORAGE_KEY, serializado);
      window.localStorage.setItem(ROLE_STORAGE_KEY, datos.rol);
      window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    } catch {
      // Ignorar restricciones de almacenamiento privado
    }
  }, []);

  const setRol = useCallback((nuevoRol: RolDemo) => {
    try {
      const actual = getClientSessionSnapshot();
      if (actual) {
        const actualizado: SesionUsuarioStockia =
          nuevoRol === "DISTRIBUIDORA_B2B"
            ? {
                ...actual,
                rol: "DISTRIBUIDORA_B2B",
                nombreEntidad:
                  actual.rol === "DISTRIBUIDORA_B2B"
                    ? actual.nombreEntidad
                    : "Distribuidora Andina S.R.L.",
                ubicacion: "Cobertura: La Paz y El Alto",
              }
            : {
                ...actual,
                rol: "COMERCIANTE",
                nombreEntidad:
                  actual.nombreEntidad === "Distribuidora Andina S.R.L."
                    ? "Tienda Doña Martha"
                    : actual.nombreEntidad,
                ubicacion:
                  actual.ubicacion === "Cobertura: La Paz y El Alto"
                    ? "Miraflores, La Paz"
                    : actual.ubicacion,
              };
        const serializado = JSON.stringify(actualizado);
        ultimoJsonSesion = serializado;
        ultimaSesionParseada = actualizado;
        window.localStorage.setItem(SESSION_STORAGE_KEY, serializado);
      }
      window.localStorage.setItem(ROLE_STORAGE_KEY, nuevoRol);
      window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    } catch {
      // Ignorar restricciones de almacenamiento privado
    }
  }, []);

  const cerrarSesion = useCallback(() => {
    try {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      ultimoJsonSesion = null;
      ultimaSesionParseada = null;
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
    } catch {
      // Ignorar restricciones de almacenamiento privado
    }
  }, []);

  return (
    <RoleContext.Provider
      value={{
        sesion,
        hidratado,
        rol,
        setRol,
        iniciarSesion,
        cerrarSesion,
      }}
    >
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  const context = useContext(RoleContext);
  if (!context) {
    throw new Error("useRole debe usarse dentro de un RoleProvider");
  }
  return context;
}
