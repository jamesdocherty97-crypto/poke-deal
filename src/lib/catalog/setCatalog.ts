// Bundled, offline-first catalog of Pokemon TCG "sets" (Base, Jungle, 151,
// Scarlet & Violet, ...).
//
// Why this exists: the Pokemon TCG API's `set.name` field holds the *literal*
// printed set name (e.g. "Base", "Scarlet & Violet 151"), but dealers and
// collectors refer to sets by nickname, abbreviation, or PTCGO/PTCGL code
// ("base set", "151", "SVI"). A quoted Lucene phrase query against `set.name`
// only matches when the wording is an exact token-for-token match, so any
// other phrasing returns zero results. That mechanical mismatch is the root
// cause of the reported "Charizard 04/102 + base set -> nothing" bug: the
// 1999 set's literal name is "Base", not "Base Set", so a phrase query for
// "base set" can never match it.
//
// This module resolves freeform/alias/code input to a canonical set `id`
// (e.g. "base1"), which callers should then query through `set.id:<id>` --
// an exact, unambiguous match -- instead of fragile `set.name` phrase
// queries. It also powers set autocomplete and "popular sets" UI chips.
//
// Fully offline by design: ships a bundled snapshot of all known sets
// (captured from GET /v2/sets on 2026-06-21 and re-verified on
// 2026-06-22, 173 sets) so search,
// autocomplete, and popular-set chips work with zero API key, consistent
// with this project's fixture/offline-mode convention (see fixtures.ts).
// To freshen the snapshot later, re-fetch /v2/sets and regenerate the
// SET_SNAPSHOT array below -- no other code needs to change.

import { normalizeSearchText, scoreSearchText, tokenizeSearchText, tokenMatches } from "./fuzzy.js";

export interface CatalogSet {
  id: string;
  name: string;
  series?: string;
  printedTotal?: number;
  total?: number;
  releaseDate?: string; // YYYY-MM-DD
  ptcgoCode?: string;
  symbolUrl?: string;
  logoUrl?: string;
}

