import "dotenv/config";
import fs from "fs";
import { Client, GatewayIntentBits, Partials, Routes, REST, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, AttachmentBuilder, EmbedBuilder } from "discord.js";

import { createCanvas } from "@napi-rs/canvas";

// =====================================
// LOG
// =====================================
function log(...a) {
    console.log(`[BOT]`, ...a);
}

// =====================================
// DB
// =====================================
function loadDB() {
    try {
        return JSON.parse(fs.readFileSync("./db.json", "utf8"));
    } catch {
        return { servers: {} };
    }
}
function saveDB() {
    fs.writeFileSync("./db.json", JSON.stringify(db, null, 2));
}
let db = loadDB();

function getServer(guildId) {
    if (!db.servers[guildId]) {
        db.servers[guildId] = { roles: [] };
        saveDB();
    }
    return db.servers[guildId];
}

function addRole(guildId, roleId, primary, secondary) {
    const srv = getServer(guildId);
    if (srv.roles.length >= 20) return false;
    srv.roles.push({ id: roleId, primary, secondary });
    saveDB();
    return true;
}

function deleteRole(guildId, roleId) {
    const srv = getServer(guildId);
    const before = srv.roles.length;
    srv.roles = srv.roles.filter(r => r.id !== roleId);
    saveDB();
    return before !== srv.roles.length;
}

// =====================================
// BOT INIT
// =====================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages
    ],
    partials: [Partials.GuildMember, Partials.Message]
});

// =====================================
// COMMANDS REGISTRATION
// =====================================
const commands = [
    {
        name: "random",
        description: "Создать случайный градиент"
    },
    {
        name: "list",
        description: "Показать список созданных градиентных ролей"
    },
    {
        name: "delete",
        description: "Удалить одну из созданных ролей"
    },
{
    name: "clear",
    description: "Удалить все роли с 0 участниками"
},

{
    name: "nocolor",
    description: "Снять все цветные роли у себя"
}

];

client.once("ready", async () => {
    log(`Logged in as ${client.user.tag}`);

    const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

    try {
        log("Registering global slash commands...");
        await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
        log("Commands registered.");
    } catch (e) {
        log("Command registration error:", e);
    }
});

// =====================================
// CANVAS GENERATOR
// =====================================
async function generateGradient(primary, secondary) {
    const width = 800;
    const height = 200;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    const c1 = `#${primary.toString(16).padStart(6, "0")}`;
    const c2 = `#${secondary.toString(16).padStart(6, "0")}`;

    const grad = ctx.createLinearGradient(0, 0, width, 0);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    return await canvas.encode("png");
}

// =====================================
// HELPERS
// =====================================
function randomColorInt() {
    return Math.floor(Math.random() * 0xffffff);
}

