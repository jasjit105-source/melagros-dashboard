import pandas as pd
import json
import sys

FILE = '/Users/mac/Dropbox/My Mac (MacBook-Pro.local)/Downloads/Melagros_2026-Feb12 Backup.xlsx'

print("=== Extracting data from Excel for Neon import ===\n")

# ─── DAILY SALES (from TIENDA tab) ───
print("--- DAILY_SALES (from TIENDA) ---")
df = pd.read_excel(FILE, sheet_name='TIENDA', header=None)

sales_rows = []
current_date = None
for idx, row in df.iterrows():
    if idx == 0: continue
    if pd.notna(row[0]) and str(row[0]) != 'nan':
        try:
            current_date = pd.to_datetime(row[0]).strftime('%Y-%m-%d')
        except:
            continue

    store_raw = str(row[1]).strip() if pd.notna(row[1]) else ''
    if store_raw in ('SUMA :', 'TIENDA', '', 'nan'):
        continue

    store_map = {
        'Cercunlacion': 'Circunvalacion', 'Circunlacion': 'Circunvalacion',
        'Leona Vicario': 'Leona Vicario', 'M.Aliman': 'Miguel Aleman',
        'Corregidora': 'Corregidora', 'Izazaga': 'Izazaga'
    }
    store = store_map.get(store_raw, store_raw)

    venta = float(row[3]) if pd.notna(row[3]) else 0
    if venta == 0 and (not pd.notna(row[2]) or float(row[2] if pd.notna(row[2]) else 0) == 0):
        continue

    if current_date is None:
        continue

    def safe_float(v):
        if pd.isna(v): return 0
        try: return float(v)
        except: return 0

    cb = safe_float(row[2])
    otro = safe_float(row[4])
    total = safe_float(row[5])
    gastos = safe_float(row[6])
    ab1 = safe_float(row[7])
    ab2 = safe_float(row[8])
    ab3 = safe_float(row[9])
    tarjeta = safe_float(row[10])
    mayoreo = safe_float(row[11])
    cb_next = safe_float(row[12])
    deposito = safe_float(row[13])

    sales_rows.append({
        'sale_date': current_date, 'store': store, 'cb': cb, 'venta': venta,
        'otro_venta': otro, 'total_venta': total, 'gastos': gastos,
        'abono1': ab1, 'abono2': ab2, 'abono3': ab3,
        'tarjeta': tarjeta, 'mayoreo': mayoreo, 'cb_next': cb_next,
        'deposito': deposito, 'source': 'excel'
    })

print(f"  Extracted {len(sales_rows)} daily sales rows")
date_range = sorted(set(r['sale_date'] for r in sales_rows))
print(f"  Date range: {date_range[0]} to {date_range[-1]}")
stores = sorted(set(r['store'] for r in sales_rows))
print(f"  Stores: {stores}")

# ─── CAJA (main cashbox ledger) ───
print("\n--- CAJA ---")
df_caja = pd.read_excel(FILE, sheet_name='CAJA ', header=0)
caja_rows = []
for idx, row in df_caja.iterrows():
    date_val = row.iloc[0]
    if pd.isna(date_val): continue
    try:
        tx_date = pd.to_datetime(date_val).strftime('%Y-%m-%d')
    except:
        continue

    cat = str(row.iloc[1]).strip() if pd.notna(row.iloc[1]) else ''
    account = str(row.iloc[2]).strip() if pd.notna(row.iloc[2]) else ''
    desc = str(row.iloc[3]).strip() if pd.notna(row.iloc[3]) else ''
    abono = float(row.iloc[4]) if pd.notna(row.iloc[4]) else 0
    gasto = float(row.iloc[5]) if pd.notna(row.iloc[5]) else 0
    saldo = float(row.iloc[6]) if pd.notna(row.iloc[6]) else 0

    if cat in ('', 'nan') and abono == 0 and gasto == 0:
        continue

    caja_rows.append({
        'tx_date': tx_date, 'category': cat, 'account': account,
        'description': desc, 'abono': abono, 'gasto': gasto, 'saldo': saldo
    })

