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

  // Hole Versicherer-Namen
  const insurerIds = [...new Set(data.map(d => d.insurer_id))];
  const { data: insurers } = await db
    .from("insurers")
    .select("insurer_id, name")
    .in("insurer_id", insurerIds);

  const insurerMap = new Map(insurers?.map(i => [i.insurer_id, i.name]) || []);

  // Formatiere Ergebnis
  let result = `🏆 Top 5 günstigste Krankenkassen\n`;
  result += `📍 ${canton} | ${year} | ${age_band} | CHF ${franchise_chf} Franchise | ${model_type}\n\n`;

  data.slice(0, 5).forEach((item, index) => {
    const name = insurerMap.get(item.insurer_id) || item.insurer_id;
    result += `${index + 1}. ${name}: CHF ${item.monthly_premium_chf.toFixed(2)}/Monat\n`;
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

  // Finde Versicherer-IDs basierend auf Namen
  const { data: insurers } = await db
    .from("insurers")
    .select("insurer_id, name");

  if (!insurers) {
    return "❌ Keine Versicherer gefunden";
  }

  // Fuzzy-Match für Versicherer-Namen
  const matchedInsurers = insurer_names.map(searchName => {
    const match = insurers.find(i => 
      i.name.toLowerCase().includes(searchName.toLowerCase()) ||
      searchName.toLowerCase().includes(i.name.toLowerCase())
    );
    return { searchName, match };
  });

  const foundIds = matchedInsurers
    .filter(m => m.match)
    .map(m => m.match!.insurer_id);

  if (foundIds.length === 0) {
    return `⚠️ Keine der Versicherer gefunden: ${insurer_names.join(", ")}`;
  }

  // Hole Prämien
  const { data: premiums, error } = await db
    .from("premiums")
    .select("insurer_id, monthly_premium_chf")
    .eq("canton", canton.toUpperCase())
    .eq("year", year)
    .eq("age_band", age_band)
    .eq("franchise_chf", franchise_chf)
    .in("insurer_id", foundIds);

  if (error || !premiums) {
    return `❌ Fehler: ${error?.message || "Keine Daten"}`;
  }

  // Formatiere Ergebnis
  let result = `📊 Versicherungsvergleich\n`;
  result += `📍 ${canton} | ${year} | ${age_band} | CHF ${franchise_chf} Franchise\n\n`;

  const insurerMap = new Map(insurers.map(i => [i.insurer_id, i.name]));
  
  const sorted = premiums.sort((a, b) => a.monthly_premium_chf - b.monthly_premium_chf);
  sorted.forEach((item, index) => {
    const name = insurerMap.get(item.insurer_id) || item.insurer_id;
    result += `${index + 1}. ${name}: CHF ${item.monthly_premium_chf.toFixed(2)}/Monat\n`;
  });

  if (sorted.length >= 2) {
    const diff = sorted[sorted.length - 1].monthly_premium_chf - sorted[0].monthly_premium_chf;
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

  // Finde Versicherer
  const { data: insurers } = await db
    .from("insurers")
    .select("insurer_id, name");

  const match = insurers?.find(i => 
    i.name.toLowerCase().includes(insurer_name.toLowerCase())
  );

  if (!match) {
    return `⚠️ Versicherer "${insurer_name}" nicht gefunden`;
  }

  // Hole Prämien über die Jahre
  const { data: premiums, error } = await db
    .from("premiums")
    .select("year, monthly_premium_chf")
    .eq("insurer_id", match.insurer_id)
    .eq("canton", canton.toUpperCase())
    .eq("age_band", age_band)
    .eq("franchise_chf", franchise_chf)
    .gte("year", start_year)
    .lte("year", end_year)
    .order("year", { ascending: true });

  if (error || !premiums || premiums.length === 0) {
    return `❌ Keine Daten für ${match.name} in ${canton}`;
  }

  // Formatiere Ergebnis
  let result = `📈 Preisentwicklung: ${match.name}\n`;
  result += `📍 ${canton} | ${age_band} | CHF ${franchise_chf} Franchise\n\n`;

  premiums.forEach(item => {
    result += `${item.year}: CHF ${item.monthly_premium_chf.toFixed(2)}/Monat\n`;
  });

  if (premiums.length >= 2) {
    const first = premiums[0].monthly_premium_chf;
    const last = premiums[premiums.length - 1].monthly_premium_chf;
    const change = ((last - first) / first * 100).toFixed(1);
    result += `\n📊 Veränderung ${premiums[0].year}-${premiums[premiums.length - 1].year}: ${change}%\n`;
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

  // Hole verfügbare Jahre
  const { data: years } = await db
    .from("premiums")
    .select("year")
    .order("year", { ascending: true });

  const uniqueYears = [...new Set(years?.map(y => y.year) || [])];

  let result = `📊 Datenbank-Statistiken\n\n`;
  result += `📋 Tabellen:\n`;
  result += `   • premiums: ${premiumsCount.count?.toLocaleString("de-CH")} Einträge\n`;
  result += `   • insurers: ${insurersCount.count} Versicherer\n`;
  result += `   • locations: ${locationsCount.count?.toLocaleString("de-CH")} PLZ-Einträge\n\n`;
  result += `📅 Verfügbare Jahre: ${uniqueYears.join(", ")}\n\n`;
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


