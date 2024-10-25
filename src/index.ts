import chalk from "chalk";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { formatEther } from "viem";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { INTERNAL_GRAPHQL_ENDPOINT } from "./config";
import { processDelegationsAndRewards } from "./delegation";
import { checkRevShare, PARTNERSHIP_TIERS } from "./revshare";

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

interface RevShareArgs {
  questName: string;
  timeWindow: number;
  ethPrice: string;
  partnershipTier: string;
  onchainOnly: boolean;
  amountIncludesPrice: boolean; // New flag
}

interface DelegationArgs {
  referrer: string;
  timeWindow: number;
  blockRange: number; // Number of blocks to process at a time
  startBlock?: number;
  endBlock?: number;
  startDate?: string;
  endDate?: string;
}

// Add a helper function to convert dates to block numbers
async function getBlockNumberFromDate(date: string): Promise<number> {
  const timestamp = Math.floor(new Date(date).getTime() / 1000);

  const query = `
    query GetBlockNumber($timestamp: BigInt!) {
      blocks(
        limit: 1
        orderBy: timestamp_ASC
        where: { timestamp_gte: $timestamp }
      ) {
        number
      }
    }
  `;

  try {
    const response = await fetch(INTERNAL_GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query,
        variables: { timestamp },
      }),
    });

    const responseData = await response.json();

    if (responseData.errors) {
      console.error("GraphQL errors:", responseData.errors);
      throw new Error("GraphQL query failed");
    }

    if (!responseData.data?.blocks?.[0]?.number) {
      console.error("No block found for timestamp:", timestamp);
      throw new Error("No block found for the given date");
    }

    return Number(responseData.data.blocks[0].number);
  } catch (error) {
    console.error("Error fetching block number:", error);
    // Fallback: Estimate block number based on average block time (2 seconds)
    const currentTimestamp = Math.floor(Date.now() / 1000);
    const secondsDiff = currentTimestamp - timestamp;
    const estimatedBlocks = Math.floor(secondsDiff / 2);

    // Get current block number
    const currentBlockQuery = `
      query {
        blocks(first: 1, orderBy: number_DESC) {
          number
        }
      }
    `;

    try {
      const currentBlockResponse = await fetch(INTERNAL_GRAPHQL_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: currentBlockQuery }),
      });

      const currentBlockData = await currentBlockResponse.json();

      if (!currentBlockData.data?.blocks?.[0]?.number) {
        throw new Error("Could not fetch current block number");
      }

      const currentBlock = Number(currentBlockData.data.blocks[0].number);
      const estimatedBlock = currentBlock - estimatedBlocks;

      console.warn(
        `Using estimated block number ${estimatedBlock} for date ${date}`
      );
      return estimatedBlock;
    } catch (fallbackError) {
      console.error("Fallback error:", fallbackError);
      throw new Error("Could not determine block number for the given date");
    }
  }
}

