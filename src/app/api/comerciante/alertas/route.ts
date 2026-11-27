import { NextResponse, connection } from "next/server";
import prisma from "@/lib/prisma";
import { EstadoLote, MetodoRegistro, Prisma } from "@prisma/client";
import { analizarInteligenciaComercio } from "@/lib/fefo-engine";

async function resolverComercioActivo(comercioIdParam?: string | null) {
  if (comercioIdParam) {
    const directo = await prisma.comercio.findUnique({
      where: { id: comercioIdParam },
    });
    if (directo) return directo;
  }

  const usuarioMartha = await prisma.usuario.findUnique({
    where: { email: "martha@stockia.bo" },
    include: { comercio: true },
  });

  if (usuarioMartha?.comercio) {
    return usuarioMartha.comercio;
  }

  return prisma.comercio.findFirst();
}

function sumarDias(base: Date, dias: number): Date {
  const f = new Date(base);
  f.setDate(f.getDate() + dias);
  return f;
}

/**
 * GET /api/comerciante/alertas
 * Devuelve en una sola llamada estructurada:
 * - listaReposicion
 * - alertasFefo
 * - capitalDormido
 * - resumenFinancieroHoy
 * - serieRotacion14d
 */
export async function GET(request: Request) {
  await connection();

  try {
    const { searchParams } = new URL(request.url);
    const comercio = await resolverComercioActivo(
      searchParams.get("comercioId")
    );

    if (!comercio) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Comercio no encontrado. Asegúrate de haber corrido `npx prisma db seed`.",
        },
        { status: 404 }
      );
    }

    const inteligencia = await analizarInteligenciaComercio(
      comercio.id,
      new Date()
    );

    return NextResponse.json({
      ok: true,
      ...inteligencia,
    });
  } catch (error) {
    console.error("[GET /api/comerciante/alertas] Error:", error);
    return NextResponse.json(
      { ok: false, error: "No se pudo calcular la inteligencia del comercio." },
      { status: 500 }
    );
  }
}

