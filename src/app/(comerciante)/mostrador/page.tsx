"use client";

import React, { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle,
  Barcode,
  Camera,
  CheckCircle2,
  CloudOff,
  Minus,
  PackagePlus,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  calcularEstadoLote,
  dbOffline,
  diasHastaVencimiento,
  ordenarLotesFEFO,
  registrarVentaFEFO,
  type CatalogoLocal,
  type MetodoRegistroLocal,
} from "@/lib/db-offline";
import { useOfflineSync } from "@/hooks/useOfflineSync";
import { BarcodeScannerModal } from "@/components/BarcodeScannerModal";
import { IngresoLoteModal } from "@/components/IngresoLoteModal";
import { InstallPwaBanner } from "@/components/InstallPwaBanner";
import { VoiceQuotaPill } from "@/components/mostrador/VoiceQuotaPill";

interface LineaCarritoUI {
  productoId: string;
  codigoBarras: string;
  nombreProducto: string;
  marca: string;
  cantidad: number;
  precioReferencia: number;
  stockDisponible: number;
  proximoLotePorVencer: boolean;
}

const EMPTY_CATALOGO: CatalogoLocal[] = [];
const EMPTY_LOTES: import("@/lib/db-offline").LoteLocal[] = [];
const EMPTY_VENTAS: import("@/lib/db-offline").VentaLocal[] = [];

