# RevShare and Delegation Verifier

This tool allows CubQuest partners to verify revenue sharing for their quests and check delegation referrals.

## How It Works

The tool provides two main functionalities:

1. RevShare Verification: Compares onchain mints against website visits and off-chain progress.
   - Website visits are tracked on the Irys blockchain, ensuring tamper-proof logging of user activity.
2. Delegation Referral Check: Analyzes delegation events and calculates reward shares for referrers.
   - Tracks BGT and HONEY rewards received by the operator
   - Calculates referrer shares based on their proportion of valid delegations
   - Verifies delegation lifecycle (queue → activate/cancel → drop)

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
npm start delegation -- \
  --referrer "0xYourReferrerAddress" \
  --startBlock 123456 \
  --endBlock 234567 \
  --timeWindow 10 \
  [--startDate "2024-03-01"] \
  [--endDate "2024-03-20"]
```

Required parameters:

- `--referrer` or `-r`: The address of the referrer
- `--startBlock` or `-b`: Start block for rewards calculation
- `--endBlock` or `-n`: End block for rewards calculation

Optional parameters:

- `--timeWindow` or `-t`: Time window in minutes for matching delegations (default: 10)
- `--startDate` or `-s`: Start date for delegation check (YYYY-MM-DD format)
- `--endDate` or `-e`: End date for delegation check (YYYY-MM-DD format)

The delegation check will:

1. Verify delegations by matching off-chain and on-chain events
2. Track rewards (BGT and HONEY) received by the operator
3. Calculate referrer shares based on their proportion of valid delegations
4. Output detailed summaries of:
   - Delegation statistics
   - Rewards received
   - Referrer share calculations

## Output

### RevShare Output

The script outputs revenue share calculations based on website visits and/or off-chain progress.

### Delegation Output

The script generates three sections:

1. Delegation Summary:

   - Total number of delegations
   - Total delegated amount
   - Number of unique delegators

2. Rewards Summary:

   - BGT rewards received
   - HONEY rewards received
   - Block range covered

3. Referrer Shares:
   - Delegation percentage
   - BGT share (25% of rewards)
   - HONEY share (25% of rewards)

All results are saved to JSON files in the `output` directory for future reference.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