/**
 * POST /api/comerciante/alertas
 * Botón de demostración: "Simular historial de 14 días" (idempotente).
 * Genera ventas históricas realistas en los últimos 14 días (incluyendo hoy),
 * calibra lotes de alta rotación para activar sugerencias de recompra ("Qué pedir hoy"),
 * lotes ROJO_CRITICO / AMBAR_PREVENTIVO para el semáforo FEFO, y lotes estancados
 * sin ventas en 21+ días para demostrar el detector de Capital Dormido en vivo.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      comercioId?: string;
    };

    const comercio = await resolverComercioActivo(body.comercioId);
    if (!comercio) {
      return NextResponse.json(
        { ok: false, error: "Comercio no encontrado." },
        { status: 404 }
      );
    }

    const catalogo = await prisma.catalogoCurado.findMany();
    const porCodigo = new Map(catalogo.map((c) => [c.codigoBarras, c]));

    const cocaCola = porCodigo.get("7771609000124");
    const lechePil = porCodigo.get("7771207001019");
    const pilfrut = porCodigo.get("7771207002115");
    const aceiteFino = porCodigo.get("7771201001015");
    const yogurtPil = porCodigo.get("7771207003051");
    const panSanGabriel = porCodigo.get("7773105001022");
    const chicolac = porCodigo.get("7771207004195");
    const mantequillaRegia = porCodigo.get("7771201003095");
    const detergenteOmo = porCodigo.get("7774102001082");
    const teWindsor = porCodigo.get("7772504001031");
    const lavavajillasOla = porCodigo.get("7774201001045");

    if (!cocaCola || !lechePil || !pilfrut || !aceiteFino) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Faltan productos base del catálogo boliviano. Ejecuta `npx prisma db seed`.",
        },
        { status: 400 }
      );
    }

    const ahora = new Date();
    const hace30Dias = sumarDias(ahora, -30);

    await prisma.$transaction(async (tx) => {
      // 1. Limpiar simulaciones previas para que el botón sea 100% idempotente
      await tx.venta.deleteMany({
        where: {
          comercioId: comercio.id,
          id: { startsWith: "sim14d_venta_" },
        },
      });

      // 2. Asegurar/calibrar lotes estratégicos para demostrar las 3 pestañas en la defensa
      //    a) Alta rotación con stock bajo -> "Qué pedir hoy" (Reponer Urgente)
      const loteCoca = await tx.inventarioLote.upsert({
        where: { id: "seed-lote-martha-03" },
        update: {
          stockActual: 7, // VRD ~3.5 u/día -> 2.0 días cobertura -> Reponer Urgente
          precioCompra: new Prisma.Decimal("10.20"),
          precioVenta: new Prisma.Decimal("13.00"),
          fechaIngreso: hace30Dias,
          fechaVencimiento: sumarDias(ahora, 60),
          estado: EstadoLote.ACTIVO,
        },
        create: {
          id: "seed-lote-martha-03",
          comercioId: comercio.id,
          productoId: cocaCola.id,
          stockActual: 7,
          precioCompra: new Prisma.Decimal("10.20"),
          precioVenta: new Prisma.Decimal("13.00"),
          fechaIngreso: hace30Dias,
          fechaVencimiento: sumarDias(ahora, 60),
          estado: EstadoLote.ACTIVO,
        },
      });

      const loteLeche = await tx.inventarioLote.upsert({
        where: { id: "seed-lote-martha-06" },
        update: {
          stockActual: 4, // VRD ~4.0 u/día -> 1.0 día cobertura -> ROJO CRÍTICO Reponer Urgente
          precioCompra: new Prisma.Decimal("6.20"),
          precioVenta: new Prisma.Decimal("7.50"),
          fechaIngreso: hace30Dias,
          fechaVencimiento: sumarDias(ahora, 14),
          estado: EstadoLote.ACTIVO,
        },
        create: {
          id: "seed-lote-martha-06",
          comercioId: comercio.id,
          productoId: lechePil.id,
          stockActual: 4,
          precioCompra: new Prisma.Decimal("6.20"),
          precioVenta: new Prisma.Decimal("7.50"),
          fechaIngreso: hace30Dias,
          fechaVencimiento: sumarDias(ahora, 14),
          estado: EstadoLote.ACTIVO,
        },
      });

      const lotePilfrut = await tx.inventarioLote.upsert({
        where: { id: "seed-lote-martha-05" },
        update: {
          stockActual: 11, // VRD ~5.5 u/día -> 2.0 días cobertura -> Reponer Urgente
          precioCompra: new Prisma.Decimal("1.50"),
          precioVenta: new Prisma.Decimal("2.00"),
          fechaIngreso: hace30Dias,
          fechaVencimiento: sumarDias(ahora, 22),
          estado: EstadoLote.ACTIVO,
        },
        create: {
          id: "seed-lote-martha-05",
          comercioId: comercio.id,
          productoId: pilfrut.id,
          stockActual: 11,
          precioCompra: new Prisma.Decimal("1.50"),
          precioVenta: new Prisma.Decimal("2.00"),
          fechaIngreso: hace30Dias,
          fechaVencimiento: sumarDias(ahora, 22),
          estado: EstadoLote.ACTIVO,
        },
      });

      const loteAceite = await tx.inventarioLote.upsert({
        where: { id: "seed-lote-martha-04" },
        update: {
          stockActual: 4, // VRD ~1.8 u/día -> 2.2 días cobertura -> Reponer Urgente
          precioCompra: new Prisma.Decimal("11.50"),
          precioVenta: new Prisma.Decimal("14.50"),
          fechaIngreso: hace30Dias,
          fechaVencimiento: sumarDias(ahora, 150),
          estado: EstadoLote.ACTIVO,
        },
        create: {
          id: "seed-lote-martha-04",
          comercioId: comercio.id,
          productoId: aceiteFino.id,
          stockActual: 4,
          precioCompra: new Prisma.Decimal("11.50"),
          precioVenta: new Prisma.Decimal("14.50"),
          fechaIngreso: hace30Dias,
          fechaVencimiento: sumarDias(ahora, 150),
          estado: EstadoLote.ACTIVO,
        },
      });

      //    b) Semáforo FEFO: ROJO_CRITICO (0..3 días) y AMBAR_PREVENTIVO (4..10 días)
      if (yogurtPil) {
        await tx.inventarioLote.upsert({
          where: { id: "seed-lote-martha-01" },
          update: {
            stockActual: 8,
            fechaVencimiento: sumarDias(ahora, 2), // ROJO_CRITICO
            estado: EstadoLote.POR_VENCER,
          },
          create: {
            id: "seed-lote-martha-01",
            comercioId: comercio.id,
            productoId: yogurtPil.id,
            stockActual: 8,
            precioCompra: new Prisma.Decimal("10.50"),
            precioVenta: new Prisma.Decimal("13.00"),
            fechaIngreso: sumarDias(ahora, -18),
            fechaVencimiento: sumarDias(ahora, 2),
            estado: EstadoLote.POR_VENCER,
          },
        });
      }

      if (chicolac) {
        await tx.inventarioLote.upsert({
          where: { id: "sim14d_lote_chicolac" },
          update: {
            stockActual: 5,
            fechaVencimiento: sumarDias(ahora, 1), // ROJO_CRITICO (1 día)
            estado: EstadoLote.POR_VENCER,
          },
          create: {
            id: "sim14d_lote_chicolac",
            comercioId: comercio.id,
            productoId: chicolac.id,
            stockActual: 5,
            precioCompra: new Prisma.Decimal("8.50"),
            precioVenta: new Prisma.Decimal("11.00"),
            fechaIngreso: sumarDias(ahora, -20),
            fechaVencimiento: sumarDias(ahora, 1),
            estado: EstadoLote.POR_VENCER,
          },
        });
      }

      if (panSanGabriel) {
        await tx.inventarioLote.upsert({
          where: { id: "seed-lote-martha-02" },
          update: {
            stockActual: 6,
            fechaVencimiento: sumarDias(ahora, 5), // AMBAR_PREVENTIVO (5 días)
            estado: EstadoLote.POR_VENCER,
          },
          create: {
            id: "seed-lote-martha-02",
            comercioId: comercio.id,
            productoId: panSanGabriel.id,
            stockActual: 6,
            precioCompra: new Prisma.Decimal("11.00"),
            precioVenta: new Prisma.Decimal("14.00"),
            fechaIngreso: sumarDias(ahora, -10),
            fechaVencimiento: sumarDias(ahora, 5),
            estado: EstadoLote.POR_VENCER,
          },
        });
      }

      if (mantequillaRegia) {
        await tx.inventarioLote.upsert({
          where: { id: "sim14d_lote_regia" },
          update: {
            stockActual: 7,
            fechaVencimiento: sumarDias(ahora, 8), // AMBAR_PREVENTIVO (8 días)
            estado: EstadoLote.ACTIVO,
          },
          create: {
            id: "sim14d_lote_regia",
            comercioId: comercio.id,
            productoId: mantequillaRegia.id,
            stockActual: 7,
            precioCompra: new Prisma.Decimal("9.20"),
            precioVenta: new Prisma.Decimal("12.00"),
            fechaIngreso: sumarDias(ahora, -22),
            fechaVencimiento: sumarDias(ahora, 8),
            estado: EstadoLote.ACTIVO,
          },
        });
      }

      //    c) Capital Dormido: lotes ingresados hace 28 días con 0 ventas en 21 días
      if (detergenteOmo) {
        await tx.inventarioLote.upsert({
          where: { id: "sim14d_lote_omo_dormido" },
          update: {
            stockActual: 14,
            fechaIngreso: sumarDias(ahora, -28),
          },
          create: {
            id: "sim14d_lote_omo_dormido",
            comercioId: comercio.id,
            productoId: detergenteOmo.id,
            stockActual: 14,
            precioCompra: new Prisma.Decimal("16.50"),
            precioVenta: new Prisma.Decimal("21.00"),
            fechaIngreso: sumarDias(ahora, -28),
            fechaVencimiento: sumarDias(ahora, 365),
            estado: EstadoLote.ACTIVO,
          },
        });
      }

      if (teWindsor) {
        await tx.inventarioLote.upsert({
          where: { id: "sim14d_lote_windsor_dormido" },
          update: {
            stockActual: 16,
            fechaIngreso: sumarDias(ahora, -26),
          },
          create: {
            id: "sim14d_lote_windsor_dormido",
            comercioId: comercio.id,
            productoId: teWindsor.id,
            stockActual: 16,
            precioCompra: new Prisma.Decimal("8.80"),
            precioVenta: new Prisma.Decimal("11.50"),
            fechaIngreso: sumarDias(ahora, -26),
            fechaVencimiento: sumarDias(ahora, 280),
            estado: EstadoLote.ACTIVO,
          },
        });
      }

      if (lavavajillasOla) {
        await tx.inventarioLote.upsert({
          where: { id: "sim14d_lote_ola_dormido" },
          update: {
            stockActual: 12,
            fechaIngreso: sumarDias(ahora, -25),
          },
          create: {
            id: "sim14d_lote_ola_dormido",
            comercioId: comercio.id,
            productoId: lavavajillasOla.id,
            stockActual: 12,
            precioCompra: new Prisma.Decimal("9.50"),
            precioVenta: new Prisma.Decimal("12.50"),
            fechaIngreso: sumarDias(ahora, -25),
            fechaVencimiento: sumarDias(ahora, 320),
            estado: EstadoLote.ACTIVO,
          },
        });
      }

      // 3. Generar 14 días de ventas históricas (día -13 hasta hoy día 0)
      const metodosRotativos: MetodoRegistro[] = [
        MetodoRegistro.ESCANER,
        MetodoRegistro.VOZ,
        MetodoRegistro.MANUAL,
      ];

      for (let offset = 13; offset >= 0; offset -= 1) {
        const fechaVenta = new Date(ahora);
        fechaVenta.setDate(fechaVenta.getDate() - offset);
        fechaVenta.setHours(10 + (offset % 7), 20, 0, 0);

        const cantCoca = 3 + (offset % 3); // ~4 u./día
        const cantLeche = 3 + ((offset + 1) % 3); // ~4 u./día
        const cantPilfrut = 4 + (offset % 4); // ~5.5 u./día
        const cantAceite = offset % 2 === 0 ? 2 : 1; // ~1.5 u./día

        const lineas = [
          {
            loteId: loteCoca.id,
            productoId: cocaCola.id,
            cantidad: cantCoca,
            precioUnitario: 13.0,
          },
          {
            loteId: loteLeche.id,
            productoId: lechePil.id,
            cantidad: cantLeche,
            precioUnitario: 7.5,
          },
          {
            loteId: lotePilfrut.id,
            productoId: pilfrut.id,
            cantidad: cantPilfrut,
            precioUnitario: 2.0,
          },
          {
            loteId: loteAceite.id,
            productoId: aceiteFino.id,
            cantidad: cantAceite,
            precioUnitario: 14.5,
          },
        ];

        const totalDia = lineas.reduce(
          (s, item) => s + item.cantidad * item.precioUnitario,
          0
        );

        await tx.venta.create({
          data: {
            id: `sim14d_venta_dia_${offset}`,
            comercioId: comercio.id,
            fechaHora: fechaVenta,
            totalBs: new Prisma.Decimal(totalDia.toFixed(2)),
            metodoRegistro: metodosRotativos[offset % metodosRotativos.length],
            sincronizadoOffline: false,
            detalles: {
              create: lineas.map((item, idx) => ({
                id: `sim14d_det_${offset}_${idx}`,
                loteId: item.loteId,
                productoId: item.productoId,
                cantidad: item.cantidad,
                precioUnitario: new Prisma.Decimal(
                  item.precioUnitario.toFixed(2)
                ),
                subtotal: new Prisma.Decimal(
                  (item.cantidad * item.precioUnitario).toFixed(2)
                ),
              })),
            },
          },
        });
      }
    });

    const inteligenciaActualizada = await analizarInteligenciaComercio(
      comercio.id,
      new Date()
    );

    return NextResponse.json({
      ok: true,
      mensaje:
        "Historial demostrativo de 14 días generado con éxito para defensa.",
      ...inteligenciaActualizada,
    });
  } catch (error) {
    console.error("[POST /api/comerciante/alertas] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Error al generar simulación de 14 días." },
      { status: 500 }
    );
  }
}
