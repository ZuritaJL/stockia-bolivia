"use client";

import React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import {
  AlertTriangle,
  BarChart3,
  Crown,
  LogOut,
  MapPinned,
  Package,
  ScanBarcode,
  ShieldCheck,
  TrendingDown,
  Wifi,
} from "lucide-react";
import { NavbarBrand } from "@/components/NavbarBrand";
import { RoleSelector } from "@/components/RoleSelector";
import { WelcomeLoginScreen } from "@/components/auth/WelcomeLoginScreen";
import { VoiceAssistantButton } from "@/components/mostrador/VoiceAssistantButton";
import { VoiceQuotaPill } from "@/components/mostrador/VoiceQuotaPill";
import { useRole } from "@/context/RoleContext";
import { dbOffline, diasHastaVencimiento } from "@/lib/db-offline";

const NAV_COMERCIANTE_IZQ = [
  {
    href: "/mostrador",
    label: "Mostrador",
    icon: ScanBarcode,
  },
  {
    href: "/inventario",
    label: "Inventario",
    icon: Package,
  },
];

const NAV_B2B = [
  {
    href: "/dashboard#mapa-zonal",
    label: "Mapa Zonal",
    description: "Mapa de calor La Paz y El Alto",
    icon: MapPinned,
  },
  {
    href: "/dashboard#quiebres-stock",
    label: "Quiebres de Stock",
    description: "Campañas de reposición B2B",
    icon: TrendingDown,
  },
  {
    href: "/dashboard#rotacion-categoria",
    label: "Rotación por Categoría",
    description: "Demanda vs. stock disponible",
    icon: BarChart3,
  },
];

