# CubQuest RevShare Verifier

This tool allows CubQuest partners to verify revenue sharing for their quests by checking onchain mints against website visits.

## How It Works

The CubQuest RevShare Verifier operates by comparing two sets of data:

1. Website Visits: These are stored on the [Irys](https://irys.xyz/) testnet blockchain. Each visit to a quest page is recorded as a transaction on Irys, providing a tamper-proof log of user activity.

2. Onchain Mints: The tool tracks NFT mints that occur on the main blockchain where CubQuest operates.

The verifier then matches these two datasets within a specified time window, allowing partners to confirm that mints are correctly attributed to their quest visits.

## Prerequisites

- Node.js (v14 or later)
- npm or yarn

## Setup

1. Clone this repository:

   ```
   git clone https://github.com/your-username/cubquest-revshare-verifier.git
   cd cubquest-revshare-verifier
   ```

2. Install dependencies:

   ```
   npm install
   ```

3. Configure the tool:
   - Copy `config/default.json.example` to `config/default.json`
   - Update the values in `config/default.json` with your specific endpoints and addresses

## Usage

Run the script with the following command:

```
npm start -- --questName "Your Quest Name" --timeWindow 10 --ethPrice "0.1" --partnershipTier "Gold"
```

- `--questName` or `-q`: The name of the quest to check (required)
- `--timeWindow` or `-t`: The time window in minutes for matching mints and visits (default: 10)
- `--ethPrice` or `-e`: The ETH price per item in ETH (required, use decimal format, e.g., "0.1" for 0.1 ETH)
- `--partnershipTier` or `-p`: The partnership tier (required, choices: "Flagship (Platinum)", "Strategic (Gold)", "Integration (Silver)", "Ecosystem (Bronze)")

## Output

The script will output a summary of the revenue share check in the console, showing:

- Quest name
- Partnership tier
- Tier percentage
- Total number of matches between onchain mints and website visits
- ETH price per item
- Total payout amount in ETH

Additionally, a detailed JSON file will be saved in the `output` directory, containing:

1. The summary information
2. An array of all matches, each including:
   - Address of the minter
   - Quest name
   - Mint timestamp
   - Relevant website visits

This allows for both a quick overview of the results and access to detailed information if needed.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
