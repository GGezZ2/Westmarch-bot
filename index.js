import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import fs from "fs-extra";

const token = process.env.TOKEN;
const guildId = process.env.GUILD_ID;
const clientId = process.env.CLIENT_ID;

if (!token || !clientId || !guildId) {
  console.error("Missing environment variables. Ensure TOKEN, CLIENT_ID and GUILD_ID are set.");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

// === DATABASE SYSTEM ===
const DB_PATH = "./db.json";
async function loadDB() {
    if (!fs.existsSync(DB_PATH)) await fs.writeJSON(DB_PATH, { players: {} });
    return fs.readJSON(DB_PATH);
}
async function saveDB(db) {
    return fs.writeJSON(DB_PATH, db, { spaces: 2 });
}

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
async function handleLevelUpIfAny(pg, oldXP, interaction, db) {
    const oldLevel = pg.level || getLevelFromXP(oldXP);
    const newLevel = getLevelFromXP(pg.xp);

    if (newLevel > oldLevel) {
        pg.level = newLevel;
        await saveDB(db);

        // prefer environment variable for channel ID
        const levelChannelId = process.env.LEVEL_UP_CHANNEL;
        let channel = null;

        if (levelChannelId) {
            channel = client.channels.cache.get(levelChannelId);
        }

        // fallback: try to find a channel in the guild whose name contains 'level'
        if (!channel && interaction && interaction.guild) {
            channel = interaction.guild.channels.cache.find(c => c.name && c.name.toLowerCase().includes("level"));
        }

        // fallback to reply in the channel where command was used (as last resort)
        if (!channel) {
            try {
                await interaction.followUp({ content: `<@${pg.ownerId}> 🎉 **${pg.name} è salito al livello ${newLevel}!**`, ephemeral: false });
            } catch (e) {
                console.log("Unable to post level-up message in followUp:", e.message);
            }
            return;
        }

        try {
            channel.send({ content: `<@${pg.ownerId}> 🎉 **${pg.name} è salito al livello ${newLevel}!**` });
        } catch (e) {
            console.error("Failed to send level-up message:", e.message);
        }
    }
}

// === INTERACTIONS ===
client.on("interactionCreate", async interaction => {
    const db = await loadDB();

    // --- AUTOCOMPLETE ---
    if (interaction.isAutocomplete()) {
        const focusedOption = interaction.options.getFocused(true);

        if (["nome", "vecchio_nome"].includes(focusedOption.name)) {
            // try to get the specific user's PGs; if none selected, aggregate all PG names
            const user = interaction.options.getUser("giocatore");
            let choices = [];

            if (user && db.players[user.id]) {
                choices = db.players[user.id].map(p => p.name);
            } else {
                for (const arr of Object.values(db.players)) {
                    choices.push(...arr.map(p => p.name));
                }
            }

            const filtered = choices
                .filter((c, i) => c.toLowerCase().startsWith(focusedOption.value.toLowerCase()))
                .slice(0, 25);

            return interaction.respond(filtered.map(c => ({ name: c, value: c })));
        }

        // for nome_sintonia autocomplete (optional) - currently not used
        return interaction.respond([]);
    }

    if (!interaction.isChatInputCommand()) return;

    const command = interaction.commandName;
    const GM_ROLE_NAME = "Gm-bot";
    const isGM = hasRoleGM(interaction.member, GM_ROLE_NAME);

    const getPG = (playerId, name) => db.players[playerId]?.find(p => p.name === name);

    // === CREA PG ===
    if (command === "crea_pg") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo Gm-bot può usare questo comando.", ephemeral: true });
        const user = interaction.options.getUser("giocatore");
        const name = interaction.options.getString("nome");

        db.players[user.id] ??= [];

        if (db.players[user.id].length >= 2)
            return interaction.reply({ content: "Questo giocatore ha già 2 PG attivi!", ephemeral: true });

        // default fields: xp, gold, conto_bancario, inventory, sintonie, ownerId, level
        const newPG = {
            name,
            xp: 0,
            gold: 0,
            conto_bancario: 0,
            inventory: [],
            sintonie: [],
            ownerId: user.id,
            level: getLevelFromXP(0)
        };

        db.players[user.id].push(newPG);
        await saveDB(db);

        return interaction.reply(`PG **${name}** creato per ${user.username}.`);
    }

    // === SCHEDA ===
    if (command === "scheda") {
        const user = interaction.options.getUser("giocatore");
        const name = interaction.options.getString("nome");

        const pg = getPG(user.id, name);
        if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

        // mark inventory items that are sintonized (either have [s] tag or their clean name is in sintonie)
        const invDisplay = pg.inventory.length
            ? pg.inventory.map(i => {
                // if item already has tag, show as-is; else check sintonie
                if (isSintonizedTag(i)) return i;
                const clean = stripSintonizedTag(i);
                return pg.sintonie && pg.sintonie.includes(clean) ? `${i} [s]` : i;
            }).join(", ")
            : "Vuoto";

        return interaction.reply({
            content: `📜 **Scheda di ${pg.name}**\nLivello: ${pg.level || getLevelFromXP(pg.xp)}\nXP: ${pg.xp}\nGold: ${pg.gold}\nConto bancario: ${pg.conto_bancario}\nSintonie: ${pg.sintonie.length ? pg.sintonie.join(", ") : "Nessuna"}\nInventario: ${invDisplay}`,
            ephemeral: false
        });
    }

    // === RICOMPENSA ===
    if (command === "ricompensa") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo Gm-bot può usare questo comando.", ephemeral: true });
        const grade = interaction.options.getString("grado").toUpperCase();
        const user = interaction.options.getUser("giocatore");
        const name = interaction.options.getString("nome");

        if (!REWARDS[grade]) return interaction.reply({ content: "Grado non valido (C/B/A).", ephemeral: true });

        const pg = getPG(user.id, name);
        if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

        const beforeXP = pg.xp || 0;
        pg.xp += REWARDS[grade].xp;
        pg.gold += REWARDS[grade].gold;

        await saveDB(db);

        // check for level up (this will save again if leveled)
        await handleLevelUpIfAny(pg, beforeXP, interaction, db);

        return interaction.reply(`Sessione grado **${grade}** completata!\n${pg.name} guadagna: **${REWARDS[grade].xp} XP** e **${REWARDS[grade].gold} oro**.`);
    }

    // === AGGIUNGI (con note, supporto multiple items se tipo=item) ===
    if (command === "aggiungi") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo Gm-bot può usare questo comando.", ephemeral: true });

        const type = interaction.options.getString("tipo");
        const rawValue = interaction.options.getString("valore");
        const note = interaction.options.getString("note");
        const user = interaction.options.getUser("giocatore");
        const name = interaction.options.getString("nome");

        const pg = getPG(user.id, name);
        if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

        if (type === "xp") {
            const amount = parseInt(rawValue);
            if (Number.isNaN(amount)) return interaction.reply({ content: "Valore XP non valido.", ephemeral: true });
            const before = pg.xp || 0;
            pg.xp += amount;
            await saveDB(db);
            await handleLevelUpIfAny(pg, before, interaction, db);
            return interaction.reply(`${user.username} - PG **${pg.name}**: XP ${before} → ${pg.xp}. Nota: ${note}`);
        } else if (type === "gold") {
            const amount = parseInt(rawValue);
            if (Number.isNaN(amount)) return interaction.reply({ content: "Valore gold non valido.", ephemeral: true });
            const before = pg.gold || 0;
            pg.gold += amount;
            await saveDB(db);
            return interaction.reply(`${user.username} - PG **${pg.name}**: Gold ${before} → ${pg.gold}. Nota: ${note}`);
        } else if (type === "item") {
            const items = sanitizeItemsList(rawValue);
            if (!items.length) return interaction.reply({ content: "Nessun item valido fornito.", ephemeral: true });

            // handle sintonized items automatically
            pg.sintonie = pg.sintonie || [];
            const addedItems = [];
            const addedSints = [];
            const skippedSints = [];

            for (const rawItem of items) {
                const hadTag = isSintonizedTag(rawItem);
                const clean = stripSintonizedTag(rawItem);
                const itemToStore = hadTag ? `${clean} [s]` : clean;

                // push inventory (store item with [s] if user provided tag, otherwise plain)
                pg.inventory.push(itemToStore);
                addedItems.push(itemToStore);

                // if item is sintonized (tag present) try to add to sintonie
                if (hadTag) {
                    if (!pg.sintonie.includes(clean)) {
                        if (pg.sintonie.length >= 3) {
                            skippedSints.push(clean);
                        } else {
                            pg.sintonie.push(clean);
                            addedSints.push(clean);
                        }
                    }
                }
            }

            await saveDB(db);

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

        const pg = getPG(user.id, name);
        if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

        if (type === "xp") {
            const amount = parseInt(rawValue);
            if (Number.isNaN(amount)) return interaction.reply({ content: "Valore XP non valido.", ephemeral: true });
            const before = pg.xp || 0;
            pg.xp = Math.max(0, before - amount);
            // adjust level down if needed (no announcement)
            pg.level = getLevelFromXP(pg.xp);
            await saveDB(db);
            return interaction.reply(`${user.username} - PG **${pg.name}**: XP ${before} → ${pg.xp}. Nota: ${note}`);
        } else if (type === "gold") {
            const amount = parseInt(rawValue);
            if (Number.isNaN(amount)) return interaction.reply({ content: "Valore gold non valido.", ephemeral: true });
            const before = pg.gold || 0;
            pg.gold = Math.max(0, before - amount);
            await saveDB(db);
            return interaction.reply(`${user.username} - PG **${pg.name}**: Gold ${before} → ${pg.gold}. Nota: ${note}`);
        } else if (type === "item") {
            const items = sanitizeItemsList(rawValue);
            if (!items.length) return interaction.reply({ content: "Nessun item valido fornito.", ephemeral: true });

            pg.sintonie = pg.sintonie || [];
            const removed = [];
            const notFound = [];
            const removedSints = [];

            for (const rawIt of items) {
                const hadTag = isSintonizedTag(rawIt);
                const clean = stripSintonizedTag(rawIt);

                const beforeCount = pg.inventory.length;
                // remove all matching inventory entries that equal either raw form or clean or clean + [s]
                pg.inventory = pg.inventory.filter(i => {
                    const cleanedI = stripSintonizedTag(i);
                    return cleanedI !== clean; // keep those that don't match the clean name
                });
                const afterCount = pg.inventory.length;

                if (afterCount < beforeCount) {
                    removed.push(rawIt);
                    // if the removed item corresponds to a sintonia, remove it
                    if (pg.sintonie.includes(clean)) {
                        pg.sintonie = pg.sintonie.filter(s => s !== clean);
                        removedSints.push(clean);
                    }
                } else {
                    notFound.push(rawIt);
                }
            }

            await saveDB(db);

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
        const pg = getPG(user.id, name);
        if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

        if (amount <= 0) return interaction.reply({ content: "Quantità non valida.", ephemeral: true });
        if (pg.gold < amount) return interaction.reply({ content: "Gold insufficienti.", ephemeral: true });

        pg.gold -= amount;
        pg.conto_bancario = (pg.conto_bancario || 0) + amount;
        await saveDB(db);

        return interaction.reply(`${user.username} - PG **${pg.name}**: Deposito di ${amount} effettuato. Gold: ${pg.gold}. Conto: ${pg.conto_bancario}`);
    }

    // === PRELIEVO (conto_bancario -> gold) ===
    if (command === "prelievo") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo Gm-bot può usare questo comando.", ephemeral: true });

        const amount = interaction.options.getInteger("quantita");
        const user = interaction.options.getUser("giocatore");
        const name = interaction.options.getString("nome");
        const pg = getPG(user.id, name);
        if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

        if (amount <= 0) return interaction.reply({ content: "Quantità non valida.", ephemeral: true });
        if ((pg.conto_bancario || 0) < amount) return interaction.reply({ content: "Saldo conto insufficiente.", ephemeral: true });

        pg.conto_bancario -= amount;
        pg.gold = (pg.gold || 0) + amount;
        await saveDB(db);

        return interaction.reply(`${user.username} - PG **${pg.name}**: Prelievo di ${amount} effettuato. Gold: ${pg.gold}. Conto: ${pg.conto_bancario}`);
    }

    // === AGGIUNGI_ITEM (bulk) ===
    if (command === "aggiungi_item") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo Gm-bot può usare questo comando.", ephemeral: true });

        const raw = interaction.options.getString("items");
        const items = sanitizeItemsList(raw);
        const user = interaction.options.getUser("giocatore");
        const name = interaction.options.getString("nome");
        const pg = getPG(user.id, name);
        if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

        if (!items.length) return interaction.reply({ content: "Nessun item valido fornito.", ephemeral: true });

        // handle sintonized items automatically
        pg.sintonie = pg.sintonie || [];
        const addedItems = [];
        const addedSints = [];
        const skippedSints = [];

        for (const rawItem of items) {
            const hadTag = isSintonizedTag(rawItem);
            const clean = stripSintonizedTag(rawItem);
            const itemToStore = hadTag ? `${clean} [s]` : clean;

            pg.inventory.push(itemToStore);
            addedItems.push(itemToStore);

            if (hadTag && !pg.sintonie.includes(clean)) {
                if (pg.sintonie.length >= 3) skippedSints.push(clean);
                else {
                    pg.sintonie.push(clean);
                    addedSints.push(clean);
                }
            }
        }

        await saveDB(db);

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
        const pg = getPG(user.id, name);
        if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

        if (!items.length) return interaction.reply({ content: "Nessun item valido fornito.", ephemeral: true });

        const removed = [];
        const notFound = [];
        const removedSints = [];

        for (const rawIt of items) {
            const clean = stripSintonizedTag(rawIt);
            const beforeCount = pg.inventory.length;
            pg.inventory = pg.inventory.filter(i => stripSintonizedTag(i) !== clean);
            const afterCount = pg.inventory.length;
            if (afterCount < beforeCount) {
                removed.push(rawIt);
                if (pg.sintonie.includes(clean)) {
                    pg.sintonie = pg.sintonie.filter(s => s !== clean);
                    removedSints.push(clean);
                }
            } else notFound.push(rawIt);
        }

        await saveDB(db);

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
        const pg = getPG(user.id, name);
        if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

        pg.sintonie = pg.sintonie || [];
        if (pg.sintonie.length >= 3) return interaction.reply({ content: "Impossibile: massimo 3 sintonie raggiunto.", ephemeral: true });
        if (pg.sintonie.includes(sint)) return interaction.reply({ content: "Questa sintonia è già presente.", ephemeral: true });

        pg.sintonie.push(sint);

        // ensure inventory contains the corresponding [s] item
        const inventoryHas = pg.inventory.some(i => stripSintonizedTag(i) === sint);
        if (!inventoryHas) pg.inventory.push(`${sint} [s]`);

        await saveDB(db);
        return interaction.reply(`${user.username} - PG **${pg.name}**: Aggiunta sintonia: ${sint}.`);
    }

    // === RIMUOVI SINTONIA ===
    if (command === "rimuovi_sintonia") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo Gm-bot può usare questo comando.", ephemeral: true });

        const sintRaw = interaction.options.getString("nome_sintonia");
        const sint = stripSintonizedTag(sintRaw);
        const user = interaction.options.getUser("giocatore");
        const name = interaction.options.getString("nome");
        const pg = getPG(user.id, name);
        if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

        pg.sintonie = pg.sintonie || [];
        if (!pg.sintonie.length) return interaction.reply({ content: "Nessuna sintonia da rimuovere.", ephemeral: true });
        if (!pg.sintonie.includes(sint)) return interaction.reply({ content: "Questa sintonia non è presente sul PG.", ephemeral: true });

        pg.sintonie = pg.sintonie.filter(s => s !== sint);
        // remove inventory entries that correspond to that sintonia
        pg.inventory = pg.inventory.filter(i => stripSintonizedTag(i) !== sint);

        await saveDB(db);
        return interaction.reply(`${user.username} - PG **${pg.name}**: Rimossa sintonia: ${sint}.`);
    }

    // === ELIMINA PG ===
    if (command === "elimina_pg") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo Gm-bot può usare questo comando.", ephemeral: true });
        const user = interaction.options.getUser("giocatore");
        const name = interaction.options.getString("nome");

        if (!db.players[user.id]) return interaction.reply({ content: "Questo giocatore non ha PG.", ephemeral: true });
        db.players[user.id] = db.players[user.id].filter(p => p.name !== name);
        if (!db.players[user.id].length) delete db.players[user.id];
        await saveDB(db);

        return interaction.reply({ content: `PG **${name}** eliminato.`, ephemeral: false });
    }

    // === RINOMINA PG ===
    if (command === "rinomina_pg") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo Gm-bot può usare questo comando.", ephemeral: true });
        const user = interaction.options.getUser("giocatore");
        const oldName = interaction.options.getString("vecchio_nome");
        const newName = interaction.options.getString("nuovo_nome");

        const pg = getPG(user.id, oldName);
        if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

        pg.name = newName;
        await saveDB(db);

        return interaction.reply({ content: `PG **${oldName}** rinominato in **${newName}**.`, ephemeral: false });
    }

    // === LISTA PG ===
    if (command === "lista_pg") {
        const user = interaction.options.getUser("giocatore");
        const list = (db.players[user.id] || []).map(p => p.name);
        return interaction.reply({ content: `PG di ${user.username}: ${list.length ? list.join(", ") : "Nessuno"}`, ephemeral: false });
    }

});

client.login(token);
