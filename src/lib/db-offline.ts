import Dexie, { type EntityTable } from "dexie";

export type UnidadMedidaLocal = "UNIDAD" | "PAQUETE" | "CAJA" | "LITRO" | "KILO";
export type EstadoLoteLocal = "ACTIVO" | "POR_VENCER" | "VENCIDO" | "AGOTADO";
export type MetodoRegistroLocal = "VOZ" | "ESCANER" | "MANUAL";

export interface CatalogoLocal {
  id: string;
  codigoBarras: string;
  nombreProducto: string;
  marca: string;
  categoria: string;
  unidadMedida: UnidadMedidaLocal;
  imagenUrl: string | null;
}

export interface LoteLocal {
  id: string;
  comercioId: string;
  productoId: string;
  stockActual: number;
  precioCompra: number;
  precioVenta: number;
  fechaVencimiento: string | null;
  fechaIngreso: string;
  estado: EstadoLoteLocal;
  sincronizado: boolean;
}

export interface DetalleVentaLocal {
  id: string;
  loteId: string;
  productoId: string;
  nombreProducto: string;
  cantidad: number;
  precioUnitario: number;
  subtotal: number;
  fechaVencimientoLote: string | null;
}

export interface VentaLocal {
  id: string;
  comercioId: string;
  fechaHora: string;
  totalBs: number;
  metodoRegistro: MetodoRegistroLocal;
  sincronizadoOffline: boolean;
  detalles: DetalleVentaLocal[];
}

export interface PayloadIngresoLoteSync {
  lote: LoteLocal;
}

export interface PayloadVentaSync {
  ventaId: string;
  comercioId: string;
  fechaHora: string;
  totalBs: number;
  metodoRegistro: MetodoRegistroLocal;
  fueOffline: boolean;
  detalles: Array<{
    id: string;
    loteId: string;
    productoId: string;
    cantidad: number;
    precioUnitario: number;
    subtotal: number;
  }>;
}

export type OperacionColaSync =
  | {
      id?: number;
      operacionId: string;
      tipo: "INGRESO_LOTE";
      payload: PayloadIngresoLoteSync;
      estado: "PENDIENTE" | "SINCRONIZANDO" | "ERROR";
      intentos: number;
      ultimoError?: string;
      creadoEn: string;
    }
  | {
      id?: number;
      operacionId: string;
      tipo: "VENTA";
      payload: PayloadVentaSync;
      estado: "PENDIENTE" | "SINCRONIZANDO" | "ERROR";
      intentos: number;
      ultimoError?: string;
      creadoEn: string;
    };

export interface MetaLocal {
  clave: string;
  valor: string;
}

class StockiaOfflineDB extends Dexie {
  catalogo!: EntityTable<CatalogoLocal, "id">;
  lotes!: EntityTable<LoteLocal, "id">;
  ventasLocales!: EntityTable<VentaLocal, "id">;
  colaSincronizacion!: EntityTable<OperacionColaSync, "id">;
  meta!: EntityTable<MetaLocal, "clave">;

  constructor() {
    super("StockiaBoliviaOfflineDB");

    this.version(1).stores({
      catalogo: "id, &codigoBarras, nombreProducto, marca, categoria",
      lotes:
        "id, comercioId, productoId, estado, fechaVencimiento, [productoId+estado]",
      ventasLocales: "id, comercioId, fechaHora, metodoRegistro",
      colaSincronizacion: "++id, &operacionId, tipo, estado, creadoEn",
      meta: "clave",
    });
  }
}

export const dbOffline = new StockiaOfflineDB();

export function generarIdLocal(prefijo = "loc"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefijo}_${crypto.randomUUID()}`;
  }
  return `${prefijo}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function diasHastaVencimiento(fechaIso: string | null): number | null {
  if (!fechaIso) return null;
  const ahora = new Date();
  const inicioHoy = new Date(
    ahora.getFullYear(),
    ahora.getMonth(),
    ahora.getDate()
  ).getTime();
  const venc = new Date(fechaIso);
  const inicioVenc = new Date(
    venc.getFullYear(),
    venc.getMonth(),
    venc.getDate()
  ).getTime();
  return Math.ceil((inicioVenc - inicioHoy) / (1000 * 60 * 60 * 24));
}

export function calcularEstadoLote(
  stockActual: number,
  fechaVencimiento: string | null
): EstadoLoteLocal {
  if (stockActual <= 0) return "AGOTADO";
  const dias = diasHastaVencimiento(fechaVencimiento);
  if (dias === null) return "ACTIVO";
  if (dias < 0) return "VENCIDO";
  if (dias <= 5) return "POR_VENCER";
  return "ACTIVO";
}

/**
 * Ordenamiento estricto FEFO (First Expired, First Out):
 * 1. Lotes con fecha de vencimiento definida van primero, ordenados de más próximo a más lejano.
 * 2. Lotes sin fecha de vencimiento van después.
 * 3. Desempate por antigüedad de ingreso (FIFO).
 */
