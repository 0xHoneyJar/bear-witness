import dotenv from "dotenv";
import fs from "fs";
import fetch from "node-fetch";
import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import chalk from "chalk";

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
      console.log(chalk.white(`[${timestamp}] ${level.toUpperCase()}: ${message}`));
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
              timestamp: parseInt(step.startTimestamp),
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
  const first = 100;

  while (hasNextPage) {
    try {
      const res = await fetch(IRYS_GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: `
            query getByOwner($tags: [TagFilter!], $first: Int!, $after: String) {
              transactions(
                owners: ["${OWNER_ADDRESS}"],
                tags: $tags,
                first: $first,
                after: $after
              ) {
                edges {
                  node {
                    id
                    tags {
                      name
                      value
                    }
                  }
                }
                pageInfo {
                  endCursor
                  hasNextPage
                }
              }
            }
          `,
          variables: {
            tags: [{ name: "questName", values: [questName] }],
            first: first,
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
      after = data.transactions.pageInfo.endCursor;
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
  timeWindow: number
): any[] {
  const matches: any[] = [];

  for (const mint of mints) {
    const relevantVisits = visits.filter(
      (visit) =>
        visit.address === mint.address &&
        visit.questName === mint.questName &&
        Math.abs(visit.timestamp - mint.timestamp) <= timeWindow * 60 * 1000
    );

    if (relevantVisits.length > 0) {
      matches.push({
        address: mint.address,
        questName: mint.questName,
        mintTimestamp: mint.timestamp,
        relevantVisits,
      });
    }
  }

  return matches;
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
    .parse();

  const { questName, timeWindow } = argv as {
    questName: string;
    timeWindow: number;
  };

  log("info", `Checking revenue share for quest: ${chalk.yellow(questName)}`);
  log("info", `Using time window: ${chalk.yellow(timeWindow)} minutes`);

  try {
    log("info", "Fetching onchain mints...");
    const onchainMints = await fetchOnchainMints(questName);
    log("success", `Fetched ${chalk.green(onchainMints.length)} onchain mints`);

    log("info", "Fetching website visits...");
    const websiteVisits = await fetchWebsiteVisits(questName);
    log("success", `Fetched ${chalk.green(websiteVisits.length)} website visits`);

    log("info", "Checking for revenue share matches...");
    const results = checkRevenueShare(onchainMints, websiteVisits, timeWindow);

    log("success", "Revenue Share Check Results:");
    console.log(chalk.cyan(JSON.stringify(results, null, 2)));

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
    log("success", `Results saved to ${chalk.underline(outputPath)}`);
  } catch (error) {
    log("error", `An error occurred during execution: ${error}`);
  }
};

main().catch((error) => {
  log("error", `Unhandled error in main execution: ${error}`);
  process.exit(1);
});