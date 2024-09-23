# RevShare and Delegation Verifier

This tool allows CubQuest partners to verify revenue sharing for their quests and check delegation referrals.

## How It Works

The tool provides two main functionalities:

1. RevShare Verification: Compares onchain mints against website visits and off-chain progress.
   - Website visits are tracked on the Irys blockchain, ensuring tamper-proof logging of user activity.
2. Delegation Referral Check: Analyzes delegation events for a given referrer within a specified date range.

## Prerequisites

- Node.js (v14 or later)
- npm or yarn

## Setup

1. Clone this repository:

   ```
   git clone https://github.com/your-username/cubquest-verifier.git
   cd cubquest-verifier
   ```

2. Install dependencies:

   ```
   npm install
   ```

3. Configure the tool:
   - Copy `config/default.json.example` to `config/default.json`
   - Update the values in `config/default.json` with your specific endpoints and addresses

## Usage

The tool supports two commands: `revshare` and `delegation`.

### RevShare Check

Run the script with the following command:

```
npm start revshare -- --questName "Your Quest Name" --timeWindow 10 --ethPrice "0.1" --partnershipTier "Gold" [--onchainOnly] [--amountIncludesPrice]
```

- `--questName` or `-q`: The name of the quest to check (required)
- `--timeWindow` or `-t`: The time window in minutes for matching mints and visits (default: 10)
- `--ethPrice` or `-e`: The ETH price per item in ETH (required, use decimal format, e.g., "0.1" for 0.1 ETH)
- `--partnershipTier` or `-p`: The partnership tier (required, choices: "Flagship (Platinum)", "Strategic (Gold)", "Integration (Silver)", "Ecosystem (Bronze)")
- `--onchainOnly` or `-o`: Only check against on-chain data, skipping the off-chain progress check (optional, default: false)
- `--amountIncludesPrice` or `-a`: Indicates if the mint amount already includes the ETH price (optional, default: false)

### Delegation Check

Run the script with the following command:

```
npm start delegation -- --referrer "Referrer Address" --startDate "YYYY-MM-DD" --endDate "YYYY-MM-DD"
```

- `--referrer` or `-r`: The address of the referrer (required)
- `--startDate` or `-s`: The start date for the check (optional, YYYY-MM-DD format)
- `--endDate` or `-e`: The end date for the check (optional, YYYY-MM-DD format)

## Output

The script will output two summaries of the revenue share check in the console:

1. Based on website visits
2. Based on off-chain progress

Each summary shows:

- Quest name
- Partnership tier
- Tier percentage
- Total number of matches
- Total number of mints
- Total mint amount in ETH
- ETH price per item
- Total payout amount in ETH

Additionally, a detailed JSON file will be saved in the `output` directory, containing:

1. Website visit results:
   - The summary information
   - An array of all matches with website visits
2. Off-chain progress results:
   - The summary information
   - An array of all matches with off-chain progress

This allows for a comprehensive overview of revenue share calculations based on both on-chain and off-chain data.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
