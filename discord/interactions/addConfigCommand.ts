import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChatInputCommandInteraction,
  Client,
  ModalActionRowComponentBuilder,
  ModalBuilder,
  ModalSubmitInteraction,
  REST,
  SelectMenuBuilder,
  SelectMenuComponentOptionData,
  SelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import {
  DiscordServerConfigRepository,
  DiscordServerRepository,
} from "../../db";
import { DiscordServer } from "../../db/entity/DiscordServer";
import { DiscordServerConfig } from "../../db/entity/DiscordServerConfig";
import starkyModules from "../../starkyModules";
import { getRoles, isBotRole } from "../role";

import { assertAdmin } from "./permissions";

type OngoingConfiguration = {
  network?: "mainnet" | "goerli";
  roleId?: string;
  moduleType?: string;
  moduleConfig?: any;
};

type OngoingConfigurationsCache = {
  [guildId: string]: OngoingConfiguration;
};

const ongoingConfigurationsCache: OngoingConfigurationsCache = {};

export const handleInitialConfigCommand = async (
  interaction: ChatInputCommandInteraction,
  client: Client,
  restClient: REST
) => {
  await assertAdmin(interaction);
  if (!interaction.guildId) return;
  ongoingConfigurationsCache[interaction.guildId] = {};

  const roles = await getRoles(restClient, interaction.guildId);
  // Showing roles, excluding everyone and the bot's role
  const options = roles
    .filter((role) => role.name !== "@everyone" && !isBotRole(role))
    .map((role) => ({
      label: role.name,
      value: role.id,
    }));

  if (options.length === 0) {
    await interaction.reply({
      content:
        "There are no roles setup on this Discord server. Please create a role first.",
      ephemeral: true,
    });
    return;
  }

  // slice only first 25 roles
  const row = new ActionRowBuilder<SelectMenuBuilder>().addComponents(
    new SelectMenuBuilder()
      .setCustomId("starky-config-role")
      .setPlaceholder("Role to assign")
      .addOptions(...options.slice(0, 25))
  );

// slice only next 25 roles
  const row2 = new ActionRowBuilder<SelectMenuBuilder>().addComponents(
    new SelectMenuBuilder()
      .setCustomId("starky-config-role")
      .setPlaceholder("Role to assign")
      .addOptions(...options.slice(25, 50))
  );

  await interaction.reply({
    content:
      "What role do you want to assign to people matching your criteria?",
    components: [row, row2],
    ephemeral: true,
  });
};

export const handleRoleConfigCommand = async (
  interaction: SelectMenuInteraction,
  client: Client,
  restClient: REST
) => {
  await assertAdmin(interaction);
  if (!interaction.guildId) return;
  const roles = await getRoles(restClient, interaction.guildId);
  const botRole = roles.find((role) => isBotRole(role));
  const selectedRole = roles.find((role) => role.id === interaction.values[0]);

  if (!botRole || !selectedRole) return;
  // Bot role position must be bigger (= higher on the list) than the selected role so we can assign
  if (botRole.position <= selectedRole.position) {
    await interaction.update({
      content: `❌ You have selected a role that the bot cannot control. Please place the role \`${botRole.name}\` above the role \`${selectedRole.name}\` in Server Settings > Roles and try again.`,
      components: [],
    });
    return;
  }


  // The following is removed to allow multiple configurations for the same role
  // const alreadyDiscordServerConfigForRole =
  //   await DiscordServerConfigRepository.findOneBy({
  //     discordServerId: interaction.guildId,
  //     discordRoleId: selectedRole.id,
  //   });

  // if (alreadyDiscordServerConfigForRole) {
  //   await interaction.update({
  //     content: `❌ You already have setup a Starky configuration for the selected role. If you want to setup a new configuration for this role, please first delete the existing one with \`/starky-delete-config\``,
  //     components: [],
  //   });
  //   return;
  // }

  ongoingConfigurationsCache[interaction.guildId].roleId =
    interaction.values[0];
  await interaction.update({
    content: "Thanks, following up...",
    components: [],
  });

  const row = new ActionRowBuilder<SelectMenuBuilder>().addComponents(
    new SelectMenuBuilder()
      .setCustomId("starky-config-network")
      .setPlaceholder("Starknet Network")
      .addOptions(
        {
          label: "Goerli",
          description: "The Goerli Starknet testnet",
          value: "goerli",
        },
        {
          label: "Mainnet",
          description: "The Starknet mainnet",
          value: "mainnet",
        }
      )
  );

  await interaction.followUp({
    content: "On what Starknet network do you want to set up Starky?",
    components: [row],
    ephemeral: true,
  });
};

export const handleNetworkConfigCommand = async (
  interaction: SelectMenuInteraction,
  client: Client,
  restClient: REST
) => {
  await assertAdmin(interaction);
  if (!interaction.guildId) return;
  const network = interaction.values[0];
  if (network !== "mainnet" && network !== "goerli") return;

  ongoingConfigurationsCache[interaction.guildId].network = network;
  await interaction.update({
    content: "Thanks, following up...",
    components: [],
  });

  const modulesOptions: SelectMenuComponentOptionData[] = [];
  for (const starkyModuleId in starkyModules) {
    const starkyModule = starkyModules[starkyModuleId];
    modulesOptions.push({
      label: starkyModule.name,
      value: starkyModuleId,
    });
  }

  const row = new ActionRowBuilder<SelectMenuBuilder>().addComponents(
    new SelectMenuBuilder()
      .setCustomId("starky-config-module-type")
      .setPlaceholder("Starky module to use")
      .addOptions(...modulesOptions)
  );
  await interaction.followUp({
    content: "What Starky module do you want to use?",
    components: [row],
    ephemeral: true,
  });
};

