import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import fs from "fs-extra";

const token = process.env.TOKEN;
const guildId = process.env.GUILD_ID;
const clientId = process.env.CLIENT_ID;
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
        .addStringOption(o => o.setName("nome").setDescription("Nome del PG").setRequired(true)),

    new SlashCommandBuilder()
        .setName("ricompensa")
        .setDescription("Assegna automaticamente ricompense di una sessione.")
        .addStringOption(o => o.setName("grado").setDescription("C, B, A").setRequired(true))
        .addUserOption(o => o.setName("giocatore").setDescription("Il giocatore").setRequired(true))
        .addStringOption(o => o.setName("nome").setDescription("Nome del PG").setRequired(true)),

    new SlashCommandBuilder()
        .setName("aggiungi")
        .setDescription("Aggiunge XP, oro o oggetto al PG.")
        .addStringOption(o => o.setName("tipo").setDescription("xp | gold | item").setRequired(true))
        .addStringOption(o => o.setName("valore").setDescription("Numero o nome oggetto").setRequired(true))
        .addUserOption(o => o.setName("giocatore").setDescription("Il giocatore").setRequired(true))
        .addStringOption(o => o.setName("nome").setDescription("Nome del PG").setRequired(true)),

    new SlashCommandBuilder()
        .setName("rimuovi")
        .setDescription("Rimuove oro, XP o oggetto dal PG.")
        .addStringOption(o => o.setName("tipo").setDescription("xp | gold | item").setRequired(true))
        .addStringOption(o => o.setName("valore").setDescription("Numero o nome oggetto").setRequired(true))
        .addUserOption(o => o.setName("giocatore").setDescription("Il giocatore").setRequired(true))
        .addStringOption(o => o.setName("nome").setDescription("Nome del PG").setRequired(true)),

    new SlashCommandBuilder()
        .setName("elimina_pg")
        .setDescription("Elimina completamente una scheda di un PG.")
        .addUserOption(o => o.setName("giocatore").setDescription("Il giocatore").setRequired(true))
        .addStringOption(o => o.setName("nome").setDescription("Nome del PG").setRequired(true)),

    new SlashCommandBuilder()
        .setName("rinomina_pg")
        .setDescription("Rinomina un PG.")
        .addUserOption(o => o.setName("giocatore").setDescription("Il giocatore").setRequired(true))
        .addStringOption(o => o.setName("vecchio_nome").setDescription("Nome attuale del PG").setRequired(true))
        .addStringOption(o => o.setName("nuovo_nome").setDescription("Nuovo nome del PG").setRequired(true)),
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

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const db = await loadDB();
    const command = interaction.commandName;
    const GM_ROLE_NAME = "GM"; // ruolo esclusivo

    const isGM = interaction.member.roles.cache.some(r => r.name === GM_ROLE_NAME);

    const getPG = (playerId, name) => db.players[playerId]?.find(p => p.name === name);

    // === CREA PG ===
    if (command === "crea_pg") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo GM può usare questo comando.", ephemeral: true });
        const user = interaction.options.getUser("giocatore");
        const name = interaction.options.getString("nome");

        db.players[user.id] ??= [];

        if (db.players[user.id].length >= 2)
            return interaction.reply({ content: "Questo giocatore ha già 2 PG attivi!", ephemeral: true });

        db.players[user.id].push({ name, xp: 0, gold: 0, inventory: [] });
        await saveDB(db);

        return interaction.reply(`PG **${name}** creato per ${user.username}.`);
    }

    // === SCHEDA ===
    if (command === "scheda") {
        const user = interaction.options.getUser("giocatore");
        const name = interaction.options.getString("nome");

        const pg = getPG(user.id, name);
        if (!pg) return interaction.reply("PG non trovato!");

        return interaction.reply(
            `📜 **Scheda di ${pg.name}**\nXP: ${pg.xp}\nGold: ${pg.gold}\nInventario: ${pg.inventory.join(", ") || "Vuoto"}`
        );
    }

    // === RICOMPENSA ===
    if (command === "ricompensa") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo GM può usare questo comando.", ephemeral: true });
        const grade = interaction.options.getString("grado").toUpperCase();
        const user = interaction.options.getUser("giocatore");
        const name = interaction.options.getString("nome");

        if (!REWARDS[grade]) return interaction.reply("Grado non valido (C/B/A).");

        const pg = getPG(user.id, name);
        if (!pg) return interaction.reply("PG non trovato!");

        pg.xp += REWARDS[grade].xp;
        pg.gold += REWARDS[grade].gold;

        await saveDB(db);

        return interaction.reply(
            `Sessione grado **${grade}** completata!\n${pg.name} guadagna: **${REWARDS[grade].xp} XP** e **${REWARDS[grade].gold} oro**.`
        );
    }

    // === AGGIUNGI ===
    if (command === "aggiungi") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo GM può usare questo comando.", ephemeral: true });
        const type = interaction.options.getString("tipo");
        const value = interaction.options.getString("valore");
        const user = interaction.options.getUser("giocatore");
        const name = interaction.options.getString("nome");

        const pg = getPG(user.id, name);
        if (!pg) return interaction.reply("PG non trovato!");

        if (type === "xp") pg.xp += parseInt(value);
        else if (type === "gold") pg.gold += parseInt(value);
        else if (type === "item") pg.inventory.push(value);
        else return interaction.reply("Tipo non valido.");

        await saveDB(db);
        return interaction.reply("Aggiornamento effettuato!");
    }

    // === RIMUOVI ===
    if (command === "rimuovi") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo GM può usare questo comando.", ephemeral: true });
        const type = interaction.options.getString("tipo");
        const value = interaction.options.getString("valore");
        const user = interaction.options.getUser("giocatore");
        const name = interaction.options.getString("nome");

        const pg = getPG(user.id, name);
        if (!pg) return interaction.reply("PG non trovato!");

        if (type === "gold") pg.gold -= parseInt(value);
        else if (type === "xp") pg.xp -= parseInt(value);
        else if (type === "item") pg.inventory = pg.inventory.filter(i => i !== value);
        else return interaction.reply("Tipo non valido.");

        await saveDB(db);
        return interaction.reply("Modifica effettuata!");
    }

    // === ELIMINA PG ===
    if (command === "elimina_pg") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo GM può usare questo comando.", ephemeral: true });
        const user = interaction.options.getUser("giocatore");
        const name = interaction.options.getString("nome");

        if (!db.players[user.id]) return interaction.reply("Questo giocatore non ha PG.");
        db.players[user.id] = db.players[user.id].filter(p => p.name !== name);
        await saveDB(db);

        return interaction.reply(`PG **${name}** eliminato.`);
    }

    // === RINOMINA PG ===
    if (command === "rinomina_pg") {
        if (!isGM) return interaction.reply({ content: "Solo il ruolo GM può usare questo comando.", ephemeral: true });
        const user = interaction.options.getUser("giocatore");
        const oldName = interaction.options.getString("vecchio_nome");
        const newName = interaction.options.getString("nuovo_nome");

        const pg = getPG(user.id, oldName);
        if (!pg) return interaction.reply("PG non trovato!");

        pg.name = newName;
        await saveDB(db);

        return interaction.reply(`PG **${oldName}** rinominato in **${newName}**.`);
    }
});

client.login(token);
