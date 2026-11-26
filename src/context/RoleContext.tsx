"use client";

import React, { createContext, useCallback, useContext, useSyncExternalStore } from "react";

export type RolDemo = "COMERCIANTE" | "DISTRIBUIDORA_B2B";

interface RoleContextValue {
  rol: RolDemo;
  setRol: (nuevoRol: RolDemo) => void;
}

const STORAGE_KEY = "stockia_demo_rol_v1";
const ROLE_CHANGE_EVENT = "stockia-role-change";

function subscribeRoleStore(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(ROLE_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(ROLE_CHANGE_EVENT, onStoreChange);
  };
}

function getClientRoleSnapshot(): RolDemo {
  try {
    const guardado = window.localStorage.getItem(STORAGE_KEY);
    if (guardado === "COMERCIANTE" || guardado === "DISTRIBUIDORA_B2B") {
      return guardado;
    }
  } catch {
    // Ignorar restricciones de almacenamiento privado
  }
  return "COMERCIANTE";
}

function getServerRoleSnapshot(): RolDemo {
  return "COMERCIANTE";
}

const RoleContext = createContext<RoleContextValue | undefined>(undefined);

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const rol = useSyncExternalStore(
    subscribeRoleStore,
    getClientRoleSnapshot,
    getServerRoleSnapshot
  );

  const setRol = useCallback((nuevoRol: RolDemo) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, nuevoRol);
      window.dispatchEvent(new Event(ROLE_CHANGE_EVENT));
    } catch {
      // Ignorar restricciones de almacenamiento privado
    }
  }, []);

  return (
    <RoleContext.Provider value={{ rol, setRol }}>
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
