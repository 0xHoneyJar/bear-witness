import dotenv from "dotenv";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { checkDelegation } from "./delegation";
import { payout } from "./payout";
import { checkRevShare, PARTNERSHIP_TIERS } from "./revshare";
import { log } from "./utils";

dotenv.config();

// Load configuration
const configPath = path.join(__dirname, "..", "config", "default.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));

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
  startDate?: string;
  endDate?: string;
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
      describe: "Check delegation referrals",
      builder: {
        referrer: {
          alias: "r",
          type: "string",
          description: "Address of the referrer",
          demandOption: true,
        },
        startDate: {
          alias: "s",
          type: "string",
          description: "Start date for the check (YYYY-MM-DD)",
          demandOption: false,
        },
        endDate: {
          alias: "e",
          type: "string",
          description: "End date for the check (YYYY-MM-DD)",
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
        const { referrer, startDate, endDate, timeWindow } =
          argv as unknown as DelegationArgs;
        log(
          "info",
          `Checking delegation referrals for: ${chalk.yellow(referrer)}`
        );
        if (startDate && endDate) {
          log(
            "info",
            `Date range: ${chalk.yellow(startDate)} to ${chalk.yellow(endDate)}`
          );
        } else {
          log(
            "info",
            "Fetching all delegation referrals (no date range specified)"
          );
        }
        log("info", `Using time window: ${chalk.yellow(timeWindow)} minutes`);

        try {
          const results = await checkDelegation(
            referrer,
            timeWindow,
            startDate,
            endDate
          );
          log("success", "Delegation Referral Check Results:");
          console.log(chalk.cyan(JSON.stringify(results.summary, null, 2)));

          // Create output directory if it doesn't exist
          const outputDir = path.join(__dirname, "..", "output");
          if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
          }

          // Output results to a file
          const outputPath = path.join(
            outputDir,
            `${referrer}_delegation_results.json`
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
      command: "payout",
      describe: "Payout delegations",
      builder: {
        referrer: {
          alias: "r",
          type: "string",
          description: "Address of the referrer",
          demandOption: true,
          default: "thj",
        },
        validator: {
          alias: "v",
          type: "string",
          description: "Address of the validator",
          demandOption: true,
        },
        operator: {
          alias: "o",
          type: "string",
          description: "Address of the operator",
          demandOption: true,
        },
        startBlock: {
          alias: "s",
          type: "string",
          description: "Start block for the payout",
          demandOption: true,
        },
        endBlock: {
          alias: "e",
          type: "string",
          description: "End block for the payout",
          demandOption: true,
        },
        mock: {
          alias: "m",
          type: "boolean",
          description: "Mock the payout",
          demandOption: false,
        },
      },
      handler: async (argv) => {
        const { referrer, validator, operator, startBlock, endBlock, mock } =
          argv;
        try {
          await payout(
            referrer,
            validator,
            operator,
            startBlock,
            endBlock,
            mock
          );
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
