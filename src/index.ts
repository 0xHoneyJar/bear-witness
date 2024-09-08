import chalk from "chalk";
import dotenv from "dotenv";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";
import { formatEther, parseEther } from "viem";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { supabase } from "./supabase";
import { Step, StepType, VerifyType } from "./types";

dotenv.config();

// Load configuration
const configPath = path.join(__dirname, "..", "config", "default.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

// Set up colored logging
function log(level: string, message: string) {
  const timestamp = new Date().toISOString();
  switch (level.toLowerCase()) {
    case "info":
      console.log(chalk.blue(`[${timestamp}] INFO: ${message}`));
      break;
    case "error":
      console.log(chalk.red(`[${timestamp}] ERROR: ${message}`));
      break;
    case "success":
      console.log(chalk.green(`[${timestamp}] SUCCESS: ${message}`));
      break;
    default:
      console.log(
        chalk.white(`[${timestamp}] ${level.toUpperCase()}: ${message}`)
      );
  }
}

interface OnchainMint {
  address: string;
  timestamp: number;
  questName: string;
  amount: number;
}

interface WebsiteVisit {
  address: string;
  timestamp: number;
  questName: string;
}

interface PartnershipTier {
  name: string;
  fullName: string;
  percentage: number;
}

const PARTNERSHIP_TIERS: PartnershipTier[] = [
  { name: "Platinum", fullName: "Flagship (Platinum)", percentage: 4.2 },
  { name: "Gold", fullName: "Strategic (Gold)", percentage: 6.9 },
  { name: "Silver", fullName: "Integration (Silver)", percentage: 10 },
  { name: "Bronze", fullName: "Ecosystem (Bronze)", percentage: 12.5 },
];

const GRAPHQL_ENDPOINT = config.GRAPHQL_ENDPOINT;
const IRYS_GRAPHQL_ENDPOINT = config.IRYS_GRAPHQL_ENDPOINT;
const OWNER_ADDRESS = config.OWNER_ADDRESS;

async function fetchOnchainMints(
  questName: string
): Promise<{ mints: OnchainMint[]; totalMints: number }> {
  let allMints: OnchainMint[] = [];
  let hasMore = true;
  let offset = 0;
  const limit = 1000;
  let totalMints = 0;

  while (hasMore) {
    try {
      const response = await fetch(GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `
            query GetQuestMints($questName: String!, $limit: Int!, $offset: Int!) {
              userQuestProgresses(
                where: {
                  id_contains: $questName
                }
                limit: $limit
                offset: $offset
              ) {
                address
                stepProgresses {
                  stepNumber
                  completed
                  startTimestamp
                  progressAmount
                }
              }
            }
          `,
          variables: {
            questName: questName.replace(/\s+/g, "-").toLowerCase(),
            limit,
            offset,
          },
        }),
      });

      const { data } = (await response.json()) as any;

      if (data.userQuestProgresses && data.userQuestProgresses.length > 0) {
        const mints = data.userQuestProgresses.flatMap((progress: any) =>
          progress.stepProgresses
            .filter((step: any) => step.completed)
            .map((step: any) => {
              const amount = parseInt(step.progressAmount) || 1;
              totalMints += amount;
              return {
                address: progress.address,
                timestamp: parseInt(step.startTimestamp) * 1000,
                questName,
                amount: amount,
              };
            })
        );
        allMints = [...allMints, ...mints];
        offset += limit;
      } else {
        hasMore = false;
      }
    } catch (error) {
      log("error", `Error fetching onchain mints: ${error}`);
      hasMore = false;
    }
  }

  return { mints: allMints, totalMints };
}

async function fetchWebsiteVisits(questName: string): Promise<WebsiteVisit[]> {
  let allVisits: WebsiteVisit[] = [];
  let hasNextPage = true;
  let after = null;
  const limit = 100;

  while (hasNextPage) {
    try {
      const res = await fetch(IRYS_GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `
            query getByOwner($tags: [TagFilter!], $limit: Int!, $after: String) {
              transactions(
                owners: ["${OWNER_ADDRESS}"],
                tags: $tags,
                limit: $limit,
                after: $after,
                order: DESC
              ) {
                edges {
                  node {
                    id
                    tags {
                      name
                      value
                    }
                  }
                  cursor
                }
                pageInfo {
                  hasNextPage
                }
              }
            }
          `,
          variables: {
            tags: [{ name: "questName", values: [questName] }],
            limit: limit,
            after: after,
          },
        }),
      });

      const { data } = (await res.json()) as any;

      const visits = data.transactions.edges.map((edge: any) => {
        const tags = edge.node.tags;
        return {
          address: tags.find((tag: any) => tag.name === "address")?.value,
          timestamp: parseInt(
            tags.find((tag: any) => tag.name === "timestamp")?.value || "0"
          ),
          questName: tags.find((tag: any) => tag.name === "questName")?.value,
        };
      });

      allVisits = [...allVisits, ...visits];

      hasNextPage = data.transactions.pageInfo.hasNextPage;
      after =
        data.transactions.edges[data.transactions.edges.length - 1]?.cursor;
    } catch (error) {
      log("error", `Error fetching website visits: ${error}`);
      hasNextPage = false;
    }
  }

  return allVisits;
}

