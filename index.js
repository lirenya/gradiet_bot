import {
    Client,
    GatewayIntentBits,
    SlashCommandBuilder,
    REST,
    Routes,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle
} from "discord.js";

import { createCanvas } from "@napi-rs/canvas";
import "dotenv/config";

const TOKEN = process.env.TOKEN;

// ===========================
// ЛОГЕР
// ===========================
function log(...a) {
    console.log("[BOT]", ...a);
}

// ===========================
// УТИЛИТЫ
// ===========================
function randomColor() {
    return Math.floor(Math.random() * 0xffffff);
}

async function generateGradient(primary, secondary) {
    const width = 800;
    const height = 200;

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");

    const grad = ctx.createLinearGradient(0, 0, width, 0);
    grad.addColorStop(0, `#${primary.toString(16).padStart(6, "0")}`);
    grad.addColorStop(1, `#${secondary.toString(16).padStart(6, "0")}`);

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);

    return await canvas.encode("png");
}

// ===========================
// RAW PATCH — назначение градиента на роль
// ===========================
async function applyGradientToRole(guildId, roleId, primary, secondary) {
    log(`PATCH role => guild=${guildId} role=${roleId}`);

    const body = {
        role_colors: {
            primary_color: primary,
            secondary_color: secondary,
            tertiary_color: null
        }
    };

    const response = await fetch(
        `https://discord.com/api/v10/guilds/${guildId}/roles/${roleId}`,
        {
            method: "PATCH",
            headers: {
                "Authorization": `Bot ${TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        }
    );

    if (!response.ok) {
        const txt = await response.text();
        log("PATCH ERROR:", txt);
        throw new Error(txt);
    }

    log("PATCH OK");
    return response.json();
}

// ===========================
// КЛИЕНТ
// ===========================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});

// ===========================
// РЕГИСТРАЦИЯ КОМАНД ПОСЛЕ ЛОГИНА
// ===========================
client.once("ready", async () => {
    log(`Logged in as ${client.user.tag}`);
    log(`Bot ID: ${client.user.id}`);

    const commands = [
        new SlashCommandBuilder()
            .setName("random")
            .setDescription("Сгенерировать случайный градиент")
            .toJSON()
    ];

    const rest = new REST({ version: "10" }).setToken(TOKEN);

    log("Registering global commands...");

    await rest.put(
        Routes.applicationCommands(client.user.id),
        { body: commands }
    );

    log("Commands registered globally.");
});

// ===========================
// ОБРАБОТКА ИНТЕРАКЦИЙ
// ===========================
client.on("interactionCreate", async (interaction) => {
    // ----------------- Slash /random -----------------
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === "random") {
            log(`/random by ${interaction.user.tag} in ${interaction.guild?.name}`);

            const primary = randomColor();
            const secondary = randomColor();

            log(`Generated colors: primary=${primary}, secondary=${secondary}`);

            const fileBuffer = await generateGradient(primary, secondary);

            const embed = new EmbedBuilder()
                .setTitle("🎨 Случайный градиент")
                .setDescription(
                    `Primary: \`#${primary.toString(16).padStart(6, "0")}\`\n` +
                    `Secondary: \`#${secondary.toString(16).padStart(6, "0")}\``
                )
                .setImage("attachment://gradient.png");

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`yes_${primary}_${secondary}`)
                    .setLabel("Да")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId("no")
                    .setLabel("Нет")
                    .setStyle(ButtonStyle.Danger)
            );

            await interaction.reply({
                embeds: [embed],
                files: [{ attachment: fileBuffer, name: "gradient.png" }],
                components: [row]
            });

            log("Sent embed with buttons.");
        }
    }

    // ----------------- Buttons -----------------
    if (interaction.isButton()) {
        log(`Button pressed: ${interaction.customId}`);

        if (interaction.customId === "no") {
            log("User cancelled");
            return interaction.reply({ content: "Отменено ❌", ephemeral: true });
        }

if (interaction.customId.startsWith("yes_")) {
    const [, pStr, sStr] = interaction.customId.split("_");
    const primary = Number(pStr);
    const secondary = Number(sStr);

    log(`Creating role... primary=${primary}, secondary=${secondary}`);

    try {
        // 1. Создаём пустую роль (чтобы discord.js ничего не трогал сам)
        const role = await interaction.guild.roles.create({
            name: `Gradient-${pStr}`,
            reason: "Создано командой /random"
        });

        log(`Role created: ${role.id}`);
        log(`PATCH role => guild=${interaction.guild.id} role=${role.id}`);

        // 2. RAW PATCH на новые цвета
        const patchUrl = `https://discord.com/api/v10/guilds/${interaction.guild.id}/roles/${role.id}`;

        const patchBody = {
            colors: {
                primary_color: primary,
                secondary_color: secondary,
                tertiary_color: null
            }
        };

        const response = await fetch(patchUrl, {
            method: "PATCH",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bot ${process.env.TOKEN}`
            },
            body: JSON.stringify(patchBody)
        });

        if (!response.ok) {
            const text = await response.text();
            log(`PATCH FAILED: ${response.status} ${text}`);
            return interaction.reply({
                content: "Ошибка при применении градиента.",
                flags: 64
            });
        }

        log("PATCH OK");

        await interaction.reply({
            content: `Роль создана: <@&${role.id}> 🎉`,
            flags: 64
        });

        log("Gradient applied successfully.");
    } catch (e) {
        log("ERROR:", e);
        interaction.reply({
            content: "Ошибка при создании роли.",
            flags: 64
        });
    }
}
    }
});

// ===========================
client.login(TOKEN);
