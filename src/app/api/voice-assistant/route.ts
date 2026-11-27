import { NextResponse, connection } from "next/server";
import { GoogleGenAI, Type, type FunctionDeclaration } from "@google/genai";
import prisma from "@/lib/prisma";
import {
  EstadoLote,
  MetodoRegistro,
  PlanSuscripcion,
  Prisma,
  UnidadMedida,
  type CatalogoCurado,
  type InventarioLote,
} from "@prisma/client";
import { guardarOperacionDeshacer } from "@/lib/voice-undo-store";

const MODELOS_CASCADA = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
] as const;

const RETARDO_REINTENTO_MS = 500;
const LIMITE_GRATIS_DIARIO = 15;

const UNIDADES_VALIDAS = new Set<string>([
  "UNIDAD",
  "PAQUETE",
  "CAJA",
  "LITRO",
  "KILO",
]);

const PALABRAS_GENERICAS_ENVASE = new Set([
  "unidad",
  "unidades",
  "paquete",
  "paquetes",
  "caja",
  "cajas",
  "litro",
  "litros",
  "kilo",
  "kilos",
  "gramos",
  "ml",
  "kg",
  "gr",
  "de",
  "del",
  "la",
  "el",
  "los",
  "las",
  "con",
  "sin",
  "producto",
  "productos",
  "ese",
  "esa",
  "eso",
  "mas",
]);

export interface TurnoConversacionVoz {
  role: "user" | "model";
  text: string;
}

interface LlamadaHerramientaNormalizada {
  name: string;
  args: Record<string, unknown>;
}

function esperarMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function esErrorReintentable(error: unknown): boolean {
  if (!error) return false;
  const errObj = error as {
    status?: number;
    code?: number | string;
    message?: string;
  };
  const codigo = Number(errObj.status ?? errObj.code ?? 0);
  if ([429, 500, 502, 503, 504].includes(codigo)) return true;

  const msg = String(errObj.message ?? error).toLowerCase();
  return (
    msg.includes("503") ||
    msg.includes("429") ||
    msg.includes("high demand") ||
    msg.includes("unavailable") ||
    msg.includes("overloaded") ||
    msg.includes("resource_exhausted") ||
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("fetch failed") ||
    msg.includes("network")
  );
}

function esMismoDiaLocal(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function normalizarTexto(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function capitalizarNombreProducto(nombre: string): string {
  return nombre
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((palabra) => {
      if (!palabra) return "";
      if (/^\d+(ml|l|kg|g|gr)$/i.test(palabra)) {
        return palabra
          .toUpperCase()
          .replace("ML", "ml")
          .replace("KG", "kg")
          .replace("GR", "g");
      }
      return palabra.charAt(0).toUpperCase() + palabra.slice(1).toLowerCase();
    })
    .join(" ");
}

function normalizarUnidadMedida(raw: unknown): UnidadMedida {
  const limpio = String(raw ?? "UNIDAD")
    .trim()
    .toUpperCase();
  if (UNIDADES_VALIDAS.has(limpio)) {
    return limpio as UnidadMedida;
  }
  if (limpio.includes("LITRO") || limpio === "L") return UnidadMedida.LITRO;
  if (limpio.includes("KILO") || limpio === "KG") return UnidadMedida.KILO;
  if (limpio.includes("PAQ")) return UnidadMedida.PAQUETE;
  if (limpio.includes("CAJ")) return UnidadMedida.CAJA;
  return UnidadMedida.UNIDAD;
}

function inferirCategoriaPorNombre(nombre: string): string {
  const n = normalizarTexto(nombre);
  if (
    /\b(coca|soda|gaseosa|refresco|agua|jugo|cerveza|maltin|cascada|fanta|sprite|pepsi)\b/.test(
      n
    )
  ) {
    return "Bebidas";
  }
  if (/\b(leche|yogurt|pilfrut|queso|mantequilla|helado|chicolac)\b/.test(n)) {
    return "Lácteos";
  }
  if (
    /\b(galleta|galletas|oreo|papas|snack|chocolate|caramelo|dulce|chizito)\b/.test(
      n
    )
  ) {
    return "Snacks";
  }
  if (/\b(pan|molde|queque|torta|empanada)\b/.test(n)) {
    return "Panadería";
  }
  if (
    /\b(detergente|jabon|lavavajillas|cloro|lavandina|papel higienico|shampoo|limpieza)\b/.test(
      n
    )
  ) {
    return "Limpieza";
  }
  return "Abarrotes";
}

/**
 * Resuelve un producto priorizando `productoId` exacto provisto por Gemini,
 * seguido de `contains` insensible a mayúsculas y coincidencia de tokens distintivos.
 */
async function resolverProductoSemantica(params: {
  productoId?: string | null;
  nombreBuscado: string;
  catalogoCache: CatalogoCurado[];
  catalogoPorId: Map<string, CatalogoCurado>;
}): Promise<CatalogoCurado | null> {
  const { productoId, nombreBuscado, catalogoCache, catalogoPorId } = params;

  if (productoId && catalogoPorId.has(productoId.trim())) {
    return catalogoPorId.get(productoId.trim()) ?? null;
  }

  const limpio = nombreBuscado.trim();
  if (!limpio) return null;

  // Sinónimos coloquiales bolivianos frecuentes para el respaldo determinista
  const norm = normalizarTexto(limpio);
  if (/\bgaseosa negra\b|\bsoda negra\b/.test(norm)) {
    const coca = catalogoCache.find((c) =>
      normalizarTexto(c.nombreProducto).includes("coca cola")
    );
    if (coca) return coca;
  }
  if (/\bfideo largo\b|\btallarin\b/.test(norm)) {
    const fideo = catalogoCache.find((c) =>
      normalizarTexto(c.nombreProducto).includes("fideo")
    );
    if (fideo) return fideo;
  }

  const coincidenciaDirectaDb = await prisma.catalogoCurado.findFirst({
    where: {
      OR: [
        { id: limpio },
        { codigoBarras: limpio },
        {
          nombreProducto: {
            contains: limpio,
            mode: "insensitive",
          },
        },
      ],
    },
  });

  if (coincidenciaDirectaDb) {
    return coincidenciaDirectaDb;
  }

  const tokensDistintivos = norm
    .split(" ")
    .filter(
      (t) =>
        t.length > 1 &&
        !/^\d+$/.test(t) &&
        !PALABRAS_GENERICAS_ENVASE.has(t)
    );

  if (tokensDistintivos.length === 0) return null;

  let mejorCandidato: CatalogoCurado | null = null;
  let mejorPuntaje = 0;

  for (const item of catalogoCache) {
    const textoItem = normalizarTexto(`${item.nombreProducto} ${item.marca}`);
    const todosPresentes = tokensDistintivos.every((tok) =>
      textoItem.includes(tok)
    );
    if (!todosPresentes) continue;

    const puntaje = tokensDistintivos.length * 20;
    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejorCandidato = item;
    }
  }

  return mejorCandidato;
}

function buscarMejorProductoEnCatalogo(
  consulta: string,
  catalogo: CatalogoCurado[],
  catalogoPorId?: Map<string, CatalogoCurado>,
  productoId?: string | null
): CatalogoCurado | null {
  if (productoId && catalogoPorId?.has(productoId.trim())) {
    return catalogoPorId.get(productoId.trim()) ?? null;
  }

  const qNorm = normalizarTexto(consulta);
  if (!qNorm) return null;

  if (/\bgaseosa negra\b|\bsoda negra\b/.test(qNorm)) {
    const coca = catalogo.find((c) =>
      normalizarTexto(c.nombreProducto).includes("coca cola")
    );
    if (coca) return coca;
  }
  if (/\bfideo largo\b|\btallarin\b/.test(qNorm)) {
    const fideo = catalogo.find((c) =>
      normalizarTexto(c.nombreProducto).includes("fideo")
    );
    if (fideo) return fideo;
  }

  const tokensConsulta = qNorm
    .split(" ")
    .filter((t) => t.length > 1 && !PALABRAS_GENERICAS_ENVASE.has(t));

  let mejor: CatalogoCurado | null = null;
  let mejorPuntaje = 0;

  for (const item of catalogo) {
    const nombreNorm = normalizarTexto(item.nombreProducto);
    const marcaNorm = normalizarTexto(item.marca);
    const completoNorm = `${nombreNorm} ${marcaNorm}`;

    if (nombreNorm === qNorm || item.codigoBarras === consulta.trim()) {
      return item;
    }

    let puntaje = 0;
    if (nombreNorm.includes(qNorm)) puntaje += 50;
    if (qNorm.includes(nombreNorm)) puntaje += 45;

    for (const tok of tokensConsulta) {
      if (/^\d+$/.test(tok)) continue;
      if (nombreNorm.split(" ").includes(tok)) {
        puntaje += 18;
      } else if (marcaNorm.split(" ").includes(tok)) {
        puntaje += 14;
      } else if (completoNorm.includes(tok)) {
        puntaje += 8;
      }
    }

    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejor = item;
    }
  }

  return mejorPuntaje >= 12 ? mejor : null;
}