function checkRevenueShare(
  mints: OnchainMint[],
  visits: WebsiteVisit[],
  timeWindow: number,
  ethPrice: bigint,
  partnershipTier: string
): any {
  let totalMatches = 0;
  let totalMintAmount = 0;
  const tierInfo = PARTNERSHIP_TIERS.find(
    (tier) => tier.fullName === partnershipTier
  );
  const tierPercentage = tierInfo ? tierInfo.percentage : 0;
  const matches: any[] = [];

  for (const mint of mints) {
    const relevantVisits = visits.filter(
      (visit) =>
        visit.address.toLowerCase() === mint.address.toLowerCase() &&
        visit.questName === mint.questName &&
        BigInt(Math.abs(visit.timestamp - mint.timestamp)) <=
          BigInt(timeWindow) * 60n * 1000n
    );

    if (relevantVisits.length > 0) {
      totalMatches++;
      totalMintAmount += mint.amount;
      matches.push({
        address: mint.address,
        questName: mint.questName,
        mintTimestamp: mint.timestamp,
        mintAmount: mint.amount,
        relevantVisits,
      });
    }
  }

  const totalPayout =
    (ethPrice *
      BigInt(Math.round(tierPercentage * 100)) *
      BigInt(totalMintAmount)) /
    10000n;

  return {
    summary: {
      questName: mints[0]?.questName || "Unknown",
      partnershipTier,
      tierPercentage,
      totalMatches,
      totalMintAmount,
      ethPricePerItem: formatEther(ethPrice),
      totalPayout: formatEther(totalPayout),
    },
    matches,
  };
}

export const MISC_STEPS = [
  StepType.Wait,
  StepType.Verify,
  StepType.Logout,
  StepType.Watch,
  VerifyType.Farcaster,
  VerifyType.Onchain,
  VerifyType.Manual,
  VerifyType.Referrals,
];

function getVerifiableStepIndices(steps: Step[]): number[] {
  const orGroupIndices = steps
    .map((step, index) => (step.orGroup ? index + 1 : null))
    .filter((index): index is number => index !== null);

  const verifiableIndices = steps.reduce(
    (verifiableIndices: number[], step, index) => {
      const stepIndex = index + 1; // 1-based index
      const isVerifiableStep =
        !MISC_STEPS.includes(step.type as StepType) &&
        step.type !== StepType.Mint &&
        step.type !== StepType.Onchain &&
        (!step.verificationType ||
          !MISC_STEPS.includes(step.verificationType as VerifyType));

      if (isVerifiableStep && !orGroupIndices.includes(stepIndex)) {
        verifiableIndices.push(stepIndex);
      }
      return verifiableIndices;
    },
    []
  );

  return verifiableIndices;
}

interface Quest {
  id: string;
  title: string;
  steps: Step[];
  tracked_steps: number[];
}

async function fetchQuestDetails(questTitle: string): Promise<Quest | null> {
  const { data, error } = await supabase
    .from("quests")
    .select("*")
    .eq("title", questTitle)
    .single();

  if (error) {
    log("error", `Error fetching quest details: ${error.message}`);
    return null;
  }

  const quest = data as Quest;
  quest.tracked_steps = getVerifiableStepIndices(quest.steps);

  return quest;
}

async function fetchAllOffchainProgress(
  quest: Quest,
  votedFor?: string
): Promise<string[]> {
  let allRows: string[] = [];
  let from = 0;
  const limit = 10000;

  while (true) {
    let query = supabase
      .from("quest_progress")
      .select("address")
      .range(from, from + limit - 1)
      .eq("quest_name", quest.title)
      .contains(
        "tracked_steps",
        Object.fromEntries(
          quest.tracked_steps.map((stepIndex) => [stepIndex, true])
        )
      );

    if (votedFor) {
      query = query.eq("voted_for", votedFor);
    }

    const { data, error } = await query;
    if (error || !Array.isArray(data) || data.length === 0) break;

    allRows = allRows.concat(data.map((row) => row.address));
    from += limit;
    if (data.length < limit) break;
  }

  return allRows;
}