// ---------------------------------------------------------------------------
// Bundled snapshot (captured 2026-06-21 from GET /v2/sets, re-verified
// 2026-06-22, ordered by releaseDate). 173 sets, Base (1999) through
// Chaos Rising (2026).
// ---------------------------------------------------------------------------
const SET_SNAPSHOT: CatalogSet[] = [
  { id: "base1", name: "Base", series: "Base", printedTotal: 102, total: 102, releaseDate: "1999-01-09", ptcgoCode: "BS", symbolUrl: "https://images.pokemontcg.io/base1/symbol.png", logoUrl: "https://images.pokemontcg.io/base1/logo.png" },
  { id: "base2", name: "Jungle", series: "Base", printedTotal: 64, total: 64, releaseDate: "1999-06-16", ptcgoCode: "JU", symbolUrl: "https://images.pokemontcg.io/base2/symbol.png", logoUrl: "https://images.pokemontcg.io/base2/logo.png" },
  { id: "basep", name: "Wizards Black Star Promos", series: "Base", printedTotal: 53, total: 53, releaseDate: "1999-07-01", ptcgoCode: "PR", symbolUrl: "https://images.pokemontcg.io/basep/symbol.png", logoUrl: "https://images.pokemontcg.io/basep/logo.png" },
  { id: "base3", name: "Fossil", series: "Base", printedTotal: 62, total: 62, releaseDate: "1999-10-10", ptcgoCode: "FO", symbolUrl: "https://images.pokemontcg.io/base3/symbol.png", logoUrl: "https://images.pokemontcg.io/base3/logo.png" },
  { id: "base4", name: "Base Set 2", series: "Base", printedTotal: 130, total: 130, releaseDate: "2000-02-24", ptcgoCode: "B2", symbolUrl: "https://images.pokemontcg.io/base4/symbol.png", logoUrl: "https://images.pokemontcg.io/base4/logo.png" },
  { id: "base5", name: "Team Rocket", series: "Base", printedTotal: 82, total: 83, releaseDate: "2000-04-24", ptcgoCode: "TR", symbolUrl: "https://images.pokemontcg.io/base5/symbol.png", logoUrl: "https://images.pokemontcg.io/base5/logo.png" },
  { id: "gym1", name: "Gym Heroes", series: "Gym", printedTotal: 132, total: 132, releaseDate: "2000-08-14", ptcgoCode: "G1", symbolUrl: "https://images.pokemontcg.io/gym1/symbol.png", logoUrl: "https://images.pokemontcg.io/gym1/logo.png" },
  { id: "gym2", name: "Gym Challenge", series: "Gym", printedTotal: 132, total: 132, releaseDate: "2000-10-16", ptcgoCode: "G2", symbolUrl: "https://images.pokemontcg.io/gym2/symbol.png", logoUrl: "https://images.pokemontcg.io/gym2/logo.png" },
  { id: "neo1", name: "Neo Genesis", series: "Neo", printedTotal: 111, total: 111, releaseDate: "2000-12-16", ptcgoCode: "N1", symbolUrl: "https://images.pokemontcg.io/neo1/symbol.png", logoUrl: "https://images.pokemontcg.io/neo1/logo.png" },
  { id: "neo2", name: "Neo Discovery", series: "Neo", printedTotal: 75, total: 75, releaseDate: "2001-06-01", ptcgoCode: "N2", symbolUrl: "https://images.pokemontcg.io/neo2/symbol.png", logoUrl: "https://images.pokemontcg.io/neo2/logo.png" },
  { id: "si1", name: "Southern Islands", series: "Other", printedTotal: 18, total: 18, releaseDate: "2001-07-31", symbolUrl: "https://images.pokemontcg.io/si1/symbol.png", logoUrl: "https://images.pokemontcg.io/si1/logo.png" },
  { id: "neo3", name: "Neo Revelation", series: "Neo", printedTotal: 64, total: 66, releaseDate: "2001-09-21", ptcgoCode: "N3", symbolUrl: "https://images.pokemontcg.io/neo3/symbol.png", logoUrl: "https://images.pokemontcg.io/neo3/logo.png" },
  { id: "neo4", name: "Neo Destiny", series: "Neo", printedTotal: 105, total: 113, releaseDate: "2002-02-28", ptcgoCode: "N4", symbolUrl: "https://images.pokemontcg.io/neo4/symbol.png", logoUrl: "https://images.pokemontcg.io/neo4/logo.png" },
  { id: "base6", name: "Legendary Collection", series: "Other", printedTotal: 110, total: 110, releaseDate: "2002-05-24", ptcgoCode: "LC", symbolUrl: "https://images.pokemontcg.io/base6/symbol.png", logoUrl: "https://images.pokemontcg.io/base6/logo.png" },
  { id: "ecard1", name: "Expedition Base Set", series: "E-Card", printedTotal: 165, total: 165, releaseDate: "2002-09-15", ptcgoCode: "EX", symbolUrl: "https://images.pokemontcg.io/ecard1/symbol.png", logoUrl: "https://images.pokemontcg.io/ecard1/logo.png" },
  { id: "bp", name: "Best of Game", series: "Other", printedTotal: 9, total: 9, releaseDate: "2002-12-01", ptcgoCode: "BP", symbolUrl: "https://images.pokemontcg.io/bp/symbol.png", logoUrl: "https://images.pokemontcg.io/bp/logo.png" },
  { id: "ecard2", name: "Aquapolis", series: "E-Card", printedTotal: 147, total: 182, releaseDate: "2003-01-15", ptcgoCode: "AQ", symbolUrl: "https://images.pokemontcg.io/ecard2/symbol.png", logoUrl: "https://images.pokemontcg.io/ecard2/logo.png" },
  { id: "ecard3", name: "Skyridge", series: "E-Card", printedTotal: 144, total: 182, releaseDate: "2003-05-12", ptcgoCode: "SK", symbolUrl: "https://images.pokemontcg.io/ecard3/symbol.png", logoUrl: "https://images.pokemontcg.io/ecard3/logo.png" },
  { id: "ex1", name: "Ruby & Sapphire", series: "EX", printedTotal: 109, total: 109, releaseDate: "2003-07-01", ptcgoCode: "RS", symbolUrl: "https://images.pokemontcg.io/ex1/symbol.png", logoUrl: "https://images.pokemontcg.io/ex1/logo.png" },
  { id: "ex2", name: "Sandstorm", series: "EX", printedTotal: 100, total: 100, releaseDate: "2003-09-18", ptcgoCode: "SS", symbolUrl: "https://images.pokemontcg.io/ex2/symbol.png", logoUrl: "https://images.pokemontcg.io/ex2/logo.png" },
  { id: "np", name: "Nintendo Black Star Promos", series: "NP", printedTotal: 40, total: 40, releaseDate: "2003-10-01", ptcgoCode: "PR-NP", symbolUrl: "https://images.pokemontcg.io/np/symbol.png", logoUrl: "https://images.pokemontcg.io/np/logo.png" },
  { id: "ex3", name: "Dragon", series: "EX", printedTotal: 97, total: 100, releaseDate: "2003-11-24", ptcgoCode: "DR", symbolUrl: "https://images.pokemontcg.io/ex3/symbol.png", logoUrl: "https://images.pokemontcg.io/ex3/logo.png" },
  { id: "ex4", name: "Team Magma vs Team Aqua", series: "EX", printedTotal: 95, total: 97, releaseDate: "2004-03-01", ptcgoCode: "MA", symbolUrl: "https://images.pokemontcg.io/ex4/symbol.png", logoUrl: "https://images.pokemontcg.io/ex4/logo.png" },
  { id: "ex5", name: "Hidden Legends", series: "EX", printedTotal: 101, total: 102, releaseDate: "2004-06-01", ptcgoCode: "HL", symbolUrl: "https://images.pokemontcg.io/ex5/symbol.png", logoUrl: "https://images.pokemontcg.io/ex5/logo.png" },
  { id: "tk1b", name: "EX Trainer Kit Latios", series: "EX", printedTotal: 10, total: 10, releaseDate: "2004-06-01", symbolUrl: "https://images.pokemontcg.io/tk1b/symbol.png", logoUrl: "https://images.pokemontcg.io/tk1b/logo.png" },
  { id: "tk1a", name: "EX Trainer Kit Latias", series: "EX", printedTotal: 10, total: 10, releaseDate: "2004-06-01", symbolUrl: "https://images.pokemontcg.io/tk1a/symbol.png", logoUrl: "https://images.pokemontcg.io/tk1a/logo.png" },
  { id: "ex6", name: "FireRed & LeafGreen", series: "EX", printedTotal: 112, total: 116, releaseDate: "2004-09-01", ptcgoCode: "RG", symbolUrl: "https://images.pokemontcg.io/ex6/symbol.png", logoUrl: "https://images.pokemontcg.io/ex6/logo.png" },
  { id: "pop1", name: "POP Series 1", series: "POP", printedTotal: 17, total: 17, releaseDate: "2004-09-01", symbolUrl: "https://images.pokemontcg.io/pop1/symbol.png", logoUrl: "https://images.pokemontcg.io/pop1/logo.png" },
  { id: "ex7", name: "Team Rocket Returns", series: "EX", printedTotal: 109, total: 111, releaseDate: "2004-11-01", ptcgoCode: "TRR", symbolUrl: "https://images.pokemontcg.io/ex7/symbol.png", logoUrl: "https://images.pokemontcg.io/ex7/logo.png" },
  { id: "ex8", name: "Deoxys", series: "EX", printedTotal: 107, total: 108, releaseDate: "2005-02-01", ptcgoCode: "DX", symbolUrl: "https://images.pokemontcg.io/ex8/symbol.png", logoUrl: "https://images.pokemontcg.io/ex8/logo.png" },
  { id: "ex9", name: "Emerald", series: "EX", printedTotal: 106, total: 107, releaseDate: "2005-05-01", ptcgoCode: "EM", symbolUrl: "https://images.pokemontcg.io/ex9/symbol.png", logoUrl: "https://images.pokemontcg.io/ex9/logo.png" },
  { id: "ex10", name: "Unseen Forces", series: "EX", printedTotal: 115, total: 145, releaseDate: "2005-08-01", ptcgoCode: "UF", symbolUrl: "https://images.pokemontcg.io/ex10/symbol.png", logoUrl: "https://images.pokemontcg.io/ex10/logo.png" },
  { id: "pop2", name: "POP Series 2", series: "POP", printedTotal: 17, total: 17, releaseDate: "2005-08-01", symbolUrl: "https://images.pokemontcg.io/pop2/symbol.png", logoUrl: "https://images.pokemontcg.io/pop2/logo.png" },
  { id: "ex11", name: "Delta Species", series: "EX", printedTotal: 113, total: 114, releaseDate: "2005-10-31", ptcgoCode: "DS", symbolUrl: "https://images.pokemontcg.io/ex11/symbol.png", logoUrl: "https://images.pokemontcg.io/ex11/logo.png" },
  { id: "ex12", name: "Legend Maker", series: "EX", printedTotal: 92, total: 93, releaseDate: "2006-02-01", ptcgoCode: "LM", symbolUrl: "https://images.pokemontcg.io/ex12/symbol.png", logoUrl: "https://images.pokemontcg.io/ex12/logo.png" },
  { id: "tk2b", name: "EX Trainer Kit 2 Minun", series: "EX", printedTotal: 12, total: 12, releaseDate: "2006-03-01", symbolUrl: "https://images.pokemontcg.io/tk2b/symbol.png", logoUrl: "https://images.pokemontcg.io/tk2b/logo.png" },
  { id: "tk2a", name: "EX Trainer Kit 2 Plusle", series: "EX", printedTotal: 12, total: 12, releaseDate: "2006-03-01", symbolUrl: "https://images.pokemontcg.io/tk2a/symbol.png", logoUrl: "https://images.pokemontcg.io/tk2a/logo.png" },
  { id: "pop3", name: "POP Series 3", series: "POP", printedTotal: 17, total: 17, releaseDate: "2006-04-01", symbolUrl: "https://images.pokemontcg.io/pop3/symbol.png", logoUrl: "https://images.pokemontcg.io/pop3/logo.png" },
  { id: "ex13", name: "Holon Phantoms", series: "EX", printedTotal: 110, total: 111, releaseDate: "2006-05-01", ptcgoCode: "HP", symbolUrl: "https://images.pokemontcg.io/ex13/symbol.png", logoUrl: "https://images.pokemontcg.io/ex13/logo.png" },
  { id: "ex14", name: "Crystal Guardians", series: "EX", printedTotal: 100, total: 100, releaseDate: "2006-08-01", ptcgoCode: "CG", symbolUrl: "https://images.pokemontcg.io/ex14/symbol.png", logoUrl: "https://images.pokemontcg.io/ex14/logo.png" },
  { id: "pop4", name: "POP Series 4", series: "POP", printedTotal: 17, total: 17, releaseDate: "2006-08-01", symbolUrl: "https://images.pokemontcg.io/pop4/symbol.png", logoUrl: "https://images.pokemontcg.io/pop4/logo.png" },
  { id: "ex15", name: "Dragon Frontiers", series: "EX", printedTotal: 101, total: 101, releaseDate: "2006-11-01", ptcgoCode: "DF", symbolUrl: "https://images.pokemontcg.io/ex15/symbol.png", logoUrl: "https://images.pokemontcg.io/ex15/logo.png" },
  { id: "ex16", name: "Power Keepers", series: "EX", printedTotal: 108, total: 108, releaseDate: "2007-02-02", ptcgoCode: "PK", symbolUrl: "https://images.pokemontcg.io/ex16/symbol.png", logoUrl: "https://images.pokemontcg.io/ex16/logo.png" },
  { id: "pop5", name: "POP Series 5", series: "POP", printedTotal: 17, total: 17, releaseDate: "2007-03-01", symbolUrl: "https://images.pokemontcg.io/pop5/symbol.png", logoUrl: "https://images.pokemontcg.io/pop5/logo.png" },
  { id: "dp1", name: "Diamond & Pearl", series: "Diamond & Pearl", printedTotal: 130, total: 130, releaseDate: "2007-05-01", ptcgoCode: "DP", symbolUrl: "https://images.pokemontcg.io/dp1/symbol.png", logoUrl: "https://images.pokemontcg.io/dp1/logo.png" },
  { id: "dpp", name: "DP Black Star Promos", series: "Diamond & Pearl", printedTotal: 56, total: 56, releaseDate: "2007-05-01", ptcgoCode: "PR-DPP", symbolUrl: "https://images.pokemontcg.io/dpp/symbol.png", logoUrl: "https://images.pokemontcg.io/dpp/logo.png" },
  { id: "dp2", name: "Mysterious Treasures", series: "Diamond & Pearl", printedTotal: 123, total: 124, releaseDate: "2007-08-01", ptcgoCode: "MT", symbolUrl: "https://images.pokemontcg.io/dp2/symbol.png", logoUrl: "https://images.pokemontcg.io/dp2/logo.png" },
  { id: "pop6", name: "POP Series 6", series: "POP", printedTotal: 17, total: 17, releaseDate: "2007-09-01", symbolUrl: "https://images.pokemontcg.io/pop6/symbol.png", logoUrl: "https://images.pokemontcg.io/pop6/logo.png" },
  { id: "dp3", name: "Secret Wonders", series: "Diamond & Pearl", printedTotal: 132, total: 132, releaseDate: "2007-11-01", ptcgoCode: "SW", symbolUrl: "https://images.pokemontcg.io/dp3/symbol.png", logoUrl: "https://images.pokemontcg.io/dp3/logo.png" },
  { id: "dp4", name: "Great Encounters", series: "Diamond & Pearl", printedTotal: 106, total: 106, releaseDate: "2008-02-01", ptcgoCode: "GE", symbolUrl: "https://images.pokemontcg.io/dp4/symbol.png", logoUrl: "https://images.pokemontcg.io/dp4/logo.png" },
  { id: "pop7", name: "POP Series 7", series: "POP", printedTotal: 17, total: 17, releaseDate: "2008-03-01", symbolUrl: "https://images.pokemontcg.io/pop7/symbol.png", logoUrl: "https://images.pokemontcg.io/pop7/logo.png" },
  { id: "dp5", name: "Majestic Dawn", series: "Diamond & Pearl", printedTotal: 100, total: 100, releaseDate: "2008-05-01", ptcgoCode: "MD", symbolUrl: "https://images.pokemontcg.io/dp5/symbol.png", logoUrl: "https://images.pokemontcg.io/dp5/logo.png" },
  { id: "dp6", name: "Legends Awakened", series: "Diamond & Pearl", printedTotal: 146, total: 146, releaseDate: "2008-08-01", ptcgoCode: "LA", symbolUrl: "https://images.pokemontcg.io/dp6/symbol.png", logoUrl: "https://images.pokemontcg.io/dp6/logo.png" },
  { id: "pop8", name: "POP Series 8", series: "POP", printedTotal: 17, total: 17, releaseDate: "2008-09-01", symbolUrl: "https://images.pokemontcg.io/pop8/symbol.png", logoUrl: "https://images.pokemontcg.io/pop8/logo.png" },
  { id: "dp7", name: "Stormfront", series: "Diamond & Pearl", printedTotal: 100, total: 106, releaseDate: "2008-11-01", ptcgoCode: "SF", symbolUrl: "https://images.pokemontcg.io/dp7/symbol.png", logoUrl: "https://images.pokemontcg.io/dp7/logo.png" },
  { id: "pl1", name: "Platinum", series: "Platinum", printedTotal: 127, total: 133, releaseDate: "2009-02-11", ptcgoCode: "PL", symbolUrl: "https://images.pokemontcg.io/pl1/symbol.png", logoUrl: "https://images.pokemontcg.io/pl1/logo.png" },
  { id: "pop9", name: "POP Series 9", series: "POP", printedTotal: 17, total: 17, releaseDate: "2009-03-01", symbolUrl: "https://images.pokemontcg.io/pop9/symbol.png", logoUrl: "https://images.pokemontcg.io/pop9/logo.png" },
  { id: "pl2", name: "Rising Rivals", series: "Platinum", printedTotal: 111, total: 120, releaseDate: "2009-05-16", ptcgoCode: "RR", symbolUrl: "https://images.pokemontcg.io/pl2/symbol.png", logoUrl: "https://images.pokemontcg.io/pl2/logo.png" },
  { id: "pl3", name: "Supreme Victors", series: "Platinum", printedTotal: 147, total: 153, releaseDate: "2009-08-19", ptcgoCode: "SV", symbolUrl: "https://images.pokemontcg.io/pl3/symbol.png", logoUrl: "https://images.pokemontcg.io/pl3/logo.png" },
  { id: "pl4", name: "Arceus", series: "Platinum", printedTotal: 99, total: 111, releaseDate: "2009-11-04", ptcgoCode: "AR", symbolUrl: "https://images.pokemontcg.io/pl4/symbol.png", logoUrl: "https://images.pokemontcg.io/pl4/logo.png" },
  { id: "ru1", name: "Pokémon Rumble", series: "Other", printedTotal: 16, total: 16, releaseDate: "2009-12-02", symbolUrl: "https://images.pokemontcg.io/ru1/symbol.png", logoUrl: "https://images.pokemontcg.io/ru1/logo.png" },
  { id: "hgss1", name: "HeartGold & SoulSilver", series: "HeartGold & SoulSilver", printedTotal: 123, total: 124, releaseDate: "2010-02-10", ptcgoCode: "HS", symbolUrl: "https://images.pokemontcg.io/hgss1/symbol.png", logoUrl: "https://images.pokemontcg.io/hgss1/logo.png" },
  { id: "hsp", name: "HGSS Black Star Promos", series: "HeartGold & SoulSilver", printedTotal: 25, total: 25, releaseDate: "2010-02-10", ptcgoCode: "PR-HS", symbolUrl: "https://images.pokemontcg.io/hsp/symbol.png", logoUrl: "https://images.pokemontcg.io/hsp/logo.png" },
  { id: "hgss2", name: "HS—Unleashed", series: "HeartGold & SoulSilver", printedTotal: 95, total: 96, releaseDate: "2010-05-12", ptcgoCode: "UL", symbolUrl: "https://images.pokemontcg.io/hgss2/symbol.png", logoUrl: "https://images.pokemontcg.io/hgss2/logo.png" },
  { id: "hgss3", name: "HS—Undaunted", series: "HeartGold & SoulSilver", printedTotal: 90, total: 91, releaseDate: "2010-08-18", ptcgoCode: "UD", symbolUrl: "https://images.pokemontcg.io/hgss3/symbol.png", logoUrl: "https://images.pokemontcg.io/hgss3/logo.png" },
  { id: "hgss4", name: "HS—Triumphant", series: "HeartGold & SoulSilver", printedTotal: 102, total: 103, releaseDate: "2010-11-03", ptcgoCode: "TM", symbolUrl: "https://images.pokemontcg.io/hgss4/symbol.png", logoUrl: "https://images.pokemontcg.io/hgss4/logo.png" },
  { id: "col1", name: "Call of Legends", series: "HeartGold & SoulSilver", printedTotal: 95, total: 106, releaseDate: "2011-02-09", ptcgoCode: "CL", symbolUrl: "https://images.pokemontcg.io/col1/symbol.png", logoUrl: "https://images.pokemontcg.io/col1/logo.png" },
  { id: "bwp", name: "BW Black Star Promos", series: "Black & White", printedTotal: 101, total: 101, releaseDate: "2011-03-01", ptcgoCode: "PR-BLW", symbolUrl: "https://images.pokemontcg.io/bwp/symbol.png", logoUrl: "https://images.pokemontcg.io/bwp/logo.png" },
  { id: "bw1", name: "Black & White", series: "Black & White", printedTotal: 114, total: 115, releaseDate: "2011-04-25", ptcgoCode: "BLW", symbolUrl: "https://images.pokemontcg.io/bw1/symbol.png", logoUrl: "https://images.pokemontcg.io/bw1/logo.png" },
  { id: "mcd11", name: "McDonald's Collection 2011", series: "Other", printedTotal: 12, total: 12, releaseDate: "2011-06-17", symbolUrl: "https://images.pokemontcg.io/mcd11/symbol.png", logoUrl: "https://images.pokemontcg.io/mcd11/logo.png" },
  { id: "bw2", name: "Emerging Powers", series: "Black & White", printedTotal: 98, total: 98, releaseDate: "2011-08-31", ptcgoCode: "EPO", symbolUrl: "https://images.pokemontcg.io/bw2/symbol.png", logoUrl: "https://images.pokemontcg.io/bw2/logo.png" },
  { id: "bw3", name: "Noble Victories", series: "Black & White", printedTotal: 101, total: 102, releaseDate: "2011-11-16", ptcgoCode: "NVI", symbolUrl: "https://images.pokemontcg.io/bw3/symbol.png", logoUrl: "https://images.pokemontcg.io/bw3/logo.png" },
  { id: "bw4", name: "Next Destinies", series: "Black & White", printedTotal: 99, total: 103, releaseDate: "2012-02-08", ptcgoCode: "NXD", symbolUrl: "https://images.pokemontcg.io/bw4/symbol.png", logoUrl: "https://images.pokemontcg.io/bw4/logo.png" },
  { id: "bw5", name: "Dark Explorers", series: "Black & White", printedTotal: 108, total: 111, releaseDate: "2012-05-09", ptcgoCode: "DEX", symbolUrl: "https://images.pokemontcg.io/bw5/symbol.png", logoUrl: "https://images.pokemontcg.io/bw5/logo.png" },
  { id: "mcd12", name: "McDonald's Collection 2012", series: "Other", printedTotal: 12, total: 12, releaseDate: "2012-06-15", symbolUrl: "https://images.pokemontcg.io/mcd12/symbol.png", logoUrl: "https://images.pokemontcg.io/mcd12/logo.png" },
  { id: "bw6", name: "Dragons Exalted", series: "Black & White", printedTotal: 124, total: 128, releaseDate: "2012-08-15", ptcgoCode: "DRX", symbolUrl: "https://images.pokemontcg.io/bw6/symbol.png", logoUrl: "https://images.pokemontcg.io/bw6/logo.png" },
  { id: "dv1", name: "Dragon Vault", series: "Black & White", printedTotal: 20, total: 21, releaseDate: "2012-10-05", ptcgoCode: "DRV", symbolUrl: "https://images.pokemontcg.io/dv1/symbol.png", logoUrl: "https://images.pokemontcg.io/dv1/logo.png" },
  { id: "bw7", name: "Boundaries Crossed", series: "Black & White", printedTotal: 149, total: 153, releaseDate: "2012-11-07", ptcgoCode: "BCR", symbolUrl: "https://images.pokemontcg.io/bw7/symbol.png", logoUrl: "https://images.pokemontcg.io/bw7/logo.png" },
  { id: "bw8", name: "Plasma Storm", series: "Black & White", printedTotal: 135, total: 138, releaseDate: "2013-02-06", ptcgoCode: "PLS", symbolUrl: "https://images.pokemontcg.io/bw8/symbol.png", logoUrl: "https://images.pokemontcg.io/bw8/logo.png" },
  { id: "bw9", name: "Plasma Freeze", series: "Black & White", printedTotal: 116, total: 122, releaseDate: "2013-05-08", ptcgoCode: "PLF", symbolUrl: "https://images.pokemontcg.io/bw9/symbol.png", logoUrl: "https://images.pokemontcg.io/bw9/logo.png" },
  { id: "bw10", name: "Plasma Blast", series: "Black & White", printedTotal: 101, total: 105, releaseDate: "2013-08-14", ptcgoCode: "PLB", symbolUrl: "https://images.pokemontcg.io/bw10/symbol.png", logoUrl: "https://images.pokemontcg.io/bw10/logo.png" },
  { id: "xyp", name: "XY Black Star Promos", series: "XY", printedTotal: 211, total: 216, releaseDate: "2013-10-12", ptcgoCode: "PR-XY", symbolUrl: "https://images.pokemontcg.io/xyp/symbol.png", logoUrl: "https://images.pokemontcg.io/xyp/logo.png" },
  { id: "bw11", name: "Legendary Treasures", series: "Black & White", printedTotal: 113, total: 140, releaseDate: "2013-11-06", ptcgoCode: "LTR", symbolUrl: "https://images.pokemontcg.io/bw11/symbol.png", logoUrl: "https://images.pokemontcg.io/bw11/logo.png" },
  { id: "xy0", name: "Kalos Starter Set", series: "XY", printedTotal: 39, total: 39, releaseDate: "2013-11-08", ptcgoCode: "KSS", symbolUrl: "https://images.pokemontcg.io/xy0/symbol.png", logoUrl: "https://images.pokemontcg.io/xy0/logo.png" },
  { id: "xy1", name: "XY", series: "XY", printedTotal: 146, total: 146, releaseDate: "2014-02-05", ptcgoCode: "XY", symbolUrl: "https://images.pokemontcg.io/xy1/symbol.png", logoUrl: "https://images.pokemontcg.io/xy1/logo.png" },
  { id: "xy2", name: "Flashfire", series: "XY", printedTotal: 106, total: 110, releaseDate: "2014-05-07", ptcgoCode: "FLF", symbolUrl: "https://images.pokemontcg.io/xy2/symbol.png", logoUrl: "https://images.pokemontcg.io/xy2/logo.png" },
  { id: "mcd14", name: "McDonald's Collection 2014", series: "Other", printedTotal: 12, total: 12, releaseDate: "2014-05-23", symbolUrl: "https://images.pokemontcg.io/mcd14/symbol.png", logoUrl: "https://images.pokemontcg.io/mcd14/logo.png" },
  { id: "xy3", name: "Furious Fists", series: "XY", printedTotal: 111, total: 114, releaseDate: "2014-08-13", ptcgoCode: "FFI", symbolUrl: "https://images.pokemontcg.io/xy3/symbol.png", logoUrl: "https://images.pokemontcg.io/xy3/logo.png" },
  { id: "xy4", name: "Phantom Forces", series: "XY", printedTotal: 119, total: 124, releaseDate: "2014-11-05", ptcgoCode: "PHF", symbolUrl: "https://images.pokemontcg.io/xy4/symbol.png", logoUrl: "https://images.pokemontcg.io/xy4/logo.png" },
  { id: "xy5", name: "Primal Clash", series: "XY", printedTotal: 160, total: 164, releaseDate: "2015-02-04", ptcgoCode: "PRC", symbolUrl: "https://images.pokemontcg.io/xy5/symbol.png", logoUrl: "https://images.pokemontcg.io/xy5/logo.png" },
  { id: "dc1", name: "Double Crisis", series: "XY", printedTotal: 34, total: 34, releaseDate: "2015-03-25", ptcgoCode: "DCR", symbolUrl: "https://images.pokemontcg.io/dc1/symbol.png", logoUrl: "https://images.pokemontcg.io/dc1/logo.png" },
  { id: "xy6", name: "Roaring Skies", series: "XY", printedTotal: 108, total: 112, releaseDate: "2015-05-06", ptcgoCode: "ROS", symbolUrl: "https://images.pokemontcg.io/xy6/symbol.png", logoUrl: "https://images.pokemontcg.io/xy6/logo.png" },
  { id: "xy7", name: "Ancient Origins", series: "XY", printedTotal: 98, total: 100, releaseDate: "2015-08-12", ptcgoCode: "AOR", symbolUrl: "https://images.pokemontcg.io/xy7/symbol.png", logoUrl: "https://images.pokemontcg.io/xy7/logo.png" },
  { id: "xy8", name: "BREAKthrough", series: "XY", printedTotal: 162, total: 165, releaseDate: "2015-11-04", ptcgoCode: "BKT", symbolUrl: "https://images.pokemontcg.io/xy8/symbol.png", logoUrl: "https://images.pokemontcg.io/xy8/logo.png" },
  { id: "mcd15", name: "McDonald's Collection 2015", series: "Other", printedTotal: 12, total: 12, releaseDate: "2015-11-27", symbolUrl: "https://images.pokemontcg.io/mcd15/symbol.png", logoUrl: "https://images.pokemontcg.io/mcd15/logo.png" },
  { id: "xy9", name: "BREAKpoint", series: "XY", printedTotal: 122, total: 126, releaseDate: "2016-02-03", ptcgoCode: "BKP", symbolUrl: "https://images.pokemontcg.io/xy9/symbol.png", logoUrl: "https://images.pokemontcg.io/xy9/logo.png" },
  { id: "g1", name: "Generations", series: "XY", printedTotal: 83, total: 117, releaseDate: "2016-02-22", ptcgoCode: "GEN", symbolUrl: "https://images.pokemontcg.io/g1/symbol.png", logoUrl: "https://images.pokemontcg.io/g1/logo.png" },
  { id: "xy10", name: "Fates Collide", series: "XY", printedTotal: 124, total: 129, releaseDate: "2016-05-02", ptcgoCode: "FCO", symbolUrl: "https://images.pokemontcg.io/xy10/symbol.png", logoUrl: "https://images.pokemontcg.io/xy10/logo.png" },
  { id: "xy11", name: "Steam Siege", series: "XY", printedTotal: 114, total: 116, releaseDate: "2016-08-03", ptcgoCode: "STS", symbolUrl: "https://images.pokemontcg.io/xy11/symbol.png", logoUrl: "https://images.pokemontcg.io/xy11/logo.png" },
  { id: "mcd16", name: "McDonald's Collection 2016", series: "Other", printedTotal: 12, total: 12, releaseDate: "2016-08-19", symbolUrl: "https://images.pokemontcg.io/mcd16/symbol.png", logoUrl: "https://images.pokemontcg.io/mcd16/logo.png" },
  { id: "xy12", name: "Evolutions", series: "XY", printedTotal: 108, total: 113, releaseDate: "2016-11-02", ptcgoCode: "EVO", symbolUrl: "https://images.pokemontcg.io/xy12/symbol.png", logoUrl: "https://images.pokemontcg.io/xy12/logo.png" },
  { id: "sm1", name: "Sun & Moon", series: "Sun & Moon", printedTotal: 149, total: 173, releaseDate: "2017-02-03", ptcgoCode: "SUM", symbolUrl: "https://images.pokemontcg.io/sm1/symbol.png", logoUrl: "https://images.pokemontcg.io/sm1/logo.png" },
  { id: "smp", name: "SM Black Star Promos", series: "Sun & Moon", printedTotal: 248, total: 250, releaseDate: "2017-02-03", ptcgoCode: "PR-SM", symbolUrl: "https://images.pokemontcg.io/smp/symbol.png", logoUrl: "https://images.pokemontcg.io/smp/logo.png" },
  { id: "sm2", name: "Guardians Rising", series: "Sun & Moon", printedTotal: 145, total: 180, releaseDate: "2017-05-05", ptcgoCode: "GRI", symbolUrl: "https://images.pokemontcg.io/sm2/symbol.png", logoUrl: "https://images.pokemontcg.io/sm2/logo.png" },
  { id: "sm3", name: "Burning Shadows", series: "Sun & Moon", printedTotal: 147, total: 177, releaseDate: "2017-08-05", ptcgoCode: "BUS", symbolUrl: "https://images.pokemontcg.io/sm3/symbol.png", logoUrl: "https://images.pokemontcg.io/sm3/logo.png" },
  { id: "sm35", name: "Shining Legends", series: "Sun & Moon", printedTotal: 73, total: 81, releaseDate: "2017-10-06", ptcgoCode: "SLG", symbolUrl: "https://images.pokemontcg.io/sm35/symbol.png", logoUrl: "https://images.pokemontcg.io/sm35/logo.png" },
  { id: "sm4", name: "Crimson Invasion", series: "Sun & Moon", printedTotal: 111, total: 126, releaseDate: "2017-11-03", ptcgoCode: "CIN", symbolUrl: "https://images.pokemontcg.io/sm4/symbol.png", logoUrl: "https://images.pokemontcg.io/sm4/logo.png" },
  { id: "mcd17", name: "McDonald's Collection 2017", series: "Other", printedTotal: 12, total: 12, releaseDate: "2017-11-07", symbolUrl: "https://images.pokemontcg.io/mcd17/symbol.png", logoUrl: "https://images.pokemontcg.io/mcd17/logo.png" },
  { id: "sm5", name: "Ultra Prism", series: "Sun & Moon", printedTotal: 156, total: 178, releaseDate: "2018-02-02", ptcgoCode: "UPR", symbolUrl: "https://images.pokemontcg.io/sm5/symbol.png", logoUrl: "https://images.pokemontcg.io/sm5/logo.png" },
  { id: "sm6", name: "Forbidden Light", series: "Sun & Moon", printedTotal: 131, total: 150, releaseDate: "2018-05-04", ptcgoCode: "FLI", symbolUrl: "https://images.pokemontcg.io/sm6/symbol.png", logoUrl: "https://images.pokemontcg.io/sm6/logo.png" },
  { id: "sm7", name: "Celestial Storm", series: "Sun & Moon", printedTotal: 168, total: 187, releaseDate: "2018-08-03", ptcgoCode: "CES", symbolUrl: "https://images.pokemontcg.io/sm7/symbol.png", logoUrl: "https://images.pokemontcg.io/sm7/logo.png" },
  { id: "sm75", name: "Dragon Majesty", series: "Sun & Moon", printedTotal: 70, total: 80, releaseDate: "2018-09-07", ptcgoCode: "DRM", symbolUrl: "https://images.pokemontcg.io/sm75/symbol.png", logoUrl: "https://images.pokemontcg.io/sm75/logo.png" },
  { id: "mcd18", name: "McDonald's Collection 2018", series: "Other", printedTotal: 12, total: 12, releaseDate: "2018-10-16", symbolUrl: "https://images.pokemontcg.io/mcd18/symbol.png", logoUrl: "https://images.pokemontcg.io/mcd18/logo.png" },
  { id: "sm8", name: "Lost Thunder", series: "Sun & Moon", printedTotal: 214, total: 240, releaseDate: "2018-11-02", ptcgoCode: "LOT", symbolUrl: "https://images.pokemontcg.io/sm8/symbol.png", logoUrl: "https://images.pokemontcg.io/sm8/logo.png" },
  { id: "sm9", name: "Team Up", series: "Sun & Moon", printedTotal: 181, total: 198, releaseDate: "2019-02-01", ptcgoCode: "TEU", symbolUrl: "https://images.pokemontcg.io/sm9/symbol.png", logoUrl: "https://images.pokemontcg.io/sm9/logo.png" },
  { id: "det1", name: "Detective Pikachu", series: "Sun & Moon", printedTotal: 18, total: 18, releaseDate: "2019-04-05", ptcgoCode: "DET", symbolUrl: "https://images.pokemontcg.io/det1/symbol.png", logoUrl: "https://images.pokemontcg.io/det1/logo.png" },
  { id: "sm10", name: "Unbroken Bonds", series: "Sun & Moon", printedTotal: 214, total: 234, releaseDate: "2019-05-03", ptcgoCode: "UNB", symbolUrl: "https://images.pokemontcg.io/sm10/symbol.png", logoUrl: "https://images.pokemontcg.io/sm10/logo.png" },
  { id: "sm11", name: "Unified Minds", series: "Sun & Moon", printedTotal: 236, total: 260, releaseDate: "2019-08-02", ptcgoCode: "UNM", symbolUrl: "https://images.pokemontcg.io/sm11/symbol.png", logoUrl: "https://images.pokemontcg.io/sm11/logo.png" },
  { id: "sma", name: "Hidden Fates Shiny Vault", series: "Sun & Moon", printedTotal: 94, total: 94, releaseDate: "2019-08-23", ptcgoCode: "HIF", symbolUrl: "https://images.pokemontcg.io/sma/symbol.png", logoUrl: "https://images.pokemontcg.io/sma/logo.png" },
  { id: "sm115", name: "Hidden Fates", series: "Sun & Moon", printedTotal: 68, total: 69, releaseDate: "2019-08-23", ptcgoCode: "HIF", symbolUrl: "https://images.pokemontcg.io/sm115/symbol.png", logoUrl: "https://images.pokemontcg.io/sm115/logo.png" },
  { id: "mcd19", name: "McDonald's Collection 2019", series: "Other", printedTotal: 12, total: 12, releaseDate: "2019-10-15", symbolUrl: "https://images.pokemontcg.io/mcd19/symbol.png", logoUrl: "https://images.pokemontcg.io/mcd19/logo.png" },
  { id: "sm12", name: "Cosmic Eclipse", series: "Sun & Moon", printedTotal: 236, total: 272, releaseDate: "2019-11-01", ptcgoCode: "CEC", symbolUrl: "https://images.pokemontcg.io/sm12/symbol.png", logoUrl: "https://images.pokemontcg.io/sm12/logo.png" },
  { id: "swshp", name: "SWSH Black Star Promos", series: "Sword & Shield", printedTotal: 307, total: 304, releaseDate: "2019-11-15", ptcgoCode: "PR-SW", symbolUrl: "https://images.pokemontcg.io/swshp/symbol.png", logoUrl: "https://images.pokemontcg.io/swshp/logo.png" },
  { id: "swsh1", name: "Sword & Shield", series: "Sword & Shield", printedTotal: 202, total: 216, releaseDate: "2020-02-07", ptcgoCode: "SSH", symbolUrl: "https://images.pokemontcg.io/swsh1/symbol.png", logoUrl: "https://images.pokemontcg.io/swsh1/logo.png" },
  { id: "swsh2", name: "Rebel Clash", series: "Sword & Shield", printedTotal: 192, total: 209, releaseDate: "2020-05-01", ptcgoCode: "RCL", symbolUrl: "https://images.pokemontcg.io/swsh2/symbol.png", logoUrl: "https://images.pokemontcg.io/swsh2/logo.png" },
  { id: "swsh3", name: "Darkness Ablaze", series: "Sword & Shield", printedTotal: 189, total: 201, releaseDate: "2020-08-14", ptcgoCode: "DAA", symbolUrl: "https://images.pokemontcg.io/swsh3/symbol.png", logoUrl: "https://images.pokemontcg.io/swsh3/logo.png" },
  { id: "fut20", name: "Pokémon Futsal Collection", series: "Other", printedTotal: 5, total: 5, releaseDate: "2020-09-11", ptcgoCode: "FUT20", symbolUrl: "https://images.pokemontcg.io/fut20/symbol.png", logoUrl: "https://images.pokemontcg.io/fut20/logo.png" },
  { id: "swsh35", name: "Champion's Path", series: "Sword & Shield", printedTotal: 73, total: 80, releaseDate: "2020-09-25", ptcgoCode: "CPA", symbolUrl: "https://images.pokemontcg.io/swsh35/symbol.png", logoUrl: "https://images.pokemontcg.io/swsh35/logo.png" },
  { id: "swsh4", name: "Vivid Voltage", series: "Sword & Shield", printedTotal: 185, total: 203, releaseDate: "2020-11-13", ptcgoCode: "VIV", symbolUrl: "https://images.pokemontcg.io/swsh4/symbol.png", logoUrl: "https://images.pokemontcg.io/swsh4/logo.png" },
  { id: "mcd21", name: "McDonald's Collection 2021", series: "Other", printedTotal: 25, total: 25, releaseDate: "2021-02-09", symbolUrl: "https://images.pokemontcg.io/mcd21/symbol.png", logoUrl: "https://images.pokemontcg.io/mcd21/logo.png" },
  { id: "swsh45sv", name: "Shining Fates Shiny Vault", series: "Sword & Shield", printedTotal: 122, total: 122, releaseDate: "2021-02-19", ptcgoCode: "SHF", symbolUrl: "https://images.pokemontcg.io/swsh45sv/symbol.png", logoUrl: "https://images.pokemontcg.io/swsh45sv/logo.png" },
  { id: "swsh45", name: "Shining Fates", series: "Sword & Shield", printedTotal: 72, total: 73, releaseDate: "2021-02-19", ptcgoCode: "SHF", symbolUrl: "https://images.pokemontcg.io/swsh45/symbol.png", logoUrl: "https://images.pokemontcg.io/swsh45/logo.png" },
  { id: "swsh5", name: "Battle Styles", series: "Sword & Shield", printedTotal: 163, total: 183, releaseDate: "2021-03-19", ptcgoCode: "BST", symbolUrl: "https://images.pokemontcg.io/swsh5/symbol.png", logoUrl: "https://images.pokemontcg.io/swsh5/logo.png" },
  { id: "swsh6", name: "Chilling Reign", series: "Sword & Shield", printedTotal: 198, total: 233, releaseDate: "2021-06-18", ptcgoCode: "CRE", symbolUrl: "https://images.pokemontcg.io/swsh6/symbol.png", logoUrl: "https://images.pokemontcg.io/swsh6/logo.png" },
  { id: "swsh7", name: "Evolving Skies", series: "Sword & Shield", printedTotal: 203, total: 237, releaseDate: "2021-08-27", ptcgoCode: "EVS", symbolUrl: "https://images.pokemontcg.io/swsh7/symbol.png", logoUrl: "https://images.pokemontcg.io/swsh7/logo.png" },
  { id: "cel25", name: "Celebrations", series: "Sword & Shield", printedTotal: 25, total: 25, releaseDate: "2021-10-08", ptcgoCode: "CEL", symbolUrl: "https://images.pokemontcg.io/cel25/symbol.png", logoUrl: "https://images.pokemontcg.io/cel25/logo.png" },
  { id: "cel25c", name: "Celebrations: Classic Collection", series: "Sword & Shield", printedTotal: 25, total: 25, releaseDate: "2021-10-08", ptcgoCode: "CEL", symbolUrl: "https://images.pokemontcg.io/cel25c/symbol.png", logoUrl: "https://images.pokemontcg.io/cel25c/logo.png" },
  { id: "swsh8", name: "Fusion Strike", series: "Sword & Shield", printedTotal: 264, total: 284, releaseDate: "2021-11-12", ptcgoCode: "FST", symbolUrl: "https://images.pokemontcg.io/swsh8/symbol.png", logoUrl: "https://images.pokemontcg.io/swsh8/logo.png" },
  { id: "swsh9", name: "Brilliant Stars", series: "Sword & Shield", printedTotal: 172, total: 186, releaseDate: "2022-02-25", ptcgoCode: "BRS", symbolUrl: "https://images.pokemontcg.io/swsh9/symbol.png", logoUrl: "https://images.pokemontcg.io/swsh9/logo.png" },
  { id: "swsh9tg", name: "Brilliant Stars Trainer Gallery", series: "Sword & Shield", printedTotal: 30, total: 30, releaseDate: "2022-02-25", ptcgoCode: "BRS", symbolUrl: "https://images.pokemontcg.io/swsh9tg/symbol.png", logoUrl: "https://images.pokemontcg.io/swsh9tg/logo.png" },
  { id: "swsh10", name: "Astral Radiance", series: "Sword & Shield", printedTotal: 189, total: 216, releaseDate: "2022-05-27", ptcgoCode: "ASR", symbolUrl: "https://images.pokemontcg.io/swsh10/symbol.png", logoUrl: "https://images.pokemontcg.io/swsh10/logo.png" },
  { id: "swsh10tg", name: "Astral Radiance Trainer Gallery", series: "Sword & Shield", printedTotal: 30, total: 30, releaseDate: "2022-05-27", ptcgoCode: "ASR", symbolUrl: "https://images.pokemontcg.io/swsh10tg/symbol.png", logoUrl: "https://images.pokemontcg.io/swsh10tg/logo.png" },
  { id: "pgo", name: "Pokémon GO", series: "Sword & Shield", printedTotal: 78, total: 88, releaseDate: "2022-07-01", ptcgoCode: "PGO", symbolUrl: "https://images.pokemontcg.io/pgo/symbol.png", logoUrl: "https://images.pokemontcg.io/pgo/logo.png" },
  { id: "mcd22", name: "McDonald's Collection 2022", series: "Other", printedTotal: 15, total: 15, releaseDate: "2022-08-03", symbolUrl: "https://images.pokemontcg.io/mcd22/symbol.png", logoUrl: "https://images.pokemontcg.io/mcd22/logo.png" },
  { id: "swsh11", name: "Lost Origin", series: "Sword & Shield", printedTotal: 196, total: 217, releaseDate: "2022-09-09", ptcgoCode: "LOR", symbolUrl: "https://images.pokemontcg.io/swsh11/symbol.png", logoUrl: "https://images.pokemontcg.io/swsh11/logo.png" },
  { id: "swsh11tg", name: "Lost Origin Trainer Gallery", series: "Sword & Shield", printedTotal: 30, total: 30, releaseDate: "2022-09-09", ptcgoCode: "LOR", symbolUrl: "https://images.pokemontcg.io/swsh11tg/symbol.png", logoUrl: "https://images.pokemontcg.io/swsh11tg/logo.png" },
  { id: "swsh12", name: "Silver Tempest", series: "Sword & Shield", printedTotal: 195, total: 215, releaseDate: "2022-11-11", ptcgoCode: "SIT", symbolUrl: "https://images.pokemontcg.io/swsh12/symbol.png", logoUrl: "https://images.pokemontcg.io/swsh12/logo.png" },
  { id: "swsh12tg", name: "Silver Tempest Trainer Gallery", series: "Sword & Shield", printedTotal: 30, total: 30, releaseDate: "2022-11-11", ptcgoCode: "SIT", symbolUrl: "https://images.pokemontcg.io/swsh12tg/symbol.png", logoUrl: "https://images.pokemontcg.io/swsh12tg/logo.png" },
  { id: "svp", name: "Scarlet & Violet Black Star Promos", series: "Scarlet & Violet", printedTotal: 215, total: 196, releaseDate: "2023-01-01", ptcgoCode: "PR-SV", symbolUrl: "https://images.pokemontcg.io/svp/symbol.png", logoUrl: "https://images.pokemontcg.io/svp/logo.png" },
  { id: "swsh12pt5", name: "Crown Zenith", series: "Sword & Shield", printedTotal: 159, total: 160, releaseDate: "2023-01-20", ptcgoCode: "CRZ", symbolUrl: "https://images.pokemontcg.io/swsh12pt5/symbol.png", logoUrl: "https://images.pokemontcg.io/swsh12pt5/logo.png" },
  { id: "swsh12pt5gg", name: "Crown Zenith Galarian Gallery", series: "Sword & Shield", printedTotal: 70, total: 70, releaseDate: "2023-01-20", ptcgoCode: "CRZ", symbolUrl: "https://images.pokemontcg.io/swsh12pt5gg/symbol.png", logoUrl: "https://images.pokemontcg.io/swsh12pt5gg/logo.png" },
  { id: "sv1", name: "Scarlet & Violet", series: "Scarlet & Violet", printedTotal: 198, total: 258, releaseDate: "2023-03-31", ptcgoCode: "SVI", symbolUrl: "https://images.pokemontcg.io/sv1/symbol.png", logoUrl: "https://images.pokemontcg.io/sv1/logo.png" },
  { id: "sve", name: "Scarlet & Violet Energies", series: "Scarlet & Violet", printedTotal: 8, total: 8, releaseDate: "2023-03-31", ptcgoCode: "SVE", symbolUrl: "https://images.pokemontcg.io/sve/symbol.png", logoUrl: "https://images.pokemontcg.io/sve/logo.png" },
  { id: "sv2", name: "Paldea Evolved", series: "Scarlet & Violet", printedTotal: 193, total: 279, releaseDate: "2023-06-09", ptcgoCode: "PAL", symbolUrl: "https://images.pokemontcg.io/sv2/symbol.png", logoUrl: "https://images.pokemontcg.io/sv2/logo.png" },
  { id: "sv3", name: "Obsidian Flames", series: "Scarlet & Violet", printedTotal: 197, total: 230, releaseDate: "2023-08-11", ptcgoCode: "OBF", symbolUrl: "https://images.pokemontcg.io/sv3/symbol.png", logoUrl: "https://images.pokemontcg.io/sv3/logo.png" },
  { id: "sv3pt5", name: "151", series: "Scarlet & Violet", printedTotal: 165, total: 207, releaseDate: "2023-09-22", ptcgoCode: "MEW", symbolUrl: "https://images.pokemontcg.io/sv3pt5/symbol.png", logoUrl: "https://images.pokemontcg.io/sv3pt5/logo.png" },
  { id: "sv4", name: "Paradox Rift", series: "Scarlet & Violet", printedTotal: 182, total: 266, releaseDate: "2023-11-03", ptcgoCode: "PAR", symbolUrl: "https://images.pokemontcg.io/sv4/symbol.png", logoUrl: "https://images.pokemontcg.io/sv4/logo.png" },
  { id: "sv4pt5", name: "Paldean Fates", series: "Scarlet & Violet", printedTotal: 91, total: 245, releaseDate: "2024-01-26", ptcgoCode: "PAF", symbolUrl: "https://images.pokemontcg.io/sv4pt5/symbol.png", logoUrl: "https://images.pokemontcg.io/sv4pt5/logo.png" },
  { id: "sv5", name: "Temporal Forces", series: "Scarlet & Violet", printedTotal: 162, total: 218, releaseDate: "2024-03-22", ptcgoCode: "TEF", symbolUrl: "https://images.pokemontcg.io/sv5/symbol.png", logoUrl: "https://images.pokemontcg.io/sv5/logo.png" },
  { id: "sv6", name: "Twilight Masquerade", series: "Scarlet & Violet", printedTotal: 167, total: 226, releaseDate: "2024-05-24", ptcgoCode: "TWM", symbolUrl: "https://images.pokemontcg.io/sv6/symbol.png", logoUrl: "https://images.pokemontcg.io/sv6/logo.png" },
  { id: "sv6pt5", name: "Shrouded Fable", series: "Scarlet & Violet", printedTotal: 64, total: 99, releaseDate: "2024-08-02", ptcgoCode: "SFA", symbolUrl: "https://images.pokemontcg.io/sv6pt5/symbol.png", logoUrl: "https://images.pokemontcg.io/sv6pt5/logo.png" },
  { id: "sv7", name: "Stellar Crown", series: "Scarlet & Violet", printedTotal: 142, total: 175, releaseDate: "2024-09-13", ptcgoCode: "SCR", symbolUrl: "https://images.pokemontcg.io/sv7/symbol.png", logoUrl: "https://images.pokemontcg.io/sv7/logo.png" },
  { id: "sv8", name: "Surging Sparks", series: "Scarlet & Violet", printedTotal: 191, total: 252, releaseDate: "2024-11-08", ptcgoCode: "SSP", symbolUrl: "https://images.pokemontcg.io/sv8/symbol.png", logoUrl: "https://images.pokemontcg.io/sv8/logo.png" },
  { id: "sv8pt5", name: "Prismatic Evolutions", series: "Scarlet & Violet", printedTotal: 131, total: 180, releaseDate: "2025-01-17", ptcgoCode: "PRE", symbolUrl: "https://images.pokemontcg.io/sv8pt5/symbol.png", logoUrl: "https://images.pokemontcg.io/sv8pt5/logo.png" },
  { id: "sv9", name: "Journey Together", series: "Scarlet & Violet", printedTotal: 159, total: 190, releaseDate: "2025-03-28", ptcgoCode: "JTG", symbolUrl: "https://images.pokemontcg.io/sv9/symbol.png", logoUrl: "https://images.pokemontcg.io/sv9/logo.png" },
  { id: "sv10", name: "Destined Rivals", series: "Scarlet & Violet", printedTotal: 182, total: 244, releaseDate: "2025-05-30", ptcgoCode: "DRI", symbolUrl: "https://images.pokemontcg.io/sv10/symbol.png", logoUrl: "https://images.pokemontcg.io/sv10/logo.png" },
  { id: "zsv10pt5", name: "Black Bolt", series: "Scarlet & Violet", printedTotal: 86, total: 172, releaseDate: "2025-07-18", ptcgoCode: "BLK", symbolUrl: "https://images.pokemontcg.io/zsv10pt5/symbol.png", logoUrl: "https://images.pokemontcg.io/zsv10pt5/logo.png" },
  { id: "rsv10pt5", name: "White Flare", series: "Scarlet & Violet", printedTotal: 86, total: 173, releaseDate: "2025-07-18", ptcgoCode: "WHT", symbolUrl: "https://images.pokemontcg.io/rsv10pt5/symbol.png", logoUrl: "https://images.pokemontcg.io/rsv10pt5/logo.png" },
  { id: "me1", name: "Mega Evolution", series: "Mega Evolution", printedTotal: 132, total: 188, releaseDate: "2025-09-26", ptcgoCode: "MEG", symbolUrl: "https://images.pokemontcg.io/me1/symbol.png", logoUrl: "https://images.pokemontcg.io/me1/logo.png" },
  { id: "me2", name: "Phantasmal Flames", series: "Mega Evolution", printedTotal: 94, total: 130, releaseDate: "2025-11-14", ptcgoCode: "PFL", symbolUrl: "https://images.pokemontcg.io/me2/symbol.png", logoUrl: "https://images.pokemontcg.io/me2/logo.png" },
  { id: "me2pt5", name: "Ascended Heroes", series: "Mega Evolution", printedTotal: 217, total: 295, releaseDate: "2026-01-30", ptcgoCode: "ASC", symbolUrl: "https://images.scrydex.com/pokemon/me2pt5-symbol/symbol", logoUrl: "https://images.scrydex.com/pokemon/me2pt5-logo/logo" },
  { id: "me3", name: "Perfect Order", series: "Mega Evolution", printedTotal: 88, total: 124, releaseDate: "2026-03-27", ptcgoCode: "POR", symbolUrl: "https://images.scrydex.com/pokemon/me3-symbol/symbol", logoUrl: "https://images.scrydex.com/pokemon/me3-logo/logo" },
  { id: "me4", name: "Chaos Rising", series: "Mega Evolution", printedTotal: 86, total: 122, releaseDate: "2026-05-22", ptcgoCode: "CRI", symbolUrl: "https://images.scrydex.com/pokemon/me4-symbol/symbol", logoUrl: "https://images.scrydex.com/pokemon/me4-logo/logo" },
];

