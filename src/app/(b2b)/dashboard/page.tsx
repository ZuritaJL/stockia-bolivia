"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  BellRing,
  Building2,
  CheckCircle2,
  Download,
  Filter,
  Loader2,
  MapPin,
  Navigation,
  ShieldCheck,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Truck,
} from "lucide-react";
import type { NivelUrgenciaZonal } from "@/app/api/b2b/analytics/route";

interface ProductoTopZona {
  nombreProducto: string;
  marca: string;
  categoria: string;
  unidadesDemandadas: number;
  comerciosBajoStock: number;
}

interface ZonaMapaCalor {
  ciudad: "LA_PAZ" | "EL_ALTO";
  macrodistrito: string;
  altitudMsnm: number;
  svgX: number;
  svgY: number;
  tiendasActivas: number;
  porcentajeCriticoAgotado: number;
  nivelUrgencia: NivelUrgenciaZonal;
  demandaProyectadaZona: number;
  topProductosDemandados: ProductoTopZona[];
  rutaPreventaSugerida: string;
}

interface ItemRotacionCategoria {
  categoria: string;
  volumenSemanalUnidades: number;
  volumenSemanaPrevia: number;
  tendenciaPct: number;
  demandaActualUnidades: number;
  stockDisponibleUnidades: number;
}

interface OportunidadReposicionB2B {
  id: string;
  ciudad: string;
  macrodistrito: string;
  marca: string;
  nombreProducto: string;
  categoria: string;
  comerciosBajoReorden: number;
  tiendasTotalesZona: number;
  porcentajeZonaAfectada: number;
  unidadesSugeridasCamion: number;
  nivelUrgencia: NivelUrgenciaZonal;
}

interface RespuestaAnalyticsB2B {
  ok: boolean;
  mensaje?: string;
  kpisGlobales: {
    totalComerciosMonitoreados: number;
    tasaQuiebreStockZonalPct: number;
    velocidadRotacionPromedioMarca: number;
    marcaLiderRotacion: string;
    demandaProyectada7DiasUnidades: number;
    alertasReposicionActivas: number;
  };
  mapaCalorZonal: ZonaMapaCalor[];
  rotacionPorCategoria: ItemRotacionCategoria[];
  oportunidadesReposicionB2B: OportunidadReposicionB2B[];
  generadoEn: string;
}

const MACRODISTRITOS_POR_CIUDAD: Record<string, string[]> = {
  TODAS: [
    "Ceja",
    "Ciudad Satélite",
    "Max Paredes",
    "Miraflores",
    "Sopocachi",
    "Villa Fátima",
    "Zona Sur",
  ],
  LA_PAZ: [
    "Miraflores",
    "Sopocachi",
    "Max Paredes",
    "Zona Sur",
    "Villa Fátima",
  ],
  EL_ALTO: ["Ceja", "Ciudad Satélite"],
};

const CATEGORIAS_FILTRO = [
  "TODAS",
  "Bebidas",
  "Lácteos",
  "Abarrotes",
  "Limpieza",
  "Snacks",
  "Panadería",
];

function colorHexPorUrgencia(urgencia: NivelUrgenciaZonal): string {
  if (urgencia === "ALTO") return "#DC2626";
  if (urgencia === "MEDIO") return "#D97706";
  return "#10563E";
}

function etiquetaCiudad(ciudad: string): string {
  return ciudad === "EL_ALTO" ? "El Alto" : "La Paz";
}

