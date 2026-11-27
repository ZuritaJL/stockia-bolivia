import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { RolUsuario } from "@prisma/client";

const CLAVES_DEMO_PERMITIDAS = new Set([
  "stockia2026",
  "stockia",
  "123456",
  "demo123",
  "martha123",
  "andina123",
]);

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      identificador?: string;
      password?: string;
      rolPreferido?: "COMERCIANTE" | "DISTRIBUIDORA_B2B";
      modoDemo?: boolean;
    };

    const rolSolicitado =
      body.rolPreferido === "DISTRIBUIDORA_B2B"
        ? "DISTRIBUIDORA_B2B"
        : "COMERCIANTE";

    // 1. Acceso instantáneo Modo Demo (1 Clic)
    if (body.modoDemo) {
      if (rolSolicitado === "DISTRIBUIDORA_B2B") {
        const usrB2B =
          (await prisma.usuario.findUnique({
            where: { email: "inteligencia@andina-b2b.bo" },
          })) ??
          (await prisma.usuario.findFirst({
            where: { rol: RolUsuario.DISTRIBUIDORA_B2B },
          }));

        return NextResponse.json({
          ok: true,
          sesion: {
            usuarioId: usrB2B?.id ?? "demo-b2b-andina",
            nombreUsuario: usrB2B?.nombre ?? "Distribuidora Andina S.R.L.",
            email: usrB2B?.email ?? "inteligencia@andina-b2b.bo",
            rol: "DISTRIBUIDORA_B2B",
            nombreEntidad: usrB2B?.nombre ?? "Distribuidora Andina S.R.L.",
            ubicacion: "Cobertura: La Paz y El Alto",
            comercioId: null,
            modoDemo: true,
          },
        });
      }

      const usrComerciante =
        (await prisma.usuario.findUnique({
          where: { email: "martha@stockia.bo" },
          include: { comercio: true },
        })) ??
        (await prisma.usuario.findFirst({
          where: { rol: RolUsuario.COMERCIANTE },
          include: { comercio: true },
        }));

      const ciudadTxt =
        usrComerciante?.comercio?.ciudad === "EL_ALTO" ? "El Alto" : "La Paz";

      return NextResponse.json({
        ok: true,
        sesion: {
          usuarioId: usrComerciante?.id ?? "demo-comerciante-martha",
          nombreUsuario: usrComerciante?.nombre ?? "Martha Quispe Mamani",
          email: usrComerciante?.email ?? "martha@stockia.bo",
          rol: "COMERCIANTE",
          nombreEntidad:
            usrComerciante?.comercio?.nombreTienda ?? "Tienda Doña Martha",
          ubicacion: usrComerciante?.comercio
            ? `${usrComerciante.comercio.macrodistrito}, ${ciudadTxt}`
            : "Miraflores, La Paz",
          comercioId: usrComerciante?.comercio?.id ?? null,
          modoDemo: true,
        },
      });
    }

    // 2. Autenticación por Correo electrónico o Usuario + Contraseña
    const identificador = (body.identificador ?? "").trim();
    const password = (body.password ?? "").trim();

    if (!identificador || !password) {
      return NextResponse.json(
        {
          ok: false,
          error: "Ingresa tu correo electrónico o usuario y tu contraseña.",
        },
        { status: 400 }
      );
    }

    if (password.length < 4) {
      return NextResponse.json(
        {
          ok: false,
          error: "La contraseña debe tener al menos 4 caracteres.",
        },
        { status: 400 }
      );
    }

    // Buscar usuario registrado en PostgreSQL por correo, nombre o nombre de tienda
    const usuarioDb = await prisma.usuario.findFirst({
      where: {
        OR: [
          { email: { equals: identificador, mode: "insensitive" } },
          { nombre: { equals: identificador, mode: "insensitive" } },
          {
            comercio: {
              nombreTienda: { equals: identificador, mode: "insensitive" },
            },
          },
        ],
      },
      include: { comercio: true },
    });

    if (usuarioDb) {
      const esHashDemo = usuarioDb.passwordHash.startsWith(
        "$2b$10$stockiaDemoHash"
      );
      const claveValida =
        usuarioDb.passwordHash === password ||
        (esHashDemo &&
          (CLAVES_DEMO_PERMITIDAS.has(password.toLowerCase()) ||
            password.length >= 4));

      if (!claveValida) {
        return NextResponse.json(
          {
            ok: false,
            error: "Contraseña incorrecta para la cuenta ingresada.",
          },
          { status: 401 }
        );
      }

      const rolFinal: "COMERCIANTE" | "DISTRIBUIDORA_B2B" =
        usuarioDb.rol === RolUsuario.DISTRIBUIDORA_B2B
          ? "DISTRIBUIDORA_B2B"
          : rolSolicitado;

      const ciudadNombre =
        usuarioDb.comercio?.ciudad === "EL_ALTO" ? "El Alto" : "La Paz";

      return NextResponse.json({
        ok: true,
        sesion: {
          usuarioId: usuarioDb.id,
          nombreUsuario: usuarioDb.nombre,
          email: usuarioDb.email,
          rol: rolFinal,
          nombreEntidad:
            rolFinal === "DISTRIBUIDORA_B2B"
              ? usuarioDb.rol === RolUsuario.DISTRIBUIDORA_B2B
                ? usuarioDb.nombre
                : "Distribuidora Mayorista"
              : (usuarioDb.comercio?.nombreTienda ?? usuarioDb.nombre),
          ubicacion:
            rolFinal === "DISTRIBUIDORA_B2B"
              ? "Cobertura: La Paz y El Alto"
              : usuarioDb.comercio
                ? `${usuarioDb.comercio.macrodistrito}, ${ciudadNombre}`
                : "La Paz, Bolivia",
          comercioId: usuarioDb.comercio?.id ?? null,
          modoDemo: false,
        },
      });
    }

    // Si es un correo/usuario válido ingresado por primera vez en el MVP, iniciar sesión vinculada al comercio base o perfil elegido
    const comercioFallback =
      rolSolicitado === "COMERCIANTE"
        ? await prisma.comercio.findFirst({
            include: { usuario: true },
          })
        : null;

    const nombreLimpio = identificador.includes("@")
      ? identificador
          .split("@")[0]
          .replace(/[._-]+/g, " ")
          .replace(/\b\w/g, (l) => l.toUpperCase())
      : identificador;

    return NextResponse.json({
      ok: true,
      sesion: {
        usuarioId: comercioFallback?.usuarioId ?? `usr_${Date.now()}`,
        nombreUsuario: nombreLimpio,
        email: identificador.includes("@")
          ? identificador.toLowerCase()
          : `${identificador.toLowerCase().replace(/\s+/g, ".")}@stockia.bo`,
        rol: rolSolicitado,
        nombreEntidad:
          rolSolicitado === "DISTRIBUIDORA_B2B"
            ? `${nombreLimpio} · Mayorista B2B`
            : `Tienda ${nombreLimpio}`,
        ubicacion:
          rolSolicitado === "DISTRIBUIDORA_B2B"
            ? "Cobertura: La Paz y El Alto"
            : comercioFallback
              ? `${comercioFallback.macrodistrito}, La Paz`
              : "La Paz, Bolivia",
        comercioId: comercioFallback?.id ?? null,
        modoDemo: false,
      },
    });
  } catch (error) {
    console.error("[POST /api/auth/login] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Error al verificar el inicio de sesión." },
      { status: 500 }
    );
  }
}