// ---------------------------------------------------------------------------
// Curated nickname/abbreviation aliases.
//
// These exist for sets where the *colloquial* name dealers actually type
// shares no useful tokens with the literal printed `name` field, so no
// amount of fuzzy token matching could ever bridge the gap. Keys must be in
// normalized form (see normalize() below) -- lowercase, punctuation
// stripped, single-spaced.
// ---------------------------------------------------------------------------
const SET_ALIASES: Record<string, string> = {
  // The #1 reported bug: "Base Set" is the universal name collectors use for
  // the 1999 set, but its literal API name is just "Base".
  base: "base1",
  "base set": "base1",
  "unlimited base set": "base1",
  "base set unlimited": "base1",
  "wotc base set": "base1",
  "shadowless base set": "base1",
  "1st edition base set": "base1",
  "first edition base set": "base1",
  "first ed base set": "base1",
  "1st ed base set": "base1",
  "base unlimited": "base1",

  // Other nicknames/abbreviations that diverge from the literal name.
  hgss: "hgss1",
  "heartgold soulsilver": "hgss1",
  "heartgold and soulsilver": "hgss1",
  "ex base set": "ecard1",
  expedition: "ecard1",
  "southern island": "si1",
  "legendary reverse": "base6",
  "legendary collection reverse": "base6",
  swsh: "swsh1",
  "sword and shield": "swsh1",
  "scarlet violet base set": "sv1",
  "scarlet and violet base set": "sv1",
  "sv base": "sv1",
  "sv base set": "sv1",
  "sword shield base set": "swsh1",
  "sword and shield base set": "swsh1",
  "swsh base": "swsh1",
  "swsh base set": "swsh1",
  "sun moon base set": "sm1",
  "sun and moon base set": "sm1",
  "sm base": "sm1",
  "black white base set": "bw1",
  "black and white base set": "bw1",
  "bw base": "bw1",
  "diamond pearl base set": "dp1",
  "diamond and pearl base set": "dp1",
  "dp base": "dp1",

  // Current-era shorthand and chase-card dealer nicknames.
  "sv 151": "sv3pt5",
  "pokemon 151": "sv3pt5",
  "scarlet violet 151": "sv3pt5",
  "scarlet and violet 151": "sv3pt5",
  "mew 151": "sv3pt5",
  "evo skies": "swsh7",
  evoskies: "swsh7",
  "moonbreon set": "swsh7",
  moonbreon: "swsh7",
  "evolving skies moonbreon": "swsh7",
  "prismatic": "sv8pt5",
  "prismatic evo": "sv8pt5",
  "prismatic evos": "sv8pt5",
  "pris evo": "sv8pt5",
  "pris evos": "sv8pt5",
  "paldean fate": "sv4pt5",
  "paldean fates shiny": "sv4pt5",
  "destined rivals team rocket": "sv10",
  "team rocket destined rivals": "sv10",

  // Subsets / galleries that share codes with their parent sets.
  "hidden fates sv": "sma",
  "hidden fates shiny": "sma",
  "hidden fates shiny vault": "sma",
  "hif shiny vault": "sma",
  "hif sv": "sma",
  hif: "sm115",
  "shining fates sv": "swsh45sv",
  "shining fates shiny": "swsh45sv",
  "shining fates shiny vault": "swsh45sv",
  "shf shiny vault": "swsh45sv",
  "shf sv": "swsh45sv",
  shf: "swsh45",
  "crown zenith gg": "swsh12pt5gg",
  "crown zenith galarian": "swsh12pt5gg",
  "crown zenith galarian gallery": "swsh12pt5gg",
  "cz gg": "swsh12pt5gg",
  "cz galarian gallery": "swsh12pt5gg",
  "brilliant stars tg": "swsh9tg",
  "brs tg": "swsh9tg",
  "brilliant stars trainer gallery": "swsh9tg",
  "astral radiance tg": "swsh10tg",
  "asr tg": "swsh10tg",
  "astral radiance trainer gallery": "swsh10tg",
  "lost origin tg": "swsh11tg",
  "lor tg": "swsh11tg",
  "lost origin trainer gallery": "swsh11tg",
  "silver tempest tg": "swsh12tg",
  "sit tg": "swsh12tg",
  "silver tempest trainer gallery": "swsh12tg",
  "celebrations classic": "cel25c",
  "celebrations classics": "cel25c",
  "classic collection": "cel25c",

  // Promo shorthand.
  "wotc promos": "basep",
  "wizards promos": "basep",
  "wizards black star": "basep",
  "dp promos": "dpp",
  "diamond pearl promos": "dpp",
  "hgss promos": "hsp",
  "heartgold soulsilver promos": "hsp",
  "bw promos": "bwp",
  "black white promos": "bwp",
  "xy promos": "xyp",
  "sun moon promos": "smp",
  "sm promos": "smp",
  "swsh promos": "swshp",
  "sword shield promos": "swshp",
  "sv promos": "svp",
  "scarlet violet promos": "svp",
};