export function ordenarLotesFEFO(lotes: LoteLocal[]): LoteLocal[] {
  return [...lotes].sort((a, b) => {
    if (a.fechaVencimiento && b.fechaVencimiento) {
      const diff =
        new Date(a.fechaVencimiento).getTime() -
        new Date(b.fechaVencimiento).getTime();
      if (diff !== 0) return diff;
    } else if (a.fechaVencimiento && !b.fechaVencimiento) {
      return -1;
    } else if (!a.fechaVencimiento && b.fechaVencimiento) {
      return 1;
    }
    return (
      new Date(a.fechaIngreso).getTime() - new Date(b.fechaIngreso).getTime()
    );
  });
}

export async function obtenerComercioIdLocal(): Promise<string> {
  const metaComercio = await dbOffline.meta.get("comercioId");
  return metaComercio?.valor ?? "comercio-demo-martha";
}

export interface NuevoLoteInput {
  productoId: string;
  stockActual: number;
  precioCompra: number;
  precioVenta: number;
  fechaVencimiento: string | null;
}

export async function registrarIngresoLoteLocal(
  input: NuevoLoteInput
): Promise<LoteLocal> {
  const ahoraIso = new Date().toISOString();
  const comercioId = await obtenerComercioIdLocal();
  const estado = calcularEstadoLote(input.stockActual, input.fechaVencimiento);

  const nuevoLote: LoteLocal = {
    id: generarIdLocal("lote"),
    comercioId,
    productoId: input.productoId,
    stockActual: input.stockActual,
    precioCompra: Number(input.precioCompra.toFixed(2)),
    precioVenta: Number(input.precioVenta.toFixed(2)),
    fechaVencimiento: input.fechaVencimiento,
    fechaIngreso: ahoraIso,
    estado,
    sincronizado: false,
  };

  await dbOffline.transaction(
    "rw",
    dbOffline.lotes,
    dbOffline.colaSincronizacion,
    async () => {
      await dbOffline.lotes.put(nuevoLote);
      await dbOffline.colaSincronizacion.add({
        operacionId: generarIdLocal("op_lote"),
        tipo: "INGRESO_LOTE",
        payload: { lote: nuevoLote },
        estado: "PENDIENTE",
        intentos: 0,
        creadoEn: ahoraIso,
      });
    }
  );

  return nuevoLote;
}

export interface ItemCarritoVenta {
  productoId: string;
  nombreProducto: string;
  cantidad: number;
  precioReferencia: number;
}

export interface ResultadoVentaFEFO {
  venta: VentaLocal;
  lotesPorVencerDespachados: number;
}

export async function registrarVentaFEFO(params: {
  items: ItemCarritoVenta[];
  metodoRegistro: MetodoRegistroLocal;
  fueOffline: boolean;
}): Promise<ResultadoVentaFEFO> {
  if (params.items.length === 0) {
    throw new Error("El carrito está vacío.");
  }

  const ahoraIso = new Date().toISOString();
  const ventaId = generarIdLocal("venta");
  let lotesPorVencerDespachados = 0;

  const ventaCreada = await dbOffline.transaction(
    "rw",
    dbOffline.lotes,
    dbOffline.ventasLocales,
    dbOffline.colaSincronizacion,
    dbOffline.meta,
    async () => {
      const comercioId = await obtenerComercioIdLocal();
      const detalles: DetalleVentaLocal[] = [];
      let totalAcumulado = 0;

      for (const item of params.items) {
        const lotesProducto = await dbOffline.lotes
          .where("productoId")
          .equals(item.productoId)
          .filter(
            (l) =>
              l.stockActual > 0 &&
              calcularEstadoLote(l.stockActual, l.fechaVencimiento) !== "VENCIDO"
          )
          .toArray();

        const lotesOrdenados = ordenarLotesFEFO(lotesProducto);
        const stockTotalDisponible = lotesOrdenados.reduce(
          (acc, l) => acc + l.stockActual,
          0
        );

        if (stockTotalDisponible < item.cantidad) {
          throw new Error(
            `Stock insuficiente para "${item.nombreProducto}". Disponible: ${stockTotalDisponible}.`
          );
        }

        let restante = item.cantidad;

        for (const lote of lotesOrdenados) {
          if (restante <= 0) break;

          const estadoPrevio = calcularEstadoLote(
            lote.stockActual,
            lote.fechaVencimiento
          );
          if (estadoPrevio === "POR_VENCER") {
            lotesPorVencerDespachados += 1;
          }

          const cantidadTomada = Math.min(lote.stockActual, restante);
          const nuevoStock = lote.stockActual - cantidadTomada;
          const nuevoEstado = calcularEstadoLote(
            nuevoStock,
            lote.fechaVencimiento
          );

          await dbOffline.lotes.update(lote.id, {
            stockActual: nuevoStock,
            estado: nuevoEstado,
          });

          const precioUnitario = Number(lote.precioVenta.toFixed(2));
          const subtotal = Number((cantidadTomada * precioUnitario).toFixed(2));
          totalAcumulado = Number((totalAcumulado + subtotal).toFixed(2));

          detalles.push({
            id: generarIdLocal("det"),
            loteId: lote.id,
            productoId: item.productoId,
            nombreProducto: item.nombreProducto,
            cantidad: cantidadTomada,
            precioUnitario,
            subtotal,
            fechaVencimientoLote: lote.fechaVencimiento,
          });

          restante -= cantidadTomada;
        }
      }

      const nuevaVenta: VentaLocal = {
        id: ventaId,
        comercioId,
        fechaHora: ahoraIso,
        totalBs: totalAcumulado,
        metodoRegistro: params.metodoRegistro,
        sincronizadoOffline: params.fueOffline,
        detalles,
      };

      await dbOffline.ventasLocales.put(nuevaVenta);

      await dbOffline.colaSincronizacion.add({
        operacionId: generarIdLocal("op_venta"),
        tipo: "VENTA",
        payload: {
          ventaId: nuevaVenta.id,
          comercioId: nuevaVenta.comercioId,
          fechaHora: nuevaVenta.fechaHora,
          totalBs: nuevaVenta.totalBs,
          metodoRegistro: nuevaVenta.metodoRegistro,
          fueOffline: params.fueOffline,
          detalles: detalles.map((d) => ({
            id: d.id,
            loteId: d.loteId,
            productoId: d.productoId,
            cantidad: d.cantidad,
            precioUnitario: d.precioUnitario,
            subtotal: d.subtotal,
          })),
        },
        estado: "PENDIENTE",
        intentos: 0,
        creadoEn: ahoraIso,
      });

      return nuevaVenta;
    }
  );

  return {
    venta: ventaCreada,
    lotesPorVencerDespachados,
  };
}