/**
 * Extrae el último producto mencionado en el historial conversacional
 * para resolver pronombres como "auméntale 10 más a ese" en modo respaldo local.
 */
function recuperarProductoDeHistorial(
  historial: TurnoConversacionVoz[],
  catalogo: CatalogoCurado[]
): CatalogoCurado | null {
  for (let i = historial.length - 1; i >= 0; i -= 1) {
    const textoTurno = normalizarTexto(historial[i].text);
    for (const item of catalogo) {
      const nombreNorm = normalizarTexto(item.nombreProducto);
      if (textoTurno.includes(nombreNorm)) {
        return item;
      }
    }
    const candidato = buscarMejorProductoEnCatalogo(historial[i].text, catalogo);
    if (candidato) return candidato;
  }
  return null;
}

// ============================================================================
// PARSER LOCAL DE RESPALDO EN ESPAÑOL CON MEMORIA DE HISTORIAL
// ============================================================================

const NUMEROS_PALABRA: Record<string, number> = {
  un: 1,
  una: 1,
  uno: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  dieciocho: 18,
  veinte: 20,
  veinticuatro: 24,
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
};

const MESES_ES: Record<string, number> = {
  enero: 0,
  febrero: 1,
  marzo: 2,
  abril: 3,
  mayo: 4,
  junio: 5,
  julio: 6,
  agosto: 7,
  septiembre: 8,
  setiembre: 8,
  octubre: 9,
  noviembre: 10,
  diciembre: 11,
};