// Curated set of well-known / heavily-traded sets spanning vintage WOTC
// through current-era chase sets, for "popular sets" quick-pick UI chips.
const POPULAR_SET_IDS = [
  // Daily dealer flow: newest and most commonly comped modern sets first.
  "sv8pt5",
  "sv8",
  "sv7",
  "sv6",
  "sv5",
  "sv4pt5",
  "sv4",
  "sv3pt5",
  "sv3",
  "sv2",
  "sv1",
  "sv10",
  "sv9",
  "zsv10pt5",
  "rsv10pt5",
  "me1",
  "me2",
  "me2pt5",
  "me3",
  "me4",

  // Sword & Shield high-volume and chase sets, including their subsets.
  "swsh12pt5",
  "swsh12pt5gg",
  "swsh12",
  "swsh12tg",
  "swsh11",
  "swsh11tg",
  "pgo",
  "swsh10",
  "swsh10tg",
  "swsh9",
  "swsh9tg",
  "swsh8",
  "swsh7",
  "swsh6",
  "swsh5",
  "swsh4",
  "swsh35",
  "swsh3",
  "swsh2",
  "swsh1",
  "swsh45",
  "swsh45sv",
  "cel25",
  "cel25c",
  "swshp",

  // Sun & Moon / XY sets that still come up constantly in collections.
  "sm12",
  "sm115",
  "sma",
  "sm11",
  "sm10",
  "sm9",
  "sm8",
  "sm75",
  "sm7",
  "sm6",
  "sm5",
  "sm4",
  "sm3",
  "sm2",
  "sm1",
  "xy12",
  "xy11",
  "xy10",
  "xy9",
  "xy8",
  "xy7",
  "xy6",
  "xy5",
  "xy4",
  "xy3",
  "xy2",
  "xy1",
  "xyp",

  // Vintage and older high-value staples.
  "base1",
  "base2",
  "base3",
  "base5",
  "base4",
  "gym1",
  "gym2",
  "neo1",
  "neo2",
  "neo3",
  "neo4",
  "base6",
  "ecard1",
  "ecard2",
  "ecard3",
  "ex1",
  "ex7",
  "ex8",
  "ex13",
  "ex14",
  "ex15",
  "ex16",
  "dp1",
  "pl1",
  "bw1",
  "bwp",
];

