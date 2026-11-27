import { NextResponse } from "next/server";
import { connection } from "next/server";
import prisma from "@/lib/prisma";
import {
  EstadoLote,
  MetodoRegistro,
  Prisma,
  UnidadMedida,
} from "@prisma/client";
import type { OperacionColaSync } from "@/lib/db-offline";

function calcularEstadoServidor(
  stockActual: number,
  fechaVencimiento: Date | null
): EstadoLote {
  if (stockActual <= 0) return EstadoLote.AGOTADO;
  if (!fechaVencimiento) return EstadoLote.ACTIVO;

  const ahora = new Date();
  const inicioHoy = new Date(
    ahora.getFullYear(),
    ahora.getMonth(),
    ahora.getDate()
  ).getTime();
  const inicioVenc = new Date(
    fechaVencimiento.getFullYear(),
    fechaVencimiento.getMonth(),
    fechaVencimiento.getDate()
  ).getTime();
  const dias = Math.ceil((inicioVenc - inicioHoy) / (1000 * 60 * 60 * 24));

  if (dias < 0) return EstadoLote.VENCIDO;
  if (dias <= 5) return EstadoLote.POR_VENCER;
  return EstadoLote.ACTIVO;
}

async function resolverComercioDemo() {
  const usuarioMartha = await prisma.usuario.findUnique({
    where: { email: "martha@stockia.bo" },
    include: { comercio: true },
  });

  if (usuarioMartha?.comercio) {
    return usuarioMartha.comercio;
  }

  return prisma.comercio.findFirst();
}

/**
 * GET /api/sync
 * Descarga el catálogo curado boliviano, lotes actuales del comercio e historial del día
 * para hidratar Dexie.js (IndexedDB) en el arranque o bajo demanda.
 */