function formatearYYYYMMDD(fecha: Date): string {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function reemplazarPalabrasNumericas(textoNorm: string): string {
  let resultado = textoNorm
    .replace(/\bmedia docena\b/g, "6")
    .replace(/\buna docena\b/g, "12");

  for (const [palabra, valor] of Object.entries(NUMEROS_PALABRA)) {
    const regex = new RegExp(`\\b${palabra}\\b`, "g");
    resultado = resultado.replace(regex, String(valor));
  }
  return resultado;
}

function extraerFechaRelativaOExplicita(
  textoOriginal: string,
  referencia: Date
): string | undefined {
  const norm = reemplazarPalabrasNumericas(normalizarTexto(textoOriginal));

  const isoMatch = textoOriginal.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (isoMatch) return isoMatch[0];

  if (/\bpasado manana\b/.test(norm)) {
    const f = new Date(referencia);
    f.setDate(f.getDate() + 2);
    return formatearYYYYMMDD(f);
  }
  if (/\bmanana\b/.test(norm)) {
    const f = new Date(referencia);
    f.setDate(f.getDate() + 1);
    return formatearYYYYMMDD(f);
  }

  const enDias = norm.match(/\ben\s+(\d+)\s+dias?\b/);
  if (enDias) {
    const f = new Date(referencia);
    f.setDate(f.getDate() + Number(enDias[1]));
    return formatearYYYYMMDD(f);
  }

  const enSemanas = norm.match(/\ben\s+(\d+)\s+semanas?\b/);
  if (enSemanas) {
    const f = new Date(referencia);
    f.setDate(f.getDate() + Number(enSemanas[1]) * 7);
    return formatearYYYYMMDD(f);
  }

  const enMeses = norm.match(/\ben\s+(\d+)\s+mes(?:es)?\b/);
  if (enMeses) {
    const f = new Date(referencia);
    f.setMonth(f.getMonth() + Number(enMeses[1]));
    return formatearYYYYMMDD(f);
  }

  const diaMes = norm.match(
    /\b(\d{1,2})\s+de\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+(?:de|del)\s+(\d{4}))?\b/
  );
  if (diaMes) {
    const dia = Number(diaMes[1]);
    const mesIdx = MESES_ES[diaMes[2]];
    let anio = diaMes[3] ? Number(diaMes[3]) : referencia.getFullYear();

    const candidata = new Date(anio, mesIdx, dia, 23, 59, 59);
    if (!diaMes[3] && candidata.getTime() < referencia.getTime()) {
      anio += 1;
    }
    return formatearYYYYMMDD(new Date(anio, mesIdx, dia));
  }

  // Solo mes mencionado: ej. "vencen en diciembre" -> día 28 de ese mes
  const soloMes = norm.match(
    /\ben\s+(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\b/
  );
  if (soloMes) {
    const mesIdx = MESES_ES[soloMes[1]];
    let anio = referencia.getFullYear();
    const candidata = new Date(anio, mesIdx, 28, 23, 59, 59);
    if (candidata.getTime() < referencia.getTime()) {
      anio += 1;
    }
    return formatearYYYYMMDD(new Date(anio, mesIdx, 28));
  }

  return undefined;
}

function extraerPrecioVentaTexto(textoOriginal: string): number | undefined {
  const m = textoOriginal
    .toLowerCase()
    .match(
      /(?:a|precio(?:\s+de\s+venta)?)\s+(\d+(?:[.,]\d+)?)\s*(?:bs|bolivianos?)?/i
    );
  if (!m) return undefined;
  const val = Number(m[1].replace(",", "."));
  return Number.isFinite(val) && val > 0 ? val : undefined;
}

function interpretarComandoLocalRespaldo(
  textoComando: string,
  catalogo: CatalogoCurado[],
  ahoraServidor: Date,
  historial: TurnoConversacionVoz[]
): LlamadaHerramientaNormalizada | null {
  const norm = reemplazarPalabrasNumericas(normalizarTexto(textoComando));

  const esCreacionProducto = /\b(crea|crear|nuevo producto|da de alta)\b/.test(
    norm
  );

  const esIngresoOAumento =
    /\b(registra|registrar|aumenta|aumentale|aumentar|agrega|agregale|agregar|suma|sumale|sumar|ingresa|ingresaron|ingreso|llego|llegaron|anade|recibi|compre|sube|nuevo lote)\b/.test(
      norm
    ) && !/\b(venta|vendi)\b/.test(norm);

  const esVentaExplicita =
    !esCreacionProducto &&
    !esIngresoOAumento &&
    /\b(vendi|vende|vendimos|venta|cobra|cobrar|despacha|llevo|lleva|dame)\b/.test(
      norm
    );

  const esPorVencer =
    !esCreacionProducto &&
    !esIngresoOAumento &&
    !esVentaExplicita &&
    /\b(por vencer|vencen|vence|vencimiento|caduca|caducan|proxima a vencer|alertas? fefo)\b/.test(
      norm
    );

  const esConsultaStock =
    !esCreacionProducto &&
    !esIngresoOAumento &&
    !esVentaExplicita &&
    !esPorVencer &&
    /\b(stock|cuanto|cuantos|cuantas|queda|quedan|tenemos|tengo|hay|disponible|existencia|acabaron|acabo)\b/.test(
      norm
    );

  if (esCreacionProducto) {
    const fechaVenc = extraerFechaRelativaOExplicita(
      textoComando,
      ahoraServidor
    );
    const precioVenta = extraerPrecioVentaTexto(textoComando) ?? 5;
    const matchUnidades =
      norm.match(/\bcon\s+(\d+)\s*(?:unidades?|stock)?\b/) ??
      norm.match(/\b(\d+)\s+unidades?\b/);
    const stockInicial = matchUnidades ? Number(matchUnidades[1]) : 0;

    const nombreExtraido = norm
      .replace(
        /^\s*(crea|crear)\s+(el\s+|un\s+)?(nuevo\s+)?(producto\s+)?/,
        ""
      )
      .replace(/\b(a|precio)\s+\d+(?:\s+\d+)?\s*(bs|bolivianos?)?.*$/, "")
      .replace(/\bcon\s+\d+.*$/, "")
      .trim();

    const nombreLimpiado = capitalizarNombreProducto(
      nombreExtraido || "Producto Nuevo"
    );

    return {
      name: "crear_producto_catalogo",
      args: {
        producto_nombre: nombreLimpiado,
        categoria: inferirCategoriaPorNombre(nombreLimpiado),
        precio_venta: precioVenta,
        stock_inicial: stockInicial,
        esProductoNuevo: true,
        ...(fechaVenc ? { fecha_vencimiento: fechaVenc } : {}),
      },
    };
  }

  if (esIngresoOAumento) {
    const sinColaFecha = norm
      .replace(/\b(que\s+)?(vence|vencen|vencimiento)\b.*$/, " ")
      .replace(/\b(a|precio)\s+\d+\s*(bs|bolivianos?)\b.*$/, " ");

    const matchCant =
      sinColaFecha.match(/\b(\d+)\s+(?:unidades?|kilos?|litros?|paquetes?|cajas?)?\b/) ??
      sinColaFecha.match(/\b(\d+)\b/);

    const cantidad = matchCant ? Math.max(1, Number(matchCant[1])) : 1;
    const fechaVenc = extraerFechaRelativaOExplicita(
      textoComando,
      ahoraServidor
    );
    const precioVenta = extraerPrecioVentaTexto(textoComando);

    const nombreCandidato = sinColaFecha
      .replace(
        /\b(registra|registrar|aumenta|aumentale|aumentar|agrega|agregale|agregar|suma|sumale|sumar|ingresa|ingresaron|ingreso|llego|llegaron|anade|recibi|compre|sube|el|la|los|las|stock|unidades|unidad|kilos|kilo|litros|litro|de|del|en|a|ese|esa|eso|mas|lote|nuevo|producto)\b/g,
        " "
      )
      .replace(/^\s*\d+\s*/, "")
      .replace(/\s+/g, " ")
      .trim();

    const prodCatalogo =
      (nombreCandidato
        ? buscarMejorProductoEnCatalogo(nombreCandidato, catalogo)
        : null) ?? recuperarProductoDeHistorial(historial, catalogo);

    if (prodCatalogo) {
      return {
        name: "registrar_lote_inventario",
        args: {
          productoId: prodCatalogo.id,
          producto_nombre: prodCatalogo.nombreProducto,
          cantidad,
          esProductoNuevo: false,
          ...(precioVenta ? { precio_venta: precioVenta } : {}),
          ...(fechaVenc ? { fecha_vencimiento: fechaVenc } : {}),
        },
      };
    }

    return {
      name: "registrar_lote_inventario",
      args: {
        producto_nombre: capitalizarNombreProducto(
          nombreCandidato || textoComando
        ),
        cantidad,
        esProductoNuevo: true,
        categoria: inferirCategoriaPorNombre(nombreCandidato),
        ...(precioVenta ? { precio_venta: precioVenta } : {}),
        ...(fechaVenc ? { fecha_vencimiento: fechaVenc } : {}),
      },
    };
  }

  if (esPorVencer) {
    const matchDias = norm.match(/\b(\d+)\s+dias?\b/);
    return {
      name: "consultar_por_vencer",
      args: { dias_limite: matchDias ? Number(matchDias[1]) : 7 },
    };
  }

  if (esConsultaStock) {
    const limpio = norm
      .replace(
        /\b(cuanto|cuantos|cuantas|stock|queda|quedan|tenemos|tengo|hay|disponible|unidades|de|del|en|tienda|mi|se|me|acabaron|acabo|los|las|el|la)\b/g,
        " "
      )
      .trim();
    const prod =
      buscarMejorProductoEnCatalogo(limpio || norm, catalogo) ??
      recuperarProductoDeHistorial(historial, catalogo);
    return {
      name: "consultar_stock",
      args: {
        ...(prod ? { productoId: prod.id } : {}),
        producto_nombre: prod ? prod.nombreProducto : limpio || textoComando,
      },
    };
  }

  const segmentos = norm
    .replace(
      /^\s*(vendi|vende|vendimos|registra venta de|registra venta|venta de|cobra|cobrar|despacha|se llevo)\s+/,
      ""
    )
    .split(/\s+(?:y|mas|con)\s+|,\s*/);

  const itemsDetectados: Array<{
    productoId?: string;
    producto_nombre: string;
    cantidad: number;
  }> = [];

  for (const seg of segmentos) {
    const trimSeg = seg.trim();
    if (!trimSeg) continue;

    const cantInicial = trimSeg.match(
      /^(\d+)\s+(?:unidades?\s+(?:de\s+)?)?(.+)$/
    );
    const cantidad = cantInicial ? Math.max(1, Number(cantInicial[1])) : 1;
    const restoProducto = cantInicial ? cantInicial[2] : trimSeg;

    const prod = buscarMejorProductoEnCatalogo(restoProducto, catalogo);
    if (prod) {
      itemsDetectados.push({
        productoId: prod.id,
        producto_nombre: prod.nombreProducto,
        cantidad,
      });
    } else if (esVentaExplicita && restoProducto.length > 2) {
      itemsDetectados.push({
        producto_nombre: restoProducto,
        cantidad,
      });
    }
  }

  if (itemsDetectados.length > 0) {
    return {
      name: "registrar_venta_voz",
      args: { items: itemsDetectados },
    };
  }

  return null;
}

// ============================================================================
// UTILIDADES DE NEGOCIO Y DECLARACIÓN DE HERRAMIENTAS GEMINI
// ============================================================================

function calcularEstadoLoteServidor(
  stockActual: number,
  fechaVencimiento: Date | null,
  referencia: Date
): EstadoLote {
  if (stockActual <= 0) return EstadoLote.AGOTADO;
  if (!fechaVencimiento) return EstadoLote.ACTIVO;

  const inicioHoy = new Date(
    referencia.getFullYear(),
    referencia.getMonth(),
    referencia.getDate()
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

function formatearFechaCortaEs(fecha: Date): string {
  return fecha.toLocaleDateString("es-BO", {
    day: "numeric",
    month: "long",
  });
}

function serializarProductoCliente(p: CatalogoCurado) {
  return {
    id: p.id,
    codigoBarras: p.codigoBarras,
    nombreProducto: p.nombreProducto,
    marca: p.marca,
    categoria: p.categoria,
    unidadMedida: p.unidadMedida,
    imagenUrl: p.imagenUrl,
  };
}

function serializarLoteCliente(l: InventarioLote, referencia: Date) {
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
    estado: calcularEstadoLoteServidor(
      l.stockActual,
      l.fechaVencimiento,
      referencia
    ),
    sincronizado: true,
  };
}

async function resolverUsuarioYComercio(
  usuarioId?: string,
  comercioId?: string
) {
  let usuario = usuarioId
    ? await prisma.usuario.findUnique({
        where: { id: usuarioId },
        include: { comercio: true },
      })
    : null;

  if (!usuario) {
    usuario = await prisma.usuario.findUnique({
      where: { email: "martha@stockia.bo" },
      include: { comercio: true },
    });
  }

  if (!usuario) {
    usuario = await prisma.usuario.findFirst({
      where: { rol: "COMERCIANTE" },
      include: { comercio: true },
    });
  }

  if (!usuario) return null;

  let comercio = usuario.comercio;
  if (!comercio && comercioId) {
    comercio = await prisma.comercio.findUnique({ where: { id: comercioId } });
  }
  if (!comercio) {
    comercio = await prisma.comercio.findFirst();
  }
  if (!comercio) return null;

  const ahora = new Date();
  if (!esMismoDiaLocal(usuario.fechaResetVoz, ahora)) {
    usuario = await prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        comandosVozHoy: 0,
        fechaResetVoz: ahora,
      },
      include: { comercio: true },
    });
  }

  return { usuario, comercio };
}