const SUBSET_BY_PARENT_AND_PREFIX: Record<string, Partial<Record<string, string>>> = {
  sm115: { SV: "sma" },
  swsh45: { SV: "swsh45sv" },
  swsh9: { TG: "swsh9tg" },
  swsh10: { TG: "swsh10tg" },
  swsh11: { TG: "swsh11tg" },
  swsh12: { TG: "swsh12tg" },
  swsh12pt5: { GG: "swsh12pt5gg" },
};

const PREFIXED_SUBSET_IDS = new Set(
  Object.values(SUBSET_BY_PARENT_AND_PREFIX)
    .flatMap((byPrefix) => Object.values(byPrefix))
    .filter((id): id is string => Boolean(id)),
);

// ---------------------------------------------------------------------------
// Normalization + matching
// ---------------------------------------------------------------------------

function releaseTime(set: CatalogSet): number {
  if (!set.releaseDate) return 0;
  const t = Date.parse(set.releaseDate);
  return Number.isNaN(t) ? 0 : t;
}

// Tokenize every set name once at module load -- 173 short strings, trivial cost.
const SET_NAME_TOKENS = new Map<string, string[]>(
  SET_SNAPSHOT.map((set) => [set.id, tokenizeSearchText(set.name)]),
);

/**
 * Rank candidate sets against freeform input. Combines, in priority order:
 * exact id match, curated alias, exact ptcgoCode match, exact normalized
 * name match, and a token-subset fuzzy match that only matches a set when
 * every query token is present in the set's name (so "base" alone won't
 * incorrectly out-rank "Base" with "Base Set 2"/"Expedition Base Set" --
 * the historical bug here was scoring by raw substring containment, which
 * rewards longer set names for happening to contain the query).
 */
