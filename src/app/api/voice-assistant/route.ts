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
} from "@/generated/prisma/client";
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
]);

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
        return palabra.toUpperCase().replace("ML", "ml").replace("KG", "kg").replace("GR", "g");
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
  if (/\b(coca|soda|refresco|agua|jugo|cerveza|maltin|cascada|fanta|sprite|pepsi)\b/.test(n)) {
    return "Bebidas";
  }
  if (/\b(leche|yogurt|pilfrut|queso|mantequilla|helado|chicolac)\b/.test(n)) {
    return "Lácteos";
  }
  if (/\b(galleta|galletas|oreo|papas|snack|chocolate|caramelo|dulce|chizito)\b/.test(n)) {
    return "Snacks";
  }
  if (/\b(pan|molde|queque|torta|empanada)\b/.test(n)) {
    return "Panadería";
  }
  if (/\b(detergente|jabon|lavavajillas|cloro|lavandina|papel higienico|shampoo|limpieza)\b/.test(n)) {
    return "Limpieza";
  }
  return "Abarrotes";
}

/**
 * Busca en CatalogoCurado primero con Prisma `contains` insensible a mayúsculas,
 * y luego verifica coincidencia estricta de todas las palabras distintivas
 * (evitando confundir un producto nuevo como "Galletas Oreo" con "Galletas Mabel's").
 */