export const finishUpConfiguration = async (
  interaction: ModalSubmitInteraction | SelectMenuInteraction,
  client: Client,
  restClient: REST
) => {
  await assertAdmin(interaction);
  if (!interaction.guildId) return;

  const currentConfig = ongoingConfigurationsCache[interaction.guildId];
  const role = (await getRoles(restClient, interaction.guildId)).find(
    (r) => r.id === currentConfig.roleId
  );

  let summaryContent = `Thanks for configuring Starky 🎉\n\nHere is a summary of your configuration:\n\n__Starknet network:__ \`${
    currentConfig.network
  }\`\n__Discord role to assign:__ \`${role?.name}\`\n__Starky module:__ \`${
    currentConfig.moduleType
  }\`${currentConfig.moduleConfig ? "\n\nModule specific settings:\n" : ""}`;
  for (const fieldId in currentConfig.moduleConfig) {
    summaryContent = `${summaryContent}\n${fieldId}: \`${currentConfig.moduleConfig[fieldId]}\``;
  }
  summaryContent = `${summaryContent}\n\n**Do you want to save this configuration?**`;

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId("starcord-config-cancel")
      .setLabel("Cancel")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("starcord-config-confirm")
      .setLabel("Save configuration")
      .setStyle(ButtonStyle.Primary)
  );

  if (interaction.replied) {
    await interaction.editReply({
      content: summaryContent,
      components: [row],
    });
  } else {
    await interaction.reply({
      content: summaryContent,
      components: [row],
      ephemeral: true,
    });
  }
};

export const handleModuleTypeConfigCommand = async (
  interaction: SelectMenuInteraction,
  client: Client,
  restClient: REST
) => {
  await assertAdmin(interaction);
  if (!interaction.guildId) return;
  const starkyModuleId = interaction.values[0];
  ongoingConfigurationsCache[interaction.guildId].moduleType = starkyModuleId;
  const starkyModule = starkyModules[starkyModuleId];
  if (!starkyModule) return;

  if (starkyModule.fields.length === 0) {
    await interaction.update({
      content: "Thanks, following up...",
      components: [],
    });
    await finishUpConfiguration(interaction, client, restClient);
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId("starky-config-module-config")
    .setTitle(`Configure the ${starkyModule.name} Starky module`);
  const rows = starkyModule.fields.map((moduleField) =>
    new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId(moduleField.id)
        .setLabel(moduleField.question)
        .setStyle(
          moduleField.textarea ? TextInputStyle.Paragraph : TextInputStyle.Short
        )
        .setPlaceholder(moduleField.placeholder ? moduleField.placeholder : "")
    )
  );
  modal.addComponents(...rows);
  await interaction.showModal(modal);
  await interaction.editReply({
    content: "Thanks, following up...",
    components: [],
  });
};

export const handleModuleConfigCommand = async (
  interaction: ModalSubmitInteraction,
  client: Client,
  restClient: REST
) => {
  await assertAdmin(interaction);
  if (!interaction.guildId) return;

  const moduleConfig: any = {};
  interaction.fields.fields.forEach(
    (fieldValue) => (moduleConfig[fieldValue.customId] = fieldValue.value)
  );

  const currentConfig = ongoingConfigurationsCache[interaction.guildId];
  currentConfig.moduleConfig = moduleConfig;
  await finishUpConfiguration(interaction, client, restClient);
};

export const handleConfigCancelCommand = async (
  interaction: ButtonInteraction,
  client: Client,
  restClient: REST
) => {
  await assertAdmin(interaction);
  if (!interaction.guildId) return;

  delete ongoingConfigurationsCache[interaction.guildId];

  await interaction.update({
    content: "❌ Starky configuration aborted.",
    components: [],
  });
};

export const handleConfigConfirmCommand = async (
  interaction: ButtonInteraction,
  client: Client,
  restClient: REST
) => {
  await assertAdmin(interaction);
  if (!interaction.guildId) return;

  const currentConfig = ongoingConfigurationsCache[interaction.guildId];

  const alreadyDiscordServerConfig =
    await DiscordServerConfigRepository.findOneBy({
      discordServerId: interaction.guildId,
      starkyModuleConfig: currentConfig.moduleConfig,
      discordRoleId: currentConfig.roleId,
      starknetNetwork: currentConfig.network,
    });

  const alreadyDiscordServer = await DiscordServerRepository.findOneBy({
    id: interaction.guildId,
  });

  const discordServerConfig =
    alreadyDiscordServerConfig || new DiscordServerConfig();

  const discordServer = alreadyDiscordServer || new DiscordServer();
  discordServer.id = interaction.guildId;

  discordServerConfig.discordServerId = interaction.guildId;
  if (
    currentConfig.network !== "mainnet" &&
    currentConfig.network !== "goerli"
  ) {
    throw new Error("Wrong network config");
  }
  discordServerConfig.starknetNetwork = currentConfig.network;
  if (!currentConfig.roleId) {
    throw new Error("Wrong role config");
  }
  discordServerConfig.discordRoleId = currentConfig.roleId;
  if (
    !currentConfig.moduleType ||
    !(currentConfig.moduleType in starkyModules)
  ) {
    throw new Error("Wrong module config");
  }
  discordServerConfig.starkyModuleType = currentConfig.moduleType;

  discordServerConfig.starkyModuleConfig = currentConfig.moduleConfig || {};

  await DiscordServerRepository.save(discordServer);
  await DiscordServerConfigRepository.save(discordServerConfig);

  delete ongoingConfigurationsCache[interaction.guildId];

  await interaction.update({
    content: "✅ Thanks, your Starky configuration is now done.",
    components: [],
  });
};