const DECLARACIONES_HERRAMIENTAS: FunctionDeclaration[] = [
  {
    name: "registrar_lote_inventario",
    description:
      'Invócala cuando el comerciante quiera registrar, aumentar, agregar, sumar, ingresar mercadería o reponer stock (ej. "registra", "aumenta", "auméntale diez más a ese", "ingresaron", "compré"). Si el producto coincide semánticamente con uno del inventario proporcionado, envía OBLIGATORIAMENTE su `productoId` exacto y `esProductoNuevo: false`. Solo usa `esProductoNuevo: true` si el artículo claramente NO existe en el catálogo actual.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        productoId: {
          type: Type.STRING,
          description:
            "ID exacto del producto en el catálogo proporcionado cuando ya existe en la tienda.",
        },
        producto_nombre: {
          type: Type.STRING,
          description:
            "Nombre oficial del producto en catálogo (o nombre limpio comercial si es un producto nuevo).",
        },
        cantidad: {
          type: Type.NUMBER,
          description:
            "Cantidad entera de unidades/kilos/litros a registrar o sumar.",
        },
        esProductoNuevo: {
          type: Type.BOOLEAN,
          description:
            "true únicamente si el producto NO existe en el listado de inventario actual y debe crearse desde cero.",
        },
        fecha_vencimiento: {
          type: Type.STRING,
          description:
            "Fecha de vencimiento opcional en formato YYYY-MM-DD calculada desde la fecha actual del servidor.",
        },
        precio_compra: {
          type: Type.NUMBER,
          description: "Costo unitario de compra en bolivianos (opcional).",
        },
        precio_venta: {
          type: Type.NUMBER,
          description: "Precio unitario de venta en bolivianos (opcional).",
        },
        categoria: {
          type: Type.STRING,
          description:
            'Categoría del producto (ej. "Bebidas", "Lácteos", "Abarrotes", "Snacks", "Panadería", "Limpieza").',
        },
        unidad_medida: {
          type: Type.STRING,
          enum: ["UNIDAD", "PAQUETE", "CAJA", "LITRO", "KILO"],
          description: 'Unidad de medida (por defecto "UNIDAD").',
        },
      },
      required: ["producto_nombre", "cantidad"],
    },
  },
  {
    name: "crear_producto_catalogo",
    description:
      'Crea un producto totalmente nuevo en el catálogo cuando NO existe en el inventario actual e incluye su precio de venta (ej. "Crea el producto Galletas Oreo a 5 bolivianos con 10 unidades").',
    parameters: {
      type: Type.OBJECT,
      properties: {
        producto_nombre: {
          type: Type.STRING,
          description: "Nombre comercial del nuevo producto.",
        },
        categoria: {
          type: Type.STRING,
          description:
            'Categoría inferida ("Snacks", "Bebidas", "Lácteos", "Abarrotes", "Panadería", "Limpieza").',
        },
        precio_venta: {
          type: Type.NUMBER,
          description: "Precio de venta unitario en bolivianos.",
        },
        stock_inicial: {
          type: Type.NUMBER,
          description: "Unidades iniciales en stock (0 si no se menciona).",
        },
        fecha_vencimiento: {
          type: Type.STRING,
          description: "Fecha de vencimiento opcional YYYY-MM-DD.",
        },
        unidad_medida: {
          type: Type.STRING,
          enum: ["UNIDAD", "PAQUETE", "CAJA", "LITRO", "KILO"],
          description: 'Unidad de medida opcional (por defecto "UNIDAD").',
        },
      },
      required: ["producto_nombre", "categoria", "precio_venta"],
    },
  },
  {
    name: "registrar_venta_voz",
    description:
      'Registra una venta en mostrador descontando stock bajo regla FEFO cuando el comerciante diga "vendí", "cobra", "despacha", "se llevó", etc. Incluye siempre el `productoId` exacto del catálogo.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        items: {
          type: Type.ARRAY,
          description: "Lista de productos y cantidades vendidas.",
          items: {
            type: Type.OBJECT,
            properties: {
              productoId: {
                type: Type.STRING,
                description: "ID exacto del producto en el catálogo.",
              },
              producto_nombre: {
                type: Type.STRING,
                description: "Nombre del producto vendido.",
              },
              cantidad: {
                type: Type.NUMBER,
                description: "Cantidad entera vendida.",
              },
            },
            required: ["producto_nombre", "cantidad"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "consultar_stock",
    description:
      'Consulta existencias o estado de un producto cuando el comerciante pregunte "¿cuánto tengo?", "¿quedan?", "se me acabaron los...", etc. Envía el `productoId` exacto.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        productoId: {
          type: Type.STRING,
          description: "ID exacto del producto en el catálogo.",
        },
        producto_nombre: {
          type: Type.STRING,
          description: "Nombre del producto a consultar.",
        },
      },
      required: ["producto_nombre"],
    },
  },
  {
    name: "consultar_por_vencer",
    description:
      "Consulta qué productos o lotes activos están próximos a vencer en los próximos días (alerta FEFO).",
    parameters: {
      type: Type.OBJECT,
      properties: {
        dias_limite: {
          type: Type.NUMBER,
          description:
            "Ventana de días hacia adelante para buscar vencimientos (por defecto 7).",
        },
      },
    },
  },
];

export async function GET(request: Request) {
  await connection();
  const { searchParams } = new URL(request.url);
  const usuarioId = searchParams.get("usuarioId") ?? undefined;
  const comercioId = searchParams.get("comercioId") ?? undefined;

  const contexto = await resolverUsuarioYComercio(usuarioId, comercioId);
  if (!contexto) {
    return NextResponse.json(
      { ok: false, error: "Usuario comerciante no encontrado." },
      { status: 404 }
    );
  }

  const { usuario, comercio } = contexto;
  const restantes =
    usuario.plan === PlanSuscripcion.VOZ_PRO
      ? null
      : Math.max(0, LIMITE_GRATIS_DIARIO - usuario.comandosVozHoy);

  return NextResponse.json({
    ok: true,
    usuarioId: usuario.id,
    comercioId: comercio.id,
    cuota: {
      plan: usuario.plan,
      usados: usuario.comandosVozHoy,
      limite: LIMITE_GRATIS_DIARIO,
      restantes,
    },
  });
}