export function searchSets(query: string, limit = 8): CatalogSet[] {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const norm = normalizeSearchText(trimmed);
  if (!norm) return [];

  const scores = new Map<string, number>();
  const bump = (id: string, score: number) => {
    scores.set(id, Math.max(scores.get(id) ?? 0, score));
  };

  const lowerTrimmed = trimmed.toLowerCase();
  const upperTrimmed = trimmed.toUpperCase();

  for (const set of SET_SNAPSHOT) {
    if (set.id.toLowerCase() === lowerTrimmed) bump(set.id, 1000);
  }

  const aliasId = SET_ALIASES[norm];
  if (aliasId) bump(aliasId, 950);

  for (const set of SET_SNAPSHOT) {
    if (set.ptcgoCode && set.ptcgoCode.toUpperCase() === upperTrimmed) {
      bump(set.id, 900);
    }
    if (normalizeSearchText(set.name) === norm) {
      bump(set.id, 880);
    }
  }

  const queryTokens = tokenizeSearchText(trimmed);
  if (queryTokens.length > 0) {
    for (const set of SET_SNAPSHOT) {
      const candidateTokens = SET_NAME_TOKENS.get(set.id) ?? [];
      if (candidateTokens.length === 0) continue;
      const allMatched = queryTokens.every((qt) =>
        candidateTokens.some((ct) => tokenMatches(qt, ct)),
      );
      if (allMatched) {
        const extra = candidateTokens.length - queryTokens.length;
        const score = Math.max(500 - extra * 40, 50);
        bump(set.id, score);
      }

      const fuzzyScore = scoreSearchText(trimmed, set.name);
      if (fuzzyScore > 0) bump(set.id, fuzzyScore);
    }
  }

  const byId = new Map(SET_SNAPSHOT.map((set) => [set.id, set]));
  return Array.from(scores.entries())
    .map(([id, score]) => ({ set: byId.get(id), score }))
    .filter((entry): entry is { set: CatalogSet; score: number } => entry.set != null)
    .sort((a, b) => b.score - a.score || releaseTime(b.set) - releaseTime(a.set))
    .slice(0, limit)
    .map((entry) => entry.set);
}

