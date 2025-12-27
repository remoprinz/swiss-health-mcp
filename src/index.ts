#!/usr/bin/env node
/**
 * Swiss Health MCP Server
 * 
 * Ein MCP-Server für Schweizer Krankenkassen-Prämien (2016-2026)
 * Datenquelle: BAG Priminfo (Bundesamt für Gesundheit)
 * 
 * @author Remo Prinz
 * @license MIT
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ============================================
// VERSICHERER-NAMEN MAPPING (Fallback)
// ============================================
const INSURER_NAMES: Record<string, string> = {
  '0008': 'CSS', '0032': 'Concordia', '0134': 'Visana', '0194': 'Atupri',
  '0246': 'Aquilana', '0290': 'Galenos', '0312': 'Helsana', '0343': 'Intras',
  '0360': 'Sanitas', '0376': 'KPT', '0455': 'ÖKK', '0509': 'Progrès',
  '0881': 'Sympany', '0923': 'Swica', '0941': 'Vivao', '0966': 'Wincare',
  '1040': 'EGK', '1113': 'Groupe Mutuel', '1318': 'Assura', '1322': 'Helsana Plus',
  '1384': 'Groupe Mutuel', '1386': 'KPT', '1401': 'Groupe Mutuel', '1479': 'Helsana',
  '1507': 'CSS', '1509': 'Swica', '1535': 'Assura', '1542': 'KPT',
  '1555': 'Groupe Mutuel', '1560': 'KPT', '1562': 'Assura', '1568': 'Helsana',
  '0062': 'AMB', '0057': 'Entremont', '0182': 'Sodalis', '0558': 'SLKK',
  '0762': 'Lumnezia', '0774': 'Luzerner Hinterland', '0780': 'Rhenusana',
  '0820': 'Sanitas', '0829': 'Avenir', '0901': 'Vallée de Joux', '0994': 'Assura-Basis',
  '1060': 'Sodalis', '1142': 'Intras', '1147': 'Agrisano', '1328': 'Agrisano',
  '1529': 'Accorda', '1565': 'Agrisano', '1566': 'Sodalis', '1569': 'Sodalis',
  '1570': 'Intras', '1573': 'Agrisano', '1575': 'Entremont', '1577': 'Vallée de Joux'
};

function getInsurerName(insurerId: string): string {
  // Normalisiere ID auf 4 Stellen mit führenden Nullen
  const normalizedId = insurerId.toString().padStart(4, '0');
  return INSURER_NAMES[normalizedId] || `Versicherer ${normalizedId}`;
}

// Haupt-IDs für bekannte Versicherer (bevorzugt bei Suche)
const PRIMARY_INSURER_IDS: Record<string, string> = {
  'helsana': '0312',
  'css': '0008',
  'swica': '0923',
  'assura': '1318',
  'kpt': '0376',
  'groupe mutuel': '1113',
  'sanitas': '0360',
  'concordia': '0032',
  'visana': '0134',
  'ökk': '0455',
  'sympany': '0881',
  'atupri': '0194',
  'egk': '1040',
  'aquilana': '0246',
  'galenos': '0290',
  'agrisano': '1147'
};

function findInsurerIdByName(searchName: string): string | undefined {
  const search = searchName.toLowerCase().trim();
  
  // 1. Prüfe zuerst die Haupt-IDs (exakter Match)
  if (PRIMARY_INSURER_IDS[search]) {
    return PRIMARY_INSURER_IDS[search];
  }
  
  // 2. Prüfe Haupt-IDs mit "enthält"
  for (const [name, id] of Object.entries(PRIMARY_INSURER_IDS)) {
    if (name.includes(search) || search.includes(name)) {
      return id;
    }
  }
  
  // 3. Fallback: Suche im vollen Mapping
  for (const [id, name] of Object.entries(INSURER_NAMES)) {
    if (name.toLowerCase() === search) {
      return id; // Exakter Match bevorzugt
    }
  }
  
  for (const [id, name] of Object.entries(INSURER_NAMES)) {
    if (name.toLowerCase().includes(search) || search.includes(name.toLowerCase())) {
      return id;
    }
  }
  
  return undefined;
}

// Findet ALLE IDs für einen Versicherer (für vollständige Daten)
function findAllInsurerIds(searchName: string): string[] {
  const search = searchName.toLowerCase().trim();
  const ids: string[] = [];
  
  for (const [id, name] of Object.entries(INSURER_NAMES)) {
    if (name.toLowerCase().includes(search) || search.includes(name.toLowerCase())) {
      ids.push(id);
    }
  }
  
  return ids;
}

// ============================================
// DISCLAIMER - Wird jeder Response angehängt
// ============================================
const DISCLAIMER = `
📋 HAFTUNGSAUSSCHLUSS:
Diese Daten stammen vom BAG Priminfo (Bundesamt für Gesundheit) und dienen nur zur Information.
Für verbindliche Prämien kontaktieren Sie bitte direkt die Krankenkasse oder besuchen Sie priminfo.admin.ch
`;

// ============================================
// Supabase Client
// ============================================
let supabase: SupabaseClient;

function getSupabase(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!url || !key) {
      throw new Error("SUPABASE_URL und SUPABASE_SERVICE_ROLE_KEY müssen gesetzt sein");
    }
    
    supabase = createClient(url, key);
  }
  return supabase;
}

// ============================================
// Tool-Definitionen
// ============================================
const TOOLS = [
  {
    name: "get_cheapest_insurers",
    description: "Findet die günstigsten Krankenkassen für ein bestimmtes Profil. Gibt die Top 5 zurück.",
    inputSchema: {
      type: "object" as const,
      properties: {
        canton: { type: "string", description: "Kanton (2-Buchstaben-Code, z.B. 'ZH', 'BE', 'GE')" },
        year: { type: "number", description: "Jahr (2016-2026)" },
        age_band: { type: "string", enum: ["child", "young_adult", "adult"], description: "Altersgruppe: child (0-18), young_adult (19-25), adult (26+)" },
        franchise_chf: { type: "number", enum: [0, 100, 200, 300, 400, 500, 600, 1000, 1500, 2000, 2500], description: "Franchise in CHF" },
        model_type: { type: "string", enum: ["standard", "hmo", "telmed", "family_doctor", "diverse"], description: "Versicherungsmodell (optional, default: standard)" },
        accident_covered: { type: "boolean", description: "Unfalldeckung inkludiert (optional, default: true)" }
      },
      required: ["canton", "year", "age_band", "franchise_chf"]
    }
  },
  {
    name: "compare_insurers",
    description: "Vergleicht mehrere Versicherer für ein bestimmtes Profil.",
    inputSchema: {
      type: "object" as const,
      properties: {
        insurer_names: { type: "array", items: { type: "string" }, description: "Liste von Versicherer-Namen (z.B. ['CSS', 'Helsana', 'Swica'])" },
        canton: { type: "string", description: "Kanton (2-Buchstaben-Code)" },
        year: { type: "number", description: "Jahr (2016-2026)" },
        age_band: { type: "string", enum: ["child", "young_adult", "adult"], description: "Altersgruppe" },
        franchise_chf: { type: "number", description: "Franchise in CHF" }
      },
      required: ["insurer_names", "canton", "year", "age_band", "franchise_chf"]
    }
  },
  {
    name: "get_price_history",
    description: "Zeigt die Preisentwicklung eines Versicherers über mehrere Jahre.",
    inputSchema: {
      type: "object" as const,
      properties: {
        insurer_name: { type: "string", description: "Name des Versicherers (z.B. 'CSS', 'Helsana')" },
        canton: { type: "string", description: "Kanton (2-Buchstaben-Code)" },
        age_band: { type: "string", enum: ["child", "young_adult", "adult"], description: "Altersgruppe" },
        franchise_chf: { type: "number", description: "Franchise in CHF" },
        start_year: { type: "number", description: "Startjahr (optional, default: 2016)" },
        end_year: { type: "number", description: "Endjahr (optional, default: 2026)" }
      },
      required: ["insurer_name", "canton", "age_band", "franchise_chf"]
    }
  },
  {
    name: "get_database_stats",
    description: "Zeigt Statistiken zur Datenbank (Anzahl Einträge, verfügbare Jahre, Versicherer).",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: []
    }
  }
];

// ============================================
// Tool-Implementierungen
// ============================================

async function getCheapestInsurers(params: {
  canton: string;
  year: number;
  age_band: string;
  franchise_chf: number;
  model_type?: string;
  accident_covered?: boolean;
}): Promise<string> {
  const db = getSupabase();
  
  const { canton, year, age_band, franchise_chf, model_type = "standard", accident_covered = true } = params;
  
  // Suche günstigste Prämien
  const { data, error } = await db
    .from("premiums")
    .select("insurer_id, monthly_premium_chf, tariff_name")
    .eq("canton", canton.toUpperCase())
    .eq("year", year)
    .eq("age_band", age_band)
    .eq("franchise_chf", franchise_chf)
    .eq("model_type", model_type)
    .eq("accident_covered", accident_covered)
    .order("monthly_premium_chf", { ascending: true })
    .limit(10);

  if (error) {
    return `❌ Fehler: ${error.message}`;
  }

  if (!data || data.length === 0) {
    return `⚠️ Keine Prämien gefunden für: ${canton}, ${year}, ${age_band}, CHF ${franchise_chf} Franchise, ${model_type}`;
  }

  // Gruppiere nach Versicherer-NAME (nicht ID), damit jeder Versicherer nur einmal erscheint
  const bestByName = new Map<string, { premium: number; tariff: string; id: string }>();
  for (const item of data) {
    const name = getInsurerName(item.insurer_id);
    const existing = bestByName.get(name);
    if (!existing || item.monthly_premium_chf < existing.premium) {
      bestByName.set(name, { 
        premium: item.monthly_premium_chf, 
        tariff: item.tariff_name || "",
        id: item.insurer_id
      });
    }
  }

  // Sortiere nach Preis
  const sorted = [...bestByName.entries()]
    .sort((a, b) => a[1].premium - b[1].premium)
    .slice(0, 5);

  // Formatiere Ergebnis
  let result = `🏆 Top 5 günstigste Krankenkassen\n`;
  result += `📍 ${canton} | ${year} | ${age_band} | CHF ${franchise_chf} Franchise | ${model_type}\n\n`;

  sorted.forEach(([name, data], index) => {
    result += `${index + 1}. ${name}: CHF ${data.premium.toFixed(2)}/Monat\n`;
  });

  result += DISCLAIMER;
  return result;
}

async function compareInsurers(params: {
  insurer_names: string[];
  canton: string;
  year: number;
  age_band: string;
  franchise_chf: number;
}): Promise<string> {
  const db = getSupabase();
  
  const { insurer_names, canton, year, age_band, franchise_chf } = params;

  // Finde ALLE Versicherer-IDs für jeden Namen (z.B. Helsana hat 0312, 1322, 1479, 1568)
  const matchedInsurers: { searchName: string; ids: string[]; primaryId: string | undefined }[] = 
    insurer_names.map(searchName => ({
      searchName,
      ids: findAllInsurerIds(searchName),
      primaryId: findInsurerIdByName(searchName)
    }));

  // Sammle alle IDs und tracke welche zu welchem Namen gehören
  const allIds: string[] = [];
  const idToSearchName = new Map<string, string>();
  
  for (const m of matchedInsurers) {
    for (const id of m.ids) {
      allIds.push(id);
      idToSearchName.set(id, m.searchName);
    }
  }

  const notFound = matchedInsurers.filter(m => m.ids.length === 0).map(m => m.searchName);

  if (allIds.length === 0) {
    return `⚠️ Keine der Versicherer gefunden: ${insurer_names.join(", ")}\n\nVerfügbare Versicherer: CSS, Helsana, Swica, Assura, Concordia, Sanitas, KPT, ÖKK, Visana, Groupe Mutuel, Sympany, Atupri, EGK, Aquilana, Galenos`;
  }

  // Hole Prämien für ALLE IDs
  const { data: premiums, error } = await db
    .from("premiums")
    .select("insurer_id, monthly_premium_chf, model_type")
    .eq("canton", canton.toUpperCase())
    .eq("year", year)
    .eq("age_band", age_band)
    .eq("franchise_chf", franchise_chf)
    .in("insurer_id", allIds);

  if (error || !premiums || premiums.length === 0) {
    return `❌ Keine Prämien gefunden für: ${canton}, ${year}\n\nGesuchte IDs: ${allIds.join(", ")}`;
  }

  // Gruppiere nach SUCHNAME (nimm günstigsten Tarif pro Versicherer)
  const bestByName = new Map<string, { premium: number; model: string; id: string }>();
  for (const p of premiums) {
    const searchName = idToSearchName.get(p.insurer_id) || p.insurer_id;
    const existing = bestByName.get(searchName);
    if (!existing || p.monthly_premium_chf < existing.premium) {
      bestByName.set(searchName, { 
        premium: p.monthly_premium_chf, 
        model: p.model_type,
        id: p.insurer_id 
      });
    }
  }

  // Formatiere Ergebnis
  let result = `📊 Versicherungsvergleich\n`;
  result += `📍 ${canton} | ${year} | ${age_band} | CHF ${franchise_chf} Franchise\n\n`;

  const sorted = [...bestByName.entries()]
    .sort((a, b) => a[1].premium - b[1].premium);
  
  sorted.forEach(([searchName, data], index) => {
    const displayName = getInsurerName(data.id);
    result += `${index + 1}. ${displayName}: CHF ${data.premium.toFixed(2)}/Monat (${data.model})\n`;
  });

  if (notFound.length > 0) {
    result += `\n⚠️ Nicht gefunden: ${notFound.join(", ")}\n`;
  }

  if (sorted.length >= 2) {
    const diff = sorted[sorted.length - 1][1].premium - sorted[0][1].premium;
    result += `\n💰 Differenz günstigste/teuerste: CHF ${diff.toFixed(2)}/Monat\n`;
  }

  result += DISCLAIMER;
  return result;
}

async function getPriceHistory(params: {
  insurer_name: string;
  canton: string;
  age_band: string;
  franchise_chf: number;
  start_year?: number;
  end_year?: number;
}): Promise<string> {
  const db = getSupabase();
  
  const { insurer_name, canton, age_band, franchise_chf, start_year = 2016, end_year = 2026 } = params;

  // Finde ALLE Versicherer-IDs (z.B. CSS hat 0008 und 1507)
  const insurerIds = findAllInsurerIds(insurer_name);
  const primaryId = findInsurerIdByName(insurer_name);

  if (insurerIds.length === 0 || !primaryId) {
    return `⚠️ Versicherer "${insurer_name}" nicht gefunden\n\nVerfügbare Versicherer: CSS, Helsana, Swica, Assura, Concordia, Sanitas, KPT, ÖKK, Visana, Groupe Mutuel, Sympany, Atupri, EGK, Aquilana, Galenos`;
  }

  const insurerDisplayName = getInsurerName(primaryId);

  // Hole Prämien über die Jahre für ALLE IDs des Versicherers
  const { data: premiums, error } = await db
    .from("premiums")
    .select("year, monthly_premium_chf, model_type, insurer_id")
    .in("insurer_id", insurerIds)
    .eq("canton", canton.toUpperCase())
    .eq("age_band", age_band)
    .eq("franchise_chf", franchise_chf)
    .gte("year", start_year)
    .lte("year", end_year)
    .order("year", { ascending: true });

  if (error || !premiums || premiums.length === 0) {
    return `❌ Keine Daten für ${insurerDisplayName} in ${canton} (IDs: ${insurerIds.join(", ")})`;
  }

  // Gruppiere nach Jahr (günstigster Tarif pro Jahr)
  const bestByYear = new Map<number, number>();
  for (const p of premiums) {
    const existing = bestByYear.get(p.year);
    if (!existing || p.monthly_premium_chf < existing) {
      bestByYear.set(p.year, p.monthly_premium_chf);
    }
  }

  // Formatiere Ergebnis
  let result = `📈 Preisentwicklung: ${insurerDisplayName}\n`;
  result += `📍 ${canton} | ${age_band} | CHF ${franchise_chf} Franchise\n\n`;

  const sortedYears = [...bestByYear.entries()].sort((a, b) => a[0] - b[0]);
  sortedYears.forEach(([year, premium]) => {
    result += `${year}: CHF ${premium.toFixed(2)}/Monat\n`;
  });

  if (sortedYears.length >= 2) {
    const first = sortedYears[0][1];
    const last = sortedYears[sortedYears.length - 1][1];
    const change = ((last - first) / first * 100).toFixed(1);
    result += `\n📊 Veränderung ${sortedYears[0][0]}-${sortedYears[sortedYears.length - 1][0]}: ${change}%\n`;
  }

  result += DISCLAIMER;
  return result;
}

async function getDatabaseStats(): Promise<string> {
  const db = getSupabase();

  // Hole Statistiken
  const [premiumsCount, insurersCount, locationsCount] = await Promise.all([
    db.from("premiums").select("*", { count: "exact", head: true }),
    db.from("insurers").select("*", { count: "exact", head: true }),
    db.from("locations").select("*", { count: "exact", head: true })
  ]);

  // Prüfe welche Jahre Daten haben (effizienter als alle Zeilen zu holen)
  const yearsToCheck = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026];
  const yearChecks = await Promise.all(
    yearsToCheck.map(year => 
      db.from("premiums").select("year", { count: "exact", head: true }).eq("year", year)
    )
  );
  
  const availableYears = yearsToCheck.filter((year, index) => 
    yearChecks[index].count && yearChecks[index].count > 0
  );

  // Hole Anzahl unique Versicherer aus premiums (statt insurers-Tabelle)
  const { data: insurerSample } = await db
    .from("premiums")
    .select("insurer_id")
    .limit(10000);
  
  const uniqueInsurers = new Set(insurerSample?.map(p => p.insurer_id) || []);

  let result = `📊 Datenbank-Statistiken\n\n`;
  result += `📋 Tabellen:\n`;
  result += `   • premiums: ${premiumsCount.count?.toLocaleString("de-CH")} Einträge\n`;
  result += `   • insurers: ${uniqueInsurers.size} aktive Versicherer\n`;
  result += `   • locations: ${locationsCount.count?.toLocaleString("de-CH")} PLZ-Einträge\n\n`;
  result += `📅 Verfügbare Jahre: ${availableYears.join(", ")}\n\n`;
  result += `🔗 Datenquelle: BAG Priminfo (priminfo.admin.ch)\n`;

  return result;
}

// ============================================
// MCP Server Setup
// ============================================

const server = new Server(
  {
    name: "swiss-health-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle: Liste alle Tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// Handle: Tool ausführen
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      case "get_cheapest_insurers":
        result = await getCheapestInsurers(args as any);
        break;
      case "compare_insurers":
        result = await compareInsurers(args as any);
        break;
      case "get_price_history":
        result = await getPriceHistory(args as any);
        break;
      case "get_database_stats":
        result = await getDatabaseStats();
        break;
      default:
        result = `❌ Unbekanntes Tool: ${name}`;
    }

    return {
      content: [{ type: "text", text: result }],
    };
  } catch (error) {
    return {
      content: [{ type: "text", text: `❌ Fehler: ${error}` }],
      isError: true,
    };
  }
});

// ============================================
// Server starten
// ============================================

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🏥 Swiss Health MCP Server läuft...");
}

main().catch(console.error);