export function AdaptiveAppShell({ children }: { children: React.ReactNode }) {
  const { sesion, hidratado, rol, cerrarSesion } = useRole();
  const pathname = usePathname();
  const router = useRouter();

  const alertasFefoCount =
    useLiveQuery(async () => {
      const lotes = await dbOffline.lotes.toArray();
      return lotes.filter((l) => {
        if (l.stockActual <= 0 || !l.fechaVencimiento) return false;
        const dias = diasHastaVencimiento(l.fechaVencimiento);
        return dias !== null && dias <= 10;
      }).length;
    }, []) ?? 2;

  const manejarCerrarSesion = () => {
    cerrarSesion();
    router.push("/");
  };

  // Estado inicial de hidratación sin parpadeo
  if (!hidratado) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F8FAFC] text-[#064e3b] font-bold text-sm">
        Cargando StockIA Bolivia...
      </div>
    );
  }

  // Mientras no exista una sesión iniciada, mostrar únicamente la pantalla de bienvenida y login
  if (!sesion) {
    return <WelcomeLoginScreen />;
  }

  const esRutaB2B =
    pathname === "/dashboard" || pathname.startsWith("/b2b");
  const rolEfectivo = esRutaB2B ? "DISTRIBUIDORA_B2B" : rol;

  const navComercianteDer = [
    {
      href: "/alertas",
      label: "Alertas FEFO",
      icon: AlertTriangle,
      badge: alertasFefoCount,
    },
    {
      href: "/plan",
      label: "Mi Perfil",
      icon: Crown,
      badge: 0,
    },
  ];

  // ============================================================================
  // LAYOUT ESCRITORIO: ROL DISTRIBUIDORA_B2B
  // ============================================================================
  if (rolEfectivo === "DISTRIBUIDORA_B2B") {
    return (
      <div className="min-h-screen flex flex-col lg:flex-row bg-background text-foreground">
        <aside className="w-full lg:w-76 lg:min-h-screen shrink-0 bg-brand-primary text-white flex flex-col justify-between border-b lg:border-b-0 lg:border-r border-brand-primary-dark shadow-md">
          <div className="p-5 space-y-6">
            <NavbarBrand variant="dark" />

            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-200/80">
                Cambio Rápido de Vista
              </span>
              <RoleSelector variant="sidebar" />
            </div>

            <div className="rounded-xl bg-brand-primary-dark/75 p-3.5 ring-1 ring-white/10">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-amber-300">
                  PORTAL B2B MAYORISTA
                </span>
                <ShieldCheck className="h-4 w-4 text-emerald-300" />
              </div>
              <p className="mt-1 text-sm font-bold text-white truncate">
                {sesion.nombreEntidad}
              </p>
              <p className="text-xs text-emerald-100/75 truncate">
                {sesion.ubicacion}
              </p>
            </div>

            <nav
              aria-label="Navegación Inteligencia Comercial B2B"
              className="space-y-1.5"
            >
              <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-emerald-200/75">
                Inteligencia Comercial
              </p>
              {NAV_B2B.map((item, index) => {
                const Icon = item.icon;
                const activo = pathname === "/dashboard" && index === 0;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`group flex items-start gap-3 rounded-xl px-3.5 py-3 transition-all ${
                      activo
                        ? "bg-white text-brand-primary shadow-sm font-semibold"
                        : "text-emerald-50/90 hover:bg-brand-primary-light/60 hover:text-white"
                    }`}
                  >
                    <Icon
                      className={`mt-0.5 h-5 w-5 shrink-0 ${
                        activo
                          ? "text-brand-amber"
                          : "text-emerald-200 group-hover:text-white"
                      }`}
                    />
                    <div className="min-w-0">
                      <div className="text-sm leading-tight">{item.label}</div>
                      <div
                        className={`text-xs mt-0.5 truncate ${
                          activo ? "text-slate-600" : "text-emerald-100/70"
                        }`}
                      >
                        {item.description}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="p-5 border-t border-white/10 space-y-3">
            <button
              type="button"
              onClick={manejarCerrarSesion}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-white/10 px-3.5 py-2 text-xs font-bold text-white hover:bg-white/20 transition cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5 text-amber-300" />
              Cerrar Sesión
            </button>

            <p className="hidden lg:block text-[11px] text-emerald-100/80 leading-relaxed">
              Cumplimiento de Privacidad StockIA: Datos 100% agregados y
              anonimizados por macrodistrito conforme a la política de
              protección al comerciante minorista.
            </p>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
          <header className="sticky top-0 z-20 bg-white/90 backdrop-blur-md border-b border-border-subtle px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-base font-bold text-slate-900">
                Inteligencia Comercial Zonal · La Paz &amp; El Alto
              </h1>
              <p className="text-xs text-slate-500">
                Sesión activa: <strong>{sesion.nombreUsuario}</strong> ({sesion.email})
              </p>
            </div>
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-primary-tint px-3 py-1 text-xs font-semibold text-brand-primary">
                <span className="h-2 w-2 rounded-full bg-emerald-600" />
                Sincronización Cloud Activa
              </span>
              <button
                type="button"
                onClick={manejarCerrarSesion}
                title="Cerrar sesión"
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-100 hover:text-red-600 cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" />
                Salir
              </button>
            </div>
          </header>

          <main className="flex-1 p-6 lg:p-8 max-w-7xl w-full mx-auto">
            {children}
          </main>
        </div>
      </div>
    );
  }

  // ============================================================================
  // LAYOUT MÓVIL (MOBILE-FIRST): ROL COMERCIANTE
  // ============================================================================
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-border-subtle shadow-2xs">
        <div className="max-w-xl mx-auto px-4 py-2.5 flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-2">
            <NavbarBrand compact />
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-brand-primary-tint px-2.5 py-1 text-[11px] font-semibold text-brand-primary">
                <Wifi className="h-3 w-3" />
                Offline-First
              </span>
              <button
                type="button"
                onClick={manejarCerrarSesion}
                title="Cerrar sesión y volver al inicio"
                className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] font-bold text-slate-700 hover:bg-red-50 hover:border-red-200 hover:text-red-600 transition cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>Salir</span>
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-slate-100">
            <div className="text-xs text-slate-600 truncate max-w-[58%]">
              <span className="font-bold text-slate-800">
                {sesion.nombreEntidad}
              </span>{" "}
              · {sesion.ubicacion}
            </div>
            <RoleSelector variant="header" />
          </div>
        </div>
      </header>

      <main className="flex-1 w-full max-w-xl mx-auto px-4 pt-4 pb-28">
        {children}
      </main>

      <nav
        aria-label="Navegación rápida de comerciante"
        className="fixed bottom-0 inset-x-0 z-40 bg-white border-t border-slate-200 shadow-[0_-4px_20px_rgba(15,23,42,0.06)]"
      >
        <div className="pointer-events-none absolute -top-9 inset-x-0 flex justify-center">
          <div className="pointer-events-auto">
            <VoiceQuotaPill compact />
          </div>
        </div>

        <div className="max-w-xl mx-auto grid grid-cols-5 items-center px-2 h-18">
          {NAV_COMERCIANTE_IZQ.map((item) => {
            const Icon = item.icon;
            const activo =
              pathname === item.href ||
              (item.href === "/mostrador" && pathname === "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center gap-1 py-2 rounded-xl transition-colors ${
                  activo
                    ? "text-brand-primary font-bold"
                    : "text-slate-500 hover:text-slate-800 font-medium"
                }`}
              >
                <Icon
                  className={`h-6 w-6 ${
                    activo ? "stroke-[2.4]" : "stroke-[1.9]"
                  }`}
                />
                <span className="text-[11px] leading-none">{item.label}</span>
              </Link>
            );
          })}

          <VoiceAssistantButton />

          {navComercianteDer.map((item) => {
            const Icon = item.icon;
            const activo =
              pathname === item.href ||
              (item.href === "/alertas" && pathname === "/alertas-fefo") ||
              (item.href === "/plan" && pathname === "/mi-plan");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`relative flex flex-col items-center justify-center gap-1 py-2 rounded-xl transition-colors ${
                  activo
                    ? "text-brand-primary font-bold"
                    : "text-slate-500 hover:text-slate-800 font-medium"
                }`}
              >
                <div className="relative">
                  <Icon
                    className={`h-6 w-6 ${
                      item.badge > 0 && !activo
                        ? "text-brand-amber stroke-[2.2]"
                        : activo
                          ? "stroke-[2.4]"
                          : "stroke-[1.9]"
                    }`}
                  />
                  {item.badge > 0 ? (
                    <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-amber px-1 text-[10px] font-extrabold text-white">
                      {item.badge}
                    </span>
                  ) : null}
                </div>
                <span className="text-[11px] leading-none">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