export async function GET() {
  await connection();

  try {
    const comercio = await resolverComercioDemo();
    if (!comercio) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "No se encontró un comercio activo. Ejecuta `npx prisma db seed`.",
        },
        { status: 404 }
      );
    }

    const ahora = new Date();
    const inicioDia = new Date(
      ahora.getFullYear(),
      ahora.getMonth(),
      ahora.getDate()
    );

    const [catalogo, lotes, ventasHoy] = await Promise.all([
      prisma.catalogoCurado.findMany({
        orderBy: { nombreProducto: "asc" },
      }),
      prisma.inventarioLote.findMany({
        where: { comercioId: comercio.id },
        orderBy: [{ fechaVencimiento: "asc" }, { fechaIngreso: "asc" }],
      }),
      prisma.venta.findMany({
        where: {
          comercioId: comercio.id,
          fechaHora: { gte: inicioDia },
        },
        include: {
          detalles: {
            include: {
              producto: { select: { nombreProducto: true } },
              lote: { select: { fechaVencimiento: true } },
            },
          },
        },
        orderBy: { fechaHora: "desc" },
      }),
    ]);

    return NextResponse.json({
      ok: true,
      comercio: {
        id: comercio.id,
        nombreTienda: comercio.nombreTienda,
        macrodistrito: comercio.macrodistrito,
        ciudad: comercio.ciudad,
      },
      catalogo: catalogo.map((c) => ({
        id: c.id,
        codigoBarras: c.codigoBarras,
        nombreProducto: c.nombreProducto,
        marca: c.marca,
        categoria: c.categoria,
        unidadMedida: c.unidadMedida,
        imagenUrl: c.imagenUrl,
      })),
      lotes: lotes.map((l) => {
        const estadoVig = calcularEstadoServidor(
          l.stockActual,
          l.fechaVencimiento
        );
        return {
          id: l.id,
          comercioId: l.comercioId,
          productoId: l.productoId,
          stockActual: l.stockActual,
          precioCompra: Number(l.precioCompra),
          precioVenta: Number(l.precioVenta),
          fechaVencimiento: l.fechaVencimiento
            ? l.fechaVencimiento.toISOString()
            : null,
          fechaIngreso: l.fechaIngreso.toISOString(),
          estado: estadoVig,
          sincronizado: true,
        };
      }),
      ventasHoy: ventasHoy.map((v) => ({
        id: v.id,
        comercioId: v.comercioId,
        fechaHora: v.fechaHora.toISOString(),
        totalBs: Number(v.totalBs),
        metodoRegistro: v.metodoRegistro,
        sincronizadoOffline: v.sincronizadoOffline,
        detalles: v.detalles.map((d) => ({
          id: d.id,
          loteId: d.loteId,
          productoId: d.productoId,
          nombreProducto: d.producto.nombreProducto,
          cantidad: d.cantidad,
          precioUnitario: Number(d.precioUnitario),
          subtotal: Number(d.subtotal),
          fechaVencimientoLote: d.lote.fechaVencimiento
            ? d.lote.fechaVencimiento.toISOString()
            : null,
        })),
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[GET /api/sync] Error:", error);
    return NextResponse.json(
      { ok: false, error: "Error al obtener datos de sincronización." },
      { status: 500 }
    );
  }
}

/**
 * POST /api/sync
 * Procesa en orden cronológico (FIFO) e idempotente las operaciones pendientes
 * acumuladas en `colaSincronizacion` (ingresos de lotes y ventas FEFO).
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      operaciones?: OperacionColaSync[];
    };

    const operaciones = body.operaciones ?? [];
    if (!Array.isArray(operaciones) || operaciones.length === 0) {
      return NextResponse.json({
        ok: true,
        procesadas: [],
        timestamp: new Date().toISOString(),
      });
    }

    const comercioFallback = await resolverComercioDemo();
    if (!comercioFallback) {
      return NextResponse.json(
        { ok: false, error: "Comercio base no encontrado en PostgreSQL." },
        { status: 404 }
      );
    }

    const procesadas: string[] = [];

    for (const op of operaciones) {
      await prisma.$transaction(async (tx) => {
        if (op.tipo === "INGRESO_LOTE") {
          const { lote, nuevoProducto } = op.payload;
          let productoIdReal = lote.productoId;

          // Si el lote proviene de un código EAN-13 nuevo escaneado en mostrador/inventario,
          // registrar primero el producto en CatalogoCurado de forma idempotente
          if (nuevoProducto) {
            const yaExisteCodigo = await tx.catalogoCurado.findUnique({
              where: { codigoBarras: nuevoProducto.codigoBarras },
            });

            if (yaExisteCodigo) {
              productoIdReal = yaExisteCodigo.id;
            } else {
              const creado = await tx.catalogoCurado.upsert({
                where: { id: nuevoProducto.id },
                update: {
                  nombreProducto: nuevoProducto.nombreProducto,
                  marca: nuevoProducto.marca,
                  categoria: nuevoProducto.categoria,
                  unidadMedida: nuevoProducto.unidadMedida as UnidadMedida,
                },
                create: {
                  id: nuevoProducto.id,
                  codigoBarras: nuevoProducto.codigoBarras,
                  nombreProducto: nuevoProducto.nombreProducto,
                  marca: nuevoProducto.marca,
                  categoria: nuevoProducto.categoria,
                  unidadMedida: nuevoProducto.unidadMedida as UnidadMedida,
                  imagenUrl: nuevoProducto.imagenUrl ?? null,
                },
              });
              productoIdReal = creado.id;
            }
          }

          const comercioIdReal =
            lote.comercioId === "comercio-demo-martha"
              ? comercioFallback.id
              : lote.comercioId;

          const fechaVenc = lote.fechaVencimiento
            ? new Date(lote.fechaVencimiento)
            : null;
          const estadoCalculado = calcularEstadoServidor(
            lote.stockActual,
            fechaVenc
          );

          await tx.inventarioLote.upsert({
            where: { id: lote.id },
            update: {
              stockActual: lote.stockActual,
              precioCompra: new Prisma.Decimal(lote.precioCompra.toFixed(2)),
              precioVenta: new Prisma.Decimal(lote.precioVenta.toFixed(2)),
              fechaVencimiento: fechaVenc,
              estado: estadoCalculado,
            },
            create: {
              id: lote.id,
              comercioId: comercioIdReal,
              productoId: productoIdReal,
              stockActual: lote.stockActual,
              precioCompra: new Prisma.Decimal(lote.precioCompra.toFixed(2)),
              precioVenta: new Prisma.Decimal(lote.precioVenta.toFixed(2)),
              fechaVencimiento: fechaVenc,
              fechaIngreso: new Date(lote.fechaIngreso),
              estado: estadoCalculado,
            },
          });

          procesadas.push(op.operacionId);
        } else if (op.tipo === "VENTA") {
          const payload = op.payload;
          const ventaExistente = await tx.venta.findUnique({
            where: { id: payload.ventaId },
          });

          if (!ventaExistente) {
            const comercioIdReal =
              payload.comercioId === "comercio-demo-martha"
                ? comercioFallback.id
                : payload.comercioId;

            await tx.venta.create({
              data: {
                id: payload.ventaId,
                comercioId: comercioIdReal,
                fechaHora: new Date(payload.fechaHora),
                totalBs: new Prisma.Decimal(payload.totalBs.toFixed(2)),
                metodoRegistro: payload.metodoRegistro as MetodoRegistro,
                sincronizadoOffline: payload.fueOffline,
                detalles: {
                  create: payload.detalles.map((d) => ({
                    id: d.id,
                    loteId: d.loteId,
                    productoId: d.productoId,
                    cantidad: d.cantidad,
                    precioUnitario: new Prisma.Decimal(
                      d.precioUnitario.toFixed(2)
                    ),
                    subtotal: new Prisma.Decimal(d.subtotal.toFixed(2)),
                  })),
                },
              },
            });

            for (const det of payload.detalles) {
              const loteDb = await tx.inventarioLote.findUnique({
                where: { id: det.loteId },
              });
              if (loteDb) {
                const nuevoStock = Math.max(0, loteDb.stockActual - det.cantidad);
                const nuevoEstado = calcularEstadoServidor(
                  nuevoStock,
                  loteDb.fechaVencimiento
                );
                await tx.inventarioLote.update({
                  where: { id: det.loteId },
                  data: {
                    stockActual: nuevoStock,
                    estado: nuevoEstado,
                  },
                });
              }
            }
          }

          procesadas.push(op.operacionId);
        }
      });
    }

    return NextResponse.json({
      ok: true,
      procesadas,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[POST /api/sync] Error:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Error procesando cola de sincronización.",
      },
      { status: 500 }
    );
  }
}
