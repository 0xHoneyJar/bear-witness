import chalk from "chalk";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { checkDelegation } from "./delegation";
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
      },
      handler: async (argv) => {
        const { questName, timeWindow, ethPrice, partnershipTier } =
          argv as unknown as RevShareArgs;

        log(
          "info",
          `Checking revenue share for quest: ${chalk.yellow(questName)}`
        );
        log("info", `Using time window: ${chalk.yellow(timeWindow)} minutes`);
        log("info", `ETH price per item: ${chalk.yellow(ethPrice)} ETH`);
        log("info", `Partnership tier: ${chalk.yellow(partnershipTier)}`);

        try {
          const results = await checkRevShare(
            questName,
            timeWindow,
            ethPrice,
            partnershipTier
          );

          log("success", "Revenue Share Check Results (Website Visits):");
          console.log(
            chalk.cyan(JSON.stringify(results.websiteResults.summary, null, 2))
          );
          log(
            "info",
            `Total mint amount: ${results.websiteResults.summary.totalMintAmount}`
          );

          log("success", "Revenue Share Check Results (Off-chain Progress):");
          console.log(
            chalk.cyan(JSON.stringify(results.offchainResults.summary, null, 2))
          );
          log(
            "info",
            `Total mint amount: ${results.offchainResults.summary.totalMintAmount}`
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
    .demandCommand(1, "You must use at least one command")
    .help()
    .parseAsync();
};

main().catch((error) => {
  log("error", `Unhandled error in main execution: ${error}`);
  process.exit(1);
});
