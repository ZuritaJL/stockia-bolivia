"use client";

import React from "react";
import { useRouter, usePathname } from "next/navigation";
import { Building2, Store } from "lucide-react";
import { RolDemo, useRole } from "@/context/RoleContext";

interface RoleSelectorProps {
  variant?: "header" | "sidebar";
}

export function RoleSelector({ variant = "header" }: RoleSelectorProps) {
  const { rol, setRol } = useRole();
  const router = useRouter();
  const pathname = usePathname();
  const esRutaB2B =
    pathname === "/dashboard" || pathname.startsWith("/b2b");
  const rolActivo = esRutaB2B ? "DISTRIBUIDORA_B2B" : rol;

  const cambiarRol = (nuevoRol: RolDemo) => {
    setRol(nuevoRol);
    if (nuevoRol === "DISTRIBUIDORA_B2B" && !esRutaB2B) {
      router.push("/dashboard");
    } else if (nuevoRol === "COMERCIANTE" && esRutaB2B) {
      router.push("/mostrador");
    }
  };

  const isSidebar = variant === "sidebar";

  return (
    <div
      className={`inline-flex items-center rounded-xl p-1 text-xs font-semibold ${
        isSidebar
          ? "w-full bg-brand-primary-dark/80 ring-1 ring-white/15"
          : "bg-slate-200/80 ring-1 ring-slate-300/70"
      }`}
      role="group"
      aria-label="Selector rápido de rol de demostración"
    >
      <button
        type="button"
        onClick={() => cambiarRol("COMERCIANTE")}
        className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-all cursor-pointer ${
          rolActivo === "COMERCIANTE"
            ? "bg-brand-primary text-white shadow-xs"
            : isSidebar
              ? "text-emerald-100/80 hover:text-white"
              : "text-slate-600 hover:text-slate-900"
        }`}
      >
        <Store className="h-3.5 w-3.5 shrink-0" />
        <span>Comerciante</span>
      </button>

      <button
        type="button"
        onClick={() => cambiarRol("DISTRIBUIDORA_B2B")}
        className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2.5 py-1.5 transition-all cursor-pointer ${
          rolActivo === "DISTRIBUIDORA_B2B"
            ? "bg-brand-amber text-white shadow-xs"
            : isSidebar
              ? "text-emerald-100/80 hover:text-white"
              : "text-slate-600 hover:text-slate-900"
        }`}
      >
        <Building2 className="h-3.5 w-3.5 shrink-0" />
        <span>B2B Zonal</span>
      </button>
    </div>
  );
}
