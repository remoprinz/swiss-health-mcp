# 🏥 Swiss Health MCP Server

[![npm version](https://badge.fury.io/js/%40prinz_esox%2Fswiss-health-mcp.svg)](https://www.npmjs.com/package/@prinz_esox/swiss-health-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Der erste MCP-Server für Schweizer Krankenkassen-Prämien.**

Ermöglicht KI-Assistenten (Claude, Cursor, ChatGPT, etc.) direkten Zugriff auf **1.6 Millionen Prämiendaten** von 55 Versicherern über 11 Jahre (2016-2026).

## 🎯 Features

- 📊 **1.6+ Mio Prämiendaten** aus der offiziellen BAG Priminfo Datenbank
- 🏢 **55 Versicherer** (CSS, Helsana, Swica, Assura, etc.)
- 📅 **11 Jahre** Historische Daten (2016-2026)
- 🔍 **Intelligente Tools** statt rohem SQL
- 🇨🇭 **Made in Switzerland** 🇨🇭

## 🛠️ Verfügbare Tools

| Tool | Beschreibung |
|------|--------------|
| `get_cheapest_insurers` | Findet die Top 5 günstigsten Krankenkassen für ein Profil |
| `compare_insurers` | Vergleicht mehrere Versicherer direkt |
| `get_price_history` | Zeigt Preisentwicklung über Jahre |
| `get_database_stats` | Datenbank-Statistiken |

## 🚀 Installation

### In Cursor IDE

Füge in `.cursor/mcp.json` hinzu:

```json
{
  "mcpServers": {
    "swiss-health": {
      "command": "npx",
      "args": ["-y", "@prinz_esox/swiss-health-mcp"],
      "env": {
        "SUPABASE_URL": "https://YOUR_PROJECT.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY": "YOUR_SERVICE_ROLE_KEY"
      }
    }
  }
}
```

### Via npm (global)

```bash
npm install -g @prinz_esox/swiss-health-mcp
```

## 💬 Beispiel-Prompts

```
"Was sind die günstigsten Krankenkassen in Zürich für 2026?"

"Vergleiche CSS, Helsana und Swica in Bern für einen Erwachsenen"

"Wie hat sich die Prämie bei der Assura von 2016 bis 2026 entwickelt?"

"Zeig mir die Datenbank-Statistiken"
```

## 📊 Datenmodell

### Parameter

| Parameter | Werte |
|-----------|-------|
| **Kantone** | AG, AI, AR, BE, BL, BS, FR, GE, GL, GR, JU, LU, NE, NW, OW, SG, SH, SO, SZ, TG, TI, UR, VD, VS, ZG, ZH |
| **Jahre** | 2016-2026 |
| **Altersgruppen** | `child` (0-18), `young_adult` (19-25), `adult` (26+) |
| **Franchisen** | 0, 100, 200, 300, 400, 500, 600, 1000, 1500, 2000, 2500 CHF |
| **Modelle** | `standard`, `hmo`, `telmed`, `family_doctor`, `diverse` |

## 📋 Datenquelle

**BAG Priminfo** (Bundesamt für Gesundheit)  
https://priminfo.admin.ch

> ⚠️ **Haftungsausschluss:** Alle Prämien dienen nur zur Information. Für verbindliche Angaben kontaktieren Sie die Krankenkasse direkt.

## 🔒 Sicherheit

- Der Server läuft **read-only** – keine Schreiboperationen möglich
- Alle Antworten enthalten einen Disclaimer
- Keine personenbezogenen Daten

## 🏗️ Entwicklung

```bash
# Repository klonen
git clone https://github.com/remoprinz/swiss-health-mcp.git
cd swiss-health-mcp

# Dependencies installieren
npm install

# Entwicklungsserver starten
npm run dev

# Für Produktion bauen
npm run build
```

## 📄 Lizenz

MIT © [Remo Prinz](https://github.com/remoprinz)

---

**Made with ❤️ in Switzerland 🇨🇭**