async function checkOffchainRevShare(
  mints: OnchainMint[],
  quest: Quest,
  ethPrice: bigint,
  partnershipTier: string,
  votedFor?: string
): Promise<any> {
  let totalMatches = 0;
  let totalMintAmount = 0;
  const tierInfo = PARTNERSHIP_TIERS.find(
    (tier) => tier.fullName === partnershipTier
  );
  const tierPercentage = tierInfo ? tierInfo.percentage : 0;
  const matches: any[] = [];

  // Fetch off-chain progress
  const offchainProgress = await fetchAllOffchainProgress(quest, votedFor);

  for (const mint of mints) {
    let isMatch = offchainProgress.includes(mint.address.toLowerCase());

    if (isMatch) {
      totalMatches++;
      totalMintAmount += mint.amount;
      matches.push({
        address: mint.address,
        questName: mint.questName,
        mintTimestamp: mint.timestamp,
        mintAmount: mint.amount,
      });
    }
  }

  const totalPayout =
    (ethPrice *
      BigInt(Math.round(tierPercentage * 100)) *
      BigInt(totalMintAmount)) /
    10000n;

  return {
    summary: {
      questName: quest.title,
      partnershipTier,
      tierPercentage,
      totalMatches,
      totalMintAmount,
      ethPricePerItem: formatEther(ethPrice),
      totalPayout: formatEther(totalPayout),
    },
    matches,
  };
}

const main = async () => {
  const argv = yargs(hideBin(process.argv))
    .option("questName", {
      alias: "q",
      type: "string",
      description: "Name of the quest to check",
      demandOption: true,
    })
    .option("timeWindow", {
      alias: "t",
      type: "number",
      description: "Time window in minutes",
      default: 10,
    })
    .option("ethPrice", {
      alias: "e",
      type: "string",
      description: "ETH price per item (in ETH)",
      demandOption: true,
    })
    .option("partnershipTier", {
      alias: "p",
      type: "string",
      description: "Partnership tier",
      choices: PARTNERSHIP_TIERS.map((tier) => tier.name),
      demandOption: true,
    })
    .parse();

  const { questName, timeWindow, ethPrice, partnershipTier } = argv as {
    questName: string;
    timeWindow: number;
    ethPrice: string;
    partnershipTier: string;
  };

  const ethPriceBigInt = parseEther(ethPrice);
  const fullPartnershipTier =
    PARTNERSHIP_TIERS.find(
      (tier) => tier.name.toLowerCase() === partnershipTier.toLowerCase()
    )?.fullName || partnershipTier;

  log("info", `Checking revenue share for quest: ${chalk.yellow(questName)}`);
  log("info", `Using time window: ${chalk.yellow(timeWindow)} minutes`);
  log("info", `ETH price per item: ${chalk.yellow(ethPrice)} ETH`);
  log("info", `Partnership tier: ${chalk.yellow(fullPartnershipTier)}`);

  try {
    log("info", "Fetching quest details...");
    const questDetails = await fetchQuestDetails(questName);
    if (!questDetails) {
      log("error", `Quest "${questName}" not found`);
      return;
    }
    log(
      "success",
      `Fetched details for quest: ${chalk.yellow(questDetails.title)}`
    );

    log("info", "Fetching onchain mints...");
    const { mints: onchainMints, totalMints } = await fetchOnchainMints(
      questName
    );
    log(
      "success",
      `Fetched ${chalk.green(
        onchainMints.length
      )} onchain mint transactions with a total of ${chalk.green(
        totalMints
      )} mints`
    );

    log("info", "Fetching website visits...");
    const websiteVisits = await fetchWebsiteVisits(questName);
    log(
      "success",
      `Fetched ${chalk.green(websiteVisits.length)} website visits`
    );

    log("info", "Checking for revenue share matches with website visits...");
    const websiteResults = checkRevenueShare(
      onchainMints,
      websiteVisits,
      timeWindow,
      ethPriceBigInt,
      fullPartnershipTier
    );

    log(
      "info",
      "Checking for revenue share matches with off-chain progress..."
    );
    const offchainResults = await checkOffchainRevShare(
      onchainMints,
      questDetails,
      ethPriceBigInt,
      fullPartnershipTier
    );

    log("success", "Revenue Share Check Results (Website Visits):");
    console.log(chalk.cyan(JSON.stringify(websiteResults.summary, null, 2)));
    log("info", `Total mint amount: ${websiteResults.summary.totalMintAmount}`);

    log("success", "Revenue Share Check Results (Off-chain Progress):");
    console.log(chalk.cyan(JSON.stringify(offchainResults.summary, null, 2)));
    log(
      "info",
      `Total mint amount: ${offchainResults.summary.totalMintAmount}`
    );

    // Create output directory if it doesn't exist
    const outputDir = path.join(__dirname, "..", "output");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Output results to a file
    const outputPath = path.join(
      outputDir,
      `${questName.replace(/\s+/g, "_")}_results.json`
    );
    fs.writeFileSync(
      outputPath,
      JSON.stringify(
        {
          websiteResults,
          offchainResults,
        },
        null,
        2
      )
    );
    log("success", `Full results saved to ${chalk.underline(outputPath)}`);
  } catch (error) {
    log("error", `An error occurred during execution: ${error}`);
  }
};

main().catch((error) => {
  log("error", `Unhandled error in main execution: ${error}`);
  process.exit(1);
});