/**
 * Reconcilia de inmediato IndexedDB (Dexie.js) contra `/api/sync` tras mutaciones
 * ejecutadas por voz o por el botón Deshacer, preservando lotes locales aún no sincronizados
 * y reflejando instantáneamente productos nuevos o cambios de stock en pantalla sin F5.
 */
export async function sincronizarInventarioLocalDesdeNube(deltasInmediatos?: {
  productos?: CatalogoLocal[];
  lotes?: LoteLocal[];
}): Promise<void> {
  if (typeof window === "undefined") return;

  // 1. Escritura optimista instantánea (< 2ms) de los registros devueltos por /api/voice-assistant
  if (
    deltasInmediatos &&
    ((deltasInmediatos.productos && deltasInmediatos.productos.length > 0) ||
      (deltasInmediatos.lotes && deltasInmediatos.lotes.length > 0))
  ) {
    await dbOffline.transaction(
      "rw",
      dbOffline.catalogo,
      dbOffline.lotes,
      async () => {
        if (deltasInmediatos.productos?.length) {
          await dbOffline.catalogo.bulkPut(deltasInmediatos.productos);
        }
        if (deltasInmediatos.lotes?.length) {
          await dbOffline.lotes.bulkPut(deltasInmediatos.lotes);
        }
      }
    );
  }

  // 2. Reconciliación completa contra PostgreSQL para asegurar consistencia total (incluyendo Undo)
  if (!navigator.onLine) return;
  try {
    const res = await fetch("/api/sync", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return;

    const data = (await res.json()) as {
      ok: boolean;
      catalogo?: CatalogoLocal[];
      lotes?: LoteLocal[];
      ventasHoy?: VentaLocal[];
      timestamp?: string;
    };
    if (!data.ok) return;

    await dbOffline.transaction(
      "rw",
      dbOffline.catalogo,
      dbOffline.lotes,
      dbOffline.ventasLocales,
      dbOffline.colaSincronizacion,
      dbOffline.meta,
      async () => {
        if (data.catalogo) {
          await dbOffline.catalogo.clear();
          await dbOffline.catalogo.bulkPut(data.catalogo);
        }

        const pendientes = await dbOffline.colaSincronizacion.count();
        if (data.lotes) {
          if (pendientes === 0) {
            await dbOffline.lotes.clear();
            await dbOffline.lotes.bulkPut(data.lotes);
          } else {
            // Conservar lotes offline pendientes y actualizar todos los sincronizados
            const lotesNoSincronizados = await dbOffline.lotes
              .filter((l) => !l.sincronizado)
              .toArray();
            await dbOffline.lotes.clear();
            await dbOffline.lotes.bulkPut(data.lotes);
            if (lotesNoSincronizados.length > 0) {
              await dbOffline.lotes.bulkPut(lotesNoSincronizados);
            }
          }
        }

        if (pendientes === 0 && data.ventasHoy) {
          await dbOffline.ventasLocales.bulkPut(data.ventasHoy);
        }

        if (data.timestamp) {
          await dbOffline.meta.put({
            clave: "ultimaSincronizacion",
            valor: data.timestamp,
          });
        }
      }
    );
  } catch {
    // Mantener los deltas aplicados localmente si hay microcorte posterior
  }
}