export default function MostradorOfflineFirstPage() {
  const {
    enLinea,
    modoOfflineSimulado,
    setModoOfflineSimulado,
    sincronizando,
    hidratandoInicial,
    pendientesCount,
    sincronizarColaPendiente,
  } = useOfflineSync();

  const [busqueda, setBusqueda] = useState("");
  const [carrito, setCarrito] = useState<LineaCarritoUI[]>([]);
  const [metodoActual, setMetodoActual] =
    useState<MetodoRegistroLocal>("MANUAL");

  const [modalEscanerAbierto, setModalEscanerAbierto] = useState(false);
  const [modalIngresoAbierto, setModalIngresoAbierto] = useState(false);
  const [productoPreseleccionadoLote, setProductoPreseleccionadoLote] =
    useState<string | null>(null);

  const [cobrando, setCobrando] = useState(false);
  const [avisoExito, setAvisoExito] = useState<string | null>(null);
  const [avisoError, setAvisoError] = useState<string | null>(null);

  // Consultas reactivas locales en IndexedDB (Dexie.js) < 1ms
  const catalogo = useLiveQuery(
    () => dbOffline.catalogo.toArray(),
    [],
    EMPTY_CATALOGO
  );
  const lotes = useLiveQuery(() => dbOffline.lotes.toArray(), [], EMPTY_LOTES);
  const ventasHoy = useLiveQuery(
    async () => {
      const hoy = new Date();
      const inicioHoyIso = new Date(
        hoy.getFullYear(),
        hoy.getMonth(),
        hoy.getDate()
      ).toISOString();
      return dbOffline.ventasLocales
        .where("fechaHora")
        .aboveOrEqual(inicioHoyIso)
        .toArray();
    },
    [],
    EMPTY_VENTAS
  );

  // Enriquecer cada producto con su stock vendible y el lote prioritario FEFO
  const productosMostrador = useMemo(() => {
    return catalogo.map((prod) => {
      const lotesVendibles = ordenarLotesFEFO(
        lotes.filter(
          (l) =>
            l.productoId === prod.id &&
            l.stockActual > 0 &&
            calcularEstadoLote(l.stockActual, l.fechaVencimiento) !== "VENCIDO"
        )
      );

      const stockDisponible = lotesVendibles.reduce(
        (sum, l) => sum + l.stockActual,
        0
      );
      const primerLoteFEFO = lotesVendibles[0] ?? null;
      const diasPrimerLote = primerLoteFEFO
        ? diasHastaVencimiento(primerLoteFEFO.fechaVencimiento)
        : null;
      const tieneAlertaFEFO =
        diasPrimerLote !== null && diasPrimerLote >= 0 && diasPrimerLote <= 5;

      // Si está agotado, tomar último precio conocido de cualquier lote previo
      const loteHistorico =
        primerLoteFEFO ??
        lotes.find((l) => l.productoId === prod.id) ??
        null;

      return {
        ...prod,
        stockDisponible,
        precioVentaActual: loteHistorico ? loteHistorico.precioVenta : 0,
        tieneAlertaFEFO,
        diasPrimerLote,
      };
    });
  }, [catalogo, lotes]);

  const resultadosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const lista = !q
      ? productosMostrador
      : productosMostrador.filter(
          (p) =>
            p.nombreProducto.toLowerCase().includes(q) ||
            p.codigoBarras.includes(q) ||
            p.marca.toLowerCase().includes(q) ||
            p.categoria.toLowerCase().includes(q)
        );

    // Mostrar primero productos con alerta FEFO, luego con stock disponible
    return [...lista].sort((a, b) => {
      if (a.tieneAlertaFEFO && !b.tieneAlertaFEFO) return -1;
      if (!a.tieneAlertaFEFO && b.tieneAlertaFEFO) return 1;
      if (a.stockDisponible > 0 && b.stockDisponible === 0) return -1;
      if (a.stockDisponible === 0 && b.stockDisponible > 0) return 1;
      return a.nombreProducto.localeCompare(b.nombreProducto);
    });
  }, [productosMostrador, busqueda]);

  const totalVentasDiaBs = useMemo(
    () => ventasHoy.reduce((acc, v) => acc + v.totalBs, 0),
    [ventasHoy]
  );

  const agregarAlCarrito = (
    prod: CatalogoLocal,
    origen: MetodoRegistroLocal = "MANUAL"
  ) => {
    setAvisoError(null);
    const infoProd = productosMostrador.find((p) => p.id === prod.id);
    const disponible = infoProd?.stockDisponible ?? 0;

    if (disponible <= 0) {
      setProductoPreseleccionadoLote(prod.id);
      setAvisoError(
        `"${prod.nombreProducto}" no tiene stock activo. Registra un lote nuevo.`
      );
      setModalIngresoAbierto(true);
      return;
    }

    if (origen === "ESCANER") {
      setMetodoActual("ESCANER");
    }

    setCarrito((prev) => {
      const existente = prev.find((item) => item.productoId === prod.id);
      if (existente) {
        if (existente.cantidad >= disponible) {
          setAvisoError(
            `Máximo stock disponible alcanzado (${disponible} u.) para ${prod.nombreProducto}.`
          );
          return prev;
        }
        return prev.map((item) =>
          item.productoId === prod.id
            ? { ...item, cantidad: item.cantidad + 1, stockDisponible: disponible }
            : item
        );
      }

      return [
        ...prev,
        {
          productoId: prod.id,
          codigoBarras: prod.codigoBarras,
          nombreProducto: prod.nombreProducto,
          marca: prod.marca,
          cantidad: 1,
          precioReferencia: infoProd?.precioVentaActual ?? 0,
          stockDisponible: disponible,
          proximoLotePorVencer: Boolean(infoProd?.tieneAlertaFEFO),
        },
      ];
    });
  };

  const cambiarCantidadCarrito = (productoId: string, delta: number) => {
    setAvisoError(null);
    setCarrito((prev) =>
      prev
        .map((item) => {
          if (item.productoId !== productoId) return item;
          const nuevaCantidad = item.cantidad + delta;
          if (nuevaCantidad > item.stockDisponible) {
            setAvisoError(
              `Solo hay ${item.stockDisponible} unidades disponibles de ${item.nombreProducto}.`
            );
            return item;
          }
          return { ...item, cantidad: nuevaCantidad };
        })
        .filter((item) => item.cantidad > 0)
    );
  };

  const manejarCodigoEscaneado = (codigoBarras: string) => {
    setModalEscanerAbierto(false);
    const encontrado = catalogo.find((c) => c.codigoBarras === codigoBarras);

    if (!encontrado) {
      setBusqueda(codigoBarras);
      setAvisoError(
        `Código ${codigoBarras} no encontrado en el catálogo curado.`
      );
      return;
    }

    agregarAlCarrito(encontrado, "ESCANER");
    setAvisoExito(`Escaneado: ${encontrado.nombreProducto}`);
  };

  const totalCarritoEstimado = useMemo(
    () =>
      carrito.reduce(
        (sum, item) => sum + item.cantidad * item.precioReferencia,
        0
      ),
    [carrito]
  );

  const totalUnidadesCarrito = useMemo(
    () => carrito.reduce((sum, item) => sum + item.cantidad, 0),
    [carrito]
  );

  const cobrarVenta = async () => {
    if (carrito.length === 0 || cobrando) return;
    setCobrando(true);
    setAvisoError(null);

    try {
      const resultado = await registrarVentaFEFO({
        items: carrito.map((c) => ({
          productoId: c.productoId,
          nombreProducto: c.nombreProducto,
          cantidad: c.cantidad,
          precioReferencia: c.precioReferencia,
        })),
        metodoRegistro: metodoActual,
        fueOffline: !enLinea,
      });

      if (typeof navigator !== "undefined" && "vibrate" in navigator) {
        try {
          navigator.vibrate(80);
        } catch {
          // Ignorar si no está soportado
        }
      }

      setCarrito([]);
      setMetodoActual("MANUAL");

      const notaFefo =
        resultado.lotesPorVencerDespachados > 0
          ? " · Lote próximo a vencer despachado primero (FEFO)"
          : " · Stock descontado por orden FEFO";

      setAvisoExito(
        `¡Venta cobrada: Bs ${resultado.venta.totalBs.toFixed(2)}!${notaFefo}`
      );
    } catch (err) {
      setAvisoError(
        err instanceof Error ? err.message : "Error al cobrar la venta."
      );
    } finally {
      setCobrando(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Banner discreto de instalación PWA */}
      <InstallPwaBanner />

      {/* 1. INDICADOR SUPERIOR DE ESTADO DE CONEXIÓN */}
      <div
        className={`rounded-2xl px-4 py-3 text-white shadow-xs transition-colors ${
          enLinea ? "bg-brand-primary" : "bg-brand-amber"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            {enLinea ? (
              <Wifi className="h-5 w-5 shrink-0 text-emerald-200" />
            ) : (
              <WifiOff className="h-5 w-5 shrink-0 text-white" />
            )}
            <div>
              <p className="text-sm font-extrabold leading-tight">
                {enLinea
                  ? "En línea"
                  : "Modo sin conexión - Guardando local"}
              </p>
              <p className="text-[11px] text-white/90">
                {sincronizando
                  ? "Sincronizando operaciones pendientes con la nube..."
                  : pendientesCount > 0
                    ? `${pendientesCount} operación(es) en cola listas para sincronizar`
                    : enLinea
                      ? "Respaldo en PostgreSQL sincronizado al día"
                      : "Tus ventas e ingresos se guardan en este celular (Dexie.js)"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {enLinea && pendientesCount > 0 && (
              <button
                type="button"
                onClick={() => void sincronizarColaPendiente()}
                className="inline-flex items-center gap-1 rounded-xl bg-white/20 px-2.5 py-1.5 text-[11px] font-bold hover:bg-white/30 cursor-pointer"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${sincronizando ? "animate-spin" : ""}`}
                />
                Sincronizar
              </button>
            )}

            {/* Interruptor auxiliar para probar Offline-First sin apagar el Wi-Fi */}
            <button
              type="button"
              onClick={() => setModoOfflineSimulado((prev) => !prev)}
              title="Simular corte o retorno de internet para pruebas MVP"
              className="inline-flex items-center gap-1 rounded-xl bg-black/20 px-2.5 py-1.5 text-[11px] font-semibold hover:bg-black/30 cursor-pointer"
            >
              <CloudOff className="h-3.5 w-3.5" />
              {modoOfflineSimulado ? "Reconectar Red" : "Probar Offline"}
            </button>
          </div>
        </div>

        {/* Mini resumen de caja del día */}
        <div className="mt-3 pt-2.5 border-t border-white/15 flex items-center justify-between text-xs">
          <span>
            Caja de hoy ({ventasHoy.length} ventas):{" "}
            <strong className="text-sm font-extrabold">
              Bs {totalVentasDiaBs.toFixed(2)}
            </strong>
          </span>
          <span className="font-semibold">
            {catalogo.length} productos · {lotes.filter((l) => l.stockActual > 0).length} lotes activos
          </span>
        </div>
      </div>

      {/* Avisos de operación */}
      {avisoExito && (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-brand-primary/30 bg-brand-primary-tint px-4 py-3 text-xs font-bold text-brand-primary">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {avisoExito}
          </span>
          <button
            type="button"
            onClick={() => setAvisoExito(null)}
            className="text-brand-primary/70 hover:text-brand-primary cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {avisoError && (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-brand-amber/40 bg-brand-amber-tint px-4 py-3 text-xs font-bold text-brand-amber-dark">
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {avisoError}
          </span>
          <button
            type="button"
            onClick={() => setAvisoError(null)}
            className="text-brand-amber-dark/70 hover:text-brand-amber-dark cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Franja discreta de estado del Asistente de Voz y Cuota Diaria */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border-subtle bg-white px-3.5 py-2.5 shadow-2xs">
        <span className="text-xs font-semibold text-slate-600">
          Asistente Operativo de Voz IA:
        </span>
        <VoiceQuotaPill />
      </div>

      {/* 2. ACCIONES TÁCTILES DE MOSTRADOR: ESCÁNER + INGRESO LOTE */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => setModalEscanerAbierto(true)}
          className="flex items-center justify-center gap-2.5 rounded-2xl border-2 border-brand-primary bg-white px-4 py-3.5 text-left shadow-2xs transition active:scale-[0.98] hover:bg-brand-primary-tint/50 cursor-pointer"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-primary text-white">
            <Camera className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-slate-900 leading-tight">
              Escanear
            </p>
            <p className="text-[11px] text-slate-500 truncate">
              Cámara código 777
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setProductoPreseleccionadoLote(null);
            setModalIngresoAbierto(true);
          }}
          className="flex items-center justify-center gap-2.5 rounded-2xl border-2 border-brand-amber bg-white px-4 py-3.5 text-left shadow-2xs transition active:scale-[0.98] hover:bg-brand-amber-tint/40 cursor-pointer"
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-amber text-white">
            <PackagePlus className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-extrabold text-slate-900 leading-tight">
              Ingreso / Lote
            </p>
            <p className="text-[11px] text-slate-500 truncate">
              +Stock y vencimiento
            </p>
          </div>
        </button>
      </div>

      {/* 3. CARRITO RÁPIDO DE VENTA + BOTÓN GIGANTE "COBRAR VENTA" (FEFO) */}
      <section className="rounded-2xl border-2 border-brand-primary/25 bg-white p-4 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-extrabold text-slate-900">
            <ShoppingCart className="h-4 w-4 text-brand-primary" />
            Carrito Rápido ({totalUnidadesCarrito})
          </h2>
          {carrito.length > 0 && (
            <button
              type="button"
              onClick={() => setCarrito([])}
              className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700 cursor-pointer"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Vaciar
            </button>
          )}
        </div>

        {carrito.length === 0 ? (
          <p className="rounded-xl bg-slate-50 py-4 text-center text-xs text-slate-500">
            Toca un producto abajo o escanea su código de barras para vender en menos de 5 segundos.
          </p>
        ) : (
          <div className="space-y-2">
            {carrito.map((item) => (
              <div
                key={item.productoId}
                className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-bold text-slate-900 truncate">
                      {item.nombreProducto}
                    </p>
                    {item.proximoLotePorVencer && (
                      <span className="shrink-0 rounded bg-brand-amber-tint px-1.5 py-0.5 text-[10px] font-extrabold text-brand-amber-dark">
                        FEFO
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600">
                    Bs {item.precioReferencia.toFixed(2)} c/u · Subtotal:{" "}
                    <strong className="text-brand-primary">
                      Bs {(item.cantidad * item.precioReferencia).toFixed(2)}
                    </strong>
                  </p>
                </div>

                {/* Controles grandes táctiles de cantidad */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => cambiarCantidadCarrito(item.productoId, -1)}
                    aria-label={`Restar ${item.nombreProducto}`}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-white border border-slate-300 text-slate-800 active:scale-95 cursor-pointer"
                  >
                    <Minus className="h-4 w-4" />
                  </button>
                  <span className="w-7 text-center text-sm font-extrabold text-slate-900">
                    {item.cantidad}
                  </span>
                  <button
                    type="button"
                    onClick={() => cambiarCantidadCarrito(item.productoId, 1)}
                    aria-label={`Sumar ${item.nombreProducto}`}
                    className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-primary text-white active:scale-95 cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* BOTÓN GIGANTE COBRAR VENTA */}
        <button
          type="button"
          disabled={carrito.length === 0 || cobrando}
          onClick={() => void cobrarVenta()}
          className="w-full min-h-15 flex items-center justify-between rounded-2xl bg-brand-primary px-5 py-4 text-white shadow-md transition active:scale-[0.99] hover:bg-brand-primary-light disabled:bg-slate-300 disabled:text-slate-500 disabled:shadow-none cursor-pointer"
        >
          <span className="text-base sm:text-lg font-extrabold tracking-tight">
            {cobrando ? "Registrando venta FEFO..." : "Cobrar Venta"}
          </span>
          <span className="rounded-xl bg-white/15 px-3 py-1 text-base sm:text-lg font-black">
            Bs {totalCarritoEstimado.toFixed(2)}
          </span>
        </button>
      </section>

      {/* 4. BUSCADOR INSTANTÁNEO LOCAL Y GRILLA TÁCTIL DE PRODUCTOS */}
      <section className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <input
            type="search"
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar por nombre, marca o código 777..."
            className="w-full rounded-2xl border border-slate-300 bg-white pl-10 pr-4 py-3 text-sm font-medium text-slate-900 shadow-2xs focus:border-brand-primary focus:outline-none"
          />
        </div>

        {hidratandoInicial && catalogo.length === 0 ? (
          <div className="rounded-2xl bg-white border border-border-subtle p-6 text-center text-xs font-semibold text-slate-500">
            Descargando catálogo curado boliviano a memoria local...
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {resultadosFiltrados.map((prod) => {
              const agotado = prod.stockDisponible <= 0;
              const enCarrito = carrito.find((c) => c.productoId === prod.id);

              return (
                <div
                  key={prod.id}
                  onClick={() => agregarAlCarrito(prod, "MANUAL")}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      agregarAlCarrito(prod, "MANUAL");
                    }
                  }}
                  className={`relative rounded-2xl border p-3 flex flex-col justify-between transition select-none cursor-pointer active:scale-[0.98] ${
                    enCarrito
                      ? "border-2 border-brand-primary bg-brand-primary-tint/35"
                      : prod.tieneAlertaFEFO
                        ? "border-brand-amber/60 bg-white shadow-2xs"
                        : agotado
                          ? "border-slate-200 bg-slate-100/75 opacity-80"
                          : "border-border-subtle bg-white shadow-2xs hover:border-brand-primary/50"
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500 truncate">
                        {prod.marca}
                      </span>
                      {prod.tieneAlertaFEFO && (
                        <span className="shrink-0 rounded-full bg-brand-amber px-1.5 py-0.5 text-[9px] font-extrabold text-white">
                          Vence {prod.diasPrimerLote}d
                        </span>
                      )}
                    </div>

                    <p className="mt-0.5 text-sm font-bold text-slate-900 leading-snug line-clamp-2">
                      {prod.nombreProducto}
                    </p>

                    <p className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] text-slate-400">
                      <Barcode className="h-3 w-3" />
                      {prod.codigoBarras}
                    </p>
                  </div>

                  <div className="mt-2.5 pt-2 border-t border-slate-100 flex items-center justify-between gap-1">
                    <span className="text-sm font-extrabold text-brand-primary">
                      {prod.precioVentaActual > 0
                        ? `Bs ${prod.precioVentaActual.toFixed(2)}`
                        : "Sin precio"}
                    </span>
                    <span
                      className={`rounded-lg px-2 py-0.5 text-[10px] font-bold ${
                        agotado
                          ? "bg-slate-200 text-slate-600"
                          : prod.tieneAlertaFEFO
                            ? "bg-brand-amber-tint text-brand-amber-dark"
                            : "bg-brand-primary-tint text-brand-primary"
                      }`}
                    >
                      {agotado ? "+ Lote" : `Stock: ${prod.stockDisponible}`}
                    </span>
                  </div>

                  {enCarrito && (
                    <span className="absolute -top-2 -right-2 flex h-6 min-w-6 items-center justify-center rounded-full bg-brand-primary px-1.5 text-xs font-extrabold text-white shadow-xs">
                      {enCarrito.cantidad}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Modales */}
      <BarcodeScannerModal
        abierto={modalEscanerAbierto}
        onClose={() => setModalEscanerAbierto(false)}
        onDetected={manejarCodigoEscaneado}
      />

      <IngresoLoteModal
        key={productoPreseleccionadoLote ?? "general"}
        abierto={modalIngresoAbierto}
        catalogo={catalogo}
        lotesActuales={lotes}
        productoInicialId={productoPreseleccionadoLote}
        onClose={() => setModalIngresoAbierto(false)}
        onSuccess={(mensaje) => setAvisoExito(mensaje)}
      />
    </div>
  );
}