async function buscarProductoExistentePreciso(
  nombreBuscado: string,
  catalogoCache: CatalogoCurado[]
): Promise<CatalogoCurado | null> {
  const limpio = nombreBuscado.trim();
  if (!limpio) return null;

  // 1. Búsqueda directa en PostgreSQL con `contains` e `insensitive`
  const coincidenciaDirectaDb = await prisma.catalogoCurado.findFirst({
    where: {
      OR: [
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

  // 2. Búsqueda normalizada sin guiones/acentos exigiendo que TODAS las palabras distintivas coincidan
  const qNorm = normalizarTexto(limpio);
  const tokensDistintivos = qNorm
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

/**
 * Búsqueda flexible para ventas y consultas de stock sobre el catálogo actual.
 */
function buscarMejorProductoEnCatalogo(
  consulta: string,
  catalogo: CatalogoCurado[]
): CatalogoCurado | null {
  const qNorm = normalizarTexto(consulta);
  if (!qNorm) return null;

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

// ============================================================================
// PARSER LOCAL DE RESPALDO EN ESPAÑOL (TOLERANTE A CAÍDA DE NUBE / 503)
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

  return undefined;
}

function extraerPrecioVentaTexto(textoOriginal: string): number | undefined {
  const m = textoOriginal
    .toLowerCase()
    .match(/(?:a|precio(?:\s+de\s+venta)?)\s+(\d+(?:[.,]\d+)?)\s*(?:bs|bolivianos?)?/i);
  if (!m) return undefined;
  const val = Number(m[1].replace(",", "."));
  return Number.isFinite(val) && val > 0 ? val : undefined;
}

function interpretarComandoLocalRespaldo(
  textoComando: string,
  catalogo: CatalogoCurado[],
  ahoraServidor: Date
): LlamadaHerramientaNormalizada | null {
  const norm = reemplazarPalabrasNumericas(normalizarTexto(textoComando));

  const esCreacionProducto =
    /\b(crea|crear|nuevo producto|da de alta)\b/.test(norm);

  const esIngresoOAumento =
    /\b(registra|registrar|aumenta|aumentar|agrega|agregar|suma|sumar|ingresa|ingresaron|ingreso|llego|llegaron|anade|recibi|compre|sube|nuevo lote)\b/.test(
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
    /\b(stock|cuanto|cuantos|cuantas|queda|quedan|tenemos|tengo|hay|disponible|existencia)\b/.test(
      norm
    );

  // 1. Creación explícita de producto en el catálogo
  if (esCreacionProducto) {
    const fechaVenc = extraerFechaRelativaOExplicita(textoComando, ahoraServidor);
    const precioVenta = extraerPrecioVentaTexto(textoComando) ?? 5;
    const matchUnidades = norm.match(/\bcon\s+(\d+)\s*(?:unidades?|stock)?\b/) ?? norm.match(/\b(\d+)\s+unidades?\b/);
    const stockInicial = matchUnidades ? Number(matchUnidades[1]) : 0;

    const nombreExtraido = norm
      .replace(/^\s*(crea|crear)\s+(el\s+|un\s+)?(nuevo\s+)?(producto\s+)?/, "")
      .replace(/\b(a|precio)\s+\d+(?:\s+\d+)?\s*(bs|bolivianos?)?.*$/, "")
      .replace(/\bcon\s+\d+.*$/, "")
      .trim();

    const nombreLimpiado = capitalizarNombreProducto(nombreExtraido || "Producto Nuevo");

    return {
      name: "crear_producto_catalogo",
      args: {
        producto_nombre: nombreLimpiado,
        categoria: inferirCategoriaPorNombre(nombreLimpiado),
        precio_venta: precioVenta,
        stock_inicial: stockInicial,
        ...(fechaVenc ? { fecha_vencimiento: fechaVenc } : {}),
      },
    };
  }

  // 2. Ingreso de lote o aumento de stock
  if (esIngresoOAumento) {
    const sinColaFecha = norm
      .replace(/\b(que\s+)?(vence|vencen|vencimiento)\b.*$/, " ")
      .replace(/\b(a|precio)\s+\d+\s*(bs|bolivianos?)\b.*$/, " ");

    const matchCant =
      sinColaFecha.match(/\b(\d+)\s+(?:unidades?\s+(?:de\s+)?)?/) ??
      sinColaFecha.match(/\ben\s+(\d+)\b/) ??
      sinColaFecha.match(/\b(\d+)\b/);

    const cantidad = matchCant ? Math.max(1, Number(matchCant[1])) : 1;
    const fechaVenc = extraerFechaRelativaOExplicita(textoComando, ahoraServidor);
    const precioVenta = extraerPrecioVentaTexto(textoComando);

    const nombreCandidato = sinColaFecha
      .replace(
        /\b(registra|registrar|aumenta|aumentar|agrega|agregar|suma|sumar|ingresa|ingresaron|ingreso|llego|llegaron|anade|recibi|compre|sube|el|la|los|las|stock|unidades|unidad|de|del|en|lote|nuevo|producto)\b/g,
        " "
      )
      .replace(/^\s*\d+\s*/, "")
      .replace(/\s+/g, " ")
      .trim();

    return {
      name: "registrar_lote_inventario",
      args: {
        producto_nombre: capitalizarNombreProducto(nombreCandidato || textoComando),
        cantidad,
        categoria: inferirCategoriaPorNombre(nombreCandidato),
        ...(precioVenta ? { precio_venta: precioVenta } : {}),
        ...(fechaVenc ? { fecha_vencimiento: fechaVenc } : {}),
      },
    };
  }

  // 3. Consulta por vencer
  if (esPorVencer) {
    const matchDias = norm.match(/\b(\d+)\s+dias?\b/);
    return {
      name: "consultar_por_vencer",
      args: { dias_limite: matchDias ? Number(matchDias[1]) : 7 },
    };
  }

  // 4. Consulta de stock
  if (esConsultaStock) {
    const limpio = norm
      .replace(
        /\b(cuanto|cuantos|cuantas|stock|queda|quedan|tenemos|tengo|hay|disponible|unidades|de|del|en|tienda|mi)\b/g,
        " "
      )
      .trim();
    const prod = buscarMejorProductoEnCatalogo(limpio || norm, catalogo);
    return {
      name: "consultar_stock",
      args: {
        producto_nombre: prod ? prod.nombreProducto : limpio || textoComando,
      },
    };
  }

  // 5. Registro de venta
  const segmentos = norm
    .replace(
      /^\s*(vendi|vende|vendimos|registra venta de|registra venta|venta de|cobra|cobrar|despacha|se llevo)\s+/,
      ""
    )
    .split(/\s+(?:y|mas|con)\s+|,\s*/);

  const itemsDetectados: Array<{ producto_nombre: string; cantidad: number }> =
    [];

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
      'DEBE invocarse siempre que el comerciante diga: "registra", "aumenta", "agrega", "suma", "ingresa", "llegaron", "compré" o "crea el producto" con unidades para el inventario. Sirve tanto para aumentar el stock de un producto existente como para registrar un producto totalmente nuevo (que se creará automáticamente en el catálogo si aún no existe).',
    parameters: {
      type: Type.OBJECT,
      properties: {
        producto_nombre: {
          type: Type.STRING,
          description:
            "Nombre del producto dictado por el comerciante. Si existe uno equivalente en el catálogo usa ese nombre; si es un producto nuevo conserva el nombre dictado (ej. 'Galletas Oreo', 'Jabón Bolívar').",
        },
        cantidad: {
          type: Type.NUMBER,
          description:
            "Cantidad entera de unidades a registrar, sumar o aumentar en el stock.",
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
          description: "Precio unitario de venta al público en bolivianos (opcional).",
        },
        categoria: {
          type: Type.STRING,
          description:
            'Categoría del producto (ej. "Bebidas", "Lácteos", "Abarrotes", "Snacks", "Panadería", "Limpieza"). Por defecto "Abarrotes".',
        },
        unidad_medida: {
          type: Type.STRING,
          enum: ["UNIDAD", "PAQUETE", "CAJA", "LITRO", "KILO"],
          description:
            'Unidad de medida del producto. Por defecto "UNIDAD".',
        },
      },
      required: ["producto_nombre", "cantidad"],
    },
  },
  {
    name: "crear_producto_catalogo",
    description:
      'Da de alta un producto nuevo en el catálogo de la tienda indicando su precio de venta y opcionalmente un stock inicial (ej. "Crea el producto Galletas Oreo a 5 bolivianos con 10 unidades" o "Crea el producto Fósforos Patria a 2 bolivianos").',
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
            'Categoría inferida del producto (ej. "Snacks", "Bebidas", "Lácteos", "Abarrotes", "Limpieza").',
        },
        precio_venta: {
          type: Type.NUMBER,
          description: "Precio de venta unitario en bolivianos.",
        },
        stock_inicial: {
          type: Type.NUMBER,
          description:
            "Unidades iniciales en stock (opcional, 0 si no se menciona cantidad).",
        },
        fecha_vencimiento: {
          type: Type.STRING,
          description:
            "Fecha de vencimiento opcional en formato YYYY-MM-DD.",
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
      'Registra una venta en mostrador cuando el comerciante dice "vendí", "cobra", "despacha" o "se llevó", descontando stock automáticamente bajo regla FEFO.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        items: {
          type: Type.ARRAY,
          description: "Lista de productos y cantidades vendidas.",
          items: {
            type: Type.OBJECT,
            properties: {
              producto_nombre: {
                type: Type.STRING,
                description: "Nombre del producto vendido.",
              },
              cantidad: {
                type: Type.NUMBER,
                description: "Cantidad entera vendida de ese producto.",
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
      "Consulta cuántas unidades disponibles quedan de un producto específico (solo para preguntas de consulta, NO para aumentar o sumar stock).",
    parameters: {
      type: Type.OBJECT,
      properties: {
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
    };

    const textoComando = (body.textoComando ?? "").trim();
    if (!textoComando) {
      return NextResponse.json(
        { ok: false, error: "No se recibió ningún comando de voz." },
        { status: 400 }
      );
    }

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

    // 1. Control de Cuota Freemium
    if (
      usuario.plan === PlanSuscripcion.BASICO_GRATIS &&
      usuario.comandosVozHoy >= LIMITE_GRATIS_DIARIO
    ) {
      return NextResponse.json({
        ok: false,
        estado: "LIMITE_ALCANZADO",
        mensajeVoz:
          "Agotaste tus 15 comandos de voz gratuitos de hoy. Activa el Plan Asistente Voz Pro por 25 bolivianos al mes para usar comandos de voz ilimitados.",
        operacion: {
          tipo: "LIMITE_ALCANZADO",
          titulo: "Límite diario gratuito alcanzado (15/15)",
          detalle:
            "Pásate al Plan Asistente Voz Pro (Bs 25/mes) en la pestaña Mi Plan para operar sin límites.",
        },
        cuota: {
          plan: usuario.plan,
          usados: usuario.comandosVozHoy,
          limite: LIMITE_GRATIS_DIARIO,
          restantes: 0,
        },
      });
    }

    const usuarioConCuota = await prisma.usuario.update({
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

    const catalogo = await prisma.catalogoCurado.findMany({
      orderBy: { nombreProducto: "asc" },
    });
    const nombresCatalogo = catalogo.map((c) => c.nombreProducto).join(", ");

    const ahoraServidor = new Date();
    const fechaIsoServidor = formatearYYYYMMDD(ahoraServidor);
    const fechaHumanaServidor = ahoraServidor.toLocaleDateString("es-BO", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const systemInstruction = `Eres StockIA, el asistente operativo de voz para tiendas minoristas en La Paz y El Alto, Bolivia.
Fecha actual exacta del servidor: ${fechaIsoServidor} (${fechaHumanaServidor}).
Convierte siempre fechas relativas ("mañana", "en dos semanas", "el 11 de febrero") a YYYY-MM-DD tomando como referencia ${fechaIsoServidor}.
Catálogo actual en tienda: ${nombresCatalogo}.
REGLAS CRÍTICAS DE INVOCACIÓN DE FUNCIONES:
1. Cuando el comerciante diga "registra", "aumenta", "agrega", "suma", "ingresa", "llegaron" o "compré" unidades de un producto (exista o NO en el catálogo), invoca SIEMPRE \`registrar_lote_inventario\`. Si el producto no está en la lista del catálogo, envía su nombre comercial limpio (ej. "Galletas Oreo") junto con \`categoria\` y \`unidad_medida\` inferidas: el servidor lo creará automáticamente.
2. Cuando el comerciante pida explícitamente dar de alta o crear un producto indicando precio de venta (ej. "Crea el producto Galletas Oreo a 5 bolivianos con 10 unidades"), invoca \`crear_producto_catalogo\` o \`registrar_lote_inventario\`.
3. Cuando diga "vendí", "cobra", "despacha" o "se llevó", invoca \`registrar_venta_voz\`.
4. Usa \`consultar_stock\` ÚNICAMENTE para preguntas de consulta ("¿cuánto hay?", "¿cuántas quedan?"), jamás cuando pidan aumentar o agregar stock.`;

    // 2. Cascada de modelos Gemini (2.5-flash -> 500ms -> 2.5-flash-lite -> 500ms -> 2.0-flash)
    let llamadasNormalizadas: LlamadaHerramientaNormalizada[] = [];
    let textoConversacionalDirecto: string | null = null;
    let motorUtilizado = "parser-local-respaldo";

    const apiKey = process.env.GEMINI_API_KEY;
    if (apiKey) {
      const ai = new GoogleGenAI({ apiKey });

      for (let i = 0; i < MODELOS_CASCADA.length; i += 1) {
        const modeloCandidato = MODELOS_CASCADA[i];
        try {
          const respuestaGemini = await ai.models.generateContent({
            model: modeloCandidato,
            contents: textoComando,
            config: {
              systemInstruction,
              tools: [{ functionDeclarations: DECLARACIONES_HERRAMIENTAS }],
              temperature: 0.1,
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

    // 3. Respaldo local en español (también si Gemini contestó texto plano en vez de invocar función ante un comando claro)
    if (llamadasNormalizadas.length === 0) {
      const interpretacionLocal = interpretarComandoLocalRespaldo(
        textoComando,
        catalogo,
        ahoraServidor
      );
      if (interpretacionLocal) {
        llamadasNormalizadas = [interpretacionLocal];
        if (!apiKey) {
          motorUtilizado = "parser-local-respaldo";
        }
      } else if (textoConversacionalDirecto) {
        return NextResponse.json({
          ok: true,
          estado: "EJECUTADO",
          motor: motorUtilizado,
          mensajeVoz: textoConversacionalDirecto,
          operacion: {
            tipo: "CONVERSACION",
            titulo: "Asistente StockIA",
            detalle: textoConversacionalDirecto,
          },
          undoToken: null,
          mutoBaseDatos: false,
          cuota: cuotaActual,
        });
      } else {
        const guia =
          "Te escucho. Puedes decir: aumenta 10 Coca-Cola 2L, crea el producto Galletas Oreo a 5 bolivianos con 10 unidades, o vendí 2 Yogurt Pil.";
        return NextResponse.json({
          ok: true,
          estado: "EJECUTADO",
          motor: motorUtilizado,
          mensajeVoz: guia,
          operacion: {
            tipo: "CONVERSACION",
            titulo: "Asistente Operativo StockIA",
            detalle: guia,
          },
          undoToken: null,
          mutoBaseDatos: false,
          cuota: cuotaActual,
        });
      }
    }

    // 4. Ejecución transaccional en PostgreSQL + carga de deltas instantáneos para Dexie.js
    let ultimoUndoToken: string | null = null;
    let mutoBaseDatos = false;
    const productosActualizadosCliente: Array<ReturnType<typeof serializarProductoCliente>> = [];
    const lotesActualizadosCliente: Array<ReturnType<typeof serializarLoteCliente>> = [];

    let resumenOperacion = {
      tipo: "CONSULTA",
      titulo: "Consulta ejecutada",
      detalle: "",
    };
    let mensajeFinalVoz = "";

    for (const paso of llamadasNormalizadas) {
      const args = paso.args;

      // ----------------------------------------------------------------------
      // FUNCIÓN 1 y 3: registrar_lote_inventario / crear_producto_catalogo
      // ----------------------------------------------------------------------
      if (
        paso.name === "registrar_lote_inventario" ||
        paso.name === "crear_producto_catalogo"
      ) {
        const esAltaDedicada = paso.name === "crear_producto_catalogo";
        const nombreRaw = String(args.producto_nombre ?? "").trim();

        if (!nombreRaw) {
          mensajeFinalVoz = "Indícame por favor el nombre del producto.";
          resumenOperacion = {
            tipo: "ERROR",
            titulo: "Nombre requerido",
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

        // Buscar primero en CatalogoCurado (`contains` + `insensitive` y coincidencia precisa)
        let producto = await buscarProductoExistentePreciso(nombreRaw, catalogo);
        let fueProductoNuevo = false;

        if (!producto) {
          const nombreCapitalizado = capitalizarNombreProducto(nombreRaw);
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
          fueProductoNuevo = true;
        }

        productosActualizadosCliente.push(serializarProductoCliente(producto));

        // Calcular precios tomando argumentos o heredando del último lote del producto
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

        // Si el producto YA existía, verificar si tiene un lote activo con la misma fecha de vencimiento
        // (o si no se dictó fecha de vencimiento, reutilizar su lote activo más reciente para incrementar stock)
        let lotecoincidente: InventarioLote | null = null;
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
            lotecoincidente =
              lotesActivosProd.find(
                (l) =>
                  l.fechaVencimiento &&
                  esMismoDiaLocal(l.fechaVencimiento, fechaVencDate)
              ) ?? null;
          } else {
            lotecoincidente =
              lotesActivosProd.find((l) => l.fechaVencimiento === null) ??
              lotesActivosProd[0] ??
              null;
          }
        }

        let loteResultado: InventarioLote;

        if (lotecoincidente && cantidad > 0) {
          const nuevoStock = lotecoincidente.stockActual + cantidad;
          const nuevoEstado = calcularEstadoLoteServidor(
            nuevoStock,
            lotecoincidente.fechaVencimiento,
            ahoraServidor
          );

          loteResultado = await prisma.inventarioLote.update({
            where: { id: lotecoincidente.id },
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
            descontoCuota: usuario.plan === PlanSuscripcion.BASICO_GRATIS,
            tipo: "INCREMENTO_LOTE",
            loteId: loteResultado.id,
            cantidadSumada: cantidad,
            descripcion: `Aumento de +${cantidad} u. en ${producto.nombreProducto}`,
          });

          mensajeFinalVoz = `Listo, sumé ${cantidad} unidades a ${producto.nombreProducto}. Ahora tienes ${loteResultado.stockActual} en ese lote.`;
          resumenOperacion = {
            tipo: "INCREMENTO_STOCK",
            titulo: `Stock aumentado: +${cantidad} ${producto.nombreProducto}`,
            detalle: `Nuevo stock del lote: ${loteResultado.stockActual} u. · Bs ${Number(loteResultado.precioVenta).toFixed(2)}`,
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
            ? ` que vencen el ${formatearFechaCortaEs(fechaVencDate)}`
            : "";

          ultimoUndoToken = guardarOperacionDeshacer({
            usuarioId: usuario.id,
            descontoCuota: usuario.plan === PlanSuscripcion.BASICO_GRATIS,
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
                ? `Listo, creé el producto ${producto.nombreProducto} a ${precioVentaNum.toFixed(2)} bolivianos con ${cantidad} unidades iniciales${textoVenc}.`
                : `Listo, creé el producto ${producto.nombreProducto} en ${producto.categoria} a ${precioVentaNum.toFixed(2)} bolivianos.`;
            resumenOperacion = {
              tipo: "NUEVO_PRODUCTO",
              titulo: `Nuevo producto: ${producto.nombreProducto}`,
              detalle: `Código ${producto.codigoBarras} · Stock: ${cantidad} u. · Bs ${precioVentaNum.toFixed(2)}`,
            };
          } else {
            mensajeFinalVoz = `Listo, registré un lote de ${cantidad} unidades de ${producto.nombreProducto}${textoVenc}.`;
            resumenOperacion = {
              tipo: "INGRESO_LOTE",
              titulo: `Ingreso: +${cantidad} ${producto.nombreProducto}`,
              detalle: `Precio venta Bs ${precioVentaNum.toFixed(2)}${textoVenc}`,
            };
          }
        }

        mutoBaseDatos = true;
        lotesActualizadosCliente.push(
          serializarLoteCliente(loteResultado, ahoraServidor)
        );
      }

      // ----------------------------------------------------------------------
      // FUNCIÓN 2: registrar_venta_voz (Regla FEFO estricta)
      // ----------------------------------------------------------------------
      else if (paso.name === "registrar_venta_voz") {
        const itemsRaw = Array.isArray(args.items) ? args.items : [];
        if (itemsRaw.length === 0) {
          mensajeFinalVoz = "No pude identificar los productos de la venta.";
          resumenOperacion = {
            tipo: "ERROR",
            titulo: "Productos no identificados",
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
                const nombreBuscado = String(obj.producto_nombre ?? "");
                const cantSolicitada = Math.max(
                  1,
                  Math.round(Number(obj.cantidad ?? 1))
                );

                const prod = buscarMejorProductoEnCatalogo(
                  nombreBuscado,
                  catalogo
                );
                if (!prod) {
                  throw new Error(
                    `No encontré "${nombreBuscado}" en el catálogo de la tienda.`
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
                    `Stock insuficiente de ${prod.nombreProducto}: pediste ${cantSolicitada} y quedan ${disponibleTotal} unidades.`
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
              descontoCuota: usuario.plan === PlanSuscripcion.BASICO_GRATIS,
              tipo: "VENTA",
              ventaId: txResult.ventaId,
              restauracionesLotes: txResult.restauracionesLotes,
              descripcion: `Venta de ${listaTexto} (Bs ${txResult.totalVenta.toFixed(2)})`,
            });

            mensajeFinalVoz = `Listo, cobré ${listaTexto}. Total ${txResult.totalVenta.toFixed(2)} bolivianos, descontando primero el lote más próximo a vencer.`;
            resumenOperacion = {
              tipo: "VENTA_VOZ",
              titulo: `Venta cobrada: Bs ${txResult.totalVenta.toFixed(2)}`,
              detalle: `${listaTexto} · Despacho FEFO (${motorUtilizado})`,
            };
          } catch (errVenta) {
            const msgErr =
              errVenta instanceof Error
                ? errVenta.message
                : "No se pudo completar la venta por voz.";
            mensajeFinalVoz = msgErr;
            resumenOperacion = {
              tipo: "ERROR",
              titulo: "No se pudo registrar la venta",
              detalle: msgErr,
            };
          }
        }
      }

      // ----------------------------------------------------------------------
      // FUNCIÓN 4: consultar_stock
      // ----------------------------------------------------------------------
      else if (paso.name === "consultar_stock") {
        const prodNombre = String(args.producto_nombre ?? "");
        const prod = buscarMejorProductoEnCatalogo(prodNombre, catalogo);

        if (!prod) {
          mensajeFinalVoz = `No encontré "${prodNombre}" en el catálogo de tu tienda.`;
          resumenOperacion = {
            tipo: "CONSULTA_STOCK",
            titulo: "Producto no encontrado",
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

          const detalleLotes = lotesProd.map((l) => ({
            unidades: l.stockActual,
            precioVenta: Number(l.precioVenta),
            vence: l.fechaVencimiento
              ? formatearFechaCortaEs(l.fechaVencimiento)
              : "sin vencimiento",
          }));

          mensajeFinalVoz =
            totalUnidades > 0
              ? `Tienes ${totalUnidades} unidades disponibles de ${prod.nombreProducto} a ${detalleLotes[0].precioVenta.toFixed(2)} bolivianos.`
              : `No tienes stock disponible de ${prod.nombreProducto} en este momento.`;

          resumenOperacion = {
            tipo: "CONSULTA_STOCK",
            titulo: `${prod.nombreProducto}: ${totalUnidades} u.`,
            detalle:
              detalleLotes.length > 0
                ? detalleLotes
                    .map((d) => `${d.unidades} u. (vence ${d.vence})`)
                    .join(" · ")
                : "Agotado actualmente",
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

        mensajeFinalVoz =
          lista.length === 0
            ? `No tienes productos por vencer en los próximos ${diasLimite} días.`
            : `Tienes ${lista.length} lotes por vencer en los próximos ${diasLimite} días: ${lista
                .map((x) => `${x.unidades} de ${x.producto} el ${x.vence}`)
                .join(", ")}.`;

        resumenOperacion = {
          tipo: "CONSULTA_FEFO",
          titulo: `${lista.length} lote(s) por vencer (≤ ${diasLimite} días)`,
          detalle:
            lista.length > 0
              ? lista
                  .map((x) => `${x.producto}: ${x.unidades} u. (${x.vence})`)
                  .join(" · ")
              : "Inventario sin vencimientos críticos cercanos",
        };
      }
    }

    return NextResponse.json({
      ok: true,
      estado: "EJECUTADO",
      motor: motorUtilizado,
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
