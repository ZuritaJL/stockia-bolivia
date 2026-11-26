"use client";

import { useEffect, useSyncExternalStore } from "react";

export interface EstadoCuotaVoz {
  usuarioId: string | null;
  comercioId: string | null;
  plan: "BASICO_GRATIS" | "VOZ_PRO";
  usados: number;
  limite: number;
  restantes: number | null;
  cargado: boolean;
}

export const STOCKIA_CLOUD_MUTATION_EVENT = "stockia-cloud-mutation";
const QUOTA_STORE_EVENT = "stockia-voice-quota-change";

let estadoActual: EstadoCuotaVoz = {
  usuarioId: null,
  comercioId: null,
  plan: "BASICO_GRATIS",
  usados: 2,
  limite: 15,
  restantes: 13,
  cargado: false,
};

let cargandoInicial = false;

function subscribeQuota(listener: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(QUOTA_STORE_EVENT, listener);
  return () => window.removeEventListener(QUOTA_STORE_EVENT, listener);
}

function getQuotaSnapshot(): EstadoCuotaVoz {
  return estadoActual;
}

const SERVER_SNAPSHOT: EstadoCuotaVoz = {
  usuarioId: null,
  comercioId: null,
  plan: "BASICO_GRATIS",
  usados: 2,
  limite: 15,
  restantes: 13,
  cargado: false,
};

function getServerQuotaSnapshot(): EstadoCuotaVoz {
  return SERVER_SNAPSHOT;
}

export function actualizarCuotaVozGlobal(parcial: Partial<EstadoCuotaVoz>) {
  estadoActual = {
    ...estadoActual,
    ...parcial,
    cargado: true,
  };
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(QUOTA_STORE_EVENT));
  }
}

export function notificarMutacionNubeStockia() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(STOCKIA_CLOUD_MUTATION_EVENT));
  }
}

export async function cargarCuotaVozDesdeServidor() {
  if (typeof window === "undefined" || !navigator.onLine) return;
  try {
    const res = await fetch("/api/voice-assistant", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as {
      ok: boolean;
      usuarioId?: string;
      comercioId?: string;
      cuota?: {
        plan: "BASICO_GRATIS" | "VOZ_PRO";
        usados: number;
        limite: number;
        restantes: number | null;
      };
    };
    if (data.ok && data.cuota) {
      actualizarCuotaVozGlobal({
        usuarioId: data.usuarioId ?? null,
        comercioId: data.comercioId ?? null,
        plan: data.cuota.plan,
        usados: data.cuota.usados,
        limite: data.cuota.limite,
        restantes: data.cuota.restantes,
      });
    }
  } catch {
    // Mantener último valor conocido en modo offline
  }
}

export function useVoiceQuota() {
  const cuota = useSyncExternalStore(
    subscribeQuota,
    getQuotaSnapshot,
    getServerQuotaSnapshot
  );

  useEffect(() => {
    if (estadoActual.cargado || cargandoInicial) return;
    cargandoInicial = true;
    void cargarCuotaVozDesdeServidor().finally(() => {
      cargandoInicial = false;
    });
  }, []);

  return cuota;
}
