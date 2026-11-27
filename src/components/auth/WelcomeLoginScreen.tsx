"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  Clock,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  Mic,
  ShieldCheck,
  Sparkles,
  Store,
  WifiOff,
} from "lucide-react";
import {
  useRole,
  type RolDemo,
  type SesionUsuarioStockia,
} from "@/context/RoleContext";

const PILARES_VALOR = [
  {
    titulo: "Control Operativo por Voz con IA",
    descripcion:
      "Registra ventas, nuevos lotes y consultas manos libres en español boliviano en menos de 5 segundos.",
    icono: Mic,
    colorIcono: "bg-amber-400/20 text-amber-300 ring-1 ring-amber-300/35",
  },
  {
    titulo: "Alertas de Vencimiento FEFO",
    descripcion:
      "Semáforo inteligente (Primero en Expirar, Primero en Salir) que evita pérdidas y protege tu capital.",
    icono: Clock,
    colorIcono: "bg-emerald-400/20 text-emerald-300 ring-1 ring-emerald-300/35",
  },
  {
    titulo: "Modo Offline-First Real",
    descripcion:
      "Sigue vendiendo y escaneando códigos 777 sin internet; tus datos se sincronizan solos al volver la señal.",
    icono: WifiOff,
    colorIcono: "bg-teal-400/20 text-teal-200 ring-1 ring-teal-300/35",
  },
];

const BARRAS_EAN_DEMO = [
  3, 1, 2, 4, 1, 2, 3, 1, 4, 2, 1, 3, 2, 1, 3, 2, 4, 1, 2, 1, 3,
];

function construirSesionOfflineFallback(
  rol: RolDemo,
  identificador?: string
): SesionUsuarioStockia {
  if (rol === "DISTRIBUIDORA_B2B") {
    return {
      usuarioId: "demo-b2b-andina",
      nombreUsuario: identificador?.trim() || "Distribuidora Andina S.R.L.",
      email: "inteligencia@andina-b2b.bo",
      rol: "DISTRIBUIDORA_B2B",
      nombreEntidad: "Distribuidora Andina S.R.L.",
      ubicacion: "Cobertura: La Paz y El Alto",
      comercioId: null,
      modoDemo: true,
    };
  }
  return {
    usuarioId: "demo-comerciante-martha",
    nombreUsuario: identificador?.trim() || "Martha Quispe Mamani",
    email: "martha@stockia.bo",
    rol: "COMERCIANTE",
    nombreEntidad: "Tienda Doña Martha",
    ubicacion: "Miraflores, La Paz",
    comercioId: null,
    modoDemo: true,
  };
}

