import chalk from "chalk";
import dotenv from "dotenv";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";
import { formatEther, parseEther } from "viem";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

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

async function fetchOnchainMints(questName: string): Promise<OnchainMint[]> {
  let allMints: OnchainMint[] = [];
  let hasMore = true;
  let offset = 0;
  const limit = 1000;

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
            .map((step: any) => ({
              address: progress.address,
              timestamp: parseInt(step.startTimestamp) * 1000, // Convert to milliseconds
              questName,
            }))
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

  return allMints;
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
  const tierInfo = PARTNERSHIP_TIERS.find((tier) => tier.fullName === partnershipTier);
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
      matches.push({
        address: mint.address,
        questName: mint.questName,
        mintTimestamp: mint.timestamp,
        relevantVisits,
      });
    }
  }

  const totalPayout = (ethPrice * BigInt(Math.round(tierPercentage * 100)) * BigInt(totalMatches)) / 10000n;

  return {
    summary: {
      questName: mints[0]?.questName || "Unknown",
      partnershipTier,
      tierPercentage,
      totalMatches,
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
    log("info", "Fetching onchain mints...");
    const onchainMints = await fetchOnchainMints(questName);
    log("success", `Fetched ${chalk.green(onchainMints.length)} onchain mints`);

    log("info", "Fetching website visits...");
    const websiteVisits = await fetchWebsiteVisits(questName);
    log(
      "success",
      `Fetched ${chalk.green(websiteVisits.length)} website visits`
    );

    log("info", "Checking for revenue share matches...");
    const results = checkRevenueShare(
      onchainMints,
      websiteVisits,
      timeWindow,
      ethPriceBigInt,
      fullPartnershipTier
    );

    log("success", "Revenue Share Check Results:");
    console.log(chalk.cyan(JSON.stringify(results.summary, null, 2)));
    log("info", `Total matches found: ${results.matches.length}`);

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
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    log("success", `Full results saved to ${chalk.underline(outputPath)}`);
  } catch (error) {
    log("error", `An error occurred during execution: ${error}`);
  }
};

main().catch((error) => {
  log("error", `Unhandled error in main execution: ${error}`);
  process.exit(1);
});
