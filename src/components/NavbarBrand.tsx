import React from "react";

interface NavbarBrandProps {
  variant?: "light" | "dark";
  compact?: boolean;
}

export function NavbarBrand({
  variant = "light",
  compact = false,
}: NavbarBrandProps) {
  const isDark = variant === "dark";

  return (
    <div className="flex items-center gap-3 select-none">
      {/* Isotipo SVG: Caja isométrica verde esmeralda con flecha ascendente y ondas de voz ámbar */}
      <div
        className={`relative flex shrink-0 items-center justify-center rounded-xl p-1.5 shadow-xs ${
          isDark
            ? "bg-white/10 ring-1 ring-white/20"
            : "bg-brand-primary-tint ring-1 ring-brand-primary/15"
        }`}
      >
        <svg
          width={compact ? 34 : 40}
          height={compact ? 34 : 40}
          viewBox="0 0 48 48"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="Isotipo StockIA Bolivia"
          role="img"
        >
          {/* Cara superior de la caja isométrica */}
          <path
            d="M21 7L35 15L21 23L7 15L21 7Z"
            fill={isDark ? "#22956E" : "#167354"}
          />
          {/* Cara izquierda de la caja isométrica */}
          <path
            d="M7 15L21 23V40L7 32V15Z"
            fill={isDark ? "#156C4E" : "#10563E"}
          />
          {/* Cara derecha de la caja isométrica */}
          <path
            d="M35 15L21 23V40L35 32V15Z"
            fill={isDark ? "#0D4733" : "#0B3D2C"}
          />
          {/* Cinta / pliegue central del empaque */}
          <path
            d="M14 11L28 19V25L25 26.7V20.6L11 12.7L14 11Z"
            fill="#F8FAFC"
            fillOpacity="0.3"
          />

          {/* Flecha ascendente de protección de ganancias */}
          <path
            d="M14 29L20 23L24 26.5L32 17"
            stroke="#F8FAFC"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M26.5 17H32V22.5"
            stroke="#F8FAFC"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Ondas de voz IA en Ámbar Vibrante (#D97706) */}
          <path
            d="M38 17.5C40.2 19.8 40.2 25.2 38 27.5"
            stroke="#D97706"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <path
            d="M42 13.5C45.6 17.8 45.6 27.2 42 31.5"
            stroke="#D97706"
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <circle cx="35.5" cy="22.5" r="2" fill="#D97706" />
        </svg>
      </div>

      {/* Logotipo tipográfico + Eslogan */}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`font-bold tracking-tight ${
              compact ? "text-base" : "text-lg"
            } ${isDark ? "text-white" : "text-brand-primary"}`}
          >
            StockIA <span className="text-brand-amber">Bolivia</span>
          </span>
        </div>
        <p
          className={`truncate text-xs font-medium ${
            isDark ? "text-emerald-100/85" : "text-slate-600"
          }`}
        >
          Controla tus productos, protege tus ganancias.
        </p>
      </div>
    </div>
  );
}

export default NavbarBrand;