/** Best-match convenience wrapper: resolves freeform/alias/code set text to a canonical set id, or undefined if nothing matches. */
export function resolveSetId(query: string | undefined): string | undefined {
  if (!query?.trim()) return undefined;
  return searchSets(query, 1)[0]?.id;
}

/**
 * Resolve a set for a card lookup, using alphanumeric collector numbers to
 * steer parent sets into their attached subsets. Example: dealers often type
 * set "Lost Origin" with number "TG06"; the actual API set is
 * "Lost Origin Trainer Gallery" (swsh11tg).
 */
export function resolveSetIdForCard(setName: string | undefined, number: string | undefined): string | undefined {
  const setId = resolveSetId(setName);
  if (!setId) return undefined;

  const prefix = collectorNumberPrefix(number);
  if (!prefix) return setId;

  return SUBSET_BY_PARENT_AND_PREFIX[setId]?.[prefix] ?? setId;
}

export function getRelatedSubsetIds(setId: string): string[] {
  return Object.values(SUBSET_BY_PARENT_AND_PREFIX[setId] ?? {}).filter((id): id is string => Boolean(id));
}

export function isPrefixedSubsetId(setId: string | undefined): boolean {
  return Boolean(setId && PREFIXED_SUBSET_IDS.has(setId));
}

/** Curated, era-spanning list of popular/heavily-traded sets for quick-pick UI chips. */
export function getPopularSets(limit = POPULAR_SET_IDS.length): CatalogSet[] {
  const byId = new Map(SET_SNAPSHOT.map((set) => [set.id, set]));
  return POPULAR_SET_IDS.map((id) => byId.get(id))
    .filter((set): set is CatalogSet => set != null)
    .slice(0, limit);
}

/** Full bundled set list, newest first. */
export function getAllSets(): CatalogSet[] {
  return [...SET_SNAPSHOT].sort((a, b) => releaseTime(b) - releaseTime(a));
}

export function getSetById(id: string): CatalogSet | undefined {
  return SET_SNAPSHOT.find((set) => set.id === id);
}

function collectorNumberPrefix(number: string | undefined): string | undefined {
  const beforeSlash = number?.trim().split("/")[0]?.trim();
  if (!beforeSlash) return undefined;
  const match = beforeSlash.match(/^([A-Za-z]{1,4})\d+$/);
  return match?.[1]?.toUpperCase();
}