const main = async () => {
  const argv = await yargs(hideBin(process.argv))
    .command({
      command: "revshare",
      describe: "Check revenue share for a quest",
      builder: {
        questName: {
          alias: "q",
          type: "string",
          description: "Name of the quest to check",
          demandOption: true,
        },
        timeWindow: {
          alias: "t",
          type: "number",
          description: "Time window in minutes",
          default: 10,
        },
        ethPrice: {
          alias: "e",
          type: "string",
          description: "ETH price per item (in ETH)",
          demandOption: true,
        },
        partnershipTier: {
          alias: "p",
          type: "string",
          description: "Partnership tier",
          choices: PARTNERSHIP_TIERS.map((tier) => tier.name),
          demandOption: true,
        },
        onchainOnly: {
          alias: "o",
          type: "boolean",
          description:
            "Only check against on-chain data (skip off-chain check)",
          default: false,
        },
        amountIncludesPrice: {
          alias: "a",
          type: "boolean",
          description: "Indicates if the mint amount includes the ETH price",
          default: false,
        },
      },
      handler: async (argv) => {
        const {
          questName,
          timeWindow,
          ethPrice,
          partnershipTier,
          onchainOnly,
          amountIncludesPrice,
        } = argv as unknown as RevShareArgs;

        log(
          "info",
          `Checking revenue share for quest: ${chalk.yellow(questName)}`
        );
        log("info", `Using time window: ${chalk.yellow(timeWindow)} minutes`);
        log("info", `ETH price per item: ${chalk.yellow(ethPrice)} ETH`);
        log("info", `Partnership tier: ${chalk.yellow(partnershipTier)}`);
        log(
          "info",
          `On-chain only: ${chalk.yellow(onchainOnly ? "Yes" : "No")}`
        );
        log(
          "info",
          `Amount includes price: ${chalk.yellow(
            amountIncludesPrice ? "Yes" : "No"
          )}`
        );

        try {
          const results = await checkRevShare(
            questName,
            timeWindow,
            ethPrice,
            partnershipTier,
            onchainOnly,
            amountIncludesPrice
          );

          if (!onchainOnly && results.offchainResults) {
            log("info", "Quest Completions Results (Internal Use Only):");
            console.log(
              chalk.gray(
                JSON.stringify(
                  (results.offchainResults as any).summary,
                  null,
                  2
                )
              )
            );
            log(
              "info",
              `Total mint amount (off-chain): ${chalk.gray(
                (results.offchainResults as any).summary.totalMintAmount
              )}`
            );
            console.log(chalk.yellow("=".repeat(50)));
          }

          console.log(chalk.magenta("=".repeat(50)));
          if (onchainOnly) {
            log(
              "success",
              "📊 Revenue Share Results (Onchain Only) - SHARE THIS:"
            );
          } else {
            log(
              "success",
              "📊 Revenue Share Results (Website Visits) - SHARE THIS:"
            );
          }
          console.log(chalk.magenta("=".repeat(50)));

          const shareableResults = {
            questName,
            timeWindow,
            ethPrice,
            partnershipTier,
            ...results.websiteResults.summary,
          };

          console.log(chalk.cyan(JSON.stringify(shareableResults, null, 2)));
          console.log(chalk.magenta("=".repeat(50)));
          log(
            "success",
            `Total mint amount: ${chalk.green(
              results.websiteResults.summary.totalMintAmount
            )}`
          );
          console.log(chalk.magenta("=".repeat(50)));

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
          log(
            "success",
            `Full results saved to ${chalk.underline(outputPath)}`
          );
        } catch (error) {
          log("error", `An error occurred during execution: ${error}`);
        }
      },
    })
    .command({
      command: "delegation",
      describe: "Check delegation referrals and calculate rewards",
      builder: {
        referrer: {
          alias: "r",
          type: "string",
          description: "Address of the referrer",
          demandOption: true,
        },
        blockRange: {
          alias: "n",
          type: "number",
          description: "Number of blocks to process at a time",
          default: 100,
        },
        startBlock: {
          alias: "b",
          type: "number",
          description: "Start block for rewards calculation",
          demandOption: false,
        },
        endBlock: {
          alias: "e",
          type: "number",
          description: "End block for rewards calculation",
          demandOption: false,
        },
        startDate: {
          alias: "s",
          type: "string",
          description: "Start date (YYYY-MM-DD)",
          demandOption: false,
        },
        endDate: {
          alias: "d",
          type: "string",
          description: "End date (YYYY-MM-DD)",
          demandOption: false,
        },
        timeWindow: {
          alias: "t",
          type: "number",
          description: "Time window in minutes for matching delegations",
          default: 10,
        },
      },
      handler: async (argv) => {
        const {
          referrer,
          timeWindow,
          blockRange,
          startBlock: inputStartBlock,
          endBlock: inputEndBlock,
          startDate,
          endDate,
        } = argv as unknown as DelegationArgs;

        try {
          // Determine block range
          let startBlock = inputStartBlock;
          let endBlock = inputEndBlock;

          if (startDate) {
            startBlock = await getBlockNumberFromDate(startDate);
          }
          if (endDate) {
            endBlock = await getBlockNumberFromDate(endDate);
          }

          if (!startBlock || !endBlock) {
            throw new Error("Must provide either block range or date range");
          }

          log(
            "info",
            `Processing delegations for referrer: ${chalk.yellow(referrer)}`
          );
          log(
            "info",
            `Block range: ${chalk.yellow(startBlock)} to ${chalk.yellow(
              endBlock
            )}`
          );
          log(
            "info",
            `Processing ${chalk.yellow(blockRange)} blocks at a time`
          );

          // Process blocks in chunks
          for (
            let currentBlock = startBlock;
            currentBlock < endBlock;
            currentBlock += blockRange
          ) {
            const chunkEndBlock = Math.min(currentBlock + blockRange, endBlock);

            log(
              "info",
              `Processing blocks ${chalk.yellow(
                currentBlock
              )} to ${chalk.yellow(chunkEndBlock)}`
            );

            const results = await processDelegationsAndRewards({
              referrer,
              timeWindow,
              startBlock: currentBlock,
              endBlock: chunkEndBlock,
            });

            // Output results for this chunk
            console.log(
              chalk.magenta(
                `\n=== Results for blocks ${currentBlock}-${chunkEndBlock} ===`
              )
            );
            console.log(
              chalk.cyan(
                JSON.stringify(
                  {
                    summary: results.summary,
                    rewards: {
                      bgt: formatEther(results.rewards.bgt),
                      honey: formatEther(results.rewards.honey),
                    },
                    referrerShares: results.referrerShares.map((share) => ({
                      referrer: share.referrer,
                      bgtShare: formatEther(share.bgtShare),
                      honeyShare: formatEther(share.honeyShare),
                      delegationPercentage: `${share.delegationPercentage.toFixed(
                        2
                      )}%`,
                    })),
                  },
                  null,
                  2
                )
              )
            );

            // Save results for this chunk
            const outputDir = path.join(__dirname, "..", "output");
            if (!fs.existsSync(outputDir)) {
              fs.mkdirSync(outputDir, { recursive: true });
            }

            const outputPath = path.join(
              outputDir,
              `${referrer}_delegation_rewards_${currentBlock}_${chunkEndBlock}.json`
            );
            fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
            log("success", `Results saved to ${chalk.underline(outputPath)}`);
          }

          log("success", "Completed processing all blocks");
        } catch (error) {
          log("error", `An error occurred during execution: ${error}`);
        }
      },
    })
    .demandCommand(1, "You must use at least one command")
    .help()
    .parseAsync();
};

main().catch((error) => {
  log("error", `Unhandled error in main execution: ${error}`);
  process.exit(1);
});
