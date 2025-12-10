import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import Database from "better-sqlite3";

const token = process.env.TOKEN;
const guildId = process.env.GUILD_ID;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId || !guildId) {
  console.error("Missing environment variables. Ensure TOKEN, CLIENT_ID and GUILD_ID are set.");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

// === DATABASE SQLITE ===
const db = new Database("./westmarch.db");

// Creazione tabelle (se non esistono)
db.exec(`
CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY,
    name TEXT
);

CREATE TABLE IF NOT EXISTS characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    playerId TEXT NOT NULL,
    name TEXT NOT NULL,
    xp INTEGER NOT NULL DEFAULT 0,
    gold INTEGER NOT NULL DEFAULT 0,
    bank INTEGER NOT NULL DEFAULT 0,
    level INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (playerId) REFERENCES players(id)
);

CREATE TABLE IF NOT EXISTS inventory (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    characterId INTEGER NOT NULL,
    item TEXT NOT NULL,
    FOREIGN KEY (characterId) REFERENCES characters(id)
);

CREATE TABLE IF NOT EXISTS attunements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    characterId INTEGER NOT NULL,
    item TEXT NOT NULL,
    FOREIGN KEY (characterId) REFERENCES characters(id)
);
`);

// === XP/GOLD REWARD TABLE ===
const REWARDS = {
  "C": { xp: 600, gold: 200 },
  "B": { xp: 1200, gold: 400 },
  "A": { xp: 2400, gold: 800 }
};

// === D&D 5e XP TABLE (for levels 1..20) ===
const XP_LEVELS = [
  0,      // lvl 1
  300,    // lvl 2
  900,    // lvl 3
  2700,   // lvl 4
  6500,   // lvl 5
  14000,  // lvl 6
  23000,  // lvl 7
  34000,  // lvl 8
  48000,  // lvl 9
  64000,  // lvl 10
  85000,  // lvl 11
  100000, // lvl 12
  120000, // lvl 13
  140000, // lvl 14
  165000, // lvl 15
  195000, // lvl 16
  225000, // lvl 17
  265000, // lvl 18
  305000, // lvl 19
  355000  // lvl 20
];

function getLevelFromXP(xp) {
  for (let lvl = XP_LEVELS.length - 1; lvl >= 0; lvl--) {
    if (xp >= XP_LEVELS[lvl]) return lvl + 1;
  }
  return 1;
}

// === DB HELPERS ===

// Player
function ensurePlayer(user) {
  const existing = db.prepare("SELECT id FROM players WHERE id = ?").get(user.id);
  if (!existing) {
    db.prepare("INSERT INTO players (id, name) VALUES (?, ?)").run(user.id, user.username);
  } else {
    // opzionale: aggiorno nome se cambiato
    db.prepare("UPDATE players SET name = ? WHERE id = ?").run(user.username, user.id);
  }
}

// Characters
function getCharacter(playerId, name) {
  return db.prepare("SELECT * FROM characters WHERE playerId = ? AND name = ?").get(playerId, name);
}

function getCharacterById(id) {
  return db.prepare("SELECT * FROM characters WHERE id = ?").get(id);
}

function listCharacters(playerId) {
  return db.prepare("SELECT * FROM characters WHERE playerId = ?").all(playerId);
}

function listAllCharacterNames() {
  return db.prepare("SELECT DISTINCT name FROM characters").all().map(r => r.name);
}

function createCharacter(playerId, name) {
  const stmt = db.prepare(`
    INSERT INTO characters (playerId, name, xp, gold, bank, level)
    VALUES (?, ?, 0, 0, 0, 1)
  `);
  const info = stmt.run(playerId, name);
  return info.lastInsertRowid;
}

function updateCharacterXPAndLevel(characterId, newXP) {
  const newLevel = getLevelFromXP(newXP);
  db.prepare("UPDATE characters SET xp = ?, level = ? WHERE id = ?").run(newXP, newLevel, characterId);
  return newLevel;
}

function updateCharacterGold(characterId, newGold) {
  db.prepare("UPDATE characters SET gold = ? WHERE id = ?").run(newGold, characterId);
}

function updateCharacterBank(characterId, newBank) {
  db.prepare("UPDATE characters SET bank = ? WHERE id = ?").run(newBank, characterId);
}

function renameCharacter(characterId, newName) {
  db.prepare("UPDATE characters SET name = ? WHERE id = ?").run(newName, characterId);
}

function deleteCharacterAndData(characterId) {
  db.prepare("DELETE FROM inventory WHERE characterId = ?").run(characterId);
  db.prepare("DELETE FROM attunements WHERE characterId = ?").run(characterId);
  db.prepare("DELETE FROM characters WHERE id = ?").run(characterId);
}

// Inventory
function getInventory(characterId) {
  return db.prepare("SELECT item FROM inventory WHERE characterId = ?").all(characterId).map(r => r.item);
}

function addInventoryItem(characterId, item) {
  db.prepare("INSERT INTO inventory (characterId, item) VALUES (?, ?)").run(characterId, item);
}

function removeInventoryItemsByCleanName(characterId, cleanName) {
  const rows = db.prepare("SELECT id, item FROM inventory WHERE characterId = ?").all(characterId);
  const toDelete = rows.filter(r => stripSintonizedTag(r.item) === cleanName);
  toDelete.forEach(r => db.prepare("DELETE FROM inventory WHERE id = ?").run(r.id));
  return toDelete.length;
}

// Attunements (sintonie)
function getAttunements(characterId) {
  return db.prepare("SELECT item FROM attunements WHERE characterId = ?").all(characterId).map(r => r.item);
}

function addAttunement(characterId, item) {
  db.prepare("INSERT INTO attunements (characterId, item) VALUES (?, ?)").run(characterId, item);
}

function removeAttunement(characterId, item) {
  db.prepare("DELETE FROM attunements WHERE characterId = ? AND item = ?").run(characterId, item);
}

function clearAttunementByName(characterId, item) {
  db.prepare("DELETE FROM attunements WHERE characterId = ? AND item = ?").run(characterId, item);
}

// === SLASH COMMANDS DEFINITION ===
const commands = [
  new SlashCommandBuilder()
    .setName("crea_pg")
    .setDescription("Crea un personaggio per un giocatore (max 2).")
    .addUserOption(o => o.setName("giocatore").setDescription("Il giocatore").setRequired(true))
    .addStringOption(o => o.setName("nome").setDescription("Nome del PG").setRequired(true)),

  new SlashCommandBuilder()
    .setName("scheda")
    .setDescription("Mostra la scheda di un PG.")
    .addUserOption(o => o.setName("giocatore").setDescription("Il giocatore").setRequired(true))
    .addStringOption(o => o.setName("nome").setDescription("Nome del PG").setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName("ricompensa")
    .setDescription("Assegna automaticamente ricompense di una sessione.")
    .addStringOption(o => o.setName("grado").setDescription("C, B, A").setRequired(true))
    .addUserOption(o => o.setName("giocatore").setDescription("Il giocatore").setRequired(true))
    .addStringOption(o => o.setName("nome").setDescription("Nome del PG").setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName("aggiungi")
    .setDescription("Aggiunge XP, oro o oggetto al PG. Richiede nota.")
    .addStringOption(o => o.setName("tipo").setDescription("xp | gold | item").setRequired(true))
    .addStringOption(o => o.setName("valore").setDescription("Numero o nome oggetto. Per più item separa con ,").setRequired(true))
    .addStringOption(o => o.setName("note").setDescription("Motivo della modifica").setRequired(true))
    .addUserOption(o => o.setName("giocatore").setDescription("Il giocatore").setRequired(true))
    .addStringOption(o => o.setName("nome").setDescription("Nome del PG").setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName("rimuovi")
    .setDescription("Rimuove XP, oro o oggetto dal PG. Richiede nota.")
    .addStringOption(o => o.setName("tipo").setDescription("xp | gold | item").setRequired(true))
    .addStringOption(o => o.setName("valore").setDescription("Numero o nome oggetto. Per più item separa con ,").setRequired(true))
    .addStringOption(o => o.setName("note").setDescription("Motivo della modifica").setRequired(true))
    .addUserOption(o => o.setName("giocatore").setDescription("Il giocatore").setRequired(true))
    .addStringOption(o => o.setName("nome").setDescription("Nome del PG").setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName("elimina_pg")
    .setDescription("Elimina completamente una scheda di un PG.")
    .addUserOption(o => o.setName("giocatore").setDescription("Il giocatore").setRequired(true))
    .addStringOption(o => o.setName("nome").setDescription("Nome del PG").setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName("rinomina_pg")
    .setDescription("Rinomina un PG.")
    .addUserOption(o => o.setName("giocatore").setDescription("Il giocatore").setRequired(true))
    .addStringOption(o => o.setName("vecchio_nome").setDescription("Nome attuale del PG").setRequired(true).setAutocomplete(true))
    .addStringOption(o => o.setName("nuovo_nome").setDescription("Nuovo nome del PG").setRequired(true)),

  // Banking
  new SlashCommandBuilder()
    .setName("deposito")
    .setDescription("Sposta oro -> conto bancario")
    .addIntegerOption(o => o.setName("quantita").setDescription("Quantità di oro da depositare").setRequired(true))
    .addUserOption(o => o.setName("giocatore").setDescription("Il giocatore").setRequired(true))
    .addStringOption(o => o.setName("nome").setDescription("Nome del PG").setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName("prelievo")
    .setDescription("Sposta conto bancario -> oro")
    .addIntegerOption(o => o.setName("quantita").setDescription("Quantità da prelevare").setRequired(true))
    .addUserOption(o => o.setName("giocatore").setDescription("Il giocatore").setRequired(true))
    .addStringOption(o => o.setName("nome").setDescription("Nome del PG").setRequired(true).setAutocomplete(true)),

  // Inventory bulk
  new SlashCommandBuilder()
    .setName("aggiungi_item")
    .setDescription("Aggiungi uno o più item al PG (separa con ',').")
    .addStringOption(o => o.setName("items").setDescription("Lista item separati da ,").setRequired(true))
    .addUserOption(o => o.setName("giocatore").setDescription("Il giocatore").setRequired(true))
    .addStringOption(o => o.setName("nome").setDescription("Nome del PG").setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName("rimuovi_item")
    .setDescription("Rimuovi uno o più item dal PG (separa con ',').")
    .addStringOption(o => o.setName("items").setDescription("Lista item separati da ,").setRequired(true))
    .addUserOption(o => o.setName("giocatore").setDescription("Il giocatore").setRequired(true))
    .addStringOption(o => o.setName("nome").setDescription("Nome del PG").setRequired(true).setAutocomplete(true)),

  // Sintonie (attunement)
  new SlashCommandBuilder()
    .setName("aggiungi_sintonia")
    .setDescription("Aggiunge una sintonia (max 3).")
    .addStringOption(o => o.setName("nome_sintonia").setDescription("Nome dell'oggetto magico").setRequired(true))
    .addUserOption(o => o.setName("giocatore").setDescription("Il giocatore").setRequired(true))
    .addStringOption(o => o.setName("nome").setDescription("Nome del PG").setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName("rimuovi_sintonia")
    .setDescription("Rimuove una sintonia dall'PG.")
    .addStringOption(o => o.setName("nome_sintonia").setDescription("Nome dell'oggetto magico").setRequired(true))
    .addUserOption(o => o.setName("giocatore").setDescription("Il giocatore").setRequired(true))
    .addStringOption(o => o.setName("nome").setDescription("Nome del PG").setRequired(true).setAutocomplete(true)),

  new SlashCommandBuilder()
    .setName("lista_pg")
    .setDescription("Lista tutti i PG di un giocatore.")
    .addUserOption(o => o.setName("giocatore").setDescription("Il giocatore").setRequired(true))
].map(c => c.toJSON());

// === REGISTER COMMANDS ===
(async () => {
  try {
    console.log("Started refreshing application (/) commands.");
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log("Successfully reloaded application (/) commands.");
  } catch (error) {
    console.error(error);
  }
})();

// === CLIENT ===
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.on("ready", () => {
  console.log(`Westmarch Bot attivo come: ${client.user.tag}`);
});

// Utility helpers
function hasRoleGM(member, roleName = "Gm-bot") {
  try {
    return member.roles.cache.some(r => r.name === roleName);
  } catch (e) {
    return false;
  }
}
const sanitizeItemsList = (raw) => raw.split(",").map(s => s.trim()).filter(s => s.length);

// helpers for sintonized items
const isSintonizedTag = (str) => /\[s\]/i.test(str);
const stripSintonizedTag = (str) => str.replace(/\[s\]/ig, "").trim();

// send level-up message (interaction required to find guild if needed)
async function handleLevelUpIfAny(character, oldXP, interaction) {
  const oldLevel = character.level || getLevelFromXP(oldXP);
  const newLevel = getLevelFromXP(character.xp);

  if (newLevel > oldLevel) {
    const levelChannelId = process.env.LEVEL_UP_CHANNEL;
    let channel = null;

    if (levelChannelId) {
      channel = client.channels.cache.get(levelChannelId);
    }

    // fallback: try to find a channel in the guild whose name contains 'level'
    if (!channel && interaction && interaction.guild) {
      channel = interaction.guild.channels.cache.find(c => c.name && c.name.toLowerCase().includes("level"));
    }

    const msg = `<@${character.playerId}> 🎉 **${character.name} è salito al livello ${newLevel}!**`;

    // fallback to reply in the channel where command was used (as last resort)
    if (!channel) {
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp({ content: msg, ephemeral: false });
        } else {
          await interaction.reply({ content: msg, ephemeral: false });
        }
      } catch (e) {
        console.log("Unable to post level-up message:", e.message);
      }
      return;
    }

    try {
      channel.send({ content: msg });
    } catch (e) {
      console.error("Failed to send level-up message:", e.message);
    }
  }
}

// === INTERACTIONS ===
client.on("interactionCreate", async interaction => {
  // --- AUTOCOMPLETE ---
  if (interaction.isAutocomplete()) {
    const focusedOption = interaction.options.getFocused(true);

    if (["nome", "vecchio_nome"].includes(focusedOption.name)) {
      const user = interaction.options.getUser("giocatore");
      let choices = [];

      if (user) {
        const chars = listCharacters(user.id);
        choices = chars.map(c => c.name);
      } else {
        choices = listAllCharacterNames();
      }

      const filtered = choices
        .filter(c => c.toLowerCase().startsWith(focusedOption.value.toLowerCase()))
        .slice(0, 25);

      return interaction.respond(filtered.map(c => ({ name: c, value: c })));
    }

    return interaction.respond([]);
  }

  if (!interaction.isChatInputCommand()) return;

  const command = interaction.commandName;
  const GM_ROLE_NAME = "Gm-bot";
  const isGM = hasRoleGM(interaction.member, GM_ROLE_NAME);

  // === CREA PG ===
  if (command === "crea_pg") {
    if (!isGM) return interaction.reply({ content: "Solo il ruolo Gm-bot può usare questo comando.", ephemeral: true });
    const user = interaction.options.getUser("giocatore");
    const name = interaction.options.getString("nome");

    ensurePlayer(user);

    const existing = listCharacters(user.id);
    if (existing.length >= 2)
      return interaction.reply({ content: "Questo giocatore ha già 2 PG attivi!", ephemeral: true });

    createCharacter(user.id, name);

    return interaction.reply(`PG **${name}** creato per ${user.username}.`);
  }

  // === SCHEDA ===
  if (command === "scheda") {
    const user = interaction.options.getUser("giocatore");
    const name = interaction.options.getString("nome");

    const pg = getCharacter(user.id, name);
    if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

    const inventory = getInventory(pg.id);
    const sintonie = getAttunements(pg.id);

    const invDisplay = inventory.length
      ? inventory.map(i => {
          if (isSintonizedTag(i)) return i;
          const clean = stripSintonizedTag(i);
          return sintonie.includes(clean) ? `${i} [s]` : i;
        }).join(", ")
      : "Vuoto";

    return interaction.reply({
      content:
        `📜 **Scheda di ${pg.name}**\n` +
        `Livello: ${pg.level}\n` +
        `XP: ${pg.xp}\n` +
        `Gold: ${pg.gold}\n` +
        `Conto bancario: ${pg.bank}\n` +
        `Sintonie: ${sintonie.length ? sintonie.join(", ") : "Nessuna"}\n` +
        `Inventario: ${invDisplay}`,
      ephemeral: false
    });
  }

  // === RICOMPENSA ===
  if (command === "ricompensa") {
    if (!isGM) return interaction.reply({ content: "Solo il ruolo Gm-bot può usare questo comando.", ephemeral: true });
    const grade = interaction.options.getString("grado").toUpperCase();
    const user = interaction.options.getUser("giocatore");
    const name = interaction.options.getString("nome");

    const reward = REWARDS[grade];
    if (!reward) return interaction.reply({ content: "Grado non valido (C/B/A).", ephemeral: true });

    const pg = getCharacter(user.id, name);
    if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

    const beforeXP = pg.xp;
    const newXP = pg.xp + reward.xp;
    const newGold = pg.gold + reward.gold;
    const newLevel = getLevelFromXP(newXP);

    db.prepare("UPDATE characters SET xp = ?, level = ?, gold = ? WHERE id = ?")
      .run(newXP, newLevel, newGold, pg.id);

    const updatedChar = { ...pg, xp: newXP, level: newLevel };

    await handleLevelUpIfAny(updatedChar, beforeXP, interaction);

    return interaction.reply(
      `Sessione grado **${grade}** completata!\n${pg.name} guadagna: **${reward.xp} XP** e **${reward.gold} oro**.`
    );
  }

  // === AGGIUNGI (con note, supporto multiple items se tipo=item) ===
  if (command === "aggiungi") {
    if (!isGM) return interaction.reply({ content: "Solo il ruolo Gm-bot può usare questo comando.", ephemeral: true });

    const type = interaction.options.getString("tipo");
    const rawValue = interaction.options.getString("valore");
    const note = interaction.options.getString("note");
    const user = interaction.options.getUser("giocatore");
    const name = interaction.options.getString("nome");

    const pg = getCharacter(user.id, name);
    if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

    if (type === "xp") {
      const amount = parseInt(rawValue);
      if (Number.isNaN(amount)) return interaction.reply({ content: "Valore XP non valido.", ephemeral: true });

      const before = pg.xp;
      const newXP = before + amount;
      const newLevel = getLevelFromXP(newXP);

      db.prepare("UPDATE characters SET xp = ?, level = ? WHERE id = ?")
        .run(newXP, newLevel, pg.id);

      const updatedChar = { ...pg, xp: newXP, level: newLevel };
      await handleLevelUpIfAny(updatedChar, before, interaction);

      return interaction.reply(`${user.username} - PG **${pg.name}**: XP ${before} → ${newXP}. Nota: ${note}`);
    } else if (type === "gold") {
      const amount = parseInt(rawValue);
      if (Number.isNaN(amount)) return interaction.reply({ content: "Valore gold non valido.", ephemeral: true });

      const before = pg.gold;
      const newGold = before + amount;

      updateCharacterGold(pg.id, newGold);

      return interaction.reply(`${user.username} - PG **${pg.name}**: Gold ${before} → ${newGold}. Nota: ${note}`);
    } else if (type === "item") {
      const items = sanitizeItemsList(rawValue);
      if (!items.length) return interaction.reply({ content: "Nessun item valido fornito.", ephemeral: true });

      let sintonie = getAttunements(pg.id);
      const addedItems = [];
      const addedSints = [];
      const skippedSints = [];

      for (const rawItem of items) {
        const hadTag = isSintonizedTag(rawItem);
        const clean = stripSintonizedTag(rawItem);
        const itemToStore = hadTag ? `${clean} [s]` : clean;

        addInventoryItem(pg.id, itemToStore);
        addedItems.push(itemToStore);

        if (hadTag) {
          if (!sintonie.includes(clean)) {
            if (sintonie.length >= 3) {
              skippedSints.push(clean);
            } else {
              addAttunement(pg.id, clean);
              sintonie.push(clean);
              addedSints.push(clean);
            }
          }
        }
      }

      let resp = `${user.username} - PG **${pg.name}**: Aggiunti item: ${addedItems.join(", ")}. Nota: ${note}`;
      if (addedSints.length) resp += ` Sintonie aggiunte: ${addedSints.join(", ")}.`;
      if (skippedSints.length) resp += ` Sintonie non aggiunte (limite 3): ${skippedSints.join(", ")}.`;

      return interaction.reply(resp);
    } else {
      return interaction.reply({ content: "Tipo non valido.", ephemeral: true });
    }
  }

  // === RIMUOVI (con note, supporto multiple items se tipo=item) ===
  if (command === "rimuovi") {
    if (!isGM) return interaction.reply({ content: "Solo il ruolo Gm-bot può usare questo comando.", ephemeral: true });

    const type = interaction.options.getString("tipo");
    const rawValue = interaction.options.getString("valore");
    const note = interaction.options.getString("note");
    const user = interaction.options.getUser("giocatore");
    const name = interaction.options.getString("nome");

    const pg = getCharacter(user.id, name);
    if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

    if (type === "xp") {
      const amount = parseInt(rawValue);
      if (Number.isNaN(amount)) return interaction.reply({ content: "Valore XP non valido.", ephemeral: true });
      const before = pg.xp;
      const newXP = Math.max(0, before - amount);
      const newLevel = getLevelFromXP(newXP);

      db.prepare("UPDATE characters SET xp = ?, level = ? WHERE id = ?")
        .run(newXP, newLevel, pg.id);

      return interaction.reply(`${user.username} - PG **${pg.name}**: XP ${before} → ${newXP}. Nota: ${note}`);
    } else if (type === "gold") {
      const amount = parseInt(rawValue);
      if (Number.isNaN(amount)) return interaction.reply({ content: "Valore gold non valido.", ephemeral: true });
      const before = pg.gold;
      const newGold = Math.max(0, before - amount);

      updateCharacterGold(pg.id, newGold);

      return interaction.reply(`${user.username} - PG **${pg.name}**: Gold ${before} → ${newGold}. Nota: ${note}`);
    } else if (type === "item") {
      const items = sanitizeItemsList(rawValue);
      if (!items.length) return interaction.reply({ content: "Nessun item valido fornito.", ephemeral: true });

      let sintonie = getAttunements(pg.id);
      const removed = [];
      const notFound = [];
      const removedSints = [];

      for (const rawIt of items) {
        const clean = stripSintonizedTag(rawIt);

        const beforeCount = getInventory(pg.id).length;
        const deletedCount = removeInventoryItemsByCleanName(pg.id, clean);
        const afterCount = beforeCount - deletedCount;

        if (deletedCount > 0) {
          removed.push(rawIt);
          if (sintonie.includes(clean)) {
            clearAttunementByName(pg.id, clean);
            sintonie = sintonie.filter(s => s !== clean);
            removedSints.push(clean);
          }
        } else {
          notFound.push(rawIt);
        }
      }

      let msg = `${user.username} - PG **${pg.name}**: Rimosso: ${removed.length ? removed.join(", ") : "Nessuno"}.`;
      if (notFound.length) msg += ` Non trovati: ${notFound.join(", ")}.`;
      if (removedSints.length) msg += ` Sintonie rimosse: ${removedSints.join(", ")}.`;
      msg += ` Nota: ${note}`;

      return interaction.reply(msg);
    } else {
      return interaction.reply({ content: "Tipo non valido.", ephemeral: true });
    }
  }

  // === DEPOSITO (gold -> conto_bancario) ===
  if (command === "deposito") {
    if (!isGM) return interaction.reply({ content: "Solo il ruolo Gm-bot può usare questo comando.", ephemeral: true });

    const amount = interaction.options.getInteger("quantita");
    const user = interaction.options.getUser("giocatore");
    const name = interaction.options.getString("nome");
    const pg = getCharacter(user.id, name);
    if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

    if (amount <= 0) return interaction.reply({ content: "Quantità non valida.", ephemeral: true });
    if (pg.gold < amount) return interaction.reply({ content: "Gold insufficienti.", ephemeral: true });

    const newGold = pg.gold - amount;
    const newBank = pg.bank + amount;

    updateCharacterGold(pg.id, newGold);
    updateCharacterBank(pg.id, newBank);

    return interaction.reply(`${user.username} - PG **${pg.name}**: Deposito di ${amount} effettuato. Gold: ${newGold}. Conto: ${newBank}`);
  }

  // === PRELIEVO (conto_bancario -> gold) ===
  if (command === "prelievo") {
    if (!isGM) return interaction.reply({ content: "Solo il ruolo Gm-bot può usare questo comando.", ephemeral: true });

    const amount = interaction.options.getInteger("quantita");
    const user = interaction.options.getUser("giocatore");
    const name = interaction.options.getString("nome");
    const pg = getCharacter(user.id, name);
    if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

    if (amount <= 0) return interaction.reply({ content: "Quantità non valida.", ephemeral: true });
    if (pg.bank < amount) return interaction.reply({ content: "Saldo conto insufficiente.", ephemeral: true });

    const newBank = pg.bank - amount;
    const newGold = pg.gold + amount;

    updateCharacterBank(pg.id, newBank);
    updateCharacterGold(pg.id, newGold);

    return interaction.reply(`${user.username} - PG **${pg.name}**: Prelievo di ${amount} effettuato. Gold: ${newGold}. Conto: ${newBank}`);
  }

  // === AGGIUNGI_ITEM (bulk) ===
  if (command === "aggiungi_item") {
    if (!isGM) return interaction.reply({ content: "Solo il ruolo Gm-bot può usare questo comando.", ephemeral: true });

    const raw = interaction.options.getString("items");
    const items = sanitizeItemsList(raw);
    const user = interaction.options.getUser("giocatore");
    const name = interaction.options.getString("nome");
    const pg = getCharacter(user.id, name);
    if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

    if (!items.length) return interaction.reply({ content: "Nessun item valido fornito.", ephemeral: true });

    let sintonie = getAttunements(pg.id);
    const addedItems = [];
    const addedSints = [];
    const skippedSints = [];

    for (const rawItem of items) {
      const hadTag = isSintonizedTag(rawItem);
      const clean = stripSintonizedTag(rawItem);
      const itemToStore = hadTag ? `${clean} [s]` : clean;

      addInventoryItem(pg.id, itemToStore);
      addedItems.push(itemToStore);

      if (hadTag && !sintonie.includes(clean)) {
        if (sintonie.length >= 3) skippedSints.push(clean);
        else {
          addAttunement(pg.id, clean);
          sintonie.push(clean);
          addedSints.push(clean);
        }
      }
    }

    let resp = `${user.username} - PG **${pg.name}**: Aggiunti item: ${addedItems.join(", ")}.`;
    if (addedSints.length) resp += ` Sintonie aggiunte: ${addedSints.join(", ")}.`;
    if (skippedSints.length) resp += ` Sintonie non aggiunte (limite 3): ${skippedSints.join(", ")}.`;

    return interaction.reply(resp);
  }

  // === RIMUOVI_ITEM (bulk) ===
  if (command === "rimuovi_item") {
    if (!isGM) return interaction.reply({ content: "Solo il ruolo Gm-bot può usare questo comando.", ephemeral: true });

    const raw = interaction.options.getString("items");
    const items = sanitizeItemsList(raw);
    const user = interaction.options.getUser("giocatore");
    const name = interaction.options.getString("nome");
    const pg = getCharacter(user.id, name);
    if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

    if (!items.length) return interaction.reply({ content: "Nessun item valido fornito.", ephemeral: true });

    let sintonie = getAttunements(pg.id);
    const removed = [];
    const notFound = [];
    const removedSints = [];

    for (const rawIt of items) {
      const clean = stripSintonizedTag(rawIt);

      const beforeCount = getInventory(pg.id).length;
      const deletedCount = removeInventoryItemsByCleanName(pg.id, clean);
      const afterCount = beforeCount - deletedCount;

      if (deletedCount > 0) {
        removed.push(rawIt);
        if (sintonie.includes(clean)) {
          clearAttunementByName(pg.id, clean);
          sintonie = sintonie.filter(s => s !== clean);
          removedSints.push(clean);
        }
      } else {
        notFound.push(rawIt);
      }
    }

    let msg = `${user.username} - PG **${pg.name}**: Rimosso: ${removed.length ? removed.join(", ") : "Nessuno"}.`;
    if (notFound.length) msg += ` Non trovati: ${notFound.join(", ")}.`;
    if (removedSints.length) msg += ` Sintonie rimosse: ${removedSints.join(", ")}.`;
    return interaction.reply(msg);
  }

  // === AGGIUNGI SINTONIA ===
  if (command === "aggiungi_sintonia") {
    if (!isGM) return interaction.reply({ content: "Solo il ruolo Gm-bot può usare questo comando.", ephemeral: true });

    const sintRaw = interaction.options.getString("nome_sintonia");
    const sint = stripSintonizedTag(sintRaw);
    const user = interaction.options.getUser("giocatore");
    const name = interaction.options.getString("nome");
    const pg = getCharacter(user.id, name);
    if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

    let sintonie = getAttunements(pg.id);
    if (sintonie.length >= 3) return interaction.reply({ content: "Impossibile: massimo 3 sintonie raggiunto.", ephemeral: true });
    if (sintonie.includes(sint)) return interaction.reply({ content: "Questa sintonia è già presente.", ephemeral: true });

    addAttunement(pg.id, sint);

    const inv = getInventory(pg.id);
    const inventoryHas = inv.some(i => stripSintonizedTag(i) === sint);
    if (!inventoryHas) addInventoryItem(pg.id, `${sint} [s]`);

    return interaction.reply(`${user.username} - PG **${pg.name}**: Aggiunta sintonia: ${sint}.`);
  }

  // === RIMUOVI SINTONIA ===
  if (command === "rimuovi_sintonia") {
    if (!isGM) return interaction.reply({ content: "Solo il ruolo Gm-bot può usare questo comando.", ephemeral: true });

    const sintRaw = interaction.options.getString("nome_sintonia");
    const sint = stripSintonizedTag(sintRaw);
    const user = interaction.options.getUser("giocatore");
    const name = interaction.options.getString("nome");
    const pg = getCharacter(user.id, name);
    if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

    let sintonie = getAttunements(pg.id);
    if (!sintonie.length) return interaction.reply({ content: "Nessuna sintonia da rimuovere.", ephemeral: true });
    if (!sintonie.includes(sint)) return interaction.reply({ content: "Questa sintonia non è presente sul PG.", ephemeral: true });

    clearAttunementByName(pg.id, sint);

    // remove inventory entries that correspond to that sintonia
    removeInventoryItemsByCleanName(pg.id, sint);

    return interaction.reply(`${user.username} - PG **${pg.name}**: Rimossa sintonia: ${sint}.`);
  }

  // === ELIMINA PG ===
  if (command === "elimina_pg") {
    if (!isGM) return interaction.reply({ content: "Solo il ruolo Gm-bot può usare questo comando.", ephemeral: true });
    const user = interaction.options.getUser("giocatore");
    const name = interaction.options.getString("nome");

    const pg = getCharacter(user.id, name);
    if (!pg) return interaction.reply({ content: "Questo giocatore non ha questo PG.", ephemeral: true });

    deleteCharacterAndData(pg.id);

    // se il player non ha più pg, posso opzionalmente rimuovere record player
    const remaining = listCharacters(user.id);
    if (remaining.length === 0) {
      db.prepare("DELETE FROM players WHERE id = ?").run(user.id);
    }

    return interaction.reply({ content: `PG **${name}** eliminato.`, ephemeral: false });
  }

  // === RINOMINA PG ===
  if (command === "rinomina_pg") {
    if (!isGM) return interaction.reply({ content: "Solo il ruolo Gm-bot può usare questo comando.", ephemeral: true });
    const user = interaction.options.getUser("giocatore");
    const oldName = interaction.options.getString("vecchio_nome");
    const newName = interaction.options.getString("nuovo_nome");

    const pg = getCharacter(user.id, oldName);
    if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

    renameCharacter(pg.id, newName);

    return interaction.reply({ content: `PG **${oldName}** rinominato in **${newName}**.`, ephemeral: false });
  }

  // === LISTA PG ===
  if (command === "lista_pg") {
    const user = interaction.options.getUser("giocatore");
    const chars = listCharacters(user.id);
    const list = chars.map(p => p.name);
    return interaction.reply({ content: `PG di ${user.username}: ${list.length ? list.join(", ") : "Nessuno"}`, ephemeral: false });
  }

});

client.login(token);