// =====================================
// INTERACTION HANDLER
// =====================================
client.on("interactionCreate", async (interaction) => {
    // -----------------------------------------
    // /random
    // -----------------------------------------
    if (interaction.isChatInputCommand() && interaction.commandName === "random") {

        const srv = getServer(interaction.guild.id);
        if (srv.roles.length >= 20)
            return interaction.reply({ content: "Достигнут лимит 20 ролей. Удалите старые ролы.", flags: 64 });

        const primary = randomColorInt();
        const secondary = randomColorInt();

        log(`Generated colors: primary=${primary}, secondary=${secondary}`);

        const buffer = await generateGradient(primary, secondary);
        const attachment = new AttachmentBuilder(buffer, { name: "gradient.png" });

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId(`yes_${primary}_${secondary}`)
                .setStyle(ButtonStyle.Success)
                .setLabel("Да"),
            new ButtonBuilder()
                .setCustomId("no")
                .setStyle(ButtonStyle.Danger)
                .setLabel("Нет")
        );

        await interaction.reply({
            content: `Создать роль с этим градиентом?`,
            components: [row],
            files: [attachment],
            flags: 64
        });

        log("Sent embed with buttons.");
        return;
    }

    // -----------------------------------------
    // BUTTONS
    // -----------------------------------------
    if (interaction.isButton()) {

        // NO
        if (interaction.customId === "no") {
            return interaction.reply({ content: "Отменено.", flags: 64 });
        }

        // YES
        if (interaction.customId.startsWith("yes_")) {
            const [, pStr, sStr] = interaction.customId.split("_");
            const primary = Number(pStr);
            const secondary = Number(sStr);

            log(`Creating role... primary=${primary}, secondary=${secondary}`);

            try {
                // 1) create empty role
                const role = await interaction.guild.roles.create({
                    name: `Gradient-${primary}`,
                    reason: "Создано через /random"
                });

                log(`Role created: ${role.id}`);

                // 2) PATCH colors
                const patchUrl = `https://discord.com/api/v10/guilds/${interaction.guild.id}/roles/${role.id}`;

                const body = {
                    colors: {
                        primary_color: primary,
                        secondary_color: secondary,
                        tertiary_color: null
                    }
                };

                log(`PATCH role => guild=${interaction.guild.id} role=${role.id}`);

                const resp = await fetch(patchUrl, {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bot ${process.env.TOKEN}`
                    },
                    body: JSON.stringify(body)
                });

                if (!resp.ok) {
                    const txt = await resp.text();
                    log(`PATCH FAILED: ${resp.status} ${txt}`);
                    return interaction.reply({ content: "Ошибка применения градиента.", flags: 64 });
                }

                log("PATCH OK");

                addRole(interaction.guild.id, role.id, primary, secondary);

                await interaction.reply({
                    content: `Роль создана: <@&${role.id}>`,
                    flags: 64
                });

                log("Gradient applied successfully.");
            } catch (e) {
                log("ERROR:", e);
                return interaction.reply({ content: "Ошибка при создании роли.", flags: 64 });
            }
            return;
        }
    }

    // -----------------------------------------
    // /list
    // -----------------------------------------
if (interaction.isChatInputCommand() && interaction.commandName === "list") {
    const srv = getServer(interaction.guild.id);

    if (srv.roles.length === 0)
        return interaction.reply({ content: "Ролей нет.", flags: 64 });

    const options = srv.roles.map(r => ({
        label: `Role ${r.id}`,
        description: `primary=${r.primary} secondary=${r.secondary}`,
        value: r.id
    }));

    // Создаем embed с упоминанием ролей
const embed = new EmbedBuilder()
    .setTitle("Список градиентных ролей")
    .setDescription(srv.roles.map(r => `<@&${r.id}> — primary=${r.primary} secondary=${r.secondary}`).join("\n"))
    .setColor("Random");


    return interaction.reply({
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId("pick_role")
                    .setPlaceholder("Выберите роль")
                    .addOptions(options)
            )
        ],
        flags: 64
    });
}
if (interaction.isStringSelectMenu() && interaction.customId === "pick_role") {
    const roleId = interaction.values[0];
    const role = interaction.guild.roles.cache.get(roleId);

    if (!role)
        return interaction.reply({ content: "Роль не найдена.", flags: 64 });

    const member = interaction.guild.members.cache.get(interaction.user.id);
    const srv = getServer(interaction.guild.id);

    // Снимаем предыдущие градиентные роли
    const previousRoles = srv.roles.map(r => r.id).filter(rid => member.roles.cache.has(rid));
    if (previousRoles.length > 0) {
        await member.roles.remove(previousRoles);
        log(`Removed previous roles from ${member.user.tag}: ${previousRoles.join(", ")}`);
    }

    await member.roles.add(role);

    return interaction.reply({ content: `Роль <@&${roleId}> выдана!`, flags: 64 });
}


    // -----------------------------------------
    // /delete
    // -----------------------------------------
    if (interaction.isChatInputCommand() && interaction.commandName === "delete") {
        const srv = getServer(interaction.guild.id);

        if (srv.roles.length === 0)
            return interaction.reply({ content: "Удалять нечего.", flags: 64 });

        const options = srv.roles.map(r => ({
            label: `Role ${r.id}`,
            description: `primary=${r.primary} secondary=${r.secondary}`,
            value: r.id
        }));

        return interaction.reply({
            content: "Выберите роль для удаления:",
            components: [
                new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder()
                        .setCustomId("delete_role")
                        .setPlaceholder("Выберите роль")
                        .addOptions(options)
                )
            ],
            flags: 64
        });
    }

    if (interaction.isStringSelectMenu() && interaction.customId === "delete_role") {
        const roleId = interaction.values[0];

        const role = interaction.guild.roles.cache.get(roleId);
        if (role) await role.delete("Удалено пользователем");

        deleteRole(interaction.guild.id, roleId);

        return interaction.reply({ content: `Роль ${roleId} удалена.`, flags: 64 });
    }

// -----------------------------------------
// /clear
// -----------------------------------------
if (interaction.isChatInputCommand() && interaction.commandName === "clear") {
    const srv = getServer(interaction.guild.id);

    if (srv.roles.length === 0)
        return interaction.reply({ content: "Нет ролей для очистки.", flags: 64 });

    let removed = 0;

    for (const r of [...srv.roles]) {
        const role = interaction.guild.roles.cache.get(r.id);

        if (!role) {
            deleteRole(interaction.guild.id, r.id);
            continue;
        }

        if (role.members.size === 0) {
            await role.delete("Clear unused gradient role");
            deleteRole(interaction.guild.id, r.id);
            removed++;
        }
    }

    return interaction.reply({
        content: removed === 0
            ? "Не найдено ролей с 0 участниками."
            : `Удалено ролей: ${removed}`,
        flags: 64
    });
}

// ========== /nocolor ==========

if (interaction.isChatInputCommand() && interaction.commandName === "nocolor") {
    const guild = interaction.guild;
    const member = interaction.member;
    const guildId = guild.id;

    let db;
    try {
        db = JSON.parse(fs.readFileSync("./db.json", "utf8"));
    } catch (e) {
        console.error("[DB] ERROR parsing db.json:", e);
        return interaction.reply({ content: "Ошибка чтения базы данных.", ephemeral: true });
    }

    if (!db.servers?.[guildId]?.roles?.length) {
        return interaction.reply({ content: "На сервере нет цветных ролей.", ephemeral: true });
    }

    const gradientRoles = db.servers[guildId].roles.map(r => String(r.id));
    const userRolesToRemove = member.roles.cache.filter(r => gradientRoles.includes(String(r.id)));

    if (userRolesToRemove.size === 0) {
        return interaction.reply({ content: "У вас нет цветных ролей для снятия.", ephemeral: true });
    }

    try {
        await member.roles.remove(userRolesToRemove);
    } catch (err) {
        console.error("[nocolor] Failed to remove roles:", err);
        return interaction.reply({ content: "Не удалось снять роли. Проверьте права бота.", ephemeral: true });
    }

    return interaction.reply({ content: `Снято ролей: ${userRolesToRemove.size}`, ephemeral: true });
}



});

// =====================================
client.login(process.env.TOKEN);
client.on("error", console.error);
client.on("warn", console.warn);
process.on("unhandledRejection", console.error);
process.on("uncaughtException", console.error);
