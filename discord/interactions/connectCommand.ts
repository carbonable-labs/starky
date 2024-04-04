import {
  ActionRowBuilder,
  ChatInputCommandInteraction,
  Client,
  REST,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
} from "discord.js";
import { nanoid } from "nanoid";

import config from "../../config";
import { DiscordMemberRepository, DiscordServerRepository } from "../../db";
import { DiscordMember } from "../../db/entity/DiscordMember";
import { DiscordServer } from "../../db/entity/DiscordServer";

export const otherNetwork = (network: string) => {
  if (network == "goerli") {
    return "mainnet";
  }
  if (network == "mainnet") {
    return "goerli";
  }
};
export const handleConnectCommand = async (
  interaction: ChatInputCommandInteraction,
  client: Client<boolean>,
  restClient: REST
) => {
  if (!interaction.member) {
    await interaction.reply({
      content: "An error occured: Member not found",
      ephemeral: true,
    });
    return;
  }

  const guildId = interaction.guildId;
  const userId = interaction.member?.user?.id;
  if (!guildId || !userId) {
    await interaction.reply({ content: "An error occured", ephemeral: true });
    return;
  }

  let alreadyDiscordServer = await DiscordServerRepository.findOneBy({
    id: guildId,
  });

  if (alreadyDiscordServer === null) {
    console.log("Creating discord server");
    alreadyDiscordServer = new DiscordServer();
    alreadyDiscordServer.id = guildId;
    await DiscordServerRepository.save(alreadyDiscordServer);
  }

  const alreadyDiscordMembers = await DiscordMemberRepository.findBy({
    discordMemberId: userId,
    discordServer: alreadyDiscordServer,
  });
  const alreadyConnectedOnBothNetworks =
    alreadyDiscordMembers.length == 2 &&
    alreadyDiscordMembers[0].starknetWalletAddress &&
    alreadyDiscordMembers[1].starknetWalletAddress;

  if (alreadyDiscordMembers.length > 0) {
    if (alreadyConnectedOnBothNetworks) {
      // Connected to Goerli & Mainnet
      await interaction.reply({
        content:
          "You have already linked a Starknet wallet to this Discord server on both networks. Use `/starky-disconnect` first if you want to link a new one",
        ephemeral: true,
      });
      return;
    } else if (
      alreadyDiscordMembers[0].starknetWalletAddress &&
      alreadyDiscordMembers.length == 1
    ) {
      // Finished setup on one network
      const newDiscordMember = new DiscordMember();

      newDiscordMember.discordMemberId =
        alreadyDiscordMembers[0].discordMemberId;
      newDiscordMember.customLink = nanoid();
      newDiscordMember.discordServer = alreadyDiscordServer;
      newDiscordMember.discordServerId = alreadyDiscordServer.id;
      newDiscordMember.starknetNetwork =
        otherNetwork(alreadyDiscordMembers[0].starknetNetwork) ?? "";
      await DiscordMemberRepository.save(newDiscordMember);

      await interaction.reply({
        content: `
You already connected on this Network : ${
          alreadyDiscordMembers[0].starknetNetwork
        } 
Go to this link : ${config.BASE_URL}/verify/${guildId}/${userId}/${
          newDiscordMember.customLink
        } and verify your Starknet identity on network: ${otherNetwork(
          alreadyDiscordMembers[0].starknetNetwork
        )}!`,
        ephemeral: true,
      });
      return;
    } else if (
      alreadyDiscordMembers.length == 1 &&
      !alreadyDiscordMembers[0].starknetWalletAddress
    ) {
      await interaction.reply({
        content: `Go to this link : ${config.BASE_URL}/verify/${guildId}/${userId}/${alreadyDiscordMembers[0].customLink} and verify your Starknet identity on this network : ${alreadyDiscordMembers[0].starknetNetwork} ! You can start over by using  /starky-disconnect command. `,
        ephemeral: true,
      });
      return;
    } else if (
      alreadyDiscordMembers.length == 2 &&
      alreadyDiscordMembers[0].starknetWalletAddress &&
      !alreadyDiscordMembers[1].starknetWalletAddress
    ) {
      await interaction.reply({
        content: `Go to this link : ${config.BASE_URL}/verify/${guildId}/${userId}/${alreadyDiscordMembers[1].customLink} and verify your Starknet identity on this network : ${alreadyDiscordMembers[1].starknetNetwork}! You can start over by using  /starky-disconnect command.`,
        ephemeral: true,
      });
      return;
    } else if (
      alreadyDiscordMembers.length == 2 &&
      !alreadyDiscordMembers[0].starknetWalletAddress &&
      alreadyDiscordMembers[1].starknetWalletAddress
    ) {
      await interaction.reply({
        content: `Go to this link : ${config.BASE_URL}/verify/${guildId}/${userId}/${alreadyDiscordMembers[0].customLink} and verify your Starknet identity on this network : ${alreadyDiscordMembers[0].starknetNetwork}! You can start over by using  /starky-disconnect command.`,
        ephemeral: true,
      });
      return;
    }
  } else {
    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("user-config-network")
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

    await interaction.reply({
      content: "On what Starknet network do you want to connect to Starky?",
      components: [row],
      ephemeral: true,
    });
    return;
  }

  console.log("An error occured in Starky connect", {
    guildId,
    userId,
    alreadyDiscordMembers,
    alreadyDiscordServer,
  });

  await interaction.reply({
    content: "An error occured in /starky-connect",
    ephemeral: true,
  });
};

export const handleUserNetworkConfigCommand = async (
  interaction: StringSelectMenuInteraction,
  client: Client,
  restClient: REST
) => {
  const guildId = interaction.guildId;
  const userId = interaction.member?.user?.id;

  if (!guildId || !userId) {
    await interaction.reply({ content: "An error occured", ephemeral: true });
    return;
  }

  const alreadyDiscordServer = await DiscordServerRepository.findOneBy({
    id: guildId,
  });

  if (!alreadyDiscordServer) {
    await interaction.reply({
      content: "Starky is not yet configured on this server",
      ephemeral: true,
    });
    return;
  }
  const newDiscordMember = new DiscordMember();
  newDiscordMember.starknetNetwork = interaction.values[0];
  newDiscordMember.discordServerId = guildId;
  newDiscordMember.discordMemberId = userId;
  newDiscordMember.customLink = nanoid();
  newDiscordMember.discordServer = alreadyDiscordServer;

  await DiscordMemberRepository.save(newDiscordMember);

  await interaction.update({
    content: "Thanks, following up...",
    components: [],
  });

  await interaction.followUp({
    content: `Go to this link : ${config.BASE_URL}/verify/${guildId}/${userId}/${newDiscordMember.customLink} and verify your Starknet identity on network : ${interaction.values[0]}!`,
    ephemeral: true,
  });
};