export async function PATCH(request: Request) {
  const body = (await request.json()) as {
    usuarioId?: string;
    plan?: "BASICO_GRATIS" | "VOZ_PRO";
  };

  const contexto = await resolverUsuarioYComercio(body.usuarioId);
  if (!contexto || !body.plan) {
    return NextResponse.json(
      { ok: false, error: "Datos inválidos." },
      { status: 400 }
    );
  }

  const actualizado = await prisma.usuario.update({
    where: { id: contexto.usuario.id },
    data: { plan: body.plan },
  });

  return NextResponse.json({
    ok: true,
    cuota: {
      plan: actualizado.plan,
      usados: actualizado.comandosVozHoy,
      limite: LIMITE_GRATIS_DIARIO,
      restantes:
        actualizado.plan === PlanSuscripcion.VOZ_PRO
          ? null
          : Math.max(0, LIMITE_GRATIS_DIARIO - actualizado.comandosVozHoy),
    },
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      textoComando?: string;
      usuarioId?: string;
      comercioId?: string;
      historial?: TurnoConversacionVoz[];
    };

    const textoComando = (body.textoComando ?? "").trim();
    if (!textoComando) {
      return NextResponse.json(
        { ok: false, error: "No se recibió ningún comando de voz." },
        { status: 400 }
      );
    }

    // Sanitizar memoria conversacional (últimos 6 intercambios = 12 mensajes máx.)
    const historialLimpio: TurnoConversacionVoz[] = Array.isArray(body.historial)
      ? body.historial
          .filter(
            (h) =>
              h &&
              (h.role === "user" || h.role === "model") &&
              typeof h.text === "string" &&
              h.text.trim().length > 0
          )
          .slice(-12)
          .map((h) => ({
            role: h.role,
            text: h.text.trim(),
          }))
      : [];

    const contexto = await resolverUsuarioYComercio(
      body.usuarioId,
      body.comercioId
    );
    if (!contexto) {
      return NextResponse.json(
        {
          ok: false,
          error: "Comercio no encontrado. Verifica que la base tenga el seed.",
        },
        { status: 404 }
      );
    }

    const { usuario, comercio } = contexto;

    // Verificar si este mensaje responde a una pregunta de aclaración previa de la IA
    const ultimoTurnoModelo = [...historialLimpio]
      .reverse()
      .find((h) => h.role === "model");
    const esRespuestaAAclaracion = Boolean(
      ultimoTurnoModelo?.text.trim().endsWith("?")
    );

    // 1. Control de Cuota Freemium
    if (
      usuario.plan === PlanSuscripcion.BASICO_GRATIS &&
      usuario.comandosVozHoy >= LIMITE_GRATIS_DIARIO &&
      !esRespuestaAAclaracion
    ) {
      return NextResponse.json({
        ok: false,
        estado: "LIMITE_ALCANZADO",
        mensajeVoz:
          "Agotaste tus 15 comandos gratuitos de hoy. Activa Voz Pro por 25 bolivianos al mes para hablar sin límites.",
        operacion: {
          tipo: "LIMITE_ALCANZADO",
          titulo: "Límite diario gratuito alcanzado (15/15)",
          detalle:
            "Pásate al Plan Asistente Voz Pro (Bs 25/mes) en Mi Plan para operar sin límites.",
        },
        cuota: {
          plan: usuario.plan,
          usados: usuario.comandosVozHoy,
          limite: LIMITE_GRATIS_DIARIO,
          restantes: 0,
        },
      });
    }

    const usuarioConCuota = esRespuestaAAclaracion
      ? usuario
      : await prisma.usuario.update({
          where: { id: usuario.id },
          data: { comandosVozHoy: { increment: 1 } },
        });

    const cuotaActual = {
      plan: usuarioConCuota.plan,
      usados: usuarioConCuota.comandosVozHoy,
      limite: LIMITE_GRATIS_DIARIO,
      restantes:
        usuarioConCuota.plan === PlanSuscripcion.VOZ_PRO
          ? null
          : Math.max(0, LIMITE_GRATIS_DIARIO - usuarioConCuota.comandosVozHoy),
    };

    // Consultar contexto real del catálogo e inventario actual del comercio
    const [catalogo, lotesComercio] = await Promise.all([
      prisma.catalogoCurado.findMany({
        orderBy: { nombreProducto: "asc" },
      }),
      prisma.inventarioLote.findMany({
        where: { comercioId: comercio.id },
        orderBy: [{ fechaVencimiento: "asc" }, { fechaIngreso: "desc" }],
      }),
    ]);

    const catalogoPorId = new Map(catalogo.map((c) => [c.id, c]));
    const ahoraServidor = new Date();

    // Construir listado compacto con ID, nombre, marca, categoría, stockTotal y precioVenta
    const resumenPorProducto = new Map<
      string,
      { stockTotal: number; precioVenta: number }
    >();

    for (const lote of lotesComercio) {
      const estadoVig = calcularEstadoLoteServidor(
        lote.stockActual,
        lote.fechaVencimiento,
        ahoraServidor
      );
      const actual = resumenPorProducto.get(lote.productoId) ?? {
        stockTotal: 0,
        precioVenta: Number(lote.precioVenta),
      };
      if (lote.stockActual > 0 && estadoVig !== EstadoLote.VENCIDO) {
        actual.stockTotal += lote.stockActual;
        actual.precioVenta = Number(lote.precioVenta);
      }
      resumenPorProducto.set(lote.productoId, actual);
    }

    const contextoInventarioReal = catalogo
      .map((c) => {
        const info = resumenPorProducto.get(c.id);
        const stock = info?.stockTotal ?? 0;
        const precio = info ? `Bs ${info.precioVenta.toFixed(2)}` : "s/p";
        return `[id:${c.id}] ${c.nombreProducto} | Marca:${c.marca} | Cat:${c.categoria} | Stock:${stock} ${c.unidadMedida.toLowerCase()} | ${precio}`;
      })
      .join("\n");

    const fechaIsoServidor = formatearYYYYMMDD(ahoraServidor);
    const fechaHumanaServidor = ahoraServidor.toLocaleDateString("es-BO", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const systemInstruction = `Eres StockIA, asistente de mostrador ágil, cercano y preciso para "${comercio.nombreTienda}" en ${comercio.macrodistrito}, Bolivia.
Fecha actual del servidor: ${fechaIsoServidor} (${fechaHumanaServidor}). Convierte fechas relativas ("mañana", "en dos semanas", "en diciembre", "el 11 de febrero") a YYYY-MM-DD tomando ${fechaIsoServidor} como base.

INVENTARIO Y CATÁLOGO REAL DE LA TIENDA:
${contextoInventarioReal}

REGLAS DE RAZONAMIENTO SEMÁNTICO Y CONVERSACIONAL:
1. Interpreta con naturalidad jerga boliviana, abreviaciones, plurales, descripciones indirectas y referencias a turnos previos del chat (ej. "la gaseosa negra de dos litros" = Coca-Cola 2L; "fideo largo" = Fideo Lazaroni; "auméntale diez más a ese" = usa el producto del turno previo; "se me acabaron los pilfrut" = consulta o alerta de stock de Pilfrut).
2. Si el producto mencionado coincide semánticamente con uno del inventario listado arriba, envía OBLIGATORIAMENTE su \`productoId\` exacto (el valor tras \`id:\`) en las herramientas (\`registrar_lote_inventario\`, \`registrar_venta_voz\`, \`consultar_stock\`) y \`esProductoNuevo: false\`.
3. AMBIGÜEDAD REAL: Si el comerciante pide una operación pero hay dos o más productos muy parecidos en el catálogo (ej. dos sabores o presentaciones distintas y solo dijo la marca general) y el historial reciente no lo aclara, NO adivines ni crees un producto duplicado ni llames herramientas todavía: responde con una sola pregunta corta y amable terminada en "?" para confirmar cuál es (ej. "¿Cuál quieres registrar, Leche Pil Natural o Chicolac Pil?").
4. Solo crea un producto nuevo (\`esProductoNuevo: true\` o \`crear_producto_catalogo\`) cuando el artículo mencionado claramente NO exista en el inventario listado arriba.
5. TONO DE VOZ: Responde como un asistente de tienda boliviano ágil y cálido en MÁXIMO 2 oraciones cortas, sin tecnicismos ni listas largas.`;

    // Construir contents multi-turno combinando historial de sesión + comando actual
    const contentsConversacion = [
      ...historialLimpio.map((turno) => ({
        role: turno.role,
        parts: [{ text: turno.text }],
      })),
      {
        role: "user" as const,
        parts: [{ text: textoComando }],
      },
    ];

    // 2. Cascada tolerante a fallos: gemini-2.5-flash -> 500ms -> gemini-2.5-flash-lite -> 500ms -> gemini-2.0-flash
    let llamadasNormalizadas: LlamadaHerramientaNormalizada[] = [];
    let textoConversacionalDirecto: string | null = null;
    let motorUtilizado = "parser-local-respaldo";
    let geminiRespondioExitosamente = false;

    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      const ai = new GoogleGenAI({ apiKey });

      for (let i = 0; i < MODELOS_CASCADA.length; i += 1) {
        const modeloCandidato = MODELOS_CASCADA[i];
        try {
          const respuestaGemini = await ai.models.generateContent({
            model: modeloCandidato,
            contents: contentsConversacion,
            config: {
              systemInstruction,
              tools: [{ functionDeclarations: DECLARACIONES_HERRAMIENTAS }],
              temperature: 0.15,
            },
          });

          const fnCalls = respuestaGemini.functionCalls ?? [];
          if (fnCalls.length > 0) {
            llamadasNormalizadas = fnCalls
              .filter((fc) => Boolean(fc.name))
              .map((fc) => ({
                name: fc.name as string,
                args: (fc.args ?? {}) as Record<string, unknown>,
              }));
          } else if (respuestaGemini.text?.trim()) {
            textoConversacionalDirecto = respuestaGemini.text.trim();
          }

          motorUtilizado = modeloCandidato;
          geminiRespondioExitosamente = true;
          break;
        } catch (errModelo) {
          console.warn(
            `[VoiceAssistant] Falló modelo ${modeloCandidato}:`,
            errModelo instanceof Error ? errModelo.message : errModelo
          );

          const haySiguienteModelo = i < MODELOS_CASCADA.length - 1;
          if (haySiguienteModelo && esErrorReintentable(errModelo)) {
            await esperarMs(RETARDO_REINTENTO_MS);
            continue;
          }
          if (haySiguienteModelo) {
            await esperarMs(RETARDO_REINTENTO_MS);
            continue;
          }
        }
      }
    }

    // 3. Si Gemini hizo una pregunta de desambiguación o respuesta conversacional deliberada, respetarla
    if (llamadasNormalizadas.length === 0) {
      if (geminiRespondioExitosamente && textoConversacionalDirecto) {
        const esPreguntaAclaracion = textoConversacionalDirecto
          .trim()
          .endsWith("?");
        return NextResponse.json({
          ok: true,
          estado: "EJECUTADO",
          motor: motorUtilizado,
          esperaRespuestaUsuario: esPreguntaAclaracion,
          mensajeVoz: textoConversacionalDirecto,
          operacion: {
            tipo: esPreguntaAclaracion ? "ACLARACION" : "CONVERSACION",
            titulo: esPreguntaAclaracion
              ? "¿Me confirmas el producto?"
              : "Asistente StockIA",
            detalle: textoConversacionalDirecto,
          },
          undoToken: null,
          mutoBaseDatos: false,
          cuota: cuotaActual,
        });
      }

      // Respaldo local determinista si todos los modelos de la nube fallaron
      const interpretacionLocal = interpretarComandoLocalRespaldo(
        textoComando,
        catalogo,
        ahoraServidor,
        historialLimpio
      );
      if (interpretacionLocal) {
        llamadasNormalizadas = [interpretacionLocal];
        motorUtilizado = "parser-local-respaldo";
      } else {
        const guia =
          "Te escucho. Dime por ejemplo: vendí 2 Coca-Cola, cuánto tengo de Arroz Grano de Oro o aumenta 10 unidades.";
        return NextResponse.json({
          ok: true,
          estado: "EJECUTADO",
          motor: motorUtilizado,
          esperaRespuestaUsuario: false,
          mensajeVoz: guia,
          operacion: {
            tipo: "CONVERSACION",
            titulo: "Asistente StockIA",
            detalle: guia,
          },
          undoToken: null,
          mutoBaseDatos: false,
          cuota: cuotaActual,
        });
      }
    }

    // 4. Ejecución transaccional en PostgreSQL + deltas instantáneos para Dexie.js
    let ultimoUndoToken: string | null = null;
    let mutoBaseDatos = false;
    const productosActualizadosCliente: Array<
      ReturnType<typeof serializarProductoCliente>
    > = [];
    const lotesActualizadosCliente: Array<
      ReturnType<typeof serializarLoteCliente>
    > = [];

    let resumenOperacion = {
      tipo: "CONSULTA",
      titulo: "Consulta ejecutada",
      detalle: "",
    };
    let mensajeFinalVoz = "";

    for (const paso of llamadasNormalizadas) {
      const args = paso.args;

      // ----------------------------------------------------------------------
      // FUNCIÓN 1 y 2: registrar_lote_inventario / crear_producto_catalogo
      // ----------------------------------------------------------------------
      if (
        paso.name === "registrar_lote_inventario" ||
        paso.name === "crear_producto_catalogo"
      ) {
        const esAltaDedicada = paso.name === "crear_producto_catalogo";
        const productoIdArg = args.productoId
          ? String(args.productoId).trim()
          : null;
        const nombreRaw = String(args.producto_nombre ?? "").trim();
        const esNuevoExplicito =
          esAltaDedicada || Boolean(args.esProductoNuevo);

        if (!nombreRaw && !productoIdArg) {
          mensajeFinalVoz = "¿De qué producto quieres registrar las unidades?";
          resumenOperacion = {
            tipo: "ACLARACION",
            titulo: "Confirma el producto",
            detalle: mensajeFinalVoz,
          };
          continue;
        }

        const cantidad = esAltaDedicada
          ? Math.max(0, Math.round(Number(args.stock_inicial ?? 0)))
          : Math.max(1, Math.round(Number(args.cantidad ?? 1)));

        const fechaVencStr = args.fecha_vencimiento
          ? String(args.fecha_vencimiento)
          : null;
        const fechaVencDate =
          fechaVencStr && !Number.isNaN(Date.parse(`${fechaVencStr}T23:59:59`))
            ? new Date(`${fechaVencStr}T23:59:59`)
            : null;

        const categoriaInferida =
          args.categoria && String(args.categoria).trim()
            ? capitalizarNombreProducto(String(args.categoria))
            : inferirCategoriaPorNombre(nombreRaw);
        const unidadMedida = normalizarUnidadMedida(args.unidad_medida);

        let producto = await resolverProductoSemantica({
          productoId: productoIdArg,
          nombreBuscado: nombreRaw,
          catalogoCache: catalogo,
          catalogoPorId,
        });

        let fueProductoNuevo = false;

        if (!producto) {
          if (!esNuevoExplicito && geminiRespondioExitosamente) {
            // Intento secundario flexible antes de crear para no duplicar accidentalmente
            producto = buscarMejorProductoEnCatalogo(
              nombreRaw,
              catalogo,
              catalogoPorId,
              productoIdArg
            );
          }

          if (!producto) {
            const nombreCapitalizado = capitalizarNombreProducto(
              nombreRaw || "Producto Nuevo"
            );
            const codigoInterno = `INT-${Date.now()}${Math.floor(Math.random() * 10)}`;
            const primeraPalabraMarca =
              nombreCapitalizado.split(" ").find((w) => w.length > 2) ?? "Local";

            producto = await prisma.catalogoCurado.create({
              data: {
                codigoBarras: codigoInterno,
                nombreProducto: nombreCapitalizado,
                marca: primeraPalabraMarca,
                categoria: categoriaInferida,
                unidadMedida,
              },
            });

            catalogo.push(producto);
            catalogoPorId.set(producto.id, producto);
            fueProductoNuevo = true;
          }
        }

        productosActualizadosCliente.push(serializarProductoCliente(producto));

        const lotePrevio = await prisma.inventarioLote.findFirst({
          where: { comercioId: comercio.id, productoId: producto.id },
          orderBy: { fechaIngreso: "desc" },
        });

        const precioVentaExplicito =
          args.precio_venta !== undefined && Number(args.precio_venta) > 0
            ? Number(args.precio_venta)
            : null;
        const precioCompraExplicito =
          args.precio_compra !== undefined && Number(args.precio_compra) > 0
            ? Number(args.precio_compra)
            : null;

        const precioVentaNum =
          precioVentaExplicito ??
          (lotePrevio ? Number(lotePrevio.precioVenta) : 10.0);

        const precioCompraNum =
          precioCompraExplicito ??
          (lotePrevio
            ? Number(lotePrevio.precioCompra)
            : Number((precioVentaNum * 0.78).toFixed(2)));

        let loteCoincidente: InventarioLote | null = null;
        if (!fueProductoNuevo && cantidad > 0) {
          const lotesActivosProd = await prisma.inventarioLote.findMany({
            where: {
              comercioId: comercio.id,
              productoId: producto.id,
              estado: { in: [EstadoLote.ACTIVO, EstadoLote.POR_VENCER] },
            },
            orderBy: { fechaIngreso: "desc" },
          });

          if (fechaVencDate) {
            loteCoincidente =
              lotesActivosProd.find(
                (l) =>
                  l.fechaVencimiento &&
                  esMismoDiaLocal(l.fechaVencimiento, fechaVencDate)
              ) ?? null;
          } else {
            loteCoincidente =
              lotesActivosProd.find((l) => l.fechaVencimiento === null) ??
              lotesActivosProd[0] ??
              null;
          }
        }

        let loteResultado: InventarioLote;

        if (loteCoincidente && cantidad > 0) {
          const nuevoStock = loteCoincidente.stockActual + cantidad;
          const nuevoEstado = calcularEstadoLoteServidor(
            nuevoStock,
            loteCoincidente.fechaVencimiento,
            ahoraServidor
          );

          loteResultado = await prisma.inventarioLote.update({
            where: { id: loteCoincidente.id },
            data: {
              stockActual: nuevoStock,
              ...(precioVentaExplicito
                ? {
                    precioVenta: new Prisma.Decimal(
                      precioVentaExplicito.toFixed(2)
                    ),
                  }
                : {}),
              ...(precioCompraExplicito
                ? {
                    precioCompra: new Prisma.Decimal(
                      precioCompraExplicito.toFixed(2)
                    ),
                  }
                : {}),
              estado: nuevoEstado,
            },
          });

          ultimoUndoToken = guardarOperacionDeshacer({
            usuarioId: usuario.id,
            descontoCuota:
              usuario.plan === PlanSuscripcion.BASICO_GRATIS &&
              !esRespuestaAAclaracion,
            tipo: "INCREMENTO_LOTE",
            loteId: loteResultado.id,
            cantidadSumada: cantidad,
            descripcion: `Aumento de +${cantidad} en ${producto.nombreProducto}`,
          });

          mensajeFinalVoz = `Listo, sumé ${cantidad} a ${producto.nombreProducto}. Ahora tienes ${loteResultado.stockActual} disponibles.`;
          resumenOperacion = {
            tipo: "INCREMENTO_STOCK",
            titulo: `Stock aumentado: +${cantidad} ${producto.nombreProducto}`,
            detalle: `Total en lote: ${loteResultado.stockActual} · Bs ${Number(loteResultado.precioVenta).toFixed(2)}`,
          };
        } else {
          const estadoInicial = calcularEstadoLoteServidor(
            cantidad,
            fechaVencDate,
            ahoraServidor
          );

          loteResultado = await prisma.inventarioLote.create({
            data: {
              comercioId: comercio.id,
              productoId: producto.id,
              stockActual: cantidad,
              precioCompra: new Prisma.Decimal(precioCompraNum.toFixed(2)),
              precioVenta: new Prisma.Decimal(precioVentaNum.toFixed(2)),
              fechaVencimiento: fechaVencDate,
              estado: estadoInicial,
            },
          });

          const textoVenc = fechaVencDate
            ? ` con vencimiento el ${formatearFechaCortaEs(fechaVencDate)}`
            : "";

          ultimoUndoToken = guardarOperacionDeshacer({
            usuarioId: usuario.id,
            descontoCuota:
              usuario.plan === PlanSuscripcion.BASICO_GRATIS &&
              !esRespuestaAAclaracion,
            tipo: "INGRESO_LOTE",
            loteId: loteResultado.id,
            productoCreadoId: fueProductoNuevo ? producto.id : null,
            descripcion: fueProductoNuevo
              ? `Creación de ${producto.nombreProducto} con ${cantidad} u.`
              : `Ingreso de ${cantidad} u. de ${producto.nombreProducto}`,
          });

          if (fueProductoNuevo) {
            mensajeFinalVoz =
              cantidad > 0
                ? `Listo, creé ${producto.nombreProducto} a ${precioVentaNum.toFixed(2)} bolivianos con ${cantidad} unidades${textoVenc}.`
                : `Listo, registré el nuevo producto ${producto.nombreProducto} a ${precioVentaNum.toFixed(2)} bolivianos.`;
            resumenOperacion = {
              tipo: "NUEVO_PRODUCTO",
              titulo: `Nuevo producto: ${producto.nombreProducto}`,
              detalle: `Stock: ${cantidad} u. · Bs ${precioVentaNum.toFixed(2)}${textoVenc}`,
            };
          } else {
            mensajeFinalVoz = `Listo, ingresé ${cantidad} de ${producto.nombreProducto}${textoVenc}.`;
            resumenOperacion = {
              tipo: "INGRESO_LOTE",
              titulo: `Ingreso: +${cantidad} ${producto.nombreProducto}`,
              detalle: `Precio Bs ${precioVentaNum.toFixed(2)}${textoVenc}`,
            };
          }
        }

        mutoBaseDatos = true;
        lotesActualizadosCliente.push(
          serializarLoteCliente(loteResultado, ahoraServidor)
        );
      }

      // ----------------------------------------------------------------------
      // FUNCIÓN 3: registrar_venta_voz (Regla FEFO estricta)
      // ----------------------------------------------------------------------
      else if (paso.name === "registrar_venta_voz") {
        const itemsRaw = Array.isArray(args.items) ? args.items : [];
        if (itemsRaw.length === 0) {
          mensajeFinalVoz = "¿Qué producto y cuántas unidades vendiste?";
          resumenOperacion = {
            tipo: "ACLARACION",
            titulo: "Confirma la venta",
            detalle: mensajeFinalVoz,
          };
        } else {
          try {
            const txResult = await prisma.$transaction(async (tx) => {
              const detallesCrear: Array<{
                loteId: string;
                productoId: string;
                nombreProducto: string;
                cantidad: number;
                precioUnitario: number;
                subtotal: number;
              }> = [];

              const restauracionesLotes: Array<{
                loteId: string;
                cantidadRestaurada: number;
              }> = [];

              const lotesModificadosTx: InventarioLote[] = [];
              const resumenItemsTexto: string[] = [];
              let totalVenta = 0;

              for (const raw of itemsRaw) {
                const obj = raw as Record<string, unknown>;
                const idBuscado = obj.productoId
                  ? String(obj.productoId)
                  : null;
                const nombreBuscado = String(obj.producto_nombre ?? "");
                const cantSolicitada = Math.max(
                  1,
                  Math.round(Number(obj.cantidad ?? 1))
                );

                const prod = buscarMejorProductoEnCatalogo(
                  nombreBuscado,
                  catalogo,
                  catalogoPorId,
                  idBuscado
                );
                if (!prod) {
                  throw new Error(
                    `No encontré "${nombreBuscado}" en tu inventario.`
                  );
                }

                const lotesCandidatos = await tx.inventarioLote.findMany({
                  where: {
                    comercioId: comercio.id,
                    productoId: prod.id,
                    stockActual: { gt: 0 },
                  },
                });

                const lotesFEFO = lotesCandidatos
                  .filter(
                    (l) =>
                      calcularEstadoLoteServidor(
                        l.stockActual,
                        l.fechaVencimiento,
                        ahoraServidor
                      ) !== EstadoLote.VENCIDO
                  )
                  .sort((a, b) => {
                    if (a.fechaVencimiento && b.fechaVencimiento) {
                      return (
                        a.fechaVencimiento.getTime() -
                        b.fechaVencimiento.getTime()
                      );
                    }
                    if (a.fechaVencimiento && !b.fechaVencimiento) return -1;
                    if (!a.fechaVencimiento && b.fechaVencimiento) return 1;
                    return a.fechaIngreso.getTime() - b.fechaIngreso.getTime();
                  });

                const disponibleTotal = lotesFEFO.reduce(
                  (s, l) => s + l.stockActual,
                  0
                );

                if (disponibleTotal < cantSolicitada) {
                  throw new Error(
                    `Solo te quedan ${disponibleTotal} de ${prod.nombreProducto} y pediste vender ${cantSolicitada}.`
                  );
                }

                let faltante = cantSolicitada;

                for (const lote of lotesFEFO) {
                  if (faltante <= 0) break;
                  const tomar = Math.min(lote.stockActual, faltante);
                  const nuevoStock = lote.stockActual - tomar;
                  const nuevoEstado = calcularEstadoLoteServidor(
                    nuevoStock,
                    lote.fechaVencimiento,
                    ahoraServidor
                  );

                  const loteUpd = await tx.inventarioLote.update({
                    where: { id: lote.id },
                    data: {
                      stockActual: nuevoStock,
                      estado: nuevoEstado,
                    },
                  });
                  lotesModificadosTx.push(loteUpd);

                  const pUnit = Number(lote.precioVenta);
                  const sub = Number((tomar * pUnit).toFixed(2));
                  totalVenta = Number((totalVenta + sub).toFixed(2));

                  detallesCrear.push({
                    loteId: lote.id,
                    productoId: prod.id,
                    nombreProducto: prod.nombreProducto,
                    cantidad: tomar,
                    precioUnitario: pUnit,
                    subtotal: sub,
                  });

                  restauracionesLotes.push({
                    loteId: lote.id,
                    cantidadRestaurada: tomar,
                  });

                  faltante -= tomar;
                }

                resumenItemsTexto.push(
                  `${cantSolicitada} ${prod.nombreProducto}`
                );
              }

              const ventaCreada = await tx.venta.create({
                data: {
                  comercioId: comercio.id,
                  totalBs: new Prisma.Decimal(totalVenta.toFixed(2)),
                  metodoRegistro: MetodoRegistro.VOZ,
                  sincronizadoOffline: false,
                  detalles: {
                    create: detallesCrear.map((d) => ({
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

              return {
                ventaId: ventaCreada.id,
                totalVenta,
                resumenItemsTexto,
                restauracionesLotes,
                lotesModificadosTx,
              };
            });

            mutoBaseDatos = true;
            for (const lMod of txResult.lotesModificadosTx) {
              lotesActualizadosCliente.push(
                serializarLoteCliente(lMod, ahoraServidor)
              );
            }

            const listaTexto = txResult.resumenItemsTexto.join(", ");

            ultimoUndoToken = guardarOperacionDeshacer({
              usuarioId: usuario.id,
              descontoCuota:
                usuario.plan === PlanSuscripcion.BASICO_GRATIS &&
                !esRespuestaAAclaracion,
              tipo: "VENTA",
              ventaId: txResult.ventaId,
              restauracionesLotes: txResult.restauracionesLotes,
              descripcion: `Venta de ${listaTexto} (Bs ${txResult.totalVenta.toFixed(2)})`,
            });

            mensajeFinalVoz = `Anote la venta de ${listaTexto}. Son ${txResult.totalVenta.toFixed(2)} bolivianos.`;
            resumenOperacion = {
              tipo: "VENTA_VOZ",
              titulo: `Venta cobrada: Bs ${txResult.totalVenta.toFixed(2)}`,
              detalle: `${listaTexto} · Despacho FEFO aplicado`,
            };
          } catch (errVenta) {
            const msgErr =
              errVenta instanceof Error
                ? errVenta.message
                : "No se pudo completar la venta.";
            mensajeFinalVoz = msgErr;
            resumenOperacion = {
              tipo: "ERROR",
              titulo: "Stock insuficiente o error",
              detalle: msgErr,
            };
          }
        }
      }

      // ----------------------------------------------------------------------
      // FUNCIÓN 4: consultar_stock
      // ----------------------------------------------------------------------
      else if (paso.name === "consultar_stock") {
        const prodId = args.productoId ? String(args.productoId) : null;
        const prodNombre = String(args.producto_nombre ?? "");
        const prod = buscarMejorProductoEnCatalogo(
          prodNombre,
          catalogo,
          catalogoPorId,
          prodId
        );

        if (!prod) {
          mensajeFinalVoz = `No encontré ${prodNombre} registrado en tu tienda.`;
          resumenOperacion = {
            tipo: "CONSULTA_STOCK",
            titulo: "Producto no registrado",
            detalle: mensajeFinalVoz,
          };
        } else {
          const lotesProd = await prisma.inventarioLote.findMany({
            where: {
              comercioId: comercio.id,
              productoId: prod.id,
              stockActual: { gt: 0 },
            },
            orderBy: { fechaVencimiento: "asc" },
          });

          const totalUnidades = lotesProd.reduce(
            (s, l) => s + l.stockActual,
            0
          );

          const unidadTxt =
            prod.unidadMedida === "KILO"
              ? "kilos"
              : prod.unidadMedida === "LITRO"
                ? "litros"
                : "unidades";

          const detalleLotes = lotesProd.map((l) => ({
            unidades: l.stockActual,
            precioVenta: Number(l.precioVenta),
            vence: l.fechaVencimiento
              ? formatearFechaCortaEs(l.fechaVencimiento)
              : "sin vencimiento",
          }));

          mensajeFinalVoz =
            totalUnidades > 0
              ? `Tienes ${totalUnidades} ${unidadTxt} de ${prod.nombreProducto}, a ${detalleLotes[0].precioVenta.toFixed(2)} bolivianos.`
              : `Te quedaste sin stock de ${prod.nombreProducto}. ¿Quieres que registremos un nuevo lote?`;

          resumenOperacion = {
            tipo: "CONSULTA_STOCK",
            titulo: `${prod.nombreProducto}: ${totalUnidades} ${unidadTxt}`,
            detalle:
              detalleLotes.length > 0
                ? detalleLotes
                    .map((d) => `${d.unidades} (vence ${d.vence})`)
                    .join(" · ")
                : "Agotado en inventario",
          };
        }
      }

      // ----------------------------------------------------------------------
      // FUNCIÓN 5: consultar_por_vencer
      // ----------------------------------------------------------------------
      else if (paso.name === "consultar_por_vencer") {
        const diasLimite = Math.max(
          1,
          Math.round(Number(args.dias_limite ?? 7))
        );

        const inicioHoy = new Date(
          ahoraServidor.getFullYear(),
          ahoraServidor.getMonth(),
          ahoraServidor.getDate()
        );
        const fechaTope = new Date(inicioHoy);
        fechaTope.setDate(fechaTope.getDate() + diasLimite);
        fechaTope.setHours(23, 59, 59, 999);

        const lotesProximos = await prisma.inventarioLote.findMany({
          where: {
            comercioId: comercio.id,
            stockActual: { gt: 0 },
            fechaVencimiento: {
              gte: inicioHoy,
              lte: fechaTope,
            },
          },
          include: { producto: true },
          orderBy: { fechaVencimiento: "asc" },
        });

        const lista = lotesProximos.map((l) => ({
          producto: l.producto.nombreProducto,
          unidades: l.stockActual,
          vence: l.fechaVencimiento
            ? formatearFechaCortaEs(l.fechaVencimiento)
            : "",
        }));

        if (lista.length === 0) {
          mensajeFinalVoz = `Todo tranquilo, no tienes productos por vencer en los próximos ${diasLimite} días.`;
        } else if (lista.length <= 2) {
          mensajeFinalVoz = `Atención: tienes ${lista
            .map((x) => `${x.unidades} de ${x.producto} que vencen el ${x.vence}`)
            .join(" y ")}.`;
        } else {
          const primero = lista[0];
          mensajeFinalVoz = `Tienes ${lista.length} lotes próximos a vencer; el más urgente son ${primero.unidades} de ${primero.producto} el ${primero.vence}.`;
        }

        resumenOperacion = {
          tipo: "CONSULTA_FEFO",
          titulo: `${lista.length} lote(s) por vencer (≤ ${diasLimite} días)`,
          detalle:
            lista.length > 0
              ? lista
                  .map((x) => `${x.producto}: ${x.unidades} u. (${x.vence})`)
                  .join(" · ")
              : "Inventario sin vencimientos cercanos",
        };
      }
    }

    const terminaEnPregunta = mensajeFinalVoz.trim().endsWith("?");

    return NextResponse.json({
      ok: true,
      estado: "EJECUTADO",
      motor: motorUtilizado,
      esperaRespuestaUsuario: terminaEnPregunta,
      mensajeVoz: mensajeFinalVoz,
      operacion: resumenOperacion,
      undoToken: ultimoUndoToken,
      mutoBaseDatos,
      cambiosLocales: {
        productos: productosActualizadosCliente,
        lotes: lotesActualizadosCliente,
      },
      cuota: cuotaActual,
    });
  } catch (error) {
    console.error("[POST /api/voice-assistant] Error:", error);
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Error procesando comando de voz.",
      },
      { status: 500 }
    );
  }
}