print(f"  Extracted {len(caja_rows)} caja rows")
if caja_rows:
    print(f"  Date range: {caja_rows[0]['tx_date']} to {caja_rows[-1]['tx_date']}")
    print(f"  Final balance: {caja_rows[-1]['saldo']}")

# ─── CAJA FUERTE (safe) ───
print("\n--- CAJA FUERTE ---")
df_cf = pd.read_excel(FILE, sheet_name='CAJA FUERTE', header=0)
cf_rows = []
for idx, row in df_cf.iterrows():
    date_val = row.iloc[0]
    if pd.isna(date_val): continue
    try:
        tx_date = pd.to_datetime(date_val).strftime('%Y-%m-%d')
    except:
        continue

    desc = str(row.iloc[1]).strip() if pd.notna(row.iloc[1]) else ''
    deposit = float(row.iloc[2]) if pd.notna(row.iloc[2]) else 0
    debit = float(row.iloc[3]) if pd.notna(row.iloc[3]) else 0
    saldo = float(row.iloc[4]) if pd.notna(row.iloc[4]) else 0

    if deposit == 0 and debit == 0:
        continue

    cf_rows.append({
        'tx_date': tx_date, 'description': desc,
        'deposit': deposit, 'debit': debit, 'saldo': saldo
    })

print(f"  Extracted {len(cf_rows)} caja fuerte rows")
if cf_rows:
    print(f"  Final balance: {cf_rows[-1]['saldo']}")

# ─── VALLE CONTROL ───
print("\n--- VALLE CONTROL ---")
df_valle = pd.read_excel(FILE, sheet_name='Valle Control', header=None, skiprows=1)
valle_rows = []
for idx, row in df_valle.iterrows():
    date_val = row.iloc[0]
    if pd.isna(date_val): continue
    desc = str(row.iloc[1]).strip() if pd.notna(row.iloc[1]) else ''
    if desc.lower() in ('saldo de apertura', ''): continue
    try:
        tx_date = pd.to_datetime(date_val).strftime('%Y-%m-%d')
    except:
        continue

    abono = float(row.iloc[2]) if pd.notna(row.iloc[2]) else 0
    gasto = float(row.iloc[3]) if pd.notna(row.iloc[3]) else 0
    saldo = float(row.iloc[4]) if pd.notna(row.iloc[4]) else 0

    valle_rows.append({
        'tx_date': tx_date, 'description': desc,
        'abono': abono, 'gasto': gasto, 'saldo': saldo
    })

print(f"  Extracted {len(valle_rows)} valle control rows")
if valle_rows:
    print(f"  Final balance: {valle_rows[-1]['saldo']}")

# ─── PRESTAMOS ───
print("\n--- PRESTAMOS (JJ Ahorro) ---")
df_prest = pd.read_excel(FILE, sheet_name='PRESTAMOS', header=None, skiprows=1)
prest_rows = []
for idx, row in df_prest.iterrows():
    date_val = row.iloc[0]
    if pd.isna(date_val): continue
    desc = str(row.iloc[1]).strip() if pd.notna(row.iloc[1]) else ''
    if desc.lower() in ('saldo de apertura', ''): continue
    try:
        tx_date = pd.to_datetime(date_val).strftime('%Y-%m-%d')
    except:
        continue

    abono = float(row.iloc[2]) if pd.notna(row.iloc[2]) else 0
    gasto = float(row.iloc[3]) if pd.notna(row.iloc[3]) else 0
    saldo = float(row.iloc[4]) if pd.notna(row.iloc[4]) else 0

    if abono == 0 and gasto == 0:
        continue

    prest_rows.append({
        'account_name': 'JJ Ahorro', 'tx_date': tx_date, 'description': desc,
        'abono': abono, 'gasto': gasto, 'saldo': saldo
    })

