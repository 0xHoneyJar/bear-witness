import chalk from "chalk";

export function log(level: string, message: string) {
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
