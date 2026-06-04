const { getSQL, ok, err, options } = require("./_db");

const SQL_PROXY = "https://aggrievedly-spryest-hattie.ngrok-free.dev";
const SQL_TOKEN = "Sahiba_CZSfEghwaD4s";

async function runSQLQuery(query, params = {}) {
  let q = query;
  for (const [k, v] of Object.entries(params)) q = q.replace(`{{${k}}}`, v);
  const res = await fetch(SQL_PROXY + "/V1/query", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + SQL_TOKEN, "ngrok-skip-browser-warning": "true" },
    body: JSON.stringify({ query: q })
  });
  const data = await res.json();
  if (data.status === "error") throw new Error(data.message);
  return data.data || data;
}

const CORTE_CERCU = "SELECT numeroCorte,corte,cadenaSalida,ISNULL(totalVentas,0) AS totalVentas,estacion,usufecha,usuhora,ISNULL(totalIngresos,0) AS totalIngresos,ISNULL(totalEgresos,0) AS totalEgresos,ISNULL(totalCaja,0) AS totalCaja,ISNULL(ventasCredito,0) AS ventasCredito,ISNULL(valesEmitidos,0) AS valesEmitidos,ISNULL(valesCambio,0) AS valesCambio,ISNULL(ingresosCobranza,0) AS ingresosCobranza,ISNULL(totalVentasUnidades,0) AS totalVentasUnidades,ISNULL(clientesAtendidos,0) AS clientesAtendidos,ISNULL(cajero,'') AS cajero,ISNULL(importeCajero,0) AS importeCajero FROM CORTESZX_C WHERE usufecha='{{fecha}}' ORDER BY numeroCorte";
const CORTE_LEONA = "SELECT numeroCorte,corte,cadenaSalida,ISNULL(totalVentas,0) AS totalVentas,estacion,usufecha,usuhora,ISNULL(totalIngresos,0) AS totalIngresos,ISNULL(totalEgresos,0) AS totalEgresos,ISNULL(totalCaja,0) AS totalCaja,ISNULL(ventasCredito,0) AS ventasCredito,ISNULL(valesEmitidos,0) AS valesEmitidos,ISNULL(valesCambio,0) AS valesCambio,ISNULL(ingresosCobranza,0) AS ingresosCobranza,ISNULL(totalVentasUnidades,0) AS totalVentasUnidades,ISNULL(clientesAtendidos,0) AS clientesAtendidos,ISNULL(cajero,'') AS cajero,ISNULL(importeCajero,0) AS importeCajero FROM CORTESZX_L WHERE usufecha='{{fecha}}' ORDER BY numeroCorte";

function parseAmount(text, pattern) {
  const match = text.match(pattern);
  if (!match) return 0;
  return Number(match[1].replace(/,/g, '')) || 0;
}

function parseCorteReceipt(data) {
  const allText = data.map(r => r.cadenaSalida || '').join('\n');

  const cb = parseAmount(allText, /Inicial en Caja:\s*\$?([\d,]+(?:\.\d+)?)/i);
  const venta = parseAmount(allText, /Ingresos por Ventas:\s*\$?([\d,]+(?:\.\d+)?)/i);
  const totalIngresos = parseAmount(allText, /Total de Ingresos:\s*\$?([\d,]+(?:\.\d+)?)/i);
  const tarjeta = parseAmount(allText, /Total en Tarjetas:\s*\$?([\d,]+(?:\.\d+)?)/i);
  const transfer = parseAmount(allText, /Total en Transfer:\s*\$?([\d,]+(?:\.\d+)?)/i);
  const efectivo = parseAmount(allText, /Total en Efectivo:\s*\$?([\d,]+(?:\.\d+)?)/i);
  const totalEgresos = parseAmount(allText, /Total de Egresos:\s*\$?([\d,]+(?:\.\d+)?)/i);
  const cobranza = parseAmount(allText, /Ingresos por cobranza:\s*\$?([\d,]+(?:\.\d+)?)/i);

  const totalVentasDB = data.reduce((a, r) => a + (Number(r.totalVentas) || 0), 0);
  const totalCajaDB = data.reduce((a, r) => a + (Number(r.totalCaja) || 0), 0);
  const totalIngresosDB = data.reduce((a, r) => a + (Number(r.totalIngresos) || 0), 0);
  const totalEgresosDB = data.reduce((a, r) => a + (Number(r.totalEgresos) || 0), 0);

  return {
    cb: cb || 0,
    venta: venta || totalVentasDB,
    total_venta: totalIngresos || totalIngresosDB,
    tarjeta: tarjeta,
    mayoreo: transfer,
    gastos: totalEgresos || totalEgresosDB,
    efectivo: efectivo,
    cobranza: cobranza,
    totalVentasDB,
    totalCajaDB,
    totalIngresosDB,
    totalEgresosDB,
    registers: data.length,
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return options();
  const sql = getSQL();

  try {
    const body = event.httpMethod === "POST" ? JSON.parse(event.body) : {};
    const fecha = body.fecha || new Date().toISOString().slice(0, 10);

    const [cercuData, leonaData] = await Promise.all([
      runSQLQuery(CORTE_CERCU, { fecha }).catch(() => []),
      runSQLQuery(CORTE_LEONA, { fecha }).catch(() => [])
    ]);

    const results = [];

    for (const [store, data] of [["Circunvalacion", cercuData], ["Leona Vicario", leonaData]]) {
      if (!data || !data.length) continue;

      const parsed = parseCorteReceipt(data);

      const rows = await sql`
        INSERT INTO daily_sales (
          sale_date, store, cb, venta, otro_venta, total_venta,
          gastos, tarjeta, mayoreo, cb_next, deposito,
          corte_raw, source
        ) VALUES (
          ${fecha}, ${store}, ${parsed.cb}, ${parsed.venta}, 0, ${parsed.total_venta},
          ${parsed.gastos}, ${parsed.tarjeta}, ${parsed.mayoreo}, 0, 0,
          ${JSON.stringify({ parsed, raw: data.map(r => ({ ...r, cadenaSalida: undefined })) })},
          'corte'
        )
        ON CONFLICT (sale_date, store) DO UPDATE SET
          cb = EXCLUDED.cb,
          venta = EXCLUDED.venta,
          total_venta = EXCLUDED.total_venta,
          gastos = CASE WHEN daily_sales.source = 'manual' THEN daily_sales.gastos ELSE EXCLUDED.gastos END,
          tarjeta = EXCLUDED.tarjeta,
          mayoreo = EXCLUDED.mayoreo,
          corte_raw = EXCLUDED.corte_raw,
          source = 'corte',
          updated_at = NOW()
        RETURNING *`;

      results.push({
        store,
        parsed,
        saved: rows[0],
      });
    }

    return ok({ fecha, synced: results.length, results });
  } catch (e) { return err(e.message); }
};
