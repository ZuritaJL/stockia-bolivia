"use client";

import React, { useCallback, useEffect, useState } from "react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import {
  AlertTriangle,
  BarChart3,
  Check,
  Clock,
  Coins,
  Copy,
  Flame,
  Loader2,
  PackageCheck,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  TrendingUp,
} from "lucide-react";
import type { ResultadoInteligenciaComerciante } from "@/lib/fefo-engine";
import { sincronizarInventarioLocalDesdeNube } from "@/lib/db-offline";
import { STOCKIA_CLOUD_MUTATION_EVENT } from "@/lib/voice-quota-store";

type PestanaActiva = "PEDIR_HOY" | "POR_VENCER" | "CAPITAL_DORMIDO";

export default function DecisionPreventistaAlertasPage() {
  const [datos, setDatos] = useState<ResultadoInteligenciaComerciante | null>(
    null
  );
  const [cargando, setCargando] = useState(true);
  const [simulando, setSimulando] = useState(false);
  const [pestana, setPestana] = useState<PestanaActiva>("PEDIR_HOY");
  const [copiadoWhatsapp, setCopiadoWhatsapp] = useState(false);
  const [mensajeBanner, setMensajeBanner] = useState<string | null>(null);

  const cargarInteligencia = useCallback(async () => {
    try {
      const res = await fetch("/api/comerciante/alertas", {
        method: "GET",
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as ResultadoInteligenciaComerciante & {
        ok: boolean;
      };
      if (json.ok) {
        setDatos(json);
      }
    } catch {
      // Mantener vista previa si se pierde red momentáneamente
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void cargarInteligencia();
    }, 0);

    const recargarPorVoz = () => {
      void cargarInteligencia();
    };
    window.addEventListener(STOCKIA_CLOUD_MUTATION_EVENT, recargarPorVoz);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener(STOCKIA_CLOUD_MUTATION_EVENT, recargarPorVoz);
    };
  }, [cargarInteligencia]);

  const ejecutarSimulacion14Dias = async () => {
    if (simulando) return;
    setSimulando(true);
    setMensajeBanner(null);

    try {
      const res = await fetch("/api/comerciante/alertas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await res.json()) as ResultadoInteligenciaComerciante & {
        ok: boolean;
        mensaje?: string;
      };
      if (res.ok && json.ok) {
        setDatos(json);
        await sincronizarInventarioLocalDesdeNube();
        setMensajeBanner(
          "Historial de 14 días simulado: rotación VRD, alertas FEFO y capital dormido actualizados."
        );
      }
    } finally {
      setSimulando(false);
    }
  };

  const copiarPedidoWhatsapp = async () => {
    if (!datos || datos.listaReposicion.length === 0) return;

    const fechaHoy = new Date().toLocaleDateString("es-BO");
    const totalPedidoBs = datos.listaReposicion.reduce(
      (acc, i) => acc + i.costoEstimadoBs,
      0
    );

    const lineasProductos = datos.listaReposicion
      .map(
        (item) =>
          `• *${item.nombreProducto}*: ${item.cantidadSugerida} u. (Est. Bs ${item.costoEstimadoBs.toFixed(2)})`
      )
      .join("\n");

    const texto = [
      `📦 *PEDIDO DE REPOSICIÓN - ${datos.comercio.nombreTienda}*`,
      `📍 ${datos.comercio.macrodistrito}, ${datos.comercio.ciudad.replace("_", " ")} | ${fechaHoy}`,
      "",
      lineasProductos,
      "",
      `💰 *Inversión total estimada:* Bs ${totalPedidoBs.toFixed(2)}`,
      `_Calculado para 7 días de cobertura con StockIA Bolivia_`,
    ].join("\n");

    try {
      await navigator.clipboard.writeText(texto);
      setCopiadoWhatsapp(true);
      window.setTimeout(() => setCopiadoWhatsapp(false), 3000);
    } catch {
      setMensajeBanner("No se pudo copiar automáticamente al portapapeles.");
    }
  };

  if (cargando && !datos) {
    return (
      <div className="rounded-3xl bg-white border border-border-subtle p-8 flex flex-col items-center justify-center gap-3 text-center">
        <Loader2 className="h-7 w-7 animate-spin text-brand-primary" />
        <p className="text-sm font-bold text-slate-800">
          Calculando rotación VRD, semáforo FEFO y capital dormido...
        </p>
      </div>
    );
  }

  const resumenHoy = datos?.resumenFinancieroHoy ?? {
    totalVendidoHoyBs: 0,
    margenGananciaHoyBs: 0,
    cantidadVentasHoy: 0,
    ahorroPotencialFefoBs: 0,
  };

  const listaReposicion = datos?.listaReposicion ?? [];
  const alertasFefo = datos?.alertasFefo ?? [];
  const capitalDormido = datos?.capitalDormido ?? {
    totalInmovilizadoBs: 0,
    cantidadProductos: 0,
    items: [],
  };
  const conteoSemaforo = datos?.conteoSemaforoFefo ?? {
    rojoCritico: 0,
    ambarPreventivo: 0,
    verdeOptimo: 0,
  };
  const serie14d = datos?.serieRotacion14d ?? [];

  const totalPedidoHoyBs = listaReposicion.reduce(
    (sum, item) => sum + item.costoEstimadoBs,
    0
  );

  const tieneVentasHistoricas = serie14d.some((d) => d.totalBs > 0);

  return (
    <div className="space-y-4">
      {/* CABECERA + BOTÓN DEMOSTRACIÓN 14 DÍAS */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-base sm:text-lg font-extrabold text-slate-900 leading-tight">
            Decisión en 2 Minutos con el Preventista
          </h1>
          <p className="text-xs text-slate-600">
            Motor predictivo VRD (14d), Semáforo FEFO y Capital Dormido
          </p>
        </div>

        <button
          type="button"
          disabled={simulando}
          onClick={() => void ejecutarSimulacion14Dias()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand-primary px-3 py-2 text-xs font-extrabold text-white shadow-xs hover:bg-brand-primary-light disabled:opacity-60 cursor-pointer"
        >
          {simulando ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5 text-amber-300" />
          )}
          {simulando ? "Simulando..." : "Simular historial de 14 días"}
        </button>
      </div>

      {mensajeBanner && (
        <div className="flex items-center justify-between gap-2 rounded-2xl border border-brand-primary/30 bg-brand-primary-tint px-3.5 py-2.5 text-xs font-bold text-brand-primary">
          <span>{mensajeBanner}</span>
          <button
            type="button"
            onClick={() => setMensajeBanner(null)}
            className="text-brand-primary/70 hover:text-brand-primary cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* TARJETAS DE RESUMEN SUPERIOR */}
      <section className="grid grid-cols-3 gap-2.5">
        {/* 1. Ganancia de Hoy (#10563E) */}
        <div className="rounded-2xl bg-[#10563E] p-3 text-white shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-100">
              Ganancia Hoy
            </span>
            <TrendingUp className="h-3.5 w-3.5 text-emerald-200 shrink-0" />
          </div>
          <p className="mt-1.5 text-lg font-black leading-tight">
            Bs {resumenHoy.margenGananciaHoyBs.toFixed(2)}
          </p>
          <p className="mt-0.5 text-[10px] text-emerald-100/85 truncate">
            Venta: Bs {resumenHoy.totalVendidoHoyBs.toFixed(0)}
          </p>
        </div>

        {/* 2. Alertas FEFO Activas (#DC2626 / #D97706) */}
        <div
          className={`rounded-2xl p-3 text-white shadow-xs flex flex-col justify-between ${
            conteoSemaforo.rojoCritico > 0 ? "bg-[#DC2626]" : "bg-[#D97706]"
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wide text-white/90">
              Alertas FEFO
            </span>
            <AlertTriangle className="h-3.5 w-3.5 text-white shrink-0" />
          </div>
          <p className="mt-1.5 text-lg font-black leading-tight">
            {alertasFefo.length} lotes
          </p>
          <p className="mt-0.5 text-[10px] text-white/90 truncate">
            Protege Bs {resumenHoy.ahorroPotencialFefoBs.toFixed(0)}
          </p>
        </div>

        {/* 3. Capital Dormido (#D97706) */}
        <div className="rounded-2xl bg-white border-2 border-[#D97706]/50 p-3 shadow-xs flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[#B45309]">
              Cap. Dormido
            </span>
            <Coins className="h-3.5 w-3.5 text-[#D97706] shrink-0" />
          </div>
          <p className="mt-1.5 text-lg font-black leading-tight text-slate-900">
            Bs {capitalDormido.totalInmovilizadoBs.toFixed(0)}
          </p>
          <p className="mt-0.5 text-[10px] font-semibold text-slate-500 truncate">
            {capitalDormido.cantidadProductos} prod. &gt;21d
          </p>
        </div>
      </section>

      {/* MINI GRÁFICA DE ROTACIÓN DE 14 DÍAS (RECHARTS) */}
      <section className="rounded-2xl border border-border-subtle bg-white p-3.5 shadow-2xs">
        <div className="flex items-center justify-between mb-2">
          <span className="inline-flex items-center gap-1.5 text-xs font-extrabold text-slate-800">
            <BarChart3 className="h-4 w-4 text-[#10563E]" />
            Pulso de Rotación (Últimos 14 días)
          </span>
          <button
            type="button"
            onClick={() => void cargarInteligencia()}
            title="Actualizar métricas"
            className="text-slate-400 hover:text-brand-primary cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        {tieneVentasHistoricas ? (
          <div className="h-28 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={serie14d}>
                <XAxis
                  dataKey="fechaCorta"
                  tick={{ fontSize: 10, fill: "#64748B" }}
                  axisLine={false}
                  tickLine={false}
                  interval={2}
                />
                <Tooltip
                  formatter={(value) => [`Bs ${Number(value).toFixed(2)}`, "Ventas"]}
                  contentStyle={{
                    borderRadius: "12px",
                    borderColor: "#E2E8F0",
                    fontSize: "12px",
                  }}
                />
                <Bar
                  dataKey="totalBs"
                  fill="#10563E"
                  radius={[5, 5, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="rounded-xl bg-slate-50 py-3 px-3 text-center text-xs text-slate-500">
            Aún hay pocas ventas registradas. Pulsa{" "}
            <strong className="text-brand-primary">
              &ldquo;Simular historial de 14 días&rdquo;
            </strong>{" "}
            arriba para cargar una curva real de demostración.
          </div>
        )}
      </section>

      {/* 3 PESTAÑAS GRANDES FÁCILES DE TOCAR CON UNA MANO */}
      <div
        role="tablist"
        aria-label="Secciones de inteligencia comercial"
        className="grid grid-cols-3 gap-1.5 rounded-2xl bg-slate-200/80 p-1.5"
      >
        <button
          type="button"
          role="tab"
          aria-selected={pestana === "PEDIR_HOY"}
          onClick={() => setPestana("PEDIR_HOY")}
          className={`min-h-12 rounded-xl px-2 py-2 text-center transition-all cursor-pointer flex flex-col items-center justify-center ${
            pestana === "PEDIR_HOY"
              ? "bg-[#10563E] text-white shadow-xs font-extrabold"
              : "text-slate-700 hover:bg-white/60 font-bold"
          }`}
        >
          <span className="text-xs leading-tight">Qué pedir hoy</span>
          <span
            className={`mt-0.5 rounded-full px-1.5 text-[10px] ${
              pestana === "PEDIR_HOY"
                ? "bg-white/20 text-white"
                : "bg-slate-300/80 text-slate-700"
            }`}
          >
            {listaReposicion.length}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={pestana === "POR_VENCER"}
          onClick={() => setPestana("POR_VENCER")}
          className={`min-h-12 rounded-xl px-2 py-2 text-center transition-all cursor-pointer flex flex-col items-center justify-center ${
            pestana === "POR_VENCER"
              ? "bg-[#DC2626] text-white shadow-xs font-extrabold"
              : "text-slate-700 hover:bg-white/60 font-bold"
          }`}
        >
          <span className="text-xs leading-tight">Por vencer (FEFO)</span>
          <span
            className={`mt-0.5 rounded-full px-1.5 text-[10px] ${
              pestana === "POR_VENCER"
                ? "bg-white/20 text-white"
                : "bg-red-100 text-[#DC2626]"
            }`}
          >
            {alertasFefo.length}
          </span>
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={pestana === "CAPITAL_DORMIDO"}
          onClick={() => setPestana("CAPITAL_DORMIDO")}
          className={`min-h-12 rounded-xl px-2 py-2 text-center transition-all cursor-pointer flex flex-col items-center justify-center ${
            pestana === "CAPITAL_DORMIDO"
              ? "bg-[#D97706] text-white shadow-xs font-extrabold"
              : "text-slate-700 hover:bg-white/60 font-bold"
          }`}
        >
          <span className="text-xs leading-tight">Capital dormido</span>
          <span
            className={`mt-0.5 rounded-full px-1.5 text-[10px] ${
              pestana === "CAPITAL_DORMIDO"
                ? "bg-white/20 text-white"
                : "bg-amber-100 text-[#B45309]"
            }`}
          >
            {capitalDormido.cantidadProductos}
          </span>
        </button>
      </div>

      {/* ==================================================================== */}
      {/* PESTAÑA 1: QUÉ PEDIR HOY (SUGERENCIA DE REPOSICIÓN PARA PREVENTISTA) */}
      {/* ==================================================================== */}
      {pestana === "PEDIR_HOY" && (
        <section className="space-y-3">
          {/* Cabecera de presupuesto + Botón Copiar para WhatsApp */}
          <div className="rounded-2xl border-2 border-[#10563E]/25 bg-white p-4 shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-slate-500">
                  Pedido óptimo para cubrir 7 días
                </p>
                <p className="text-xl font-black text-[#10563E]">
                  Bs {totalPedidoHoyBs.toFixed(2)}
                </p>
              </div>
              <ShoppingBag className="h-8 w-8 text-[#10563E]/80" />
            </div>

            <button
              type="button"
              disabled={listaReposicion.length === 0}
              onClick={() => void copiarPedidoWhatsapp()}
              className="w-full min-h-12 flex items-center justify-center gap-2 rounded-xl bg-[#10563E] px-4 py-3 text-sm font-extrabold text-white shadow-xs transition active:scale-[0.99] hover:bg-brand-primary-light disabled:opacity-50 cursor-pointer"
            >
              {copiadoWhatsapp ? (
                <>
                  <Check className="h-4 w-4 text-amber-300" />
                  ¡Pedido copiado listo para pegar en WhatsApp!
                </>
              ) : (
                <>
                  <Copy className="h-4 w-4" />
                  Copiar pedido para WhatsApp
                </>
              )}
            </button>
          </div>

          {listaReposicion.length === 0 ? (
            <div className="rounded-2xl bg-white border border-border-subtle p-6 text-center space-y-2">
              <PackageCheck className="mx-auto h-8 w-8 text-[#10563E]" />
              <p className="text-sm font-bold text-slate-900">
                Tu stock cubre más de 3 días de demanda
              </p>
              <p className="text-xs text-slate-500">
                No necesitas hacer compras de emergencia hoy.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {listaReposicion.map((item) => {
                const esCritico = item.nivelSemaforo === "ROJO_CRITICO";
                return (
                  <article
                    key={item.productoId}
                    className={`rounded-2xl border-l-4 bg-white p-4 shadow-2xs space-y-2.5 ${
                      esCritico
                        ? "border-l-[#DC2626] ring-1 ring-[#DC2626]/20"
                        : "border-l-[#D97706] ring-1 ring-[#D97706]/25"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold text-white ${
                            esCritico ? "bg-[#DC2626]" : "bg-[#D97706]"
                          }`}
                        >
                          <Flame className="h-3 w-3" />
                          {item.etiquetaUrgencia} · {item.diasCobertura}d cobertura
                        </span>
                        <h3 className="mt-1 text-sm font-extrabold text-slate-900">
                          {item.nombreProducto}
                        </h3>
                        <p className="text-[11px] text-slate-500">
                          Quedan <strong>{item.stockTotal} u.</strong> · Rotación VRD:{" "}
                          <strong>{item.vrd} u./día</strong>
                        </p>
                      </div>

                      <div className="text-right shrink-0 rounded-xl bg-emerald-50 px-3 py-2 ring-1 ring-[#10563E]/20">
                        <span className="block text-[10px] font-bold uppercase text-[#10563E]">
                          Pedir hoy
                        </span>
                        <span className="text-lg font-black text-[#10563E]">
                          +{item.cantidadSugerida} u.
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-100 text-xs text-slate-600">
                      <span>
                        Costo unitario: Bs {item.precioCompraUnitario.toFixed(2)}
                      </span>
                      <strong className="text-slate-900">
                        Inversión: Bs {item.costoEstimadoBs.toFixed(2)}
                      </strong>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ==================================================================== */}
      {/* PESTAÑA 2: POR VENCER - SEMÁFORO FEFO (ROJO / ÁMBAR / VERDE)         */}
      {/* ==================================================================== */}
      {pestana === "POR_VENCER" && (
        <section className="space-y-3">
          {/* Leyenda de Semáforo FEFO */}
          <div className="grid grid-cols-3 gap-2 text-center text-[11px] font-bold">
            <div className="rounded-xl bg-red-50 border border-[#DC2626]/30 py-2 px-1 text-[#DC2626]">
              Rojo (0-3d): {conteoSemaforo.rojoCritico}
            </div>
            <div className="rounded-xl bg-amber-50 border border-[#D97706]/30 py-2 px-1 text-[#B45309]">
              Ámbar (4-10d): {conteoSemaforo.ambarPreventivo}
            </div>
            <div className="rounded-xl bg-emerald-50 border border-[#10563E]/30 py-2 px-1 text-[#10563E]">
              Óptimo (&gt;10d): {conteoSemaforo.verdeOptimo}
            </div>
          </div>

          {alertasFefo.length === 0 ? (
            <div className="rounded-2xl bg-white border border-border-subtle p-6 text-center space-y-2">
              <PackageCheck className="mx-auto h-8 w-8 text-[#10563E]" />
              <p className="text-sm font-bold text-slate-900">
                Todos tus lotes están en Verde Óptimo (&gt; 10 días)
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {alertasFefo.map((lote) => {
                const esRojo = lote.semaforo === "ROJO_CRITICO";
                const etiquetaDias =
                  lote.diasRestantes < 0
                    ? `Vencido hace ${Math.abs(lote.diasRestantes)}d`
                    : lote.diasRestantes === 0
                      ? "Vence HOY"
                      : `Vence en ${lote.diasRestantes} día(s)`;

                return (
                  <article
                    key={lote.loteId}
                    className={`rounded-2xl border-l-4 bg-white p-4 shadow-2xs space-y-2.5 ${
                      esRojo
                        ? "border-l-[#DC2626] ring-1 ring-[#DC2626]/25"
                        : "border-l-[#D97706] ring-1 ring-[#D97706]/25"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[11px] font-semibold text-slate-500">
                          {lote.marca} · {lote.stockActual} unidades en lote
                        </span>
                        <h3 className="text-sm font-extrabold text-slate-900">
                          {lote.nombreProducto}
                        </h3>
                      </div>

                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-extrabold text-white ${
                          esRojo ? "bg-[#DC2626]" : "bg-[#D97706]"
                        }`}
                      >
                        <Clock className="h-3 w-3" />
                        {etiquetaDias}
                      </span>
                    </div>

                    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-700">
                      <span>
                        Fecha:{" "}
                        <strong>
                          {new Date(lote.fechaVencimiento).toLocaleDateString(
                            "es-BO"
                          )}
                        </strong>
                      </span>
                      <span>
                        Capital en juego:{" "}
                        <strong
                          className={
                            esRojo ? "text-[#DC2626]" : "text-[#B45309]"
                          }
                        >
                          Bs {lote.valorEnRiesgoBs.toFixed(2)}
                        </strong>
                      </span>
                    </div>

                    <div
                      className={`rounded-xl px-3 py-2 text-xs font-bold ${
                        esRojo
                          ? "bg-red-50 text-[#DC2626]"
                          : "bg-amber-50 text-[#B45309]"
                      }`}
                    >
                      💡 {lote.accionSugerida}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* ==================================================================== */}
      {/* PESTAÑA 3: DETECTOR DE CAPITAL DORMIDO (0 VENTAS EN 21 DÍAS)         */}
      {/* ==================================================================== */}
      {pestana === "CAPITAL_DORMIDO" && (
        <section className="space-y-3">
          <div className="rounded-2xl bg-[#D97706] p-4 text-white shadow-xs">
            <p className="text-xs font-bold uppercase tracking-wide text-amber-100">
              Dinero inmovilizado sin retorno (&gt; 21 días sin ventas)
            </p>
            <p className="mt-1 text-2xl font-black">
              Bs {capitalDormido.totalInmovilizadoBs.toFixed(2)}
            </p>
            <p className="mt-0.5 text-xs text-amber-50">
              Convierte estos productos lentos en efectivo antes de volver a comprarlos.
            </p>
          </div>

          {capitalDormido.items.length === 0 ? (
            <div className="rounded-2xl bg-white border border-border-subtle p-6 text-center space-y-2">
              <PackageCheck className="mx-auto h-8 w-8 text-[#10563E]" />
              <p className="text-sm font-bold text-slate-900">
                ¡Cero capital dormido!
              </p>
              <p className="text-xs text-slate-500">
                Todo tu inventario tuvo movimiento en las últimas 3 semanas.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {capitalDormido.items.map((item) => (
                <article
                  key={item.productoId}
                  className="rounded-2xl border border-[#D97706]/35 bg-white p-4 shadow-2xs space-y-2.5"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <span className="text-[11px] font-semibold text-slate-500">
                        {item.categoria} · Sin ventas hace {item.diasSinVenta}d
                      </span>
                      <h3 className="text-sm font-extrabold text-slate-900">
                        {item.nombreProducto}
                      </h3>
                      <p className="text-xs text-slate-600">
                        {item.stockTotal} u. estancadas × Bs{" "}
                        {item.precioCompraPromedio.toFixed(2)} costo
                      </p>
                    </div>

                    <div className="text-right shrink-0 rounded-xl bg-amber-50 px-3 py-1.5 ring-1 ring-[#D97706]/30">
                      <span className="block text-[10px] font-bold text-[#B45309]">
                        Estancado
                      </span>
                      <span className="text-base font-black text-[#B45309]">
                        Bs {item.montoInmovilizadoBs.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div className="rounded-xl bg-[#10563E]/8 px-3 py-2 text-xs font-semibold text-[#10563E]">
                    🤝 Estrategia sugerida: {item.sugerenciaLiquidez}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