print(f"  Extracted {len(prest_rows)} prestamos rows")
if prest_rows:
    print(f"  Final balance: {prest_rows[-1]['saldo']}")

# ─── Generate SQL import file ───
print("\n=== Generating SQL import file ===")

out = open('/Users/mac/Dropbox/1 - Business Sahiba/Claude Respond IO/SQL Centro Dashboard/melagros-dashboard/db/import-data.sql', 'w')

out.write("-- Auto-generated from Melagros Excel backup\n")
out.write("-- Run AFTER schema.sql\n\n")

# Daily sales
out.write("-- DAILY SALES\n")
for r in sales_rows:
    vals = [r['sale_date'], r['store'], r['cb'], r['venta'], r['otro_venta'], r['total_venta'],
            r['gastos'], r['abono1'], r['abono2'], r['abono3'], r['tarjeta'], r['mayoreo'],
            r['cb_next'], r['deposito'], r['source']]
    out.write(f"INSERT INTO daily_sales (sale_date,store,cb,venta,otro_venta,total_venta,gastos,abono1,abono2,abono3,tarjeta,mayoreo,cb_next,deposito,source) VALUES ('{vals[0]}','{vals[1]}',{vals[2]},{vals[3]},{vals[4]},{vals[5]},{vals[6]},{vals[7]},{vals[8]},{vals[9]},{vals[10]},{vals[11]},{vals[12]},{vals[13]},'{vals[14]}') ON CONFLICT (sale_date,store) DO NOTHING;\n")

# Caja
out.write("\n-- CAJA\n")
for r in caja_rows:
    desc_esc = r['description'].replace("'", "''")
    acct_esc = r['account'].replace("'", "''")
    cat_esc = r['category'].replace("'", "''")
    out.write(f"INSERT INTO caja (tx_date,category,account,description,abono,gasto,saldo) VALUES ('{r['tx_date']}','{cat_esc}','{acct_esc}','{desc_esc}',{r['abono']},{r['gasto']},{r['saldo']});\n")

# Caja Fuerte
out.write("\n-- CAJA FUERTE\n")
for r in cf_rows:
    desc_esc = r['description'].replace("'", "''")
    out.write(f"INSERT INTO caja_fuerte (tx_date,description,deposit,debit,saldo) VALUES ('{r['tx_date']}','{desc_esc}',{r['deposit']},{r['debit']},{r['saldo']});\n")

# Valle Control
out.write("\n-- VALLE CONTROL\n")
for r in valle_rows:
    desc_esc = r['description'].replace("'", "''")
    out.write(f"INSERT INTO valle_control (tx_date,description,abono,gasto,saldo) VALUES ('{r['tx_date']}','{desc_esc}',{r['abono']},{r['gasto']},{r['saldo']});\n")

# Prestamos
out.write("\n-- PRESTAMOS\n")
for r in prest_rows:
    desc_esc = r['description'].replace("'", "''")
    out.write(f"INSERT INTO prestamos (account_name,tx_date,description,abono,gasto,saldo) VALUES ('{r['account_name']}','{r['tx_date']}','{desc_esc}',{r['abono']},{r['gasto']},{r['saldo']});\n")

out.close()
print("Done! Written to db/import-data.sql")

# Summary
print(f"\n=== SUMMARY ===")
print(f"  Daily Sales: {len(sales_rows)} rows")
print(f"  Caja:        {len(caja_rows)} rows")
print(f"  Caja Fuerte: {len(cf_rows)} rows")
print(f"  Valle:       {len(valle_rows)} rows")
print(f"  Prestamos:   {len(prest_rows)} rows")
print(f"  TOTAL:       {len(sales_rows)+len(caja_rows)+len(cf_rows)+len(valle_rows)+len(prest_rows)} rows to import")