export default function DashboardEjecutivoB2BPage() {
  const [ciudad, setCiudad] = useState<string>("TODAS");
  const [macrodistrito, setMacrodistrito] = useState<string>("TODOS");
  const [categoria, setCategoria] = useState<string>("TODAS");

  const [datos, setDatos] = useState<RespuestaAnalyticsB2B | null>(null);
  const [cargando, setCargando] = useState<boolean>(true);
  const [simulandoRed, setSimulandoRed] = useState<boolean>(false);

  const [zonaSeleccionadaNombre, setZonaSeleccionadaNombre] =
    useState<string>("Ceja");
  const [campanasDespachadas, setCampanasDespachadas] = useState<Set<string>>(
    new Set()
  );
  const [avisoOperativo, setAvisoOperativo] = useState<string | null>(null);

  const cargarAnalitica = useCallback(
    async (fCiudad: string, fMacro: string, fCat: string) => {
      try {
        const params = new URLSearchParams({
          ciudad: fCiudad,
          macrodistrito: fMacro,
          categoria: fCat,
        });
        const res = await fetch(`/api/b2b/analytics?${params.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const json = (await res.json()) as RespuestaAnalyticsB2B;
        if (json.ok) {
          setDatos(json);
          if (json.mapaCalorZonal.length > 0) {
            const siguePresente = json.mapaCalorZonal.some(
              (z) => z.macrodistrito === zonaSeleccionadaNombre
            );
            if (!siguePresente) {
              setZonaSeleccionadaNombre(json.mapaCalorZonal[0].macrodistrito);
            }
          }
        }
      } finally {
        setCargando(false);
      }
    },
    [zonaSeleccionadaNombre]
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void cargarAnalitica(ciudad, macrodistrito, categoria);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [ciudad, macrodistrito, categoria, cargarAnalitica]);

  const simularRed80Comercios = async () => {
    if (simulandoRed) return;
    setSimulandoRed(true);
    setAvisoOperativo(null);

    try {
      const res = await fetch("/api/b2b/analytics", {
        method: "POST",
      });
      const json = (await res.json()) as RespuestaAnalyticsB2B;
      if (res.ok && json.ok) {
        setCiudad("TODAS");
        setMacrodistrito("TODOS");
        setCategoria("TODAS");
        setDatos(json);
        setZonaSeleccionadaNombre("Ceja");
        setAvisoOperativo(
          "Red zonal de 80 comercios en La Paz y El Alto simulada exitosamente (datos 100% agregados y anonimizados)."
        );
      }
    } finally {
      setSimulandoRed(false);
    }
  };

  const zonaActivaDetalle = useMemo(() => {
    if (!datos || datos.mapaCalorZonal.length === 0) return null;
    return (
      datos.mapaCalorZonal.find(
        (z) => z.macrodistrito === zonaSeleccionadaNombre
      ) ?? datos.mapaCalorZonal[0]
    );
  }, [datos, zonaSeleccionadaNombre]);

  const lanzarAlertaPreventistas = (idCampana?: string, etiqueta?: string) => {
    if (idCampana) {
      setCampanasDespachadas((prev) => {
        const nuevo = new Set(prev);
        nuevo.add(idCampana);
        return nuevo;
      });
      setAvisoOperativo(
        `Alerta enviada al equipo de preventa para ruta: ${etiqueta ?? idCampana}.`
      );
    } else if (datos) {
      const todosIds = new Set(
        datos.oportunidadesReposicionB2B.map((o) => o.id)
      );
      setCampanasDespachadas(todosIds);
      setAvisoOperativo(
        `Se despacharon ${todosIds.size} hojas de ruta priorizadas a la flota de preventistas de La Paz y El Alto.`
      );
    }
  };

  const exportarReporteZonalCSV = () => {
    if (!datos) return;

    const cabeceras = [
      "Ciudad",
      "Macrodistrito",
      "Comercios_Monitoreados_Zona",
      "Marca",
      "Producto",
      "Categoria",
      "Comercios_Bajo_Reorden",
      "Porcentaje_Quiebre_Zona",
      "Unidades_Sugeridas_Despacho",
      "Nivel_Urgencia",
    ];

    const filas =
      datos.oportunidadesReposicionB2B.length > 0
        ? datos.oportunidadesReposicionB2B.map((op) => [
            etiquetaCiudad(op.ciudad),
            op.macrodistrito,
            String(op.tiendasTotalesZona),
            `"${op.marca.replace(/"/g, '""')}"`,
            `"${op.nombreProducto.replace(/"/g, '""')}"`,
            op.categoria,
            String(op.comerciosBajoReorden),
            `${op.porcentajeZonaAfectada}%`,
            String(op.unidadesSugeridasCamion),
            op.nivelUrgencia,
          ])
        : datos.mapaCalorZonal.map((z) => [
            etiquetaCiudad(z.ciudad),
            z.macrodistrito,
            String(z.tiendasActivas),
            "Agregado Zonal",
            `"${z.topProductosDemandados[0]?.nombreProducto ?? "General"}"`,
            "Todas",
            "0",
            `${z.porcentajeCriticoAgotado}%`,
            String(z.demandaProyectadaZona),
            z.nivelUrgencia,
          ]);

    const contenidoCsv =
      "\uFEFF" +
      [cabeceras.join(","), ...filas.map((f) => f.join(","))].join("\r\n");

    const blob = new Blob([contenidoCsv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement("a");
    const fechaIso = new Date().toISOString().slice(0, 10);
    enlace.href = url;
    enlace.setAttribute(
      "download",
      `stockia-reporte-zonal-b2b-${fechaIso}.csv`
    );
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
    URL.revokeObjectURL(url);
  };

  const kpis = datos?.kpisGlobales ?? {
    totalComerciosMonitoreados: 0,
    tasaQuiebreStockZonalPct: 0,
    velocidadRotacionPromedioMarca: 0,
    marcaLiderRotacion: "---",
    demandaProyectada7DiasUnidades: 0,
    alertasReposicionActivas: 0,
  };

  const opcionesMacro = MACRODISTRITOS_POR_CIUDAD[ciudad] ?? MACRODISTRITOS_POR_CIUDAD.TODAS;

  return (
    <div className="space-y-6">
      {/* BARRA EJECUTIVA DE FILTROS + SIMULADOR DE 80 COMERCIOS */}
      <section className="rounded-2xl border border-border-subtle bg-white p-4 lg:p-5 shadow-2xs flex flex-col xl:flex-row xl:items-end justify-between gap-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
          {/* Filtro Ciudad */}
          <div className="space-y-1">
            <label className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
              <Filter className="h-3.5 w-3.5 text-[#10563E]" />
              Ciudad
            </label>
            <select
              value={ciudad}
              onChange={(e) => {
                setCiudad(e.target.value);
                setMacrodistrito("TODOS");
              }}
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 focus:border-[#10563E] focus:bg-white focus:outline-none"
            >
              <option value="TODAS">La Paz y El Alto (Todas)</option>
              <option value="LA_PAZ">La Paz (Hoyada)</option>
              <option value="EL_ALTO">El Alto (Altiplano)</option>
            </select>
          </div>

          {/* Filtro Macrodistrito */}
          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-600">
              Macrodistrito
            </label>
            <select
              value={macrodistrito}
              onChange={(e) => setMacrodistrito(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 focus:border-[#10563E] focus:bg-white focus:outline-none"
            >
              <option value="TODOS">Todos los macrodistritos</option>
              {opcionesMacro.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>

          {/* Filtro Categoría */}
          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-600">
              Categoría de Consumo
            </label>
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-900 focus:border-[#10563E] focus:bg-white focus:outline-none"
            >
              {CATEGORIAS_FILTRO.map((cat) => (
                <option key={cat} value={cat}>
                  {cat === "TODAS" ? "Todas las categorías" : cat}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Acciones Ejecutivas */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            disabled={simulandoRed}
            onClick={() => void simularRed80Comercios()}
            className="inline-flex items-center gap-2 rounded-xl bg-[#10563E] px-4 py-2.5 text-xs font-extrabold text-white shadow-xs hover:bg-brand-primary-light disabled:opacity-60 cursor-pointer"
          >
            {simulandoRed ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4 text-amber-300" />
            )}
            {simulandoRed
              ? "Generando 80 comercios..."
              : "Simular Red de 80 Comercios Zonal"}
          </button>

          <button
            type="button"
            onClick={exportarReporteZonalCSV}
            className="inline-flex items-center gap-2 rounded-xl border-2 border-[#10563E] bg-white px-4 py-2 text-xs font-extrabold text-[#10563E] hover:bg-brand-primary-tint cursor-pointer"
          >
            <Download className="h-4 w-4" />
            Exportar Reporte Zonal (CSV)
          </button>
        </div>
      </section>

      {avisoOperativo && (
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-[#10563E]/30 bg-brand-primary-tint px-4 py-3 text-xs font-bold text-[#10563E]">
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0" />
            {avisoOperativo}
          </span>
          <button
            type="button"
            onClick={() => setAvisoOperativo(null)}
            className="text-[#10563E]/70 hover:text-[#10563E] cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* SECCIÓN SUPERIOR: 4 TARJETAS KPI EJECUTIVAS */}
      <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="rounded-2xl border border-border-subtle bg-white p-5 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-500">
            <span>Comercios Conectados</span>
            <Building2 className="h-4 w-4 text-[#10563E]" />
          </div>
          <p className="mt-2 text-3xl font-black text-slate-900">
            {cargando ? "..." : kpis.totalComerciosMonitoreados}
          </p>
          <p className="mt-1 text-xs font-medium text-[#10563E]">
            Red minorista agregada (k-anonimizada)
          </p>
        </div>

        <div className="rounded-2xl border border-border-subtle bg-white p-5 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-500">
            <span>Índice Quiebre Zonal</span>
            <TrendingDown
              className="h-4 w-4"
              style={{
                color:
                  kpis.tasaQuiebreStockZonalPct >= 30
                    ? "#DC2626"
                    : kpis.tasaQuiebreStockZonalPct >= 18
                      ? "#D97706"
                      : "#10563E",
              }}
            />
          </div>
          <p
            className="mt-2 text-3xl font-black"
            style={{
              color:
                kpis.tasaQuiebreStockZonalPct >= 30
                  ? "#DC2626"
                  : kpis.tasaQuiebreStockZonalPct >= 18
                    ? "#D97706"
                    : "#10563E",
            }}
          >
            {cargando ? "..." : `${kpis.tasaQuiebreStockZonalPct}%`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            SKUs bajo punto de reorden en góndola
          </p>
        </div>

        <div className="rounded-2xl border border-border-subtle bg-white p-5 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-slate-500">
            <span>Demanda Proyectada 7 Días</span>
            <Activity className="h-4 w-4 text-[#10563E]" />
          </div>
          <p className="mt-2 text-3xl font-black text-slate-900">
            {cargando
              ? "..."
              : `${kpis.demandaProyectada7DiasUnidades.toLocaleString("es-BO")} u.`}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Rotación media: <strong>{kpis.velocidadRotacionPromedioMarca} u./día</strong> ({kpis.marcaLiderRotacion})
          </p>
        </div>

        <div className="rounded-2xl border border-[#D97706]/35 bg-brand-amber-tint/45 p-5 shadow-2xs">
          <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-[#B45309]">
            <span>Alertas de Reposición</span>
            <AlertTriangle className="h-4 w-4 text-[#D97706]" />
          </div>
          <p className="mt-2 text-3xl font-black text-slate-900">
            {cargando ? "..." : kpis.alertasReposicionActivas}
          </p>
          <p className="mt-1 text-xs font-semibold text-[#B45309]">
            Oportunidades activas de preventa zonal
          </p>
        </div>
      </section>

      {/* SECCIÓN CENTRAL: MAPA DE CALOR ZONAL INTERACTIVO (LA PAZ Y EL ALTO) + PANEL DE RUTA */}
      <section
        id="mapa-zonal"
        className="grid grid-cols-1 xl:grid-cols-12 gap-6 scroll-mt-20"
      >
        {/* Mapa Esquemático Georreferenciado + Cuadrícula de Macrodistritos */}
        <div className="xl:col-span-7 rounded-2xl border border-border-subtle bg-white p-5 lg:p-6 shadow-2xs space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-extrabold text-slate-900 flex items-center gap-2">
                <MapPin className="h-5 w-5 text-[#10563E]" />
                Mapa de Calor Zonal Interactivo · La Paz &amp; El Alto
              </h2>
              <p className="text-xs text-slate-500">
                Haz clic en cualquier macrodistrito para inspeccionar la ruta óptima de preventa
              </p>
            </div>

            <div className="flex items-center gap-3 text-[11px] font-bold">
              <span className="inline-flex items-center gap-1 text-[#DC2626]">
                <span className="h-2.5 w-2.5 rounded-full bg-[#DC2626]" />
                Urgencia Alta
              </span>
              <span className="inline-flex items-center gap-1 text-[#D97706]">
                <span className="h-2.5 w-2.5 rounded-full bg-[#D97706]" />
                Media
              </span>
              <span className="inline-flex items-center gap-1 text-[#10563E]">
                <span className="h-2.5 w-2.5 rounded-full bg-[#10563E]" />
                Estable
              </span>
            </div>
          </div>

          {/* Lienzo Cartográfico Esquemático Cuenca La Paz - Altiplano El Alto */}
          <div className="rounded-2xl bg-slate-900 p-3 ring-1 ring-slate-800 overflow-hidden">
            <svg
              viewBox="0 0 490 250"
              className="w-full h-56 sm:h-64 select-none"
              role="img"
              aria-label="Mapa esquemático interactivo de macrodistritos de La Paz y El Alto"
            >
              {/* Fondo Altiplano (El Alto) vs Hoyada (La Paz) */}
              <path
                d="M12 16 L185 16 L170 234 L12 234 Z"
                fill="#1E293B"
                stroke="#334155"
                strokeDasharray="4 4"
              />
              <path
                d="M190 16 L478 16 L478 234 L175 234 Z"
                fill="#0F172A"
                stroke="#334155"
              />

              {/* Etiquetas Geográficas */}
              <text
                x="24"
                y="36"
                fill="#94A3B8"
                fontSize="10"
                fontWeight="700"
              >
                EL ALTO (4,050 msnm)
              </text>
              <text
                x="204"
                y="36"
                fill="#94A3B8"
                fontSize="10"
                fontWeight="700"
              >
                HOYADA DE LA PAZ (3,600 - 3,280 msnm)
              </text>

              {/* Eje Vial: Autopista La Paz - El Alto y Corredor troncal */}
              <path
                d="M95 142 L115 62 L235 85 L335 138 L390 205"
                stroke="#475569"
                strokeWidth="2.5"
                strokeDasharray="5 4"
                fill="none"
              />
              <path
                d="M235 85 L250 175 L335 138 L365 65"
                stroke="#334155"
                strokeWidth="2"
                fill="none"
              />

              {/* Nodos interactivos por Macrodistrito */}
              {(datos?.mapaCalorZonal ?? []).map((zona) => {
                const seleccionado =
                  zonaActivaDetalle?.macrodistrito === zona.macrodistrito;
                const fill = colorHexPorUrgencia(zona.nivelUrgencia);

                return (
                  <g
                    key={`${zona.ciudad}-${zona.macrodistrito}`}
                    onClick={() => setZonaSeleccionadaNombre(zona.macrodistrito)}
                    className="cursor-pointer"
                  >
                    {seleccionado && (
                      <circle
                        cx={zona.svgX}
                        cy={zona.svgY}
                        r="28"
                        fill={fill}
                        fillOpacity="0.28"
                      />
                    )}
                    <circle
                      cx={zona.svgX}
                      cy={zona.svgY}
                      r={seleccionado ? "19" : "15"}
                      fill={fill}
                      stroke="#F8FAFC"
                      strokeWidth={seleccionado ? "3" : "1.8"}
                    />
                    <text
                      x={zona.svgX}
                      y={zona.svgY + 4}
                      textAnchor="middle"
                      fill="#FFFFFF"
                      fontSize="10"
                      fontWeight="800"
                    >
                      {Math.round(zona.porcentajeCriticoAgotado)}%
                    </text>
                    <text
                      x={zona.svgX}
                      y={zona.svgY + 31}
                      textAnchor="middle"
                      fill={seleccionado ? "#FBBF24" : "#E2E8F0"}
                      fontSize="10.5"
                      fontWeight="700"
                    >
                      {zona.macrodistrito}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Cuadrícula de Tarjetas Georreferenciadas */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {(datos?.mapaCalorZonal ?? []).map((zona) => {
              const activa =
                zonaActivaDetalle?.macrodistrito === zona.macrodistrito;
              const hex = colorHexPorUrgencia(zona.nivelUrgencia);

              return (
                <button
                  key={`${zona.ciudad}-${zona.macrodistrito}`}
                  type="button"
                  onClick={() => setZonaSeleccionadaNombre(zona.macrodistrito)}
                  className={`text-left rounded-2xl border p-3.5 transition-all cursor-pointer ${
                    activa
                      ? "border-2 border-slate-900 bg-slate-50 shadow-sm"
                      : "border-slate-200 bg-white hover:border-slate-400"
                  }`}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                      {etiquetaCiudad(zona.ciudad)}
                    </span>
                    <span
                      className="rounded-full px-2 py-0.5 text-[10px] font-extrabold text-white"
                      style={{ backgroundColor: hex }}
                    >
                      {zona.porcentajeCriticoAgotado}% crítico
                    </span>
                  </div>

                  <p className="mt-1 text-sm font-black text-slate-900">
                    {zona.macrodistrito}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    <strong>{zona.tiendasActivas}</strong> tiendas · Dem.{" "}
                    <strong>{zona.demandaProyectadaZona} u.</strong>
                  </p>
                </button>
              );
            })}
          </div>
        </div>

        {/* Panel Lateral de Despacho y Ruta de Preventa Recomendada */}
        <div className="xl:col-span-5 rounded-2xl border-2 border-[#10563E]/25 bg-white p-5 lg:p-6 shadow-2xs flex flex-col justify-between space-y-5">
          {zonaActivaDetalle ? (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-4">
                <div>
                  <span className="text-xs font-bold uppercase tracking-wider text-[#10563E]">
                    {etiquetaCiudad(zonaActivaDetalle.ciudad)} ·{" "}
                    {zonaActivaDetalle.altitudMsnm} msnm
                  </span>
                  <h3 className="text-xl font-black text-slate-900">
                    Zona {zonaActivaDetalle.macrodistrito}
                  </h3>
                </div>
                <span
                  className="rounded-xl px-3 py-1 text-xs font-extrabold text-white"
                  style={{
                    backgroundColor: colorHexPorUrgencia(
                      zonaActivaDetalle.nivelUrgencia
                    ),
                  }}
                >
                  Urgencia {zonaActivaDetalle.nivelUrgencia}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-50 p-3">
                  <span className="text-[11px] font-semibold text-slate-500">
                    Tiendas Monitoreadas
                  </span>
                  <p className="text-xl font-black text-slate-900">
                    {zonaActivaDetalle.tiendasActivas}
                  </p>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <span className="text-[11px] font-semibold text-slate-500">
                    Desabastecimiento
                  </span>
                  <p
                    className="text-xl font-black"
                    style={{
                      color: colorHexPorUrgencia(
                        zonaActivaDetalle.nivelUrgencia
                      ),
                    }}
                  >
                    {zonaActivaDetalle.porcentajeCriticoAgotado}%
                  </p>
                </div>
              </div>

              {/* Ruta de Preventa Sugerida */}
              <div className="rounded-2xl bg-[#10563E] p-4 text-white space-y-1.5">
                <div className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wide text-amber-300">
                  <Navigation className="h-4 w-4" />
                  Ruta de Preventa Recomendada
                </div>
                <p className="text-xs leading-relaxed text-emerald-50">
                  {zonaActivaDetalle.rutaPreventaSugerida}
                </p>
              </div>

              {/* Top 3 Productos que Urge Despachar en la Zona */}
              <div className="space-y-2.5">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                  <Truck className="h-4 w-4 text-[#D97706]" />
                  Top 3 Productos que Urge Despachar Aquí
                </h4>

                {zonaActivaDetalle.topProductosDemandados.length === 0 ? (
                  <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
                    Sin alertas activas en esta zona. Usa &ldquo;Simular Red de 80 Comercios Zonal&rdquo; para poblar todas las zonas.
                  </p>
                ) : (
                  zonaActivaDetalle.topProductosDemandados.map((prod, idx) => (
                    <div
                      key={prod.nombreProducto}
                      className="flex items-center justify-between rounded-xl border border-slate-200 px-3.5 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-extrabold text-slate-900 truncate">
                          {idx + 1}. {prod.nombreProducto}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          {prod.marca} · {prod.categoria}
                        </p>
                      </div>
                      <div className="text-right shrink-0 ml-2">
                        <span className="block text-xs font-black text-[#10563E]">
                          {prod.unidadesDemandadas} u. req.
                        </span>
                        <span className="text-[10px] font-bold text-[#DC2626]">
                          {prod.comerciosBajoStock} tiendas sin stock
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : null}

          <button
            type="button"
            onClick={() =>
              lanzarAlertaPreventistas(
                `zona-${zonaActivaDetalle?.macrodistrito ?? "general"}`,
                `${etiquetaCiudad(zonaActivaDetalle?.ciudad ?? "LA_PAZ")} - ${zonaActivaDetalle?.macrodistrito ?? ""}`
              )
            }
            className="w-full flex items-center justify-center gap-2 rounded-xl bg-[#D97706] px-4 py-3 text-xs font-extrabold text-white shadow-xs hover:bg-brand-amber-dark cursor-pointer"
          >
            <BellRing className="h-4 w-4" />
            Priorizar Preventistas en {zonaActivaDetalle?.macrodistrito ?? "Zona"}
          </button>
        </div>
      </section>

      {/* SECCIÓN INFERIOR 1: GRÁFICO DE BARRAS APILADAS (DEMANDA ACTUAL VS STOCK DISPONIBLE) */}
      <section
        id="rotacion-categoria"
        className="rounded-2xl border border-border-subtle bg-white p-5 lg:p-6 shadow-2xs space-y-4 scroll-mt-20"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold text-slate-900">
              Demanda Actual vs. Stock Disponible por Categoría
            </h2>
            <p className="text-xs text-slate-500">
              Comparativa agregada semanal en unidades para anticipar quiebres mayoristas
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {(datos?.rotacionPorCategoria ?? []).slice(0, 4).map((cat) => (
              <span
                key={cat.categoria}
                className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700"
              >
                <TrendingUp className="h-3 w-3 text-[#10563E]" />
                {cat.categoria}:{" "}
                <strong
                  className={
                    cat.tendenciaPct >= 0 ? "text-[#10563E]" : "text-[#DC2626]"
                  }
                >
                  {cat.tendenciaPct >= 0 ? `+${cat.tendenciaPct}%` : `${cat.tendenciaPct}%`}
                </strong>
              </span>
            ))}
          </div>
        </div>

        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={datos?.rotacionPorCategoria ?? []}
              margin={{ top: 10, right: 20, left: 0, bottom: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis
                dataKey="categoria"
                tick={{ fontSize: 12, fill: "#334155", fontWeight: 600 }}
              />
              <YAxis tick={{ fontSize: 11, fill: "#64748B" }} />
              <Tooltip
                contentStyle={{
                  borderRadius: "12px",
                  borderColor: "#CBD5E1",
                  fontSize: "12px",
                }}
              />
              <Legend wrapperStyle={{ fontSize: "12px", fontWeight: 700 }} />
              <Bar
                dataKey="demandaActualUnidades"
                name="Demanda Proyectada (Unidades)"
                stackId="a"
                fill="#D97706"
                radius={[0, 0, 0, 0]}
              />
              <Bar
                dataKey="stockDisponibleUnidades"
                name="Stock Disponible en Tiendas (Unidades)"
                stackId="a"
                fill="#10563E"
                radius={[6, 6, 0, 0]}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* SECCIÓN INFERIOR 2: TABLA DE CAMPAÑAS DE REPOSICIÓN SUGERIDA */}
      <section
        id="quiebres-stock"
        className="rounded-2xl border border-border-subtle bg-white p-5 lg:p-6 shadow-2xs space-y-4 scroll-mt-20"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-extrabold text-slate-900">
              Campañas de Reposición Sugerida por Macrodistrito
            </h2>
            <p className="text-xs text-slate-500">
              Marcas y productos con mayor concentración de comercios por debajo de su punto de reorden
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => lanzarAlertaPreventistas()}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#D97706] px-4 py-2 text-xs font-extrabold text-white shadow-xs hover:bg-brand-amber-dark cursor-pointer"
            >
              <BellRing className="h-3.5 w-3.5" />
              Lanzar Alerta a Preventistas
            </button>

            <button
              type="button"
              onClick={exportarReporteZonalCSV}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#10563E] px-4 py-2 text-xs font-extrabold text-white shadow-xs hover:bg-brand-primary-light cursor-pointer"
            >
              <Download className="h-3.5 w-3.5" />
              Exportar Reporte Zonal (CSV)
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold uppercase text-slate-500">
                <th className="py-3 pr-4">Zona / Macrodistrito</th>
                <th className="py-3 pr-4">Producto &amp; Marca</th>
                <th className="py-3 pr-4">Categoría</th>
                <th className="py-3 pr-4">Tiendas Bajo Reorden</th>
                <th className="py-3 pr-4">Carga Sugerida Camión</th>
                <th className="py-3 pr-4">Urgencia</th>
                <th className="py-3 text-right">Acción Preventa</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(datos?.oportunidadesReposicionB2B ?? []).length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="py-8 text-center text-xs text-slate-500"
                  >
                    No hay quiebres masivos para el filtro seleccionado. Pulsa{" "}
                    <strong>&ldquo;Simular Red de 80 Comercios Zonal&rdquo;</strong>{" "}
                    para visualizar campañas completas.
                  </td>
                </tr>
              ) : (
                (datos?.oportunidadesReposicionB2B ?? []).map((op) => {
                  const despachada = campanasDespachadas.has(op.id);
                  return (
                    <tr key={op.id} className="hover:bg-slate-50/80">
                      <td className="py-3 pr-4">
                        <span className="font-bold text-slate-900">
                          {op.macrodistrito}
                        </span>
                        <span className="block text-[11px] text-slate-500">
                          {etiquetaCiudad(op.ciudad)}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="font-bold text-slate-900">
                          {op.nombreProducto}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {op.marca}
                        </span>
                      </td>
                      <td className="py-3 pr-4 text-xs font-semibold text-slate-600">
                        {op.categoria}
                      </td>
                      <td className="py-3 pr-4">
                        <span className="font-extrabold text-slate-900">
                          {op.comerciosBajoReorden} / {op.tiendasTotalesZona}
                        </span>
                        <span className="ml-1.5 text-xs font-bold text-[#DC2626]">
                          ({op.porcentajeZonaAfectada}%)
                        </span>
                      </td>
                      <td className="py-3 pr-4 font-extrabold text-[#10563E]">
                        {op.unidadesSugeridasCamion} u.
                      </td>
                      <td className="py-3 pr-4">
                        <span
                          className="rounded-full px-2.5 py-0.5 text-[11px] font-extrabold text-white"
                          style={{
                            backgroundColor: colorHexPorUrgencia(
                              op.nivelUrgencia
                            ),
                          }}
                        >
                          {op.nivelUrgencia}
                        </span>
                      </td>
                      <td className="py-3 text-right">
                        <button
                          type="button"
                          onClick={() =>
                            lanzarAlertaPreventistas(
                              op.id,
                              `${op.macrodistrito} · ${op.nombreProducto}`
                            )
                          }
                          className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-bold cursor-pointer ${
                            despachada
                              ? "bg-brand-primary-tint text-[#10563E]"
                              : "bg-slate-900 text-white hover:bg-[#10563E]"
                          }`}
                        >
                          {despachada ? (
                            <>
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Ruta Enviada
                            </>
                          ) : (
                            <>
                              <BellRing className="h-3.5 w-3.5 text-amber-300" />
                              Alertar Ruta
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* PIE DE PÁGINA EJECUTIVO: DISTINTIVO DE CUMPLIMIENTO ÉTICO Y PRIVACIDAD */}
      <footer className="rounded-2xl border border-[#10563E]/25 bg-brand-primary-tint/60 px-5 py-4 flex items-center gap-3 text-xs font-semibold text-[#10563E]">
        <ShieldCheck className="h-5 w-5 shrink-0 text-[#10563E]" />
        <p>
          Cumplimiento de Privacidad StockIA: Datos 100% agregados y
          anonimizados por macrodistrito conforme a la política de protección al
          comerciante minorista.
        </p>
      </footer>
    </div>
  );
}