export function WelcomeLoginScreen() {
  const { iniciarSesion } = useRole();
  const router = useRouter();

  const [rolSeleccionado, setRolSeleccionado] =
    useState<RolDemo>("COMERCIANTE");
  const [identificador, setIdentificador] = useState("");
  const [password, setPassword] = useState("");
  const [mostrarPassword, setMostrarPassword] = useState(false);

  const [cargandoLogin, setCargandoLogin] = useState(false);
  const [cargandoDemo, setCargandoDemo] = useState(false);
  const [mensajeError, setMensajeError] = useState<string | null>(null);

  const redirigirSegunRol = (rolDestino: RolDemo) => {
    if (rolDestino === "DISTRIBUIDORA_B2B") {
      router.push("/dashboard");
    } else {
      router.push("/mostrador");
    }
  };

  const manejarSubmitFormulario = async (e: React.FormEvent) => {
    e.preventDefault();
    if (cargandoLogin || cargandoDemo) return;

    const idLimpio = identificador.trim();
    const passLimpia = password.trim();

    if (!idLimpio || !passLimpia) {
      setMensajeError(
        "Por favor ingresa tu correo o usuario y tu contraseña."
      );
      return;
    }

    setMensajeError(null);
    setCargandoLogin(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identificador: idLimpio,
          password: passLimpia,
          rolPreferido: rolSeleccionado,
          modoDemo: false,
        }),
      });

      const data = (await res.json()) as {
        ok: boolean;
        error?: string;
        sesion?: SesionUsuarioStockia;
      };

      if (!res.ok || !data.ok || !data.sesion) {
        setMensajeError(
          data.error ?? "No se pudo iniciar sesión. Verifica tus credenciales."
        );
        return;
      }

      iniciarSesion(data.sesion);
      redirigirSegunRol(data.sesion.rol);
    } catch {
      const sesionLocal = construirSesionOfflineFallback(
        rolSeleccionado,
        idLimpio
      );
      iniciarSesion(sesionLocal);
      redirigirSegunRol(sesionLocal.rol);
    } finally {
      setCargandoLogin(false);
    }
  };

  const entrarEnModoDemoUnClic = async () => {
    if (cargandoLogin || cargandoDemo) return;
    setMensajeError(null);
    setCargandoDemo(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rolPreferido: rolSeleccionado,
          modoDemo: true,
        }),
      });

      const data = (await res.json()) as {
        ok: boolean;
        sesion?: SesionUsuarioStockia;
      };

      const sesionFinal =
        res.ok && data.ok && data.sesion
          ? data.sesion
          : construirSesionOfflineFallback(rolSeleccionado);

      iniciarSesion(sesionFinal);
      redirigirSegunRol(sesionFinal.rol);
    } catch {
      const sesionOffline = construirSesionOfflineFallback(rolSeleccionado);
      iniciarSesion(sesionOffline);
      redirigirSegunRol(sesionOffline.rol);
    } finally {
      setCargandoDemo(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-[#022c22] via-[#064e3b] to-[#0f172a] text-white flex flex-col justify-between">
      {/* ==================================================================== */}
      {/* ILUMINACIÓN AMBIENTAL RADIAL DE ALTO IMPACTO                         */}
      {/* ==================================================================== */}
      <div
        aria-hidden="true"
        className="pointer-events-none select-none absolute -top-28 -left-24 h-128 w-128 rounded-full bg-emerald-400/25 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none select-none absolute top-1/4 -right-24 h-136 w-136 rounded-full bg-amber-400/20 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none select-none absolute -bottom-28 left-1/4 h-112 w-112 rounded-full bg-emerald-500/20 blur-3xl"
      />

      {/* ==================================================================== */}
      {/* ESCENA ILUSTRADA DE ESTANTERÍAS Y PRODUCTOS DE TIENDA BOLIVIANA      */}
      {/* ==================================================================== */}
      <div
        aria-hidden="true"
        className="pointer-events-none select-none absolute inset-0 overflow-hidden"
      >
        {/* Retícula luminosa y líneas sutiles de estantería de tienda */}
        <svg
          className="absolute inset-0 h-full w-full opacity-18"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern
              id="shelf-dots"
              width="36"
              height="36"
              patternUnits="userSpaceOnUse"
            >
              <circle cx="2" cy="2" r="1.1" fill="#6EE7B7" fillOpacity="0.45" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#shelf-dots)" />
          {/* Líneas horizontales de repisas de mostrador */}
          <line
            x1="0"
            y1="22%"
            x2="100%"
            y2="22%"
            stroke="#34D399"
            strokeOpacity="0.22"
            strokeWidth="1.5"
          />
          <line
            x1="0"
            y1="82%"
            x2="100%"
            y2="82%"
            stroke="#FBBF24"
            strokeOpacity="0.18"
            strokeWidth="1.5"
          />
        </svg>

        {/* PRODUCTO ILUSTRADO 1: Botella de Gaseosa 2L + Caja de Leche 1L (Superior Izquierda) */}
        <div className="hidden md:block absolute top-8 left-6 xl:left-12 opacity-80 animate-stockia-float">
          <svg width="150" height="145" viewBox="0 0 150 145" fill="none">
            {/* Repisa flotante cristal */}
            <rect
              x="6"
              y="122"
              width="138"
              height="8"
              rx="4"
              fill="#34D399"
              fillOpacity="0.28"
            />
            {/* Botella Gaseosa 2L */}
            <g transform="translate(18, 12)">
              <rect x="15" y="2" width="14" height="8" rx="2" fill="#EF4444" />
              <path
                d="M16 10 H28 L34 28 C38 38 38 48 35 60 L37 98 C37 105 32 109 25 109 H19 C12 109 7 105 7 98 L9 60 C6 48 6 38 10 28 Z"
                fill="#1E1B18"
                stroke="#F8FAFC"
                strokeOpacity="0.35"
                strokeWidth="1.5"
              />
              {/* Etiqueta roja característica */}
              <rect
                x="8"
                y="45"
                width="28"
                height="22"
                rx="3"
                fill="#DC2626"
              />
              <path
                d="M10 57 Q22 49 34 57"
                stroke="#FFFFFF"
                strokeWidth="2.2"
                strokeLinecap="round"
              />
              {/* Brillo cristal */}
              <path
                d="M14 26 V96"
                stroke="#FFFFFF"
                strokeOpacity="0.28"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </g>

            {/* Caja Tetra Pak Leche 1L */}
            <g transform="translate(74, 34)">
              <path
                d="M6 18 L24 4 L46 18 Z"
                fill="#E0F2FE"
                stroke="#38BDF8"
                strokeWidth="1.2"
              />
              <rect
                x="6"
                y="18"
                width="40"
                height="70"
                rx="4"
                fill="#F8FAFC"
                stroke="#38BDF8"
                strokeWidth="1.5"
              />
              <rect x="6" y="42" width="40" height="24" fill="#0284C7" />
              <text
                x="26"
                y="57"
                textAnchor="middle"
                fill="#FFFFFF"
                fontSize="9.5"
                fontWeight="900"
              >
                1L PIL
              </text>
              <circle cx="26" cy="30" r="5" fill="#38BDF8" fillOpacity="0.55" />
            </g>
          </svg>
        </div>

        {/* PRODUCTO ILUSTRADO 2: Botella de Aceite Vegetal + Paquete de Fideo (Inferior Izquierda) */}
        <div className="hidden md:block absolute bottom-12 left-8 xl:left-14 opacity-80 animate-stockia-float-delayed">
          <svg width="165" height="140" viewBox="0 0 165 140" fill="none">
            <rect
              x="8"
              y="118"
              width="148"
              height="8"
              rx="4"
              fill="#FBBF24"
              fillOpacity="0.26"
            />
            {/* Botella de Aceite Dorado 900ml */}
            <g transform="translate(18, 12)">
              <rect x="14" y="2" width="14" height="8" rx="2" fill="#10B981" />
              <path
                d="M15 10 H27 L35 30 V98 C35 103 31 106 26 106 H16 C11 106 7 103 7 98 V30 Z"
                fill="#F59E0B"
                fillOpacity="0.88"
                stroke="#FDE68A"
                strokeWidth="1.5"
              />
              <rect
                x="10"
                y="46"
                width="22"
                height="26"
                rx="4"
                fill="#065F46"
              />
              <circle cx="21" cy="59" r="6" fill="#FBBF24" />
              <path
                d="M13 28 V94"
                stroke="#FEF3C7"
                strokeOpacity="0.55"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </g>

            {/* Paquete de Fideo / Abarrotes + Fruta */}
            <g transform="translate(68, 46)">
              <rect
                x="0"
                y="8"
                width="56"
                height="64"
                rx="6"
                fill="#EA580C"
                stroke="#FDBA74"
                strokeWidth="1.5"
              />
              <rect
                x="8"
                y="22"
                width="40"
                height="24"
                rx="4"
                fill="#FDE047"
                fillOpacity="0.9"
              />
              <line
                x1="12"
                y1="29"
                x2="44"
                y2="29"
                stroke="#CA8A04"
                strokeWidth="2"
              />
              <line
                x1="12"
                y1="35"
                x2="44"
                y2="35"
                stroke="#CA8A04"
                strokeWidth="2"
              />
              <line
                x1="12"
                y1="41"
                x2="44"
                y2="41"
                stroke="#CA8A04"
                strokeWidth="2"
              />
              <text
                x="28"
                y="62"
                textAnchor="middle"
                fill="#FFFFFF"
                fontSize="8.5"
                fontWeight="800"
              >
                FIDEO 400g
              </text>
            </g>

            {/* Manzana / Fruta fresca de tienda de barrio */}
            <g transform="translate(130, 82)">
              <circle cx="13" cy="18" r="13" fill="#EF4444" />
              <path
                d="M13 5 Q18 -2 23 3 Q18 9 13 5 Z"
                fill="#34D399"
              />
            </g>
          </svg>
        </div>

        {/* PRODUCTO ILUSTRADO 3: Galletas, Yogurt Lácteo y Canasta (Inferior Derecha) */}
        <div className="hidden lg:block absolute bottom-12 right-7 xl:right-12 opacity-80 animate-stockia-float-slow">
          <svg width="155" height="130" viewBox="0 0 155 130" fill="none">
            <rect
              x="6"
              y="110"
              width="142"
              height="8"
              rx="4"
              fill="#34D399"
              fillOpacity="0.28"
            />
            {/* Vaso / Botella Yogurt Frutilla */}
            <g transform="translate(18, 28)">
              <path
                d="M4 12 H40 L35 80 C35 82 33 83 30 83 H14 C11 83 9 82 9 80 Z"
                fill="#FB7185"
                stroke="#FFE4E6"
                strokeWidth="1.5"
              />
              <rect x="1" y="6" width="42" height="7" rx="3" fill="#F43F5E" />
              <circle cx="22" cy="45" r="8" fill="#FFF1F2" />
              <circle cx="22" cy="45" r="4.5" fill="#E11D48" />
            </g>

            {/* Paquete de Galletas Bolivianas */}
            <g transform="translate(70, 44)">
              <rect
                x="0"
                y="10"
                width="66"
                height="56"
                rx="8"
                fill="#D97706"
                stroke="#FDE68A"
                strokeWidth="1.5"
              />
              <circle cx="24" cy="38" r="11" fill="#FDE68A" />
              <circle cx="21" cy="35" r="1.5" fill="#92400E" />
              <circle cx="27" cy="36" r="1.5" fill="#92400E" />
              <circle cx="24" cy="41" r="1.5" fill="#92400E" />
              <text
                x="49"
                y="41"
                textAnchor="middle"
                fill="#FFFFFF"
                fontSize="8"
                fontWeight="900"
              >
                GALLETAS
              </text>
            </g>
          </svg>
        </div>

        {/* ================================================================ */}
        {/* TARJETA FLOTANTE IA #1: ESCÁNER LÁSER ANIMADO EAN-13 777         */}
        {/* ================================================================ */}
        <div className="hidden md:flex absolute top-7 left-1/2 -translate-x-1/2 lg:left-[38%] -rotate-3 animate-stockia-float items-center gap-3 rounded-2xl bg-white/12 backdrop-blur-md border border-white/20 px-4 py-2.5 shadow-2xl">
          <div className="relative overflow-hidden rounded-lg bg-white px-2.5 py-1.5">
            <div className="flex items-end gap-[1.5px] h-7">
              {BARRAS_EAN_DEMO.map((ancho, idx) => (
                <span
                  key={idx}
                  style={{ width: `${ancho}px` }}
                  className="h-full bg-slate-900 inline-block"
                />
              ))}
            </div>
            <p className="mt-0.5 text-[8px] font-mono font-bold tracking-widest text-slate-700 text-center">
              7770000000014
            </p>
            {/* Línea láser verde animada */}
            <span className="animate-stockia-laser absolute inset-x-0 h-0.5 bg-emerald-400 shadow-[0_0_10px_#34D399,0_0_4px_#10B981]" />
          </div>

          <div>
            <span className="block text-[10px] font-extrabold uppercase tracking-wider text-emerald-300">
              Escáner IA Activo
            </span>
            <span className="text-xs font-black text-white">
              Leche 1L · Bs 7.50
            </span>
          </div>
        </div>

        {/* ================================================================ */}
        {/* TARJETA FLOTANTE IA #2: SEMÁFORO INTELIGENTE FEFO (DERECHA SUP.) */}
        {/* ================================================================ */}
        <div className="hidden xl:flex absolute top-8 right-10 rotate-3 animate-stockia-float-delayed items-center gap-2.5 rounded-2xl bg-white/12 backdrop-blur-md border border-amber-300/30 px-4 py-2.5 shadow-2xl">
          <div className="flex flex-col gap-1 rounded-full bg-slate-950/75 p-1.5 border border-white/15">
            <span className="h-2 w-2 rounded-full bg-red-500/35" />
            <span className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px_#FBBF24] animate-pulse" />
            <span className="h-2 w-2 rounded-full bg-emerald-500/35" />
          </div>
          <div>
            <span className="block text-[10px] font-extrabold uppercase tracking-wider text-amber-300">
              Alerta FEFO Detectada
            </span>
            <span className="text-xs font-black text-white">
              Vence en 3 días · Prioridad Venta
            </span>
          </div>
        </div>

        {/* ================================================================ */}
        {/* TARJETA FLOTANTE IA #3: COMANDO DE VOZ CON ECUALIZADOR ANIMADO   */}
        {/* ================================================================ */}
        <div className="hidden lg:flex absolute bottom-14 left-[36%] -rotate-2 animate-stockia-float-slow items-center gap-3 rounded-2xl bg-white/12 backdrop-blur-md border border-emerald-300/25 px-4 py-2.5 shadow-2xl">
          <div className="flex items-end gap-1 h-6 px-1">
            {[10, 20, 14, 24, 16, 12].map((h, i) => (
              <span
                key={i}
                style={{
                  height: `${h}px`,
                  animationDelay: `${i * 140}ms`,
                }}
                className="w-1 rounded-full bg-amber-400 animate-stockia-eq"
              />
            ))}
          </div>
          <div>
            <span className="block text-[10px] font-extrabold uppercase tracking-wider text-emerald-300">
              Copiloto de Voz IA
            </span>
            <span className="text-xs font-black text-white">
              &ldquo;Vendido 2 aceites · Bs 28.00&rdquo;
            </span>
          </div>
        </div>
      </div>

      {/* Barra luminosa superior */}
      <div className="relative z-10 h-1.5 w-full bg-gradient-to-r from-emerald-400 via-amber-400 to-emerald-500" />

      {/* ==================================================================== */}
      {/* CONTENEDORES PRINCIPALES DE ALTO CONTRASTE                           */}
      {/* ==================================================================== */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-7 lg:gap-10 items-center">
          {/* COLUMNA IZQUIERDA: CRISTAL OSCURO ESMERALDA */}
          <section className="lg:col-span-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-3xl bg-emerald-950/75 backdrop-blur-xl shadow-2xl ring-2 ring-emerald-400/40">
                <svg
                  width="54"
                  height="54"
                  viewBox="0 0 48 48"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-label="Logo oficial StockIA Bolivia"
                  role="img"
                >
                  <path d="M21 7L35 15L21 23L7 15L21 7Z" fill="#34D399" />
                  <path d="M7 15L21 23V40L7 32V15Z" fill="#10B981" />
                  <path d="M35 15L21 23V40L35 32V15Z" fill="#047857" />
                  <path
                    d="M14 11L28 19V25L25 26.7V20.6L11 12.7L14 11Z"
                    fill="#F8FAFC"
                    fillOpacity="0.4"
                  />
                  <path
                    d="M14 29L20 23L24 26.5L32 17"
                    stroke="#FFFFFF"
                    strokeWidth="2.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M26.5 17H32V22.5"
                    stroke="#FFFFFF"
                    strokeWidth="2.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <path
                    d="M38 17.5C40.2 19.8 40.2 25.2 38 27.5"
                    stroke="#FBBF24"
                    strokeWidth="2.9"
                    strokeLinecap="round"
                  />
                  <path
                    d="M42 13.5C45.6 17.8 45.6 27.2 42 31.5"
                    stroke="#FBBF24"
                    strokeWidth="2.9"
                    strokeLinecap="round"
                  />
                  <circle cx="35.5" cy="22.5" r="2.2" fill="#FBBF24" />
                </svg>
              </div>

              <div>
                <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-950/70 ring-1 ring-emerald-400/35 px-3 py-0.5 text-[11px] font-extrabold uppercase tracking-wider text-emerald-200 mb-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-amber-300" />
                  Plataforma Inteligente · La Paz &amp; El Alto
                </div>
                <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white drop-shadow-sm">
                  StockIA <span className="text-amber-400">Bolivia</span>
                </h1>
                <p className="mt-1 text-sm sm:text-base font-semibold text-emerald-200">
                  &ldquo;Controla tus productos, protege tu ganancia&rdquo;
                </p>
              </div>
            </div>

            {/* Tarjeta Bienvenida en Cristal Oscuro Esmeralda */}
            <div className="rounded-3xl bg-emerald-950/60 backdrop-blur-xl border border-emerald-400/25 p-5 sm:p-6 shadow-2xl space-y-4 text-white">
              <div>
                <h2 className="text-xs sm:text-sm font-extrabold uppercase tracking-wider text-amber-300">
                  Bienvenido a tu copiloto comercial
                </h2>
                <p className="mt-1 text-xs sm:text-sm text-emerald-100/90 leading-relaxed">
                  Diseñado específicamente para tiendas de barrio, micromercados
                  y distribuidoras mayoristas en Bolivia:
                </p>
              </div>

              <div className="space-y-3">
                {PILARES_VALOR.map((pilar) => {
                  const Icon = pilar.icono;
                  return (
                    <div
                      key={pilar.titulo}
                      className="flex items-start gap-3.5 rounded-2xl bg-slate-950/35 p-3.5 border border-white/10 transition hover:bg-slate-950/50"
                    >
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${pilar.colorIcono}`}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <h3 className="text-sm font-extrabold text-white">
                          {pilar.titulo}
                        </h3>
                        <p className="mt-0.5 text-xs text-emerald-100/85 leading-relaxed">
                          {pilar.descripcion}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* COLUMNA DERECHA: TARJETA BLANCA LUMINOSA DE MÁXIMO CONTRASTE */}
          <section className="lg:col-span-6">
            <div className="rounded-3xl bg-white/95 backdrop-blur-xl border border-white/40 p-6 sm:p-8 shadow-[0_20px_60px_rgba(0,0,0,0.45)] space-y-5 text-slate-900">
              <div>
                <h2 className="text-xl font-black text-slate-900">
                  Iniciar Sesión
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  Selecciona tu perfil de acceso e ingresa tus credenciales
                </p>
              </div>

              {/* Selector de Perfil / Rol */}
              <div className="space-y-1.5">
                <span className="block text-xs font-bold text-slate-700">
                  Perfil de ingreso
                </span>
                <div
                  role="group"
                  aria-label="Seleccionar perfil de usuario"
                  className="grid grid-cols-1 sm:grid-cols-2 gap-2.5"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setRolSeleccionado("COMERCIANTE");
                      setMensajeError(null);
                    }}
                    className={`flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition-all cursor-pointer ${
                      rolSeleccionado === "COMERCIANTE"
                        ? "border-[#059669] bg-emerald-50/80 shadow-2xs"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                        rolSeleccionado === "COMERCIANTE"
                          ? "bg-[#064e3b] text-white"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      <Store className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold text-slate-900 leading-tight">
                        Comerciante
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        Tienda de Barrio (Móvil)
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setRolSeleccionado("DISTRIBUIDORA_B2B");
                      setMensajeError(null);
                    }}
                    className={`flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition-all cursor-pointer ${
                      rolSeleccionado === "DISTRIBUIDORA_B2B"
                        ? "border-[#D97706] bg-amber-50/80 shadow-2xs"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <div
                      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                        rolSeleccionado === "DISTRIBUIDORA_B2B"
                          ? "bg-[#D97706] text-white"
                          : "bg-slate-100 text-slate-600"
                      }`}
                    >
                      <Building2 className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-extrabold text-slate-900 leading-tight">
                        Distribuidora Mayorista
                      </p>
                      <p className="text-[11px] text-slate-500 truncate">
                        Portal B2B Zonal
                      </p>
                    </div>
                  </button>
                </div>
              </div>

              {mensajeError && (
                <div className="flex items-center gap-2 rounded-2xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-bold text-red-700">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>{mensajeError}</span>
                </div>
              )}

              {/* Formulario Principal */}
              <form onSubmit={manejarSubmitFormulario} className="space-y-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="login-identificador"
                    className="block text-xs font-bold text-slate-700"
                  >
                    Correo electrónico o Usuario
                  </label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <input
                      id="login-identificador"
                      type="text"
                      autoComplete="username"
                      value={identificador}
                      onChange={(e) => setIdentificador(e.target.value)}
                      placeholder={
                        rolSeleccionado === "COMERCIANTE"
                          ? "Ej. tienda@stockia.bo o martha@stockia.bo"
                          : "Ej. inteligencia@andina-b2b.bo"
                      }
                      className="w-full rounded-2xl border border-slate-300 bg-slate-50/70 pl-10 pr-4 py-3 text-sm font-medium text-slate-900 focus:border-[#059669] focus:bg-white focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="login-password"
                    className="block text-xs font-bold text-slate-700"
                  >
                    Contraseña
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <input
                      id="login-password"
                      type={mostrarPassword ? "text" : "password"}
                      autoComplete="current-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Ingresa tu contraseña"
                      className="w-full rounded-2xl border border-slate-300 bg-slate-50/70 pl-10 pr-11 py-3 text-sm font-medium text-slate-900 focus:border-[#059669] focus:bg-white focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setMostrarPassword((prev) => !prev)}
                      aria-label={
                        mostrarPassword
                          ? "Ocultar contraseña"
                          : "Mostrar contraseña"
                      }
                      className="absolute right-3 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-500 hover:bg-slate-200/70 hover:text-slate-800 cursor-pointer"
                    >
                      {mostrarPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={cargandoLogin || cargandoDemo}
                  className="w-full min-h-13 flex items-center justify-center gap-2 rounded-2xl bg-[#064e3b] px-5 py-3.5 text-sm font-extrabold text-white shadow-md transition active:scale-[0.99] hover:bg-[#059669] disabled:opacity-60 cursor-pointer"
                >
                  {cargandoLogin ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Verificando acceso...
                    </>
                  ) : (
                    <>
                      <span>
                        Ingresar como{" "}
                        {rolSeleccionado === "COMERCIANTE"
                          ? "Comerciante"
                          : "Distribuidora B2B"}
                      </span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              </form>

              {/* Separador */}
              <div className="relative py-1">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-white px-3 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                    Acceso rápido para presentaciones
                  </span>
                </div>
              </div>

              {/* Botón Entrar en Modo Demo (1 Clic) */}
              <button
                type="button"
                disabled={cargandoLogin || cargandoDemo}
                onClick={() => void entrarEnModoDemoUnClic()}
                className="w-full min-h-13 flex items-center justify-center gap-2 rounded-2xl border-2 border-[#059669] bg-emerald-50/90 px-5 py-3 text-sm font-extrabold text-[#064e3b] shadow-2xs transition active:scale-[0.99] hover:bg-[#059669] hover:text-white disabled:opacity-60 cursor-pointer"
              >
                {cargandoDemo ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Cargando perfil demostrativo...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4 text-[#D97706]" />
                    <span>
                      Entrar en Modo Demo (1 Clic) ·{" "}
                      {rolSeleccionado === "COMERCIANTE"
                        ? "Tienda Doña Martha"
                        : "Distribuidora Andina"}
                    </span>
                  </>
                )}
              </button>
            </div>
          </section>
        </div>
      </main>

      {/* Pie de página claro sobre fondo oscuro */}
      <footer className="relative z-10 py-4 px-4 text-center text-xs font-medium text-emerald-200/80 border-t border-white/10 bg-slate-950/35 backdrop-blur-xs">
        StockIA Bolivia · Tecnología Offline-First e Inteligencia Artificial para
        el comercio boliviano.
      </footer>
    </div>
  );
}

export default WelcomeLoginScreen;
