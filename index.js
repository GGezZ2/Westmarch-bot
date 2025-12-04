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
function hasRoleGM(member, roleName = "GM") {
    try {
        return member.roles.cache.some(r => r.name === roleName);
    } catch (e) {
        return false;
    }
}
const sanitizeItemsList = (raw) => raw.split(",").map(s => s.trim()).filter(s => s.length);

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

        // for nome_sintonia or nome_sintonia autocomplete (optional) - currently not used
        return interaction.respond([]);
    }

    if (!interaction.isChatInputCommand()) return;

    const command = interaction.commandName;
    const GM_ROLE_NAME = "GM";
    const isGM = hasRoleGM(interaction.member, GM_ROLE_NAME);

    const getPG = (playerId, name) => db.players[playerId]?.find(p => p.name === name);

    // === CREA PG ===
    if (command === "crea_pg") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo GM può usare questo comando.", ephemeral: true });
        const user = interaction.options.getUser("giocatore");
        const name = interaction.options.getString("nome");

        db.players[user.id] ??= [];

        if (db.players[user.id].length >= 2)
            return interaction.reply({ content: "Questo giocatore ha già 2 PG attivi!", ephemeral: true });

        // default fields: xp, gold, conto_bancario, inventory, sintonie
        db.players[user.id].push({ name, xp: 0, gold: 0, conto_bancario: 0, inventory: [], sintonie: [] });
        await saveDB(db);

        return interaction.reply(`PG **${name}** creato per ${user.username}.`);
    }

    // === SCHEDA ===
    if (command === "scheda") {
        const user = interaction.options.getUser("giocatore");
        const name = interaction.options.getString("nome");

        const pg = getPG(user.id, name);
        if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

        return interaction.reply({
            content: `📜 **Scheda di ${pg.name}**\nXP: ${pg.xp}\nGold: ${pg.gold}\nConto bancario: ${pg.conto_bancario}\nSintonie: ${pg.sintonie.length ? pg.sintonie.join(", ") : "Nessuna"}\nInventario: ${pg.inventory.length ? pg.inventory.join(", ") : "Vuoto"}`,
            ephemeral: false
        });
    }

    // === RICOMPENSA ===
    if (command === "ricompensa") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo GM può usare questo comando.", ephemeral: true });
        const grade = interaction.options.getString("grado").toUpperCase();
        const user = interaction.options.getUser("giocatore");
        const name = interaction.options.getString("nome");

        if (!REWARDS[grade]) return interaction.reply({ content: "Grado non valido (C/B/A).", ephemeral: true });

        const pg = getPG(user.id, name);
        if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

        pg.xp += REWARDS[grade].xp;
        pg.gold += REWARDS[grade].gold;

        await saveDB(db);

        return interaction.reply(`Sessione grado **${grade}** completata!\n${pg.name} guadagna: **${REWARDS[grade].xp} XP** e **${REWARDS[grade].gold} oro**.`);
    }

    // === AGGIUNGI (con note, supporto multiple items se tipo=item) ===
    if (command === "aggiungi") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo GM può usare questo comando.", ephemeral: true });

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
            const before = pg.xp;
            pg.xp += amount;
            await saveDB(db);
            return interaction.reply(`${user.username} - PG **${pg.name}**: XP ${before} → ${pg.xp}. Nota: ${note}`);
        } else if (type === "gold") {
            const amount = parseInt(rawValue);
            if (Number.isNaN(amount)) return interaction.reply({ content: "Valore gold non valido.", ephemeral: true });
            const before = pg.gold;
            pg.gold += amount;
            await saveDB(db);
            return interaction.reply(`${user.username} - PG **${pg.name}**: Gold ${before} → ${pg.gold}. Nota: ${note}`);
        } else if (type === "item") {
            const items = sanitizeItemsList(rawValue);
            if (!items.length) return interaction.reply({ content: "Nessun item valido fornito.", ephemeral: true });
            pg.inventory.push(...items);
            await saveDB(db);
            return interaction.reply(`${user.username} - PG **${pg.name}**: Aggiunti item: ${items.join(", ")}. Nota: ${note}`);
        } else {
            return interaction.reply({ content: "Tipo non valido.", ephemeral: true });
        }
    }

    // === RIMUOVI (con note, supporto multiple items se tipo=item) ===
    if (command === "rimuovi") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo GM può usare questo comando.", ephemeral: true });

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
            const before = pg.xp;
            pg.xp = Math.max(0, pg.xp - amount);
            await saveDB(db);
            return interaction.reply(`${user.username} - PG **${pg.name}**: XP ${before} → ${pg.xp}. Nota: ${note}`);
        } else if (type === "gold") {
            const amount = parseInt(rawValue);
            if (Number.isNaN(amount)) return interaction.reply({ content: "Valore gold non valido.", ephemeral: true });
            const before = pg.gold;
            pg.gold = Math.max(0, pg.gold - amount);
            await saveDB(db);
            return interaction.reply(`${user.username} - PG **${pg.name}**: Gold ${before} → ${pg.gold}. Nota: ${note}`);
        } else if (type === "item") {
            const items = sanitizeItemsList(rawValue);
            if (!items.length) return interaction.reply({ content: "Nessun item valido fornito.", ephemeral: true });

            const removed = [];
            const notFound = [];
            for (const it of items) {
                // remove all occurrences
                const beforeCount = pg.inventory.length;
                pg.inventory = pg.inventory.filter(i => i !== it);
                const afterCount = pg.inventory.length;
                if (afterCount < beforeCount) removed.push(it);
                else notFound.push(it);
            }
            await saveDB(db);
            let msg = `${user.username} - PG **${pg.name}**: Rimosso: ${removed.length ? removed.join(", ") : "Nessuno"}.`;
            if (notFound.length) msg += ` Non trovati: ${notFound.join(", ")}.`;
            msg += ` Nota: ${note}`;
            return interaction.reply(msg);
        } else {
            return interaction.reply({ content: "Tipo non valido.", ephemeral: true });
        }
    }

    // === DEPOSITO (gold -> conto_bancario) ===
    if (command === "deposito") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo GM può usare questo comando.", ephemeral: true });

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
        if (!isGM) return interaction.reply({ content: "Solo il ruolo GM può usare questo comando.", ephemeral: true });

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
        if (!isGM) return interaction.reply({ content: "Solo il ruolo GM può usare questo comando.", ephemeral: true });

        const raw = interaction.options.getString("items");
        const items = sanitizeItemsList(raw);
        const user = interaction.options.getUser("giocatore");
        const name = interaction.options.getString("nome");
        const pg = getPG(user.id, name);
        if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

        if (!items.length) return interaction.reply({ content: "Nessun item valido fornito.", ephemeral: true });

        pg.inventory.push(...items);
        await saveDB(db);

        return interaction.reply(`${user.username} - PG **${pg.name}**: Aggiunti item: ${items.join(", ")}`);
    }

    // === RIMUOVI_ITEM (bulk) ===
    if (command === "rimuovi_item") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo GM può usare questo comando.", ephemeral: true });

        const raw = interaction.options.getString("items");
        const items = sanitizeItemsList(raw);
        const user = interaction.options.getUser("giocatore");
        const name = interaction.options.getString("nome");
        const pg = getPG(user.id, name);
        if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

        if (!items.length) return interaction.reply({ content: "Nessun item valido fornito.", ephemeral: true });

        const removed = [];
        const notFound = [];
        for (const it of items) {
            const beforeCount = pg.inventory.length;
            pg.inventory = pg.inventory.filter(i => i !== it);
            const afterCount = pg.inventory.length;
            if (afterCount < beforeCount) removed.push(it);
            else notFound.push(it);
        }
        await saveDB(db);

        let msg = `${user.username} - PG **${pg.name}**: Rimosso: ${removed.length ? removed.join(", ") : "Nessuno"}.`;
        if (notFound.length) msg += ` Non trovati: ${notFound.join(", ")}.`;
        return interaction.reply(msg);
    }

    // === AGGIUNGI SINTONIA ===
    if (command === "aggiungi_sintonia") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo GM può usare questo comando.", ephemeral: true });

        const sint = interaction.options.getString("nome_sintonia");
        const user = interaction.options.getUser("giocatore");
        const name = interaction.options.getString("nome");
        const pg = getPG(user.id, name);
        if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

        pg.sintonie = pg.sintonie || [];
        if (pg.sintonie.length >= 3) return interaction.reply({ content: "Impossibile: massimo 3 sintonie raggiunto.", ephemeral: true });
        if (pg.sintonie.includes(sint)) return interaction.reply({ content: "Questa sintonia è già presente.", ephemeral: true });

        pg.sintonie.push(sint);
        await saveDB(db);
        return interaction.reply(`${user.username} - PG **${pg.name}**: Aggiunta sintonia: ${sint}.`);
    }

    // === RIMUOVI SINTONIA ===
    if (command === "rimuovi_sintonia") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo GM può usare questo comando.", ephemeral: true });

        const sint = interaction.options.getString("nome_sintonia");
        const user = interaction.options.getUser("giocatore");
        const name = interaction.options.getString("nome");
        const pg = getPG(user.id, name);
        if (!pg) return interaction.reply({ content: "PG non trovato!", ephemeral: true });

        pg.sintonie = pg.sintonie || [];
        if (!pg.sintonie.length) return interaction.reply({ content: "Nessuna sintonia da rimuovere.", ephemeral: true });
        if (!pg.sintonie.includes(sint)) return interaction.reply({ content: "Questa sintonia non è presente sul PG.", ephemeral: true });

        pg.sintonie = pg.sintonie.filter(s => s !== sint);
        await saveDB(db);
        return interaction.reply(`${user.username} - PG **${pg.name}**: Rimossa sintonia: ${sint}.`);
    }

    // === ELIMINA PG ===
    if (command === "elimina_pg") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo GM può usare questo comando.", ephemeral: true });
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
        if (!isGM) return interaction.reply({ content: "Solo il ruolo GM può usare questo comando.", ephemeral: true });
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
