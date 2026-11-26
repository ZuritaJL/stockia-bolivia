"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  dbOffline,
  type CatalogoLocal,
  type LoteLocal,
  type VentaLocal,
} from "@/lib/db-offline";
import { STOCKIA_CLOUD_MUTATION_EVENT } from "@/lib/voice-quota-store";

function subscribeOnlineStatus(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getOnlineSnapshot(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

function getServerOnlineSnapshot(): boolean {
  return true;
}

interface RespuestaPullSync {
  ok: boolean;
  comercio?: {
    id: string;
    nombreTienda: string;
    macrodistrito: string;
    ciudad: string;
  };
  catalogo?: CatalogoLocal[];
  lotes?: LoteLocal[];
  ventasHoy?: VentaLocal[];
  timestamp?: string;
}

export function useOfflineSync() {
  const navegadorEnLinea = useSyncExternalStore(
    subscribeOnlineStatus,
    getOnlineSnapshot,
    getServerOnlineSnapshot
  );

  // Permite simular modo offline en demostraciones sin desconectar Wi-Fi del equipo
  const [modoOfflineSimulado, setModoOfflineSimulado] = useState(false);
  const enLinea = navegadorEnLinea && !modoOfflineSimulado;

  const [sincronizando, setSincronizando] = useState(false);
  const [hidratandoInicial, setHidratandoInicial] = useState(false);
  const [errorSync, setErrorSync] = useState<string | null>(null);

  const lockSyncRef = useRef(false);
  const hidratadoRef = useRef(false);

  const pendientesCount =
    useLiveQuery(
      () =>
        dbOffline.colaSincronizacion
          .where("estado")
          .anyOf(["PENDIENTE", "ERROR"])
          .count(),
      [],
      0
    ) ?? 0;

  const ultimaSincronizacion = useLiveQuery(
    async () => {
      const reg = await dbOffline.meta.get("ultimaSincronizacion");
      return reg?.valor ?? null;
    },
    [],
    null
  );

  /**
   * Descarga catálogo curado y lotes desde PostgreSQL hacia IndexedDB.
   * Solo reemplaza lotes locales cuando la cola pendiente está vacía,
   * garantizando que nunca se pisen ventas offline aún no enviadas.
   */
  const hidratarDesdeServidor = useCallback(async () => {
    if (!enLinea) return;

    try {
      await Promise.resolve();
      setHidratandoInicial(true);
      const res = await fetch("/api/sync", {
        method: "GET",
        cache: "no-store",
      });
      if (!res.ok) return;

      const data = (await res.json()) as RespuestaPullSync;
      if (!data.ok) return;

      await dbOffline.transaction(
        "rw",
        dbOffline.catalogo,
        dbOffline.lotes,
        dbOffline.ventasLocales,
        dbOffline.colaSincronizacion,
        dbOffline.meta,
        async () => {
          if (data.comercio) {
            await dbOffline.meta.put({
              clave: "comercioId",
              valor: data.comercio.id,
            });
            await dbOffline.meta.put({
              clave: "nombreTienda",
              valor: data.comercio.nombreTienda,
            });
          }

          if (data.catalogo && data.catalogo.length > 0) {
            await dbOffline.catalogo.bulkPut(data.catalogo);
          }

          const pendientesActuales = await dbOffline.colaSincronizacion.count();
          if (pendientesActuales === 0 && data.lotes) {
            await dbOffline.lotes.clear();
            await dbOffline.lotes.bulkPut(data.lotes);
          }

          if (pendientesActuales === 0 && data.ventasHoy) {
            await dbOffline.ventasLocales.bulkPut(data.ventasHoy);
          }

          if (data.timestamp) {
            await dbOffline.meta.put({
              clave: "ultimaSincronizacion",
              valor: data.timestamp,
            });
          }
        }
      );
      setErrorSync(null);
    } catch {
      // Si la red falla en pleno intento, continúa operando 100% en modo local
    } finally {
      setHidratandoInicial(false);
    }
  }, [enLinea]);

  /**
   * Envía en lote FIFO todas las operaciones pendientes de `colaSincronizacion` a `/api/sync`.
   */
  const sincronizarColaPendiente = useCallback(async () => {
    if (!enLinea || lockSyncRef.current) return;

    const pendientes = await dbOffline.colaSincronizacion
      .orderBy("id")
      .filter((op) => op.estado === "PENDIENTE" || op.estado === "ERROR")
      .toArray();

    if (pendientes.length === 0) return;

    lockSyncRef.current = true;
    setSincronizando(true);
    setErrorSync(null);

    try {
      const res = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operaciones: pendientes }),
      });

      const data = (await res.json()) as {
        ok: boolean;
        procesadas?: string[];
        timestamp?: string;
        error?: string;
      };

      if (!res.ok || !data.ok) {
        throw new Error(data.error ?? "No se pudo sincronizar con la nube.");
      }

      const idsExitosos = new Set(data.procesadas ?? []);

      await dbOffline.transaction(
        "rw",
        dbOffline.colaSincronizacion,
        dbOffline.lotes,
        dbOffline.meta,
        async () => {
          for (const op of pendientes) {
            if (idsExitosos.has(op.operacionId) && op.id !== undefined) {
              await dbOffline.colaSincronizacion.delete(op.id);
              if (op.tipo === "INGRESO_LOTE") {
                await dbOffline.lotes.update(op.payload.lote.id, {
                  sincronizado: true,
                });
              }
            }
          }

          await dbOffline.meta.put({
            clave: "ultimaSincronizacion",
            valor: data.timestamp ?? new Date().toISOString(),
          });
        }
      );
    } catch (err) {
      const mensaje =
        err instanceof Error ? err.message : "Error de red al sincronizar";
      setErrorSync(mensaje);

      await dbOffline.transaction("rw", dbOffline.colaSincronizacion, async () => {
        for (const op of pendientes) {
          if (op.id !== undefined) {
            await dbOffline.colaSincronizacion.update(op.id, {
              estado: "ERROR",
              intentos: op.intentos + 1,
              ultimoError: mensaje,
            });
          }
        }
      });
    } finally {
      lockSyncRef.current = false;
      setSincronizando(false);
    }
  }, [enLinea]);

  // Hidratación inicial de IndexedDB al montar la PWA
  useEffect(() => {
    if (hidratadoRef.current || !enLinea) return;
    hidratadoRef.current = true;

    const timer = window.setTimeout(() => {
      void (async () => {
        await sincronizarColaPendiente();
        await hidratarDesdeServidor();
      })();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [enLinea, hidratarDesdeServidor, sincronizarColaPendiente]);

  // Disparo automático cuando regresa la conexión o entran nuevas operaciones con red activa
  useEffect(() => {
    if (!enLinea || pendientesCount <= 0) return;

    const timer = window.setTimeout(() => {
      void sincronizarColaPendiente();
    }, 150);

    return () => window.clearTimeout(timer);
  }, [enLinea, pendientesCount, sincronizarColaPendiente]);

  // Refrescar IndexedDB automáticamente cuando el Asistente de Voz o Deshacer mutan PostgreSQL
  useEffect(() => {
    const manejarMutacionVoz = () => {
      void hidratarDesdeServidor();
    };
    window.addEventListener(STOCKIA_CLOUD_MUTATION_EVENT, manejarMutacionVoz);
    return () =>
      window.removeEventListener(
        STOCKIA_CLOUD_MUTATION_EVENT,
        manejarMutacionVoz
      );
  }, [hidratarDesdeServidor]);

  return {
    enLinea,
    modoOfflineSimulado,
    setModoOfflineSimulado,
    sincronizando,
    hidratandoInicial,
    pendientesCount,
    ultimaSincronizacion,
    errorSync,
    sincronizarColaPendiente,
    hidratarDesdeServidor,
  };
}
